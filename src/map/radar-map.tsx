'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MapLibre, Marker } from 'maplibre-gl';
import { createVectorIconElement } from '../components/vector-icon';
import { createMapNavigationControl } from './map-navigation-control';
import type { Aircraft, AircraftTracePoint, UnitSystem } from '../domain/aircraft';
import { aircraftKind, aircraftKindLabel } from '../domain/aircraft-kind';
import { loadActualRangeOutline, type ActualRangeOutline } from '../data/readsb';
import { compactAircraftLabel, layoutAircraftLabels, type LabelSide } from './label-layout';
import { translate, type Language } from '../i18n';
import type { Theme } from '../theme';
import { mapAltitudeLabel } from '../units';
import { altitudeColor, altitudeColorForValue } from './altitude-color';
import { applyAltitudeShadowProjection } from './altitude-shadow';
import { createAircraftIconElement, updateAircraftIconElement } from './aircraft-icon';
import {
  aircraftMotionEnabled as canAnimateAircraftMotion,
  aircraftPositionDistanceMetres,
  interpolateAircraftPosition,
  maximumAircraftProjectionSeconds,
  maximumSmoothCorrectionMetres,
  projectAircraftPosition,
  type AircraftPosition,
} from './aircraft-motion';
import { createDistanceRings, type DistanceRing } from './distance-rings';
import { aircraftIconRotation } from './heading';
import { mapThemePaint, openStreetMapRasterLayerId, type MapTheme, type MapThemePaint } from './map-theme';

type RadarMapProps = {
  actualRangeAvailable: boolean;
  actualRangeVisible: boolean;
  aircraft: Aircraft[];
  aircraftMotionEnabled: boolean;
  aircraftShadowsVisible: boolean;
  center: [longitude: number, latitude: number];
  dataBaseUrl: string;
  distanceRingsVisible: boolean;
  favoriteIds: ReadonlySet<string>;
  focusTarget?: { latitude?: number; longitude?: number; request: number };
  following: boolean;
  historyOpen: boolean;
  labelsVisible: boolean;
  legTraceVisible: boolean;
  tracePoints: AircraftTracePoint[];
  highlightedTracePoint?: AircraftTracePoint;
  language: Language;
  mapStyleUrl: string;
  mapTheme: MapTheme;
  onActualRangeVisibleChange: (visible: boolean) => void;
  onAircraftShadowsVisibleChange: (visible: boolean) => void;
  onDeselect: () => void;
  onDistanceRingsVisibleChange: (visible: boolean) => void;
  onHistoryToggle: () => void;
  onLabelsVisibleChange: (visible: boolean) => void;
  onLegTraceVisibleChange: (visible: boolean) => void;
  onSelect: (id: string) => void;
  selectedId?: string;
  shadowTimestamp?: number;
  theme: Theme;
  unitSystem: UnitSystem;
};

type AircraftMarker = {
  aircraft?: Aircraft;
  altitude: HTMLSpanElement;
  correctionFrom?: AircraftPosition;
  correctionStartedAt?: number;
  displayedPosition?: AircraftPosition;
  displayedTrackDeg: number;
  element: HTMLButtonElement;
  favorite: boolean;
  flight: HTMLElement;
  icon: SVGSVGElement;
  label: HTMLSpanElement;
  labelSide?: LabelSide;
  marker: Marker;
  motionReceivedAt?: number;
  priority: number;
  selected: boolean;
  shadowElement: HTMLSpanElement;
  shadowIcon: SVGSVGElement;
  shadowMarker: Marker;
  targetPosition?: AircraftPosition;
  targetTrackDeg: number;
};

type TraceSegmentElements = { glow?: SVGLineElement; line: SVGLineElement; fromIndex: number };
type DistanceRingElements = {
  casing: SVGPolylineElement;
  label: SVGGElement;
  labelWidth: number;
  line: SVGPolylineElement;
};

const shortestAngleDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const aircraftMarkerZIndex = (aircraft: Aircraft, selected: boolean) =>
  selected ? 100_000 : 10 + Math.max(0, Math.round(aircraft.altitudeFt ?? 0));
const receiverAccentColor = '#e3ad5b';
const markerCorrectionDurationMs = 320;
const minimumMarkerMovementMetres = 0.35;

const createAircraftMarker = (onSelect: () => void): AircraftMarker => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'aircraft-map-marker';
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onSelect();
  });

  const icon = createAircraftIconElement();

  const shadowElement = document.createElement('span');
  shadowElement.className = 'aircraft-altitude-shadow-marker';
  shadowElement.setAttribute('aria-hidden', 'true');
  const shadowProjection = document.createElement('span');
  shadowProjection.className = 'aircraft-altitude-shadow-projection';
  const shadowIcon = createAircraftIconElement();
  shadowIcon.classList.add('aircraft-altitude-shadow-icon');
  shadowProjection.appendChild(shadowIcon);
  shadowElement.appendChild(shadowProjection);

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
  const shadowMarker = new Marker({
    element: shadowElement,
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
    shadowElement,
    shadowIcon,
    shadowMarker,
    targetTrackDeg: 0,
  };
};

export function RadarMap({ actualRangeAvailable, actualRangeVisible, aircraft, aircraftMotionEnabled, aircraftShadowsVisible, center, dataBaseUrl, distanceRingsVisible, favoriteIds, focusTarget, following, historyOpen, labelsVisible, tracePoints, highlightedTracePoint, legTraceVisible, language, mapStyleUrl, mapTheme, onActualRangeVisibleChange, onAircraftShadowsVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, selectedId, shadowTimestamp, theme, unitSystem }: RadarMapProps) {
  const centerLongitude = center[0];
  const centerLatitude = center[1];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markersRef = useRef(new Map<string, AircraftMarker>());
  const profileMarkerRef = useRef<Marker | undefined>(undefined);
  const lastLabelLayoutRef = useRef(0);
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
  const historyOpenRef = useRef(historyOpen);
  const aircraftMotionEnabledRef = useRef(aircraftMotionEnabled);
  const followingRef = useRef(following);
  const selectedIdRef = useRef(selectedId);
  const actualRangeAvailableRef = useRef(actualRangeAvailable);
  const actualRangeVisibleRef = useRef(actualRangeVisible);
  const aircraftShadowsVisibleRef = useRef(aircraftShadowsVisible);
  const distanceRingsVisibleRef = useRef(distanceRingsVisible);
  const labelsVisibleRef = useRef(labelsVisible);
  const legTraceVisibleRef = useRef(legTraceVisible);
  const languageRef = useRef(language);
  const shadowTimestampRef = useRef(shadowTimestamp ?? Date.now() / 1_000);
  const navigationControlRef = useRef<ReturnType<typeof createMapNavigationControl> | undefined>(undefined);
  const onActualRangeVisibleChangeRef = useRef(onActualRangeVisibleChange);
  const onAircraftShadowsVisibleChangeRef = useRef(onAircraftShadowsVisibleChange);
  const onDeselectRef = useRef(onDeselect);
  const onDistanceRingsVisibleChangeRef = useRef(onDistanceRingsVisibleChange);
  const onHistoryToggleRef = useRef(onHistoryToggle);
  const onLabelsVisibleChangeRef = useRef(onLabelsVisibleChange);
  const onLegTraceVisibleChangeRef = useRef(onLegTraceVisibleChange);
  const onSelectRef = useRef(onSelect);
  const updateLabelVisibilityRef = useRef<() => void>(() => undefined);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    actualRangeAvailableRef.current = actualRangeAvailable;
    actualRangeVisibleRef.current = actualRangeVisible;
    aircraftMotionEnabledRef.current = aircraftMotionEnabled;
    followingRef.current = following;
    selectedIdRef.current = selectedId;
    aircraftShadowsVisibleRef.current = aircraftShadowsVisible;
    distanceRingsVisibleRef.current = distanceRingsVisible;
    onActualRangeVisibleChangeRef.current = onActualRangeVisibleChange;
    onAircraftShadowsVisibleChangeRef.current = onAircraftShadowsVisibleChange;
    onDeselectRef.current = onDeselect;
    onDistanceRingsVisibleChangeRef.current = onDistanceRingsVisibleChange;
    onHistoryToggleRef.current = onHistoryToggle;
    onLabelsVisibleChangeRef.current = onLabelsVisibleChange;
    onLegTraceVisibleChangeRef.current = onLegTraceVisibleChange;
    onSelectRef.current = onSelect;
    historyOpenRef.current = historyOpen;
    labelsVisibleRef.current = labelsVisible;
    legTraceVisibleRef.current = legTraceVisible;
  }, [actualRangeAvailable, actualRangeVisible, aircraftMotionEnabled, aircraftShadowsVisible, distanceRingsVisible, following, historyOpen, labelsVisible, legTraceVisible, onActualRangeVisibleChange, onAircraftShadowsVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, selectedId]);

  useEffect(() => {
    languageRef.current = language;
    shadowTimestampRef.current = shadowTimestamp ?? Date.now() / 1_000;
    navigationControlRef.current?.setState(
      language,
      actualRangeAvailable,
      actualRangeVisible,
      aircraftShadowsVisible,
      distanceRingsVisible,
      labelsVisible,
      legTraceVisible,
      historyOpen,
    );
  }, [actualRangeAvailable, actualRangeVisible, aircraftShadowsVisible, distanceRingsVisible, historyOpen, labelsVisible, language, legTraceVisible, shadowTimestamp]);

  const animateMarkers = useCallback(function animateMarkerFrame(now: number) {
    const map = mapRef.current;
    if (!map) {
      animationFrameRef.current = undefined;
      return;
    }

    const previousFrame = lastAnimationFrameRef.current;
    if (previousFrame !== undefined && now - previousFrame < 32) {
      animationFrameRef.current = requestAnimationFrame(animateMarkerFrame);
      return;
    }
    const elapsed = Math.min(64, Math.max(0, now - (previousFrame ?? now)));
    lastAnimationFrameRef.current = now;
    let keepAnimating = false;

    markersRef.current.forEach((aircraftMarker) => {
      const motionAircraft = aircraftMarker.aircraft;
      if (
        aircraftMotionEnabledRef.current
        && !historyOpenRef.current
        && motionAircraft
        && aircraftMarker.motionReceivedAt !== undefined
        && canAnimateAircraftMotion(motionAircraft)
      ) {
        const secondsSinceSnapshot = Math.max(0, (now - aircraftMarker.motionReceivedAt) / 1_000);
        const projectedPosition = projectAircraftPosition(motionAircraft, secondsSinceSnapshot);
        if (projectedPosition) {
          let nextPosition = projectedPosition;
          if (aircraftMarker.correctionFrom && aircraftMarker.correctionStartedAt !== undefined) {
            const progress = Math.min(1, Math.max(0, (now - aircraftMarker.correctionStartedAt) / markerCorrectionDurationMs));
            const easedProgress = progress * progress * (3 - 2 * progress);
            nextPosition = interpolateAircraftPosition(
              aircraftMarker.correctionFrom,
              projectedPosition,
              easedProgress,
            );
            if (progress >= 1) {
              aircraftMarker.correctionFrom = undefined;
              aircraftMarker.correctionStartedAt = undefined;
            }
          }
          if (
            !aircraftMarker.displayedPosition
            || aircraftPositionDistanceMetres(aircraftMarker.displayedPosition, nextPosition) >= minimumMarkerMovementMetres
          ) {
            aircraftMarker.marker.setLngLat(nextPosition);
            aircraftMarker.shadowMarker.setLngLat(nextPosition);
            aircraftMarker.displayedPosition = nextPosition;
          }
          if (followingRef.current && selectedIdRef.current === motionAircraft.id) {
            const previousFollowTarget = followTargetRef.current;
            if (
              !previousFollowTarget
              || aircraftPositionDistanceMetres(previousFollowTarget, nextPosition) >= minimumMarkerMovementMetres
            ) {
              followTargetRef.current = nextPosition;
              map.jumpTo({ center: nextPosition });
            }
          }
          const positionAge = Math.max(0, motionAircraft.positionSeenSeconds ?? motionAircraft.seenSeconds);
          if (
            aircraftMarker.correctionFrom
            || positionAge + secondsSinceSnapshot < maximumAircraftProjectionSeconds
          ) keepAnimating = true;
        }
      }

      const headingDelta = shortestAngleDifference(aircraftMarker.displayedTrackDeg, aircraftMarker.targetTrackDeg);
      if (Math.abs(headingDelta) > 0.08) {
        const headingProgress = Math.min(1, elapsed / 240);
        aircraftMarker.displayedTrackDeg = normalizeAngle(aircraftMarker.displayedTrackDeg + headingDelta * headingProgress);
        if (aircraftMarker.aircraft) {
          const rotation = aircraftIconRotation(
            aircraftKind(aircraftMarker.aircraft),
            aircraftMarker.displayedTrackDeg,
            map.getBearing(),
          );
          updateAircraftIconElement(
            aircraftMarker.icon,
            aircraftMarker.aircraft,
            rotation,
          );
          if (aircraftMarker.shadowIcon) {
            updateAircraftIconElement(aircraftMarker.shadowIcon, aircraftMarker.aircraft, rotation);
          }
        }
        keepAnimating = true;
      } else {
        aircraftMarker.displayedTrackDeg = aircraftMarker.targetTrackDeg;
      }
    });

    if (now - lastLabelLayoutRef.current >= 150) updateLabelVisibilityRef.current();
    if (keepAnimating) animationFrameRef.current = requestAnimationFrame(animateMarkerFrame);
    else {
      animationFrameRef.current = undefined;
      lastAnimationFrameRef.current = undefined;
    }
  }, []);

  const startMarkerAnimation = useCallback(() => {
    if (animationFrameRef.current !== undefined) return;
    lastAnimationFrameRef.current = undefined;
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
    traceElementsRef.current.segments.forEach(({ glow, line, fromIndex }) => {
      const from = projected[fromIndex];
      const to = projected[fromIndex + 1];
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
      if (current.startsLeg || current.timestamp - previous.timestamp > 300) continue;
      const stale = previous.stale || current.stale;
      const color = stale
        ? '#91a4aa'
        : altitudeColorForValue(current.altitudeFt ?? previous.altitudeFt, current.onGround, theme);
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
      segments.push({ glow, line, fromIndex: index - 1 });
    }

    let start: SVGCircleElement | undefined;
    const firstPoint = points[0];
    if (firstPoint) {
      start = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      start.setAttribute('fill', '#0b1316');
      start.setAttribute('r', '3.5');
      start.setAttribute('stroke', altitudeColorForValue(firstPoint.altitudeFt, firstPoint.onGround, theme));
      start.setAttribute('stroke-opacity', '0.7');
      start.setAttribute('stroke-width', '1.5');
      overlay.appendChild(start);
    }
    traceElementsRef.current = { segments, start };
    updateTraceOverlayPositions();
  }, [theme, updateTraceOverlayPositions]);

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
      lastLabelLayoutRef.current = performance.now();
      const zoom = map.getZoom();
      const bounds = map.getCanvas().getBoundingClientRect();
      const entries = [...markersRef.current.entries()];
      // Batch writes before measuring, avoiding a layout flush for each individual label.
      for (const [, item] of entries) {
        const focused = item.element.matches(':hover, :focus-visible');
        item.label.classList.toggle('label-compact', compactAircraftLabel(zoom, item.selected || item.favorite || focused));
      }
      const candidates = entries.map(([id, item]) => {
        const point = map.project(item.marker.getLngLat());
        return { id, x: point.x, y: point.y, width: item.label.offsetWidth, height: item.label.offsetHeight,
          selected: item.selected, favorite: item.favorite, focused: item.element.matches(':hover, :focus-visible'), previous: item.labelSide };
      });
      const obstacles = [...(containerRef.current?.parentElement?.querySelectorAll('.maplibregl-ctrl, .altitude-legend, .mobile-aircraft-summary, .history-panel') ?? [])]
        .filter((element) => element.getClientRects().length > 0).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left - bounds.left - 6, right: rect.right - bounds.left + 6,
            top: rect.top - bounds.top - 6, bottom: rect.bottom - bounds.top + 6 };
        });
      const placements = labelsVisibleRef.current ? layoutAircraftLabels(candidates, bounds.width, bounds.height, zoom, obstacles) : new Map();
      for (const [id, item] of entries) {
        const placement = placements.get(id);
        item.label.classList.toggle('label-hidden', !placement);
        if (placement) {
          item.labelSide = placement.side;
          item.label.dataset.side = placement.side;
          item.label.style.setProperty('--label-x', `${placement.x}px`);
          item.label.style.setProperty('--label-y', `${placement.y}px`);
        }
      }
    };
    updateLabelVisibilityRef.current = updateLabelVisibility;
    const refreshMovingLabels = () => {
      if (performance.now() - lastLabelLayoutRef.current >= 150) updateLabelVisibility();
    };
    const container = containerRef.current;
    container.addEventListener('pointerover', updateLabelVisibility);
    container.addEventListener('pointerout', updateLabelVisibility);
    container.addEventListener('focusin', updateLabelVisibility);
    container.addEventListener('focusout', updateLabelVisibility);

    const navigationControl = createMapNavigationControl(
      [centerLongitude, centerLatitude],
      languageRef.current,
      actualRangeAvailableRef.current,
      actualRangeVisibleRef.current,
      aircraftShadowsVisibleRef.current,
      distanceRingsVisibleRef.current,
      labelsVisibleRef.current,
      legTraceVisibleRef.current,
      historyOpenRef.current,
      () => onActualRangeVisibleChangeRef.current(!actualRangeVisibleRef.current),
      () => onAircraftShadowsVisibleChangeRef.current(!aircraftShadowsVisibleRef.current),
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
    map.on('resize', updateLabelVisibility);
    map.on('move', refreshMovingLabels);
    map.on('move', updateActualRangeOverlayPositions);
    map.on('move', updateDistanceRingOverlayPositions);
    map.on('move', updateTraceOverlayPositions);
    map.on('rotate', () => {
      markersRef.current.forEach((aircraftMarker) => {
        if (aircraftMarker.aircraft) {
          const rotation = aircraftIconRotation(
            aircraftKind(aircraftMarker.aircraft),
            aircraftMarker.displayedTrackDeg,
            map.getBearing(),
          );
          updateAircraftIconElement(
            aircraftMarker.icon,
            aircraftMarker.aircraft,
            rotation,
          );
          if (aircraftMarker.shadowIcon) {
            updateAircraftIconElement(aircraftMarker.shadowIcon, aircraftMarker.aircraft, rotation);
            applyAltitudeShadowProjection(
              aircraftMarker.shadowElement,
              aircraftMarker.aircraft.altitudeFt,
              aircraftMarker.aircraft.onGround,
              aircraftMarker.aircraft.latitude!,
              aircraftMarker.aircraft.longitude!,
              shadowTimestampRef.current,
              map.getBearing(),
            );
          }
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
      container.removeEventListener('pointerover', updateLabelVisibility);
      container.removeEventListener('pointerout', updateLabelVisibility);
      container.removeEventListener('focusin', updateLabelVisibility);
      container.removeEventListener('focusout', updateLabelVisibility);
      updateLabelVisibilityRef.current = () => undefined;
      profileMarkerRef.current?.remove();
      profileMarkerRef.current = undefined;
      if (animationFrameRef.current !== undefined) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      markers.forEach(({ marker, shadowMarker }) => {
        marker.remove();
        shadowMarker?.remove();
      });
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
      navigationControlRef.current = undefined;
      attributionObserver?.disconnect();
    };
  }, [centerLatitude, centerLongitude, mapStyleUrl, updateActualRangeOverlayPositions, updateDistanceRingOverlayPositions, updateTraceOverlayPositions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const rasterLayerId = openStreetMapRasterLayerId(map.getStyle());
    if (!rasterLayerId) return;

    const paint = mapThemePaint(mapTheme, theme);
    for (const property of Object.keys(paint) as Array<keyof MapThemePaint>) {
      map.setPaintProperty(rasterLayerId, property, paint[property]);
    }
  }, [mapTheme, ready, theme]);

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
    const map = mapRef.current;
    if (!map || !ready) return;
    const projectionTimestamp = shadowTimestamp ?? Date.now() / 1_000;
    const motionNow = performance.now();

    const positionedAircraft = aircraft.filter(
      (item) => item.latitude !== undefined && item.longitude !== undefined,
    );
    const visibleIds = new Set(positionedAircraft.map((item) => item.id));

    markersRef.current.forEach(({ marker, shadowMarker }, id) => {
      if (visibleIds.has(id)) return;
      marker.remove();
      shadowMarker?.remove();
      markersRef.current.delete(id);
    });

    positionedAircraft.forEach((item) => {
      let aircraftMarker = markersRef.current.get(item.id);
      const targetPosition: AircraftPosition = [item.longitude!, item.latitude!];
      const nextPosition = historyOpen || !aircraftMotionEnabled
        ? targetPosition
        : projectAircraftPosition(item, 0) ?? targetPosition;
      if (aircraftMarker && (!aircraftMarker.shadowElement || !aircraftMarker.shadowIcon || !aircraftMarker.shadowMarker)) {
        aircraftMarker.marker.remove();
        markersRef.current.delete(item.id);
        aircraftMarker = undefined;
      }
      if (!aircraftMarker) {
        aircraftMarker = createAircraftMarker(() => onSelectRef.current(item.id));
        aircraftMarker.marker.setLngLat(nextPosition);
        aircraftMarker.shadowMarker.setLngLat(nextPosition);
        aircraftMarker.shadowMarker.addTo(map);
        aircraftMarker.marker.addTo(map);
        aircraftMarker.displayedPosition = nextPosition;
        aircraftMarker.motionReceivedAt = motionNow;
        aircraftMarker.targetPosition = targetPosition;
        aircraftMarker.displayedTrackDeg = item.trackDeg ?? 0;
        aircraftMarker.targetTrackDeg = item.trackDeg ?? 0;
        markersRef.current.set(item.id, aircraftMarker);
      } else {
        const currentLngLat = aircraftMarker.marker.getLngLat();
        const currentPosition = aircraftMarker.displayedPosition
          ?? [currentLngLat.lng, currentLngLat.lat] as AircraftPosition;
        const correctionDistance = aircraftPositionDistanceMetres(currentPosition, nextPosition);
        aircraftMarker.targetPosition = targetPosition;
        aircraftMarker.motionReceivedAt = motionNow;
        if (
          historyOpen
          || !aircraftMotionEnabled
          || !canAnimateAircraftMotion(item)
          || correctionDistance > maximumSmoothCorrectionMetres
        ) {
          aircraftMarker.marker.setLngLat(nextPosition);
          aircraftMarker.shadowMarker.setLngLat(nextPosition);
          aircraftMarker.displayedPosition = nextPosition;
          aircraftMarker.correctionFrom = undefined;
          aircraftMarker.correctionStartedAt = undefined;
        } else if (correctionDistance >= minimumMarkerMovementMetres) {
          aircraftMarker.correctionFrom = currentPosition;
          aircraftMarker.correctionStartedAt = motionNow;
        }
      }
      // Also updates markers that survived a development hot reload.
      aircraftMarker.marker.setSubpixelPositioning(true);
      aircraftMarker.shadowMarker.setSubpixelPositioning(true);

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
      aircraftMarker.element.style.setProperty('--aircraft-color', altitudeColor(item, theme));
      aircraftMarker.shadowElement.style.display = aircraftShadowsVisible ? '' : 'none';
      applyAltitudeShadowProjection(
        aircraftMarker.shadowElement,
        item.altitudeFt,
        item.onGround,
        item.latitude!,
        item.longitude!,
        projectionTimestamp,
        map.getBearing(),
      );
      const rotation = aircraftIconRotation(kind, aircraftMarker.displayedTrackDeg, map.getBearing());
      updateAircraftIconElement(
        aircraftMarker.icon,
        item,
        rotation,
      );
      updateAircraftIconElement(aircraftMarker.shadowIcon, item, rotation);
      aircraftMarker.element.classList.toggle('selected', aircraftMarker.selected);
      aircraftMarker.element.classList.toggle('favorite', aircraftMarker.favorite);
      aircraftMarker.element.classList.toggle('helicopter', kind === 'helicopter' && !item.onGround);
      aircraftMarker.element.classList.toggle('mlat', item.source === 'mlat');
      aircraftMarker.element.style.zIndex = String(aircraftMarkerZIndex(item, aircraftMarker.selected));
      aircraftMarker.element.setAttribute('aria-label', [
        item.flight,
        aircraftKindLabel(kind, language),
        `${translate(language, 'altitude').toLowerCase()} ${altitude}`,
        aircraftMarker.favorite ? translate(language, 'favoriteAircraft') : undefined,
      ].filter(Boolean).join(', '));
      if (aircraftMotionEnabled && !historyOpen && canAnimateAircraftMotion(item)) startMarkerAnimation();
    });

    updateLabelVisibilityRef.current();
  }, [aircraft, aircraftMotionEnabled, aircraftShadowsVisible, favoriteIds, historyOpen, labelsVisible, language, ready, selectedId, shadowTimestamp, startMarkerAnimation, theme, unitSystem]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    renderTraceOverlay(selectedId && legTraceVisible ? tracePoints : []);
  }, [tracePoints, legTraceVisible, ready, renderTraceOverlay, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId || !highlightedTracePoint) {
      profileMarkerRef.current?.remove();
      profileMarkerRef.current = undefined;
      return;
    }
    if (!profileMarkerRef.current) {
      const element = document.createElement('span');
      element.className = 'trace-profile-marker';
      element.setAttribute('aria-hidden', 'true');
      profileMarkerRef.current = new Marker({ element, anchor: 'center', subpixelPositioning: true });
    }
    profileMarkerRef.current.getElement().dataset.timestamp = String(highlightedTracePoint.timestamp);
    profileMarkerRef.current.setLngLat([highlightedTracePoint.longitude, highlightedTracePoint.latitude]).addTo(map);
  }, [highlightedTracePoint, ready, selectedId]);

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
    const displayedPosition = aircraftMotionEnabled
      ? markersRef.current.get(selectedId)?.displayedPosition
      : undefined;
    const nextTarget: AircraftPosition = displayedPosition ?? [selected.longitude, selected.latitude];
    const previousTarget = followTargetRef.current;
    if (previousTarget && aircraftPositionDistanceMetres(previousTarget, nextTarget) < 8) return;
    followTargetRef.current = nextTarget;
    mapRef.current?.jumpTo({ center: nextTarget });
    if (aircraftMotionEnabled && canAnimateAircraftMotion(selected)) startMarkerAnimation();
  }, [aircraft, aircraftMotionEnabled, following, selectedId, startMarkerAnimation]);

  return (
    <>
      <div className="maplibre-surface" ref={containerRef} />
      {!ready && !error && <div className="map-loading">{translate(language, 'mapLoading')}</div>}
      {error && <div className="map-error"><strong>{translate(language, 'mapUnavailable')}</strong><span>{error}</span></div>}
    </>
  );
}
