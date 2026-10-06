'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttributionControl, Map as MapLibre, Marker } from 'maplibre-gl';
import { createVectorIconElement } from '../components/vector-icon';
import { createMapNavigationControl } from './map-navigation-control';
import type { Aircraft, AircraftTracePoint, UnitSystem } from '../domain/aircraft';
import { aircraftKind, aircraftKindLabel } from '../domain/aircraft-kind';
import { loadActualRangeOutline, loadAircraftRecentTrace, type ActualRangeOutline } from '../data/readsb';
import { createWakeTraceCache } from '../data/wake-trace-cache';
import { compactAircraftLabel, layoutAircraftLabels, type LabelSide } from './label-layout';
import { translate, type Language } from '../i18n';
import type { Theme } from '../theme';
import { mapAltitudeLabel } from '../units';
import { altitudeColor, altitudeColorForValue } from './altitude-color';
import { applyAltitudeShadowProjection } from './altitude-shadow';
import { createAircraftIconElement, updateAircraftIconElement } from './aircraft-icon';
import { createAircraftIconSizer } from './aircraft-map-size';
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
import { aircraftIconMotionActive } from './icon-animation';
import { aircraftWakeZoomOpacity, aircraftWakeZoomProfile, maximumAircraftWakeScreenLength } from './aircraft-wake';
import { drawAircraftWakeRoute, hasAircraftWake, updateAircraftWakeRouteElement } from './aircraft-wake-element';
import { createFrameProjector } from './frame-projector';
import { mapThemePaint, openStreetMapRasterLayerId, type MapTheme, type MapThemePaint } from './map-theme';

type RadarMapProps = {
  actualRangeAvailable: boolean;
  actualRangeVisible: boolean;
  aircraft: Aircraft[];
  aircraftMotionEnabled: boolean;
  aircraftShadowsVisible: boolean;
  aircraftWakesVisible: boolean;
  wakeTraces: ReadonlyMap<string, AircraftTracePoint[]>;
  center: [longitude: number, latitude: number];
  dataBaseUrl: string;
  distanceRingsVisible: boolean;
  favoriteIds: ReadonlySet<string>;
  focusTarget?: { latitude?: number; longitude?: number; request: number };
  following: boolean;
  historyOpen: boolean;
  labelsVisible: boolean;
  live: boolean;
  legTraceVisible: boolean;
  tracePoints: AircraftTracePoint[];
  highlightedTracePoint?: AircraftTracePoint;
  language: Language;
  mapStyleUrl: string;
  mapTheme: MapTheme;
  onActualRangeVisibleChange: (visible: boolean) => void;
  onAircraftShadowsVisibleChange: (visible: boolean) => void;
  onAircraftWakesVisibleChange: (visible: boolean) => void;
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
  wakeIcon: SVGSVGElement;
  label: HTMLSpanElement;
  labelSize?: { width: number; height: number };
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
  const symbol = document.createElement('span');
  symbol.className = 'aircraft-map-symbol';
  symbol.appendChild(icon);
  const wakeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wakeIcon.setAttribute('class', 'aircraft-icon-svg aircraft-wake-svg');
  wakeIcon.setAttribute('viewBox', '0 0 40 40');
  wakeIcon.setAttribute('aria-hidden', 'true');

  const shadowElement = document.createElement('span');
  shadowElement.className = 'aircraft-altitude-shadow-marker';
  shadowElement.setAttribute('aria-hidden', 'true');
  const shadowProjection = document.createElement('span');
  shadowProjection.className = 'aircraft-altitude-shadow-projection';
  const shadowIcon = createAircraftIconElement();
  shadowIcon.classList.add('aircraft-altitude-shadow-icon');
  const shadowSymbol = document.createElement('span');
  shadowSymbol.className = 'aircraft-map-symbol';
  shadowSymbol.appendChild(shadowIcon);
  shadowProjection.appendChild(shadowSymbol);
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
  element.appendChild(wakeIcon);
  element.appendChild(symbol);
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
    wakeIcon,
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

export function RadarMap({ actualRangeAvailable, actualRangeVisible, aircraft, aircraftMotionEnabled, aircraftShadowsVisible, aircraftWakesVisible, wakeTraces, center, dataBaseUrl, distanceRingsVisible, favoriteIds, focusTarget, following, historyOpen, labelsVisible, live, tracePoints, highlightedTracePoint, legTraceVisible, language, mapStyleUrl, mapTheme, onActualRangeVisibleChange, onAircraftShadowsVisibleChange, onAircraftWakesVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, selectedId, shadowTimestamp, theme, unitSystem }: RadarMapProps) {
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
  const aircraftWakesVisibleRef = useRef(aircraftWakesVisible);
  const wakeTracesRef = useRef(wakeTraces);
  const wakeTraceCacheRef = useRef<ReturnType<typeof createWakeTraceCache> | undefined>(undefined);
  const lastWakeDemandRef = useRef(-Infinity);
  const lastWakeDrawRef = useRef(0);
  const wakeDrawFrameRef = useRef<number | undefined>(undefined);
  const pendingWakeDrawRef = useRef<(() => void) | undefined>(undefined);
  const wakeAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewportRef = useRef({ width: 0, height: 0 });
  const zoomingRef = useRef(false);
  const iconScaleRef = useRef(1);
  const wakeContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const distanceRingsVisibleRef = useRef(distanceRingsVisible);
  const labelsVisibleRef = useRef(labelsVisible);
  const legTraceVisibleRef = useRef(legTraceVisible);
  const languageRef = useRef(language);
  const shadowTimestampRef = useRef(shadowTimestamp ?? Date.now() / 1_000);
  const navigationControlRef = useRef<ReturnType<typeof createMapNavigationControl> | undefined>(undefined);
  const onActualRangeVisibleChangeRef = useRef(onActualRangeVisibleChange);
  const onAircraftShadowsVisibleChangeRef = useRef(onAircraftShadowsVisibleChange);
  const onAircraftWakesVisibleChangeRef = useRef(onAircraftWakesVisibleChange);
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
    aircraftWakesVisibleRef.current = aircraftWakesVisible;
    distanceRingsVisibleRef.current = distanceRingsVisible;
    onActualRangeVisibleChangeRef.current = onActualRangeVisibleChange;
    onAircraftShadowsVisibleChangeRef.current = onAircraftShadowsVisibleChange;
    onAircraftWakesVisibleChangeRef.current = onAircraftWakesVisibleChange;
    onDeselectRef.current = onDeselect;
    onDistanceRingsVisibleChangeRef.current = onDistanceRingsVisibleChange;
    onHistoryToggleRef.current = onHistoryToggle;
    onLabelsVisibleChangeRef.current = onLabelsVisibleChange;
    onLegTraceVisibleChangeRef.current = onLegTraceVisibleChange;
    onSelectRef.current = onSelect;
    historyOpenRef.current = historyOpen;
    labelsVisibleRef.current = labelsVisible;
    legTraceVisibleRef.current = legTraceVisible;
  }, [actualRangeAvailable, actualRangeVisible, aircraftMotionEnabled, aircraftShadowsVisible, aircraftWakesVisible, distanceRingsVisible, following, historyOpen, labelsVisible, legTraceVisible, onActualRangeVisibleChange, onAircraftShadowsVisibleChange, onAircraftWakesVisibleChange, onDeselect, onDistanceRingsVisibleChange, onHistoryToggle, onLabelsVisibleChange, onLegTraceVisibleChange, onSelect, selectedId]);

  useEffect(() => {
    languageRef.current = language;
    shadowTimestampRef.current = shadowTimestamp ?? Date.now() / 1_000;
    navigationControlRef.current?.setState(
      language,
      actualRangeAvailable,
      actualRangeVisible,
      aircraftShadowsVisible,
      aircraftWakesVisible,
      distanceRingsVisible,
      labelsVisible,
      legTraceVisible,
      historyOpen,
    );
  }, [actualRangeAvailable, actualRangeVisible, aircraftShadowsVisible, aircraftWakesVisible, distanceRingsVisible, historyOpen, labelsVisible, language, legTraceVisible, shadowTimestamp]);

  const updateWakePositions = useCallback(function requestWakeDraw() {
    // Feed, marker motion, move and rotate may all request the same frame.
    if (wakeDrawFrameRef.current !== undefined) return;
    const draw = () => {
      if (wakeDrawFrameRef.current !== undefined) cancelAnimationFrame(wakeDrawFrameRef.current);
      wakeDrawFrameRef.current = undefined;
      pendingWakeDrawRef.current = undefined;
      clearTimeout(wakeAnimationTimerRef.current);
      wakeAnimationTimerRef.current = undefined;
      const map = mapRef.current;
      const context = wakeContextRef.current;
      const { width, height } = viewportRef.current;
      context?.clearRect(0, 0, width, height);
      if (!map || markersRef.current.size === 0 || historyOpenRef.current || !aircraftWakesVisibleRef.current || document.hidden
        || containerRef.current?.dataset.iconAnimation !== 'running'
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches
        || aircraftWakeZoomOpacity(map.getZoom()) === 0) {
        wakeTraceCacheRef.current?.setWanted([]);
        lastWakeDemandRef.current = -Infinity;
        containerRef.current?.setAttribute('data-wake-renderer', 'svg');
        return;
      }
      lastWakeDrawRef.current = performance.now();
      const project = createFrameProjector((position) => map.project(position), map.getCenter().lng,
        map.getPitch() === 0 && !map.getTerrain() && (map.getProjection()?.type ?? 'mercator') === 'mercator');
      const profile = aircraftWakeZoomProfile(map.getZoom());
      const { lengthScale } = profile;
      // Keep the shared layer between gestures on busy maps too: switching back
      // to hundreds of animated SVG tails would block the next input event.
      const denseTraffic = markersRef.current.size >= 80;
      const canvas = denseTraffic && context;
      const appearance = { ...profile, opacity: aircraftWakeZoomOpacity(map.getZoom()),
        color: containerRef.current?.dataset.wakeTone === 'dark' ? '50, 74, 80' : '220, 227, 223',
        flowTime: zoomingRef.current ? 0 : performance.now() };
      const iconScale = iconScaleRef.current;
      const margin = maximumAircraftWakeScreenLength * lengthScale + 40;
      // Reuse this frame's projection, but never schedule work per animation frame
      // or during zoom gestures. Load only aircraft whose trails could be visible.
      const refreshDemand = !zoomingRef.current && performance.now() - lastWakeDemandRef.current >= 1_000;
      const demand: { id: string; distance: number }[] = [];
      let hasVisibleWakes = false;
      for (const [id, marker] of markersRef.current) {
        if (!marker.aircraft || !marker.displayedPosition) continue;
        const point = project(marker.displayedPosition);
        const inView = point.x >= -margin && point.x <= width + margin && point.y >= -margin && point.y <= height + margin;
        if (refreshDemand && inView && hasAircraftWake(marker.wakeIcon)) {
          demand.push({ id, distance: id === selectedIdRef.current ? -1 : Math.hypot(point.x - width / 2, point.y - height / 2) });
        }
        const local = inView ? wakeTracesRef.current.get(id) : undefined;
        const trace = inView ? wakeTraceCacheRef.current?.get(id, local) ?? local ?? [] : [];
        const rotation = aircraftIconRotation(aircraftKind(marker.aircraft), marker.displayedTrackDeg, map.getBearing());
        if (canvas) {
          if (inView) {
            const drawn = drawAircraftWakeRoute(canvas, marker.wakeIcon, trace, shadowTimestampRef.current,
              marker.displayedPosition, project, rotation, appearance, iconScale);
            hasVisibleWakes ||= drawn;
          }
        } else {
          updateAircraftWakeRouteElement(marker.wakeIcon, trace, shadowTimestampRef.current,
            marker.displayedPosition, project, rotation, lengthScale, iconScale);
        }
      }
      if (refreshDemand) {
        lastWakeDemandRef.current = performance.now();
        wakeTraceCacheRef.current?.setWanted(demand.sort((a, b) => a.distance - b.distance).map(({ id }) => id));
      }
      // Switch only once the replacement is painted, also when traffic subsides.
      containerRef.current?.setAttribute('data-wake-renderer', canvas ? 'canvas' : 'svg');
      // Faint airflow needs only 12.5 fps at rest. Camera movement still requests
      // every frame so the geographic route stays attached throughout zooming.
      if (canvas && hasVisibleWakes) wakeAnimationTimerRef.current = setTimeout(requestWakeDraw, 80);
    };
    pendingWakeDrawRef.current = draw;
    wakeDrawFrameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const cache = createWakeTraceCache({
      load: (id, signal) => loadAircraftRecentTrace(dataBaseUrl, id, signal),
      onChange: updateWakePositions,
    });
    wakeTraceCacheRef.current = cache;
    lastWakeDemandRef.current = -Infinity;
    updateWakePositions();
    return () => { cache.dispose(); wakeTraceCacheRef.current = undefined; };
  }, [dataBaseUrl, updateWakePositions]);

  useEffect(() => {
    const container = containerRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateVisibility = () => {
      if (container) container.dataset.pageVisible = String(!document.hidden);
      if (document.hidden || reducedMotion.matches) wakeTraceCacheRef.current?.setWanted([]);
      lastWakeDemandRef.current = -Infinity;
      updateWakePositions();
    };
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    reducedMotion.addEventListener('change', updateVisibility);
    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
      reducedMotion.removeEventListener('change', updateVisibility);
    };
  }, [updateWakePositions]);

  useEffect(() => {
    wakeTracesRef.current = wakeTraces;
    if (!aircraftWakesVisible || historyOpen || !live) wakeTraceCacheRef.current?.setWanted([]);
    updateWakePositions();
  }, [wakeTraces, aircraftWakesVisible, historyOpen, live, ready, updateWakePositions]);

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
            aircraftMarker.wakeIcon,
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

    if (now - lastWakeDrawRef.current >= 80) updateWakePositions();
    if (now - lastLabelLayoutRef.current >= 150) updateLabelVisibilityRef.current();
    if (keepAnimating) animationFrameRef.current = requestAnimationFrame(animateMarkerFrame);
    else {
      animationFrameRef.current = undefined;
      lastAnimationFrameRef.current = undefined;
    }
  }, [updateWakePositions]);

  const startMarkerAnimation = useCallback(() => {
    if (animationFrameRef.current !== undefined) return;
    lastAnimationFrameRef.current = undefined;
    animationFrameRef.current = requestAnimationFrame(animateMarkers);
  }, [animateMarkers]);

  const updateActualRangeOverlayPositions = useCallback(() => {
    const map = mapRef.current;
    if (!map || !actualRangeVisibleRef.current || !actualRangeAvailableRef.current) return;
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
    if (!map || !distanceRingsVisibleRef.current) return;
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
    containerRef.current.dataset.cameraZooming = 'false';
    const wakeCanvas = document.createElement('canvas');
    wakeCanvas.className = 'map-wake-canvas';
    wakeCanvas.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(wakeCanvas);
    wakeContextRef.current = wakeCanvas.getContext('2d');
    const updateViewport = () => {
      viewportRef.current = { width: map.getCanvas().clientWidth, height: map.getCanvas().clientHeight };
      const { width, height } = viewportRef.current;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      wakeCanvas.width = Math.round(width * ratio);
      wakeCanvas.height = Math.round(height * ratio);
      wakeCanvas.style.width = `${width}px`;
      wakeCanvas.style.height = `${height}px`;
      wakeContextRef.current?.setTransform(ratio, 0, 0, ratio, 0, 0);
      markersRef.current.forEach((item) => { item.labelSize = undefined; });
      updateWakePositions();
    };
    updateViewport();
    map.on('resize', updateViewport);
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

    let previousIconScale: string | undefined;
    const iconSizer = createAircraftIconSizer(map.getZoom(), {
      now: () => performance.now(),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      shouldAnimate: () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      setScale: (value) => {
        const scale = value.toFixed(5);
        if (scale === previousIconScale) return;
        previousIconScale = scale;
        iconScaleRef.current = Number(scale);
        // Existing and new contacts share the settled size. This property is
        // never changed during zooming: keep layout work out of camera frames.
        containerRef.current?.style.setProperty('--aircraft-icon-scale', scale);
        updateWakePositions();
        // Engine offsets and silhouettes must change in the same paint frame.
        pendingWakeDrawRef.current?.();
      },
    });

    let previousWakeAppearance: string | undefined;
    const updateWakeVisibility = () => {
      const opacity = aircraftWakeZoomOpacity(map.getZoom()).toFixed(3);
      const profile = aircraftWakeZoomProfile(map.getZoom());
      const middle = profile.middleOpacity.toFixed(3), tail = profile.tailOpacity.toFixed(3);
      const appearance = `${opacity}:${middle}:${tail}`;
      if (appearance === previousWakeAppearance) return;
      previousWakeAppearance = appearance;
      containerRef.current?.style.setProperty('--aircraft-wake-opacity', opacity);
      containerRef.current?.style.setProperty('--aircraft-wake-middle-opacity', middle);
      containerRef.current?.style.setProperty('--aircraft-wake-tail-opacity', tail);
      // Only pause the flow at zero; keep the strokes mounted for the fade-out.
      containerRef.current?.setAttribute('data-wake-visible', String(Number(opacity) > 0));
    };
    updateWakeVisibility();

    const updateLabelVisibility = () => {
      lastLabelLayoutRef.current = performance.now();
      // Hidden labels need neither DOM measurement nor collision detection.
      if (!labelsVisibleRef.current) {
        markersRef.current.forEach((item) => item.label.classList.add('label-hidden'));
        return;
      }
      const zoom = map.getZoom();
      const bounds = map.getCanvas().getBoundingClientRect();
      const entries = [...markersRef.current.entries()];
      // Batch writes before measuring, avoiding a layout flush for each individual label.
      for (const [, item] of entries) {
        const focused = item.element.matches(':hover, :focus-visible');
        const compact = compactAircraftLabel(zoom, item.selected || item.favorite || focused);
        if (item.label.classList.contains('label-compact') !== compact) {
          item.label.classList.toggle('label-compact', compact);
          item.labelSize = undefined;
        }
      }
      const candidates = entries.map(([id, item]) => {
        const point = map.project(item.marker.getLngLat());
        const size = item.labelSize ??= { width: item.label.offsetWidth, height: item.label.offsetHeight };
        return { id, x: point.x, y: point.y, ...size,
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
      aircraftWakesVisibleRef.current,
      distanceRingsVisibleRef.current,
      labelsVisibleRef.current,
      legTraceVisibleRef.current,
      historyOpenRef.current,
      () => onActualRangeVisibleChangeRef.current(!actualRangeVisibleRef.current),
      () => onAircraftShadowsVisibleChangeRef.current(!aircraftShadowsVisibleRef.current),
      () => onAircraftWakesVisibleChangeRef.current(!aircraftWakesVisibleRef.current),
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
    map.on('zoomstart', () => {
      zoomingRef.current = true;
      wakeTraceCacheRef.current?.setWanted([]);
      container.dataset.cameraZooming = 'true';
      iconSizer.zoomStart();
      updateWakePositions();
    });
    map.on('zoomend', () => {
      zoomingRef.current = false;
      lastWakeDemandRef.current = -Infinity;
      container.dataset.cameraZooming = 'false';
      iconSizer.zoomEnd(map.getZoom());
      updateWakePositions();
    });
    // Flush after camera updates instead of letting the trails lag one frame.
    map.on('render', () => pendingWakeDrawRef.current?.());
    map.on('zoom', updateWakeVisibility);
    map.on('resize', updateLabelVisibility);
    map.on('move', refreshMovingLabels);
    map.on('move', updateActualRangeOverlayPositions);
    map.on('move', updateDistanceRingOverlayPositions);
    map.on('move', updateTraceOverlayPositions);
    map.on('move', updateWakePositions);
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
            aircraftMarker.wakeIcon,
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
      updateWakePositions();
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
      if (wakeDrawFrameRef.current !== undefined) cancelAnimationFrame(wakeDrawFrameRef.current);
      wakeDrawFrameRef.current = undefined;
      pendingWakeDrawRef.current = undefined;
      iconSizer.dispose();
      clearTimeout(wakeAnimationTimerRef.current);
      wakeAnimationTimerRef.current = undefined;
      wakeContextRef.current = null;
      zoomingRef.current = false;
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
  }, [centerLatitude, centerLongitude, mapStyleUrl, updateActualRangeOverlayPositions, updateDistanceRingOverlayPositions, updateTraceOverlayPositions, updateWakePositions]);

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
      if (aircraftMarker && (!aircraftMarker.wakeIcon || !aircraftMarker.shadowElement || !aircraftMarker.shadowIcon || !aircraftMarker.shadowMarker)) {
        aircraftMarker.marker.remove();
        aircraftMarker.shadowMarker?.remove();
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
      if (aircraftMarker.flight.textContent !== item.flight || aircraftMarker.altitude.textContent !== altitude) {
        aircraftMarker.flight.textContent = item.flight;
        aircraftMarker.altitude.textContent = altitude;
        aircraftMarker.labelSize = undefined;
      }
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
        aircraftMarker.wakeIcon,
      );
      updateAircraftIconElement(aircraftMarker.shadowIcon, item, rotation);
      aircraftMarker.element.classList.toggle('selected', aircraftMarker.selected);
      aircraftMarker.element.classList.toggle('favorite', aircraftMarker.favorite);
      aircraftMarker.element.classList.toggle('helicopter', kind === 'helicopter' && !item.onGround);
      aircraftMarker.element.dataset.iconMotion = aircraftIconMotionActive(item) ? 'running' : 'paused';
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
    updateWakePositions();
  }, [aircraft, aircraftMotionEnabled, aircraftShadowsVisible, favoriteIds, historyOpen, labelsVisible, language, ready, selectedId, shadowTimestamp, startMarkerAnimation, theme, unitSystem, updateWakePositions]);

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
      <div className="maplibre-surface" data-icon-animation={live && !historyOpen ? 'running' : 'paused'}
        data-wake-enabled={aircraftWakesVisible}
        data-wake-tone={mapTheme === 'dark' || mapTheme === 'vector' && theme !== 'daylight' ? 'light' : 'dark'} ref={containerRef} />
      {!ready && !error && <div className="map-loading">{translate(language, 'mapLoading')}</div>}
      {error && <div className="map-error"><strong>{translate(language, 'mapUnavailable')}</strong><span>{error}</span></div>}
    </>
  );
}
