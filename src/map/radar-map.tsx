'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MapLibre, Marker } from 'maplibre-gl';
import { createVectorIconElement, type VectorIconName } from '../components/vector-icon';
import type { Aircraft, AircraftTracePoint, UnitSystem } from '../domain/aircraft';
import { aircraftKind, aircraftKindLabel } from '../domain/aircraft-kind';
import { limitAircraftTracePeriod, type LegTracePeriod } from '../domain/aircraft-trace';
import { loadActualRangeOutline, loadAircraftLegTrace, type ActualRangeOutline } from '../data/readsb';
import { translate, type Language } from '../i18n';
import { mapAltitudeLabel } from '../units';
import { altitudeColor, altitudeColorForValue } from './altitude-color';
import { createAircraftIconElement, updateAircraftIconElement } from './aircraft-icon';
import { createDistanceRings, type DistanceRing } from './distance-rings';
import { aircraftIconRotation } from './heading';

type RadarMapProps = {
  actualRangeAvailable: boolean;
  actualRangeVisible: boolean;
  aircraft: Aircraft[];
  center: [longitude: number, latitude: number];
  dataBaseUrl: string;
  distanceRingsVisible: boolean;
  favoriteIds: ReadonlySet<string>;
  focusTarget?: { latitude?: number; longitude?: number; request: number };
  following: boolean;
  historyOpen: boolean;
  labelsVisible: boolean;
  legTraceVisible: boolean;
  legTracePeriod: LegTracePeriod;
  language: Language;
  mapStyleUrl: string;
  onActualRangeVisibleChange: (visible: boolean) => void;
  onDeselect: () => void;
  onDistanceRingsVisibleChange: (visible: boolean) => void;
  onHistoryToggle: () => void;
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
  favorite: boolean;
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
type TraceSegmentElements = { glow?: SVGLineElement; line: SVGLineElement };
type DistanceRingElements = {
  casing: SVGPolylineElement;
  label: SVGGElement;
  labelWidth: number;
  line: SVGPolylineElement;
};

const overlaps = (first: LabelBox, second: LabelBox) =>
  first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;

const shortestAngleDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const aircraftMarkerZIndex = (aircraft: Aircraft, selected: boolean) =>
  selected ? 100_000 : 10 + Math.max(0, Math.round(aircraft.altitudeFt ?? 0));
const receiverAccentColor = '#e3ad5b';
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

const mapControlLabels = (
  language: Language,
  actualRangeVisible: boolean,
  distanceRingsVisible: boolean,
  labelsVisible: boolean,
  legTraceVisible: boolean,
) => ({
  actualRangeName: translate(language, 'actualRange'),
  actualRange: translate(language, actualRangeVisible ? 'hideActualRangeOutline' : 'showActualRangeOutline'),
  aircraftLabels: translate(language, 'aircraftLabels'),
  center: translate(language, 'centerReceiver'),
  distanceRingsName: translate(language, 'distanceRings'),
  distanceRings: translate(language, distanceRingsVisible ? 'hideDistanceRings' : 'showDistanceRings'),
  history: translate(language, 'history'),
  labels: translate(language, labelsVisible ? 'hideAircraftLabels' : 'showAircraftLabels'),
  legTrace: translate(language, legTraceVisible ? 'hideLegTrace' : 'showLegTrace'),
  legTraceName: translate(language, 'legTrace'),
  mapLayers: translate(language, 'mapLayers'),
  zoomIn: translate(language, 'zoomIn'),
  zoomOut: translate(language, 'zoomOut'),
});

const createMapNavigationControl = (
  center: [number, number],
  language: Language,
  actualRangeAvailable: boolean,
  actualRangeVisible: boolean,
  distanceRingsVisible: boolean,
  labelsVisible: boolean,
  legTraceVisible: boolean,
  historyOpen: boolean,
  onActualRangeToggle: () => void,
  onDistanceRingsToggle: () => void,
  onLabelsToggle: () => void,
  onLegTraceToggle: () => void,
  onHistoryToggle: () => void,
) => {
  let container: HTMLDivElement | undefined;
  let layerMenu: HTMLDivElement | undefined;
  let documentPointerDown: ((event: PointerEvent) => void) | undefined;
  let controls: {
    actualRange: HTMLButtonElement;
    center: HTMLButtonElement;
    distanceRings: HTMLButtonElement;
    history: HTMLButtonElement;
    layers: HTMLButtonElement;
    labels: HTMLButtonElement;
    legTrace: HTMLButtonElement;
    zoomIn: HTMLButtonElement;
    zoomOut: HTMLButtonElement;
  } | undefined;
  let currentLanguage = language;
  let currentActualRangeAvailable = actualRangeAvailable;
  let currentActualRangeVisible = actualRangeVisible;
  let currentDistanceRingsVisible = distanceRingsVisible;
  let currentLabelsVisible = labelsVisible;
  let currentLegTraceVisible = legTraceVisible;
  let currentHistoryOpen = historyOpen;
  let menuOpen = false;

  const button = (className: string, label: string, onClick: () => void, iconName: VectorIconName) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.addEventListener('click', onClick);
    element.appendChild(createVectorIconElement(iconName, 'maplibregl-ctrl-icon vector-control-icon'));
    return element;
  };

  const layerButton = (className: string, label: string, onClick: () => void, iconName: VectorIconName) => {
    const element = button(`vector-map-layer-option ${className}`, label, onClick, iconName);
    element.removeAttribute('title');
    const copy = document.createElement('span');
    copy.className = 'vector-map-layer-name';
    copy.textContent = label;
    const toggle = document.createElement('span');
    toggle.className = 'vector-map-layer-switch';
    toggle.setAttribute('aria-hidden', 'true');
    element.appendChild(copy);
    element.appendChild(toggle);
    return element;
  };

  const setLayerButtonState = (element: HTMLButtonElement, name: string, actionLabel: string, active: boolean) => {
    element.setAttribute('aria-label', actionLabel);
    element.setAttribute('aria-pressed', String(active));
    element.querySelector('.vector-map-layer-name')!.textContent = name;
    element.classList.toggle('active', active);
  };

  const setMenuOpen = (open: boolean) => {
    menuOpen = open;
    if (layerMenu) layerMenu.hidden = !open;
    if (controls) {
      controls.layers.setAttribute('aria-expanded', String(open));
      controls.layers.classList.toggle('active', open);
    }
  };

  const updateState = () => {
    if (!controls) return;
    const labels = mapControlLabels(
      currentLanguage,
      currentActualRangeVisible,
      currentDistanceRingsVisible,
      currentLabelsVisible,
      currentLegTraceVisible,
    );
    for (const key of ['zoomIn', 'zoomOut', 'center'] as const) {
      controls[key].setAttribute('aria-label', labels[key]);
      controls[key].title = labels[key];
    }
    controls.layers.setAttribute('aria-label', labels.mapLayers);
    controls.layers.title = labels.mapLayers;
    const layerHeading = layerMenu?.querySelector(':scope > strong');
    if (layerHeading) layerHeading.textContent = labels.mapLayers;
    setLayerButtonState(controls.labels, labels.aircraftLabels, labels.labels, currentLabelsVisible);
    setLayerButtonState(controls.legTrace, labels.legTraceName, labels.legTrace, currentLegTraceVisible);
    setLayerButtonState(controls.actualRange, labels.actualRangeName, labels.actualRange, currentActualRangeVisible);
    setLayerButtonState(controls.distanceRings, labels.distanceRingsName, labels.distanceRings, currentDistanceRingsVisible);
    controls.actualRange.disabled = !currentActualRangeAvailable;
    controls.legTrace.disabled = currentHistoryOpen;
    controls.history.setAttribute('aria-label', labels.history);
    controls.history.setAttribute('aria-pressed', String(currentHistoryOpen));
    controls.history.title = labels.history;
    controls.history.classList.toggle('active', currentHistoryOpen);
  };

  const setState = (
    nextLanguage: Language,
    nextActualRangeAvailable: boolean,
    nextActualRangeVisible: boolean,
    nextDistanceRingsVisible: boolean,
    nextLabelsVisible: boolean,
    nextLegTraceVisible: boolean,
    nextHistoryOpen: boolean,
  ) => {
    currentLanguage = nextLanguage;
    currentActualRangeAvailable = nextActualRangeAvailable;
    currentActualRangeVisible = nextActualRangeVisible;
    currentDistanceRingsVisible = nextDistanceRingsVisible;
    currentLabelsVisible = nextLabelsVisible;
    currentLegTraceVisible = nextLegTraceVisible;
    currentHistoryOpen = nextHistoryOpen;
    updateState();
  };

  return {
    onAdd(map: MapLibre) {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group vector-map-navigation';
      const labels = mapControlLabels(
        currentLanguage,
        currentActualRangeVisible,
        currentDistanceRingsVisible,
        currentLabelsVisible,
        currentLegTraceVisible,
      );
      layerMenu = document.createElement('div');
      layerMenu.className = 'vector-map-layer-menu';
      layerMenu.id = 'vector-map-layer-menu';
      layerMenu.hidden = true;
      const layerHeading = document.createElement('strong');
      layerHeading.textContent = labels.mapLayers;
      layerMenu.appendChild(layerHeading);
      controls = {
        zoomIn: button('vector-map-zoom-in', labels.zoomIn, () => map.zoomIn({ duration: 250 }), 'zoomIn'),
        zoomOut: button('vector-map-zoom-out', labels.zoomOut, () => map.zoomOut({ duration: 250 }), 'zoomOut'),
        center: button('vector-map-recenter', labels.center, () => map.easeTo({
          center,
          zoom: 7.2,
          bearing: 0,
          pitch: 0,
          duration: 700,
        }), 'center'),
        actualRange: layerButton('vector-map-actual-range', labels.actualRange, onActualRangeToggle, 'range'),
        distanceRings: layerButton('vector-map-distance-rings', labels.distanceRings, onDistanceRingsToggle, 'rings'),
        layers: button('vector-map-toggle vector-map-layers', labels.mapLayers, () => setMenuOpen(!menuOpen), 'layers'),
        labels: layerButton('vector-map-labels', labels.labels, onLabelsToggle, 'labels'),
        legTrace: layerButton('vector-map-leg-trace', labels.legTrace, onLegTraceToggle, 'trace'),
        history: button('vector-map-toggle vector-map-history', labels.history, onHistoryToggle, 'history'),
      };
      controls.layers.setAttribute('aria-controls', layerMenu.id);
      controls.layers.setAttribute('aria-expanded', 'false');
      layerMenu.appendChild(controls.labels);
      layerMenu.appendChild(controls.legTrace);
      layerMenu.appendChild(controls.actualRange);
      layerMenu.appendChild(controls.distanceRings);
      container.appendChild(layerMenu);
      container.appendChild(controls.zoomIn);
      container.appendChild(controls.zoomOut);
      container.appendChild(controls.center);
      container.appendChild(controls.layers);
      container.appendChild(controls.history);
      container.addEventListener('pointerdown', (event) => event.stopPropagation());
      documentPointerDown = (event) => {
        if (container && event.target instanceof Node && !container.contains(event.target)) setMenuOpen(false);
      };
      document.addEventListener('pointerdown', documentPointerDown);
      updateState();
      return container;
    },
    onRemove() {
      if (documentPointerDown) document.removeEventListener('pointerdown', documentPointerDown);
      container?.remove();
      container = undefined;
      layerMenu = undefined;
      documentPointerDown = undefined;
      controls = undefined;
    },
    setState,
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

  const favoriteTarget = document.createElement('span');
  favoriteTarget.className = 'favorite-map-target';
  favoriteTarget.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 4; index += 1) {
    favoriteTarget.appendChild(document.createElement('i'));
  }

  const label = document.createElement('span');
  label.className = 'map-plane-label';
  const flight = document.createElement('strong');
  const altitude = document.createElement('span');
  label.appendChild(flight);
  label.appendChild(altitude);
  element.appendChild(icon);
  element.appendChild(favoriteTarget);
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
    favorite: false,
    flight,
    icon,
    label,
    marker,
    priority: 0,
    selected: false,
    targetTrackDeg: 0,
  };
};

export function RadarMap({ actualRangeAvailable, actualRangeVisible, aircraft, center, dataBaseUrl, distanceRingsVisible, favoriteIds, focusTarget, following, historyOpen, labelsVisible, legTracePeriod, legTraceVisible, language, mapStyleUrl, onActualRangeVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, recordLiveTrace, selectedId, unitSystem }: RadarMapProps) {
  const centerLongitude = center[0];
  const centerLatitude = center[1];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markersRef = useRef(new Map<string, AircraftMarker>());
  const liveTracesRef = useRef(new Map<string, AircraftTracePoint[]>());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastAnimationFrameRef = useRef<number | undefined>(undefined);
  const followTargetRef = useRef<[longitude: number, latitude: number] | undefined>(undefined);
  const actualRangeCoordinatesRef = useRef<ActualRangeOutline>([]);
  const actualRangeElementsRef = useRef<SVGPolylineElement[]>([]);
  const actualRangeOverlayRef = useRef<SVGSVGElement | null>(null);
  const distanceRingsRef = useRef<DistanceRing[]>([]);
  const distanceRingElementsRef = useRef<DistanceRingElements[]>([]);
  const distanceRingOverlayRef = useRef<SVGSVGElement | null>(null);
  const traceElementsRef = useRef<{ segments: TraceSegmentElements[]; start?: SVGCircleElement }>({ segments: [] });
  const traceOverlayRef = useRef<SVGSVGElement | null>(null);
  const tracePointsRef = useRef<AircraftTracePoint[]>([]);
  const traceSignatureRef = useRef<string>();
  const historyOpenRef = useRef(historyOpen);
  const actualRangeAvailableRef = useRef(actualRangeAvailable);
  const actualRangeVisibleRef = useRef(actualRangeVisible);
  const distanceRingsVisibleRef = useRef(distanceRingsVisible);
  const labelsVisibleRef = useRef(labelsVisible);
  const legTraceVisibleRef = useRef(legTraceVisible);
  const languageRef = useRef(language);
  const navigationControlRef = useRef<ReturnType<typeof createMapNavigationControl> | undefined>(undefined);
  const onActualRangeVisibleChangeRef = useRef(onActualRangeVisibleChange);
  const onDeselectRef = useRef(onDeselect);
  const onDistanceRingsVisibleChangeRef = useRef(onDistanceRingsVisibleChange);
  const onHistoryToggleRef = useRef(onHistoryToggle);
  const onLabelsVisibleChangeRef = useRef(onLabelsVisibleChange);
  const onLegTraceVisibleChangeRef = useRef(onLegTraceVisibleChange);
  const onSelectRef = useRef(onSelect);
  const updateLabelVisibilityRef = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<{ aircraftId: string; points: AircraftTracePoint[] }>();

  useEffect(() => {
    actualRangeAvailableRef.current = actualRangeAvailable;
    actualRangeVisibleRef.current = actualRangeVisible;
    distanceRingsVisibleRef.current = distanceRingsVisible;
    onActualRangeVisibleChangeRef.current = onActualRangeVisibleChange;
    onDeselectRef.current = onDeselect;
    onDistanceRingsVisibleChangeRef.current = onDistanceRingsVisibleChange;
    onHistoryToggleRef.current = onHistoryToggle;
    onLabelsVisibleChangeRef.current = onLabelsVisibleChange;
    onLegTraceVisibleChangeRef.current = onLegTraceVisibleChange;
    onSelectRef.current = onSelect;
    historyOpenRef.current = historyOpen;
    labelsVisibleRef.current = labelsVisible;
    legTraceVisibleRef.current = legTraceVisible;
  }, [actualRangeAvailable, actualRangeVisible, distanceRingsVisible, historyOpen, labelsVisible, legTraceVisible, onActualRangeVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect]);

  useEffect(() => {
    languageRef.current = language;
    navigationControlRef.current?.setState(
      language,
      actualRangeAvailable,
      actualRangeVisible,
      distanceRingsVisible,
      labelsVisible,
      legTraceVisible,
      historyOpen,
    );
  }, [actualRangeAvailable, actualRangeVisible, distanceRingsVisible, historyOpen, labelsVisible, language, legTraceVisible]);

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
            aircraftIconRotation(aircraftKind(aircraftMarker.aircraft), aircraftMarker.displayedTrackDeg, map.getBearing()),
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

  const updateActualRangeOverlayPositions = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    actualRangeCoordinatesRef.current.forEach((segment, segmentIndex) => {
      const element = actualRangeElementsRef.current[segmentIndex];
      if (!element) return;
      element.setAttribute('points', segment.map((point) => {
        const projected = map.project(point);
        return `${projected.x},${projected.y}`;
      }).join(' '));
    });
  }, []);

  const renderActualRangeOutline = useCallback((coordinates: ActualRangeOutline) => {
    const overlay = actualRangeOverlayRef.current;
    if (!overlay) return;

    overlay.replaceChildren();
    actualRangeCoordinatesRef.current = coordinates;
    actualRangeElementsRef.current = coordinates.map(() => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', receiverAccentColor);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('stroke-opacity', '0.95');
      line.setAttribute('stroke-width', '1.8');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      overlay.appendChild(line);
      return line;
    });
    updateActualRangeOverlayPositions();
  }, [updateActualRangeOverlayPositions]);

  const updateDistanceRingOverlayPositions = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    distanceRingsRef.current.forEach((ring, index) => {
      const elements = distanceRingElementsRef.current[index];
      if (!elements) return;
      const points = ring.coordinates.map((coordinate) => {
        const projected = map.project(coordinate);
        return `${projected.x},${projected.y}`;
      }).join(' ');
      elements.casing.setAttribute('points', points);
      elements.line.setAttribute('points', points);
      const labelPosition = map.project(ring.labelCoordinate);
      elements.label.setAttribute(
        'transform',
        `translate(${labelPosition.x - elements.labelWidth / 2} ${labelPosition.y})`,
      );
    });
  }, []);

  const renderDistanceRings = useCallback((rings: DistanceRing[]) => {
    const overlay = distanceRingOverlayRef.current;
    if (!overlay) return;

    overlay.replaceChildren();
    distanceRingsRef.current = rings;
    distanceRingElementsRef.current = rings.map((ring) => {
      const casing = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      casing.setAttribute('class', 'distance-ring-casing');
      casing.setAttribute('fill', 'none');
      casing.setAttribute('vector-effect', 'non-scaling-stroke');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('class', 'distance-ring-line');
      line.setAttribute('fill', 'none');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      label.setAttribute('class', 'distance-ring-label');
      const labelWidth = Math.max(44, ring.label.length * 6.8 + 14);
      const labelBackdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      labelBackdrop.setAttribute('class', 'distance-ring-label-backdrop');
      labelBackdrop.setAttribute('x', '0');
      labelBackdrop.setAttribute('y', '-10');
      labelBackdrop.setAttribute('width', String(labelWidth));
      labelBackdrop.setAttribute('height', '20');
      labelBackdrop.setAttribute('rx', '5');
      const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelText.setAttribute('class', 'distance-ring-label-text');
      labelText.setAttribute('x', '7');
      labelText.setAttribute('y', '0');
      labelText.textContent = ring.label;
      label.appendChild(labelBackdrop);
      label.appendChild(labelText);
      overlay.appendChild(casing);
      overlay.appendChild(line);
      overlay.appendChild(label);
      return { casing, label, labelWidth, line };
    });
    updateDistanceRingOverlayPositions();
  }, [updateDistanceRingOverlayPositions]);

  const updateTraceOverlayPositions = useCallback(() => {
    const map = mapRef.current;
    const points = tracePointsRef.current;
    if (!map || points.length === 0) return;

    const projected = points.map((point) => map.project([point.longitude, point.latitude]));
    traceElementsRef.current.segments.forEach(({ glow, line }, index) => {
      const from = projected[index];
      const to = projected[index + 1];
      for (const element of glow ? [glow, line] : [line]) {
        element.setAttribute('x1', String(from.x));
        element.setAttribute('y1', String(from.y));
        element.setAttribute('x2', String(to.x));
        element.setAttribute('y2', String(to.y));
      }
    });

    const start = traceElementsRef.current.start;
    if (start) {
      start.setAttribute('cx', String(projected[0].x));
      start.setAttribute('cy', String(projected[0].y));
    }
  }, []);

  const renderTraceOverlay = useCallback((points: AircraftTracePoint[]) => {
    const overlay = traceOverlayRef.current;
    if (!overlay) return;

    overlay.replaceChildren();
    tracePointsRef.current = points;
    const segments: TraceSegmentElements[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const stale = previous.stale || current.stale;
      const color = stale
        ? '#91a4aa'
        : altitudeColorForValue(current.altitudeFt ?? previous.altitudeFt, current.onGround);
      let glow: SVGLineElement | undefined;
      if (!stale) {
        glow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        glow.setAttribute('stroke', color);
        glow.setAttribute('stroke-linecap', 'round');
        glow.setAttribute('stroke-opacity', '0.2');
        glow.setAttribute('stroke-width', '7');
        overlay.appendChild(glow);
      }
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-opacity', stale ? '0.58' : '0.92');
      line.setAttribute('stroke-width', stale ? '2.2' : '2.6');
      if (stale) line.setAttribute('stroke-dasharray', '3 4');
      overlay.appendChild(line);
      segments.push({ glow, line });
    }

    let start: SVGCircleElement | undefined;
    const firstPoint = points[0];
    if (firstPoint) {
      start = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      start.setAttribute('fill', '#0b1316');
      start.setAttribute('r', '3.5');
      start.setAttribute('stroke', altitudeColorForValue(firstPoint.altitudeFt, firstPoint.onGround));
      start.setAttribute('stroke-opacity', '0.7');
      start.setAttribute('stroke-width', '1.5');
      overlay.appendChild(start);
    }
    traceElementsRef.current = { segments, start };
    updateTraceOverlayPositions();
  }, [updateTraceOverlayPositions]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    setReady(false);
    const map = new MapLibre({
      container: containerRef.current,
      style: mapStyleUrl,
      center: [centerLongitude, centerLatitude],
      zoom: 7.2,
      attributionControl: false,
    });
    mapRef.current = map;
    const actualRangeOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    actualRangeOverlay.classList.add('map-actual-range-overlay');
    actualRangeOverlay.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(actualRangeOverlay);
    actualRangeOverlayRef.current = actualRangeOverlay;
    const distanceRingOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    distanceRingOverlay.classList.add('map-distance-rings-overlay');
    distanceRingOverlay.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(distanceRingOverlay);
    distanceRingOverlayRef.current = distanceRingOverlay;
    const traceOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    traceOverlay.classList.add('map-leg-trace-overlay');
    traceOverlay.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(traceOverlay);
    traceOverlayRef.current = traceOverlay;
    let mapInitialized = false;
    let receiverMarker: Marker | undefined;

    const updateLabelVisibility = () => {
      const occupied: LabelBox[] = [];
      const zoom = map.getZoom();
      const canvas = map.getCanvas();
      const ordered = [...markersRef.current.values()].sort((left, right) =>
        Number(right.selected) - Number(left.selected)
          || Number(right.favorite) - Number(left.favorite)
          || right.priority - left.priority,
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

    const navigationControl = createMapNavigationControl(
      [centerLongitude, centerLatitude],
      languageRef.current,
      actualRangeAvailableRef.current,
      actualRangeVisibleRef.current,
      distanceRingsVisibleRef.current,
      labelsVisibleRef.current,
      legTraceVisibleRef.current,
      historyOpenRef.current,
      () => onActualRangeVisibleChangeRef.current(!actualRangeVisibleRef.current),
      () => onDistanceRingsVisibleChangeRef.current(!distanceRingsVisibleRef.current),
      () => onLabelsVisibleChangeRef.current(!labelsVisibleRef.current),
      () => onLegTraceVisibleChangeRef.current(!legTraceVisibleRef.current),
      () => onHistoryToggleRef.current(),
    );
    navigationControlRef.current = navigationControl;
    map.addControl(navigationControl, 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    const attributionElement = containerRef.current.querySelector('.maplibregl-ctrl-attrib');
    let attributionObserver: MutationObserver | undefined;
    const collapseInitialAttribution = () => {
      if (!attributionElement?.classList.contains('maplibregl-compact')) return false;
      attributionElement.classList.remove('maplibregl-compact-show');
      attributionElement.removeAttribute('open');
      return true;
    };
    if (!collapseInitialAttribution() && attributionElement) {
      attributionObserver = new MutationObserver(() => {
        if (collapseInitialAttribution()) attributionObserver?.disconnect();
      });
      attributionObserver.observe(attributionElement, { attributes: true });
    }
    map.on('click', () => onDeselectRef.current());
    map.on('moveend', updateLabelVisibility);
    map.on('zoomend', updateLabelVisibility);
    map.on('move', updateActualRangeOverlayPositions);
    map.on('move', updateDistanceRingOverlayPositions);
    map.on('move', updateTraceOverlayPositions);
    map.on('rotate', () => {
      markersRef.current.forEach((aircraftMarker) => {
        if (aircraftMarker.aircraft) {
          updateAircraftIconElement(
            aircraftMarker.icon,
            aircraftMarker.aircraft,
            aircraftIconRotation(aircraftKind(aircraftMarker.aircraft), aircraftMarker.displayedTrackDeg, map.getBearing()),
          );
        }
      });
      updateLabelVisibility();
    });

    const initializeMap = () => {
      if (mapInitialized) return;
      mapInitialized = true;
      const receiverElement = document.createElement('span');
      receiverElement.className = 'receiver-map-marker';
      receiverElement.setAttribute('aria-hidden', 'true');
      receiverElement.appendChild(createVectorIconElement('receiver', 'receiver-map-icon'));
      receiverMarker = new Marker({ element: receiverElement, anchor: 'center' })
        .setLngLat([centerLongitude, centerLatitude])
        .addTo(map);
      setReady(true);
    };

    map.once('style.load', initializeMap);
    map.on('error', (event) => {
      if (!mapInitialized) setError(event.error?.message ?? translate(languageRef.current, 'mapLoadFailed'));
    });

    const markers = markersRef.current;
    return () => {
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      receiverMarker?.remove();
      updateLabelVisibilityRef.current = () => undefined;
      map.remove();
      mapRef.current = null;
      actualRangeCoordinatesRef.current = [];
      actualRangeElementsRef.current = [];
      actualRangeOverlayRef.current = null;
      distanceRingsRef.current = [];
      distanceRingElementsRef.current = [];
      distanceRingOverlayRef.current = null;
      traceElementsRef.current = { segments: [] };
      traceOverlayRef.current = null;
      tracePointsRef.current = [];
      traceSignatureRef.current = undefined;
      navigationControlRef.current = undefined;
      attributionObserver?.disconnect();
    };
  }, [centerLatitude, centerLongitude, mapStyleUrl, updateActualRangeOverlayPositions, updateDistanceRingOverlayPositions, updateTraceOverlayPositions]);

  useEffect(() => {
    const overlay = distanceRingOverlayRef.current;
    if (!overlay || !ready) return;

    overlay.style.display = distanceRingsVisible ? '' : 'none';
    if (!distanceRingsVisible) return;
    renderDistanceRings(createDistanceRings([centerLongitude, centerLatitude], unitSystem));
  }, [centerLatitude, centerLongitude, distanceRingsVisible, ready, renderDistanceRings, unitSystem]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = actualRangeOverlayRef.current;
    if (!map || !overlay || !ready) return;

    const visible = actualRangeAvailable && actualRangeVisible;
    overlay.style.display = visible ? '' : 'none';
    if (!visible) return;

    const controller = new AbortController();
    const refresh = async () => {
      try {
        const coordinates = await loadActualRangeOutline(dataBaseUrl, controller.signal);
        if (controller.signal.aborted) return;
        renderActualRangeOutline(coordinates);
      } catch {
        if (!controller.signal.aborted) renderActualRangeOutline([]);
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [actualRangeAvailable, actualRangeVisible, dataBaseUrl, ready, renderActualRangeOutline]);

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
      aircraftMarker.favorite = favoriteIds.has(item.id);
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
        aircraftIconRotation(kind, aircraftMarker.displayedTrackDeg, map.getBearing()),
      );
      aircraftMarker.element.classList.toggle('selected', aircraftMarker.selected);
      aircraftMarker.element.classList.toggle('favorite', aircraftMarker.favorite);
      aircraftMarker.element.classList.toggle('mlat', item.source === 'mlat');
      aircraftMarker.element.style.zIndex = String(aircraftMarkerZIndex(item, aircraftMarker.selected));
      aircraftMarker.element.setAttribute('aria-label', [
        item.flight,
        aircraftKindLabel(kind, language),
        `${translate(language, 'altitude').toLowerCase()} ${altitude}`,
        aircraftMarker.favorite ? translate(language, 'favoriteAircraft') : undefined,
      ].filter(Boolean).join(', '));
    });

    updateLabelVisibilityRef.current();
  }, [aircraft, favoriteIds, labelsVisible, language, ready, recordLiveTrace, selectedId, startMarkerAnimation, unitSystem]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (!selectedId || !legTraceVisible) {
      renderTraceOverlay([]);
      traceSignatureRef.current = undefined;
      return;
    }
    if (selectedTrace?.aircraftId !== selectedId) {
      renderTraceOverlay([]);
      traceSignatureRef.current = undefined;
      return;
    }

    const serverPoints = selectedTrace.points;
    const livePoints = liveTracesRef.current.get(selectedId) ?? [];
    const latestServerTimestamp = serverPoints.at(-1)?.timestamp ?? 0;
    const combined = [...serverPoints, ...livePoints.filter((point) => point.timestamp > latestServerTimestamp)];
    const visiblePoints = limitAircraftTracePeriod(combined, legTracePeriod);
    if (visiblePoints.length === 0) {
      renderTraceOverlay([]);
      traceSignatureRef.current = `${selectedId}:empty`;
      return;
    }

    const lastPoint = visiblePoints.at(-1)!;
    const signature = [
      selectedId,
      legTracePeriod,
      visiblePoints.length,
      lastPoint.timestamp,
      lastPoint.latitude,
      lastPoint.longitude,
      lastPoint.altitudeFt,
      lastPoint.onGround,
      lastPoint.stale,
    ].join(':');
    if (traceSignatureRef.current === signature) return;

    renderTraceOverlay(visiblePoints);
    traceSignatureRef.current = signature;
  }, [aircraft, legTracePeriod, legTraceVisible, ready, renderTraceOverlay, selectedId, selectedTrace]);

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
    </>
  );
}
