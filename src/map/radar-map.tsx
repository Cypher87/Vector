'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttributionControl, GeoJSONSource, Map as MapLibre, Marker } from 'maplibre-gl';
import type { Aircraft, AircraftTracePoint, UnitSystem } from '../domain/aircraft';
import { aircraftKind, aircraftKindLabel } from '../domain/aircraft-kind';
import { loadAircraftLegTrace } from '../data/readsb';
import { translate, type Language } from '../i18n';
import { mapAltitudeLabel } from '../units';
import { altitudeColor, altitudeColorForValue } from './altitude-color';
import { createAircraftIconElement, updateAircraftIconElement } from './aircraft-icon';
import { aircraftHeadingRotation } from './heading';

type RadarMapProps = {
  aircraft: Aircraft[];
  center: [longitude: number, latitude: number];
  dataBaseUrl: string;
  focusTarget?: { latitude?: number; longitude?: number; request: number };
  following: boolean;
  labelsVisible: boolean;
  legTraceVisible: boolean;
  language: Language;
  mapStyleUrl: string;
  onDeselect: () => void;
  onLabelsVisibleChange: (visible: boolean) => void;
  onLegTraceVisibleChange: (visible: boolean) => void;
  onSelect: (id: string) => void;
  recordLiveTrace: boolean;
  selectedId?: string;
  unitSystem: UnitSystem;
};

type AircraftMarker = {
  aircraft?: Aircraft;
  altitude: HTMLSpanElement;
  displayedTrackDeg: number;
  element: HTMLButtonElement;
  flight: HTMLElement;
  icon: SVGSVGElement;
  label: HTMLSpanElement;
  marker: Marker;
  priority: number;
  selected: boolean;
  targetPosition?: [longitude: number, latitude: number];
  targetTrackDeg: number;
};

type LabelBox = { bottom: number; left: number; right: number; top: number };
type TraceFeature = {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: number[][] } | { type: 'Point'; coordinates: number[] };
  properties: { color: string; kind: 'trace' | 'leg-start'; stale: boolean };
};
type TraceFeatureCollection = { type: 'FeatureCollection'; features: TraceFeature[] };

const overlaps = (first: LabelBox, second: LabelBox) =>
  first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;

const shortestAngleDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const markerDistanceMetres = (
  from: [longitude: number, latitude: number],
  to: [longitude: number, latitude: number],
) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(to[1] - from[1]);
  const deltaLongitude = radians(to[0] - from[0]);
  const originLatitude = radians(from[1]);
  const destinationLatitude = radians(to[1]);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const emptyTraceData = (): TraceFeatureCollection => ({ type: 'FeatureCollection', features: [] });

const traceData = (points: AircraftTracePoint[]): TraceFeatureCollection => {
  const features: TraceFeature[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [previous.longitude, previous.latitude],
          [current.longitude, current.latitude],
        ],
      },
      properties: {
        color: altitudeColorForValue(current.altitudeFt ?? previous.altitudeFt, current.onGround),
        kind: 'trace',
        stale: previous.stale || current.stale,
      },
    });
  }

  const firstPoint = points[0];
  if (firstPoint) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [firstPoint.longitude, firstPoint.latitude] },
      properties: {
        color: altitudeColorForValue(firstPoint.altitudeFt, firstPoint.onGround),
        kind: 'leg-start',
        stale: firstPoint.stale,
      },
    });
  }
  return { type: 'FeatureCollection', features };
};

const mapControlLabels = (language: Language) => ({
  center: translate(language, 'centerReceiver'),
  zoomIn: translate(language, 'zoomIn'),
  zoomOut: translate(language, 'zoomOut'),
});

const createMapNavigationControl = (center: [number, number], language: Language) => {
  let container: HTMLDivElement | undefined;
  let controls: { center: HTMLButtonElement; zoomIn: HTMLButtonElement; zoomOut: HTMLButtonElement } | undefined;

  const button = (className: string, label: string, onClick: () => void, symbol?: string) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.addEventListener('click', onClick);
    const icon = document.createElement('span');
    icon.className = 'maplibregl-ctrl-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (symbol) icon.textContent = symbol;
    element.appendChild(icon);
    return element;
  };

  const setLanguage = (nextLanguage: Language) => {
    if (!controls) return;
    const labels = mapControlLabels(nextLanguage);
    for (const key of ['zoomIn', 'zoomOut', 'center'] as const) {
      controls[key].setAttribute('aria-label', labels[key]);
      controls[key].title = labels[key];
    }
  };

  return {
    onAdd(map: MapLibre) {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group vector-map-navigation';
      const labels = mapControlLabels(language);
      controls = {
        zoomIn: button('maplibregl-ctrl-zoom-in', labels.zoomIn, () => map.zoomIn({ duration: 250 })),
        zoomOut: button('maplibregl-ctrl-zoom-out', labels.zoomOut, () => map.zoomOut({ duration: 250 })),
        center: button('vector-map-recenter', labels.center, () => map.easeTo({
          center,
          zoom: 7.2,
          bearing: 0,
          pitch: 0,
          duration: 700,
        }), '◎'),
      };
      container.appendChild(controls.zoomIn);
      container.appendChild(controls.zoomOut);
      container.appendChild(controls.center);
      return container;
    },
    onRemove() {
      container?.remove();
      container = undefined;
      controls = undefined;
    },
    setLanguage,
  };
};

const createAircraftMarker = (onSelect: () => void): AircraftMarker => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'aircraft-map-marker';
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onSelect();
  });

  const icon = createAircraftIconElement();

  const label = document.createElement('span');
  label.className = 'map-plane-label';
  const flight = document.createElement('strong');
  const altitude = document.createElement('span');
  label.appendChild(flight);
  label.appendChild(altitude);
  element.appendChild(icon);
  element.appendChild(label);

  const marker = new Marker({
    element,
    anchor: 'center',
    subpixelPositioning: true,
  });
  return {
    altitude,
    displayedTrackDeg: 0,
    element,
    flight,
    icon,
    label,
    marker,
    priority: 0,
    selected: false,
    targetTrackDeg: 0,
  };
};

export function RadarMap({ aircraft, center, dataBaseUrl, focusTarget, following, labelsVisible, legTraceVisible, language, mapStyleUrl, onDeselect, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, recordLiveTrace, selectedId, unitSystem }: RadarMapProps) {
  const centerLongitude = center[0];
  const centerLatitude = center[1];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markersRef = useRef(new Map<string, AircraftMarker>());
  const liveTracesRef = useRef(new Map<string, AircraftTracePoint[]>());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastAnimationFrameRef = useRef<number | undefined>(undefined);
  const followTargetRef = useRef<[longitude: number, latitude: number] | undefined>(undefined);
  const labelsVisibleRef = useRef(labelsVisible);
  const languageRef = useRef(language);
  const navigationControlRef = useRef<ReturnType<typeof createMapNavigationControl> | undefined>(undefined);
  const onDeselectRef = useRef(onDeselect);
  const onSelectRef = useRef(onSelect);
  const updateLabelVisibilityRef = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<{ aircraftId: string; points: AircraftTracePoint[] }>();

  useEffect(() => {
    onDeselectRef.current = onDeselect;
    onSelectRef.current = onSelect;
    labelsVisibleRef.current = labelsVisible;
  }, [labelsVisible, onDeselect, onSelect]);

  useEffect(() => {
    languageRef.current = language;
    navigationControlRef.current?.setLanguage(language);
  }, [language]);

  const animateMarkers = useCallback(function animateMarkerFrame(now: number) {
    const map = mapRef.current;
    if (!map) {
      animationFrameRef.current = undefined;
      return;
    }

    const previousFrame = lastAnimationFrameRef.current ?? now;
    const elapsed = Math.min(64, Math.max(0, now - previousFrame));
    lastAnimationFrameRef.current = now;
    let keepAnimating = false;

    markersRef.current.forEach((aircraftMarker) => {
      const headingDelta = shortestAngleDifference(aircraftMarker.displayedTrackDeg, aircraftMarker.targetTrackDeg);
      if (Math.abs(headingDelta) > 0.08) {
        const headingProgress = Math.min(1, elapsed / 240);
        aircraftMarker.displayedTrackDeg = normalizeAngle(aircraftMarker.displayedTrackDeg + headingDelta * headingProgress);
        if (aircraftMarker.aircraft) {
          updateAircraftIconElement(
            aircraftMarker.icon,
            aircraftMarker.aircraft,
            aircraftHeadingRotation(aircraftMarker.displayedTrackDeg, map.getBearing()),
          );
        }
        keepAnimating = true;
      } else {
        aircraftMarker.displayedTrackDeg = aircraftMarker.targetTrackDeg;
      }
    });

    if (keepAnimating) animationFrameRef.current = requestAnimationFrame(animateMarkerFrame);
    else {
      animationFrameRef.current = undefined;
      lastAnimationFrameRef.current = undefined;
    }
  }, []);

  const startMarkerAnimation = useCallback(() => {
    if (animationFrameRef.current !== undefined) return;
    lastAnimationFrameRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(animateMarkers);
  }, [animateMarkers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibre({
      container: containerRef.current,
      style: mapStyleUrl,
      center: [centerLongitude, centerLatitude],
      zoom: 7.2,
      attributionControl: false,
    });
    mapRef.current = map;
    let layersInitialized = false;

    const updateLabelVisibility = () => {
      const occupied: LabelBox[] = [];
      const zoom = map.getZoom();
      const canvas = map.getCanvas();
      const ordered = [...markersRef.current.values()].sort((left, right) =>
        Number(right.selected) - Number(left.selected) || right.priority - left.priority,
      );

      ordered.forEach((aircraftMarker) => {
        if (!labelsVisibleRef.current) {
          aircraftMarker.label.classList.add('label-hidden');
          return;
        }

        aircraftMarker.label.classList.remove('label-hidden');
        const point = map.project(aircraftMarker.marker.getLngLat());
        const labelWidth = aircraftMarker.label.offsetWidth || 74;
        const labelHeight = aircraftMarker.label.offsetHeight || 34;
        const left = point.x + 19;
        const top = point.y - labelHeight / 2;
        const box = { left, right: left + labelWidth, top, bottom: top + labelHeight };
        const outside = box.right < 0 || box.left > canvas.width || box.bottom < 0 || box.top > canvas.height;
        const hidden = !aircraftMarker.selected
          && (zoom < 6.2 || outside || occupied.some((candidate) => overlaps(box, candidate)));
        aircraftMarker.label.classList.toggle('label-hidden', hidden);
        if (!hidden) occupied.push(box);
      });
    };
    updateLabelVisibilityRef.current = updateLabelVisibility;

    const navigationControl = createMapNavigationControl([centerLongitude, centerLatitude], languageRef.current);
    navigationControlRef.current = navigationControl;
    map.addControl(navigationControl, 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.on('click', () => onDeselectRef.current());
    map.on('moveend', updateLabelVisibility);
    map.on('zoomend', updateLabelVisibility);
    map.on('rotate', () => {
      markersRef.current.forEach((aircraftMarker) => {
        if (aircraftMarker.aircraft) {
          updateAircraftIconElement(
            aircraftMarker.icon,
            aircraftMarker.aircraft,
            aircraftHeadingRotation(aircraftMarker.displayedTrackDeg, map.getBearing()),
          );
        }
      });
      updateLabelVisibility();
    });

    const initializeLayers = () => {
      if (layersInitialized) return;
      layersInitialized = true;
      map.addSource('receiver', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [centerLongitude, centerLatitude] }, properties: {} },
      });
      map.addLayer({
        id: 'receiver-halo',
        type: 'circle',
        source: 'receiver',
        paint: { 'circle-radius': 11, 'circle-color': '#4fe4d3', 'circle-opacity': 0.13 },
      });
      map.addLayer({
        id: 'receiver-point',
        type: 'circle',
        source: 'receiver',
        paint: { 'circle-radius': 4, 'circle-color': '#0b1316', 'circle-stroke-color': '#4fe4d3', 'circle-stroke-width': 2 },
      });
      map.addSource('selected-leg-trace', {
        type: 'geojson',
        data: emptyTraceData(),
      });
      map.addLayer({
        id: 'selected-leg-trace-glow',
        type: 'line',
        source: 'selected-leg-trace',
        filter: ['all', ['==', ['get', 'kind'], 'trace'], ['==', ['get', 'stale'], false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-blur': 2,
          'line-color': ['get', 'color'],
          'line-opacity': 0.2,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8],
        },
      });
      map.addLayer({
        id: 'selected-leg-trace-line',
        type: 'line',
        source: 'selected-leg-trace',
        filter: ['all', ['==', ['get', 'kind'], 'trace'], ['==', ['get', 'stale'], false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.92,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 10, 2.6],
        },
      });
      map.addLayer({
        id: 'selected-leg-trace-stale',
        type: 'line',
        source: 'selected-leg-trace',
        filter: ['all', ['==', ['get', 'kind'], 'trace'], ['==', ['get', 'stale'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#91a4aa',
          'line-dasharray': [1.5, 2],
          'line-opacity': 0.58,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 2.2],
        },
      });
      map.addLayer({
        id: 'selected-leg-trace-start',
        type: 'circle',
        source: 'selected-leg-trace',
        filter: ['==', ['get', 'kind'], 'leg-start'],
        paint: {
          'circle-color': '#0b1316',
          'circle-radius': 3.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.7,
          'circle-stroke-width': 1.5,
        },
      });
      setReady(true);
    };

    map.once('style.load', initializeLayers);
    map.on('error', (event) => {
      if (!layersInitialized) setError(event.error?.message ?? translate(languageRef.current, 'mapLoadFailed'));
    });

    const markers = markersRef.current;
    return () => {
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      updateLabelVisibilityRef.current = () => undefined;
      map.remove();
      mapRef.current = null;
      navigationControlRef.current = undefined;
    };
  }, [centerLatitude, centerLongitude, mapStyleUrl]);

  useEffect(() => {
    if (!selectedId || !legTraceVisible) return;

    const controller = new AbortController();
    loadAircraftLegTrace(dataBaseUrl, selectedId, controller.signal)
      .then((points) => setSelectedTrace({ aircraftId: selectedId, points }))
      .catch(() => {
        if (!controller.signal.aborted) setSelectedTrace({ aircraftId: selectedId, points: [] });
      });
    return () => controller.abort();
  }, [dataBaseUrl, legTraceVisible, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const positionedAircraft = aircraft.filter(
      (item) => item.latitude !== undefined && item.longitude !== undefined,
    );
    const visibleIds = new Set(positionedAircraft.map((item) => item.id));

    markersRef.current.forEach(({ marker }, id) => {
      if (visibleIds.has(id)) return;
      marker.remove();
      markersRef.current.delete(id);
    });

    positionedAircraft.forEach((item) => {
      if (recordLiveTrace) {
        const timestamp = Date.now() / 1_000 - item.seenSeconds;
        const liveTrace = liveTracesRef.current.get(item.id) ?? [];
        const previousPoint = liveTrace.at(-1);
        if (previousPoint && timestamp - previousPoint.timestamp > 300) liveTrace.length = 0;
        if (!previousPoint || previousPoint.latitude !== item.latitude || previousPoint.longitude !== item.longitude) {
          liveTrace.push({
            altitudeFt: item.altitudeFt,
            latitude: item.latitude!,
            longitude: item.longitude!,
            onGround: item.onGround,
            stale: item.seenSeconds > 20,
            startsLeg: liveTrace.length === 0,
            timestamp,
          });
          if (liveTrace.length > 600) liveTrace.splice(0, liveTrace.length - 500);
          liveTracesRef.current.set(item.id, liveTrace);
        }
      }

      let aircraftMarker = markersRef.current.get(item.id);
      const targetPosition: [number, number] = [item.longitude!, item.latitude!];
      if (!aircraftMarker) {
        aircraftMarker = createAircraftMarker(() => onSelectRef.current(item.id));
        aircraftMarker.marker.setLngLat(targetPosition);
        aircraftMarker.marker.addTo(map);
        aircraftMarker.targetPosition = targetPosition;
        aircraftMarker.displayedTrackDeg = item.trackDeg ?? 0;
        aircraftMarker.targetTrackDeg = item.trackDeg ?? 0;
        markersRef.current.set(item.id, aircraftMarker);
      } else if (
        !aircraftMarker.targetPosition
        || aircraftMarker.targetPosition[0] !== targetPosition[0]
        || aircraftMarker.targetPosition[1] !== targetPosition[1]
      ) {
        aircraftMarker.targetPosition = targetPosition;
        aircraftMarker.marker.setLngLat(targetPosition);
      }
      // Also updates markers that survived a development hot reload.
      aircraftMarker.marker.setSubpixelPositioning(true);

      const altitude = mapAltitudeLabel(item, unitSystem, language);
      const kind = aircraftKind(item);
      aircraftMarker.flight.textContent = item.flight;
      aircraftMarker.altitude.textContent = altitude;
      aircraftMarker.priority = item.altitudeFt ?? 0;
      aircraftMarker.selected = item.id === selectedId;
      aircraftMarker.aircraft = item;
      if (item.trackDeg !== undefined) {
        const trackChange = Math.abs(shortestAngleDifference(aircraftMarker.targetTrackDeg, item.trackDeg));
        const reliableHeading = !item.onGround && (item.groundSpeedKts === undefined || item.groundSpeedKts >= 4);
        if (reliableHeading && trackChange >= 1.25) {
          aircraftMarker.targetTrackDeg = item.trackDeg;
          startMarkerAnimation();
        }
      }
      aircraftMarker.element.style.setProperty('--aircraft-color', altitudeColor(item));
      updateAircraftIconElement(
        aircraftMarker.icon,
        item,
        aircraftHeadingRotation(aircraftMarker.displayedTrackDeg, map.getBearing()),
      );
      aircraftMarker.element.classList.toggle('selected', aircraftMarker.selected);
      aircraftMarker.element.classList.toggle('mlat', item.source === 'mlat');
      aircraftMarker.element.setAttribute('aria-label', `${item.flight}, ${aircraftKindLabel(kind, language)}, ${translate(language, 'altitude').toLowerCase()} ${altitude}`);
    });

    updateLabelVisibilityRef.current();
  }, [aircraft, labelsVisible, language, ready, recordLiveTrace, selectedId, startMarkerAnimation, unitSystem]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('selected-leg-trace') as GeoJSONSource | undefined;
    if (!source || !selectedId || !legTraceVisible) {
      source?.setData(emptyTraceData());
      return;
    }

    const serverPoints = selectedTrace?.aircraftId === selectedId ? selectedTrace.points : [];
    const livePoints = liveTracesRef.current.get(selectedId) ?? [];
    const latestServerTimestamp = serverPoints.at(-1)?.timestamp ?? 0;
    const combined = [...serverPoints, ...livePoints.filter((point) => point.timestamp > latestServerTimestamp)];
    source.setData(traceData(combined));
  }, [aircraft, legTraceVisible, ready, selectedId, selectedTrace]);

  useEffect(() => {
    if (!ready || focusTarget?.latitude === undefined || focusTarget.longitude === undefined) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [focusTarget.longitude, focusTarget.latitude],
      zoom: Math.max(map.getZoom(), 8.5),
      duration: 650,
    });
  }, [focusTarget, ready]);

  useEffect(() => {
    if (!following || !selectedId) {
      followTargetRef.current = undefined;
      return;
    }
    const selected = aircraft.find((item) => item.id === selectedId);
    if (selected?.latitude === undefined || selected.longitude === undefined) return;
    const nextTarget: [number, number] = [selected.longitude, selected.latitude];
    const previousTarget = followTargetRef.current;
    if (previousTarget && markerDistanceMetres(previousTarget, nextTarget) < 8) return;
    followTargetRef.current = nextTarget;
    mapRef.current?.jumpTo({ center: nextTarget });
  }, [aircraft, following, selectedId]);

  return (
    <>
      <div className="maplibre-surface" ref={containerRef} />
      {!ready && !error && <div className="map-loading">{translate(language, 'mapLoading')}</div>}
      {error && <div className="map-error"><strong>{translate(language, 'mapUnavailable')}</strong><span>{error}</span></div>}
      <button
        className={`map-label-toggle ${labelsVisible ? 'active' : ''}`}
        aria-label={translate(language, labelsVisible ? 'hideAircraftLabels' : 'showAircraftLabels')}
        aria-pressed={labelsVisible}
        onClick={() => onLabelsVisibleChange(!labelsVisible)}
      ><span aria-hidden="true">Aa</span> Labels</button>
      <button
        className={`map-trace-toggle ${legTraceVisible ? 'active' : ''}`}
        aria-label={translate(language, legTraceVisible ? 'hideLegTrace' : 'showLegTrace')}
        aria-pressed={legTraceVisible}
        onClick={() => onLegTraceVisibleChange(!legTraceVisible)}
      ><span aria-hidden="true">⌁</span> {translate(language, 'legTrace')}</button>
    </>
  );
}
