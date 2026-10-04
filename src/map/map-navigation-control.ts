import type { Map as MapLibre } from 'maplibre-gl';
import { createVectorIconElement, type VectorIconName } from '../components/vector-icon';
import { translate, type Language } from '../i18n';

const mapControlLabels = (
  language: Language,
  actualRangeVisible: boolean,
  aircraftShadowsVisible: boolean,
  distanceRingsVisible: boolean,
  labelsVisible: boolean,
  legTraceVisible: boolean,
) => ({
  actualRangeName: translate(language, 'actualRange'),
  actualRange: translate(language, actualRangeVisible ? 'hideActualRangeOutline' : 'showActualRangeOutline'),
  aircraftLabels: translate(language, 'aircraftLabels'),
  aircraftShadowsName: translate(language, 'aircraftShadows'),
  aircraftShadows: translate(language, aircraftShadowsVisible ? 'hideAircraftShadows' : 'showAircraftShadows'),
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

export const createMapNavigationControl = (
  center: [number, number],
  language: Language,
  actualRangeAvailable: boolean,
  actualRangeVisible: boolean,
  aircraftShadowsVisible: boolean,
  distanceRingsVisible: boolean,
  labelsVisible: boolean,
  legTraceVisible: boolean,
  historyOpen: boolean,
  onActualRangeToggle: () => void,
  onAircraftShadowsToggle: () => void,
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
    aircraftShadows: HTMLButtonElement;
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
  let currentAircraftShadowsVisible = aircraftShadowsVisible;
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
      currentAircraftShadowsVisible,
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
    setLayerButtonState(controls.aircraftShadows, labels.aircraftShadowsName, labels.aircraftShadows, currentAircraftShadowsVisible);
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
    nextAircraftShadowsVisible: boolean,
    nextDistanceRingsVisible: boolean,
    nextLabelsVisible: boolean,
    nextLegTraceVisible: boolean,
    nextHistoryOpen: boolean,
  ) => {
    currentLanguage = nextLanguage;
    currentActualRangeAvailable = nextActualRangeAvailable;
    currentActualRangeVisible = nextActualRangeVisible;
    currentAircraftShadowsVisible = nextAircraftShadowsVisible;
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
        currentAircraftShadowsVisible,
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
        aircraftShadows: layerButton('vector-map-aircraft-shadows', labels.aircraftShadows, onAircraftShadowsToggle, 'shadows'),
        distanceRings: layerButton('vector-map-distance-rings', labels.distanceRings, onDistanceRingsToggle, 'rings'),
        layers: button('vector-map-toggle vector-map-layers', labels.mapLayers, () => setMenuOpen(!menuOpen), 'layers'),
        labels: layerButton('vector-map-labels', labels.labels, onLabelsToggle, 'labels'),
        legTrace: layerButton('vector-map-leg-trace', labels.legTrace, onLegTraceToggle, 'trace'),
        history: button('vector-map-toggle vector-map-history', labels.history, onHistoryToggle, 'history'),
      };
      controls.layers.setAttribute('aria-controls', layerMenu.id);
      controls.layers.setAttribute('aria-expanded', 'false');
      layerMenu.appendChild(controls.labels);
      layerMenu.appendChild(controls.aircraftShadows);
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
