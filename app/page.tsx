'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AircraftPhoto } from '../src/components/aircraft-photo';
import { AircraftFilterMenu } from '../src/components/aircraft-filter-menu';
import { AircraftRoute } from '../src/components/aircraft-route';
import { AircraftTechnicalData } from '../src/components/aircraft-technical-data';
import { HistoryControls } from '../src/components/history-controls';
import { ReceiverDashboard } from '../src/components/receiver-dashboard';
import { SyncMenu } from '../src/components/sync-menu';
import { VectorIcon } from '../src/components/vector-icon';
import { useAircraftFeed } from '../src/data/use-aircraft-feed';
import { useAircraftHistory } from '../src/data/use-aircraft-history';
import type { Aircraft, FeedStatus, UnitSystem } from '../src/domain/aircraft';
import { aircraftKind, aircraftKindLabel } from '../src/domain/aircraft-kind';
import {
  aircraftFilterPresetStorageKey,
  emptyAircraftFilters,
  normalizeAircraftFilterPresets,
  parseAircraftFilterPresets,
  type AircraftFilterKey,
  type AircraftFilterPreset,
  type AircraftFilters,
  type AircraftSort,
} from '../src/domain/aircraft-filter-preset';
import { mergeAircraftMetadata } from '../src/domain/aircraft-metadata';
import { defaultLegTracePeriod, parseLegTracePeriod, type LegTracePeriod } from '../src/domain/aircraft-trace';
import {
  favoriteAircraftStorageKey,
  parseFavoriteAircraftIds,
  toggleFavoriteAircraftId,
} from '../src/domain/favorite-aircraft';
import { signalStrengthLevel, type SignalStrengthLevel } from '../src/domain/signal-strength';
import { localeForLanguage, translate, type Language, type TranslationKey } from '../src/i18n';
import { altitudeColor, altitudeLegendGradient } from '../src/map/altitude-color';
import { AircraftIcon } from '../src/map/aircraft-icon';
import { RadarMap } from '../src/map/radar-map';
import { aircraftIconRotation } from '../src/map/heading';
import { defaultMapTheme, parseMapTheme, type MapTheme } from '../src/map/map-theme';
import {
  applySyncPreferencePatch,
  createSyncPreferencePatch,
  hasSyncPreferences,
  type SyncPreferences,
} from '../src/sync/preferences';
import { useVectorSync } from '../src/sync/use-vector-sync';
import { defaultTheme, parseTheme, type Theme } from '../src/theme';
import { altitudeLegendScale, altitudeValue, distanceKilometres, distanceValue, formatNumber, speedValue, verticalRateValue } from '../src/units';

const formatCallsign = (value: string) => value.replace(/^([A-Z]{2,3})(\d.*)$/i, '$1 $2');
const formatAltitude = (aircraft: Aircraft, unitSystem: UnitSystem, language: Language) => {
  const altitude = altitudeValue(aircraft, unitSystem, language);
  return `${altitude.value}${altitude.unit ? ` ${altitude.unit}` : ''}`;
};
const trendArrow = (rate?: number) => rate === undefined || Math.abs(rate) < 128 ? '→' : rate > 0 ? '↗' : '↘';
const typeLabel = (aircraft: Aircraft, language: Language) => {
  if (aircraft.description || aircraft.aircraftType) return aircraft.description ?? aircraft.aircraftType!;
  const kind = aircraftKind(aircraft);
  return kind === 'unknown' ? translate(language, 'unknownType') : aircraftKindLabel(kind, language);
};
const sourceLabel = (source: Aircraft['source']) => source === 'mlat' ? 'MLAT' : source.startsWith('adsb') ? 'ADS-B' : source.replace('_', ' ').toUpperCase();
const directionLabel = (degrees?: number) => {
  if (degrees === undefined) return '—';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
};
const statusText: Record<FeedStatus, TranslationKey> = {
  connecting: 'receiverConnecting',
  live: 'receiverOnline',
  stale: 'dataDelayed',
  offline: 'receiverOffline',
};
const signalBarLevels: Exclude<SignalStrengthLevel, 0>[] = [1, 2, 3, 4];
const createAircraftFilterPresetId = () => `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function Home() {
  const feed = useAircraftFeed();
  const vectorSync = useVectorSync();
  const {
    connected: syncConnected,
    loading: syncLoading,
    preferences: syncedPreferences,
    profileId: syncProfileId,
    revision: syncRevision,
    savePreferences: saveSyncPreferences,
  } = vectorSync;
  const history = useAircraftHistory({
    aircraft: feed.aircraft,
    historyBaseUrl: feed.config.historyBaseUrl,
    lastUpdate: feed.lastUpdate,
    receiverHaveReplay: feed.receiver?.haveReplay === true,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const receiverDashboardRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receiverDashboardOpen, setReceiverDashboardOpen] = useState(false);
  const [autoHideDetails, setAutoHideDetails] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [aircraftShadowsVisible, setAircraftShadowsVisible] = useState(true);
  const [legTraceVisible, setLegTraceVisible] = useState(true);
  const [legTracePeriod, setLegTracePeriod] = useState<LegTracePeriod>(defaultLegTracePeriod);
  const [actualRangeVisible, setActualRangeVisible] = useState(false);
  const [distanceRingsVisible, setDistanceRingsVisible] = useState(false);
  const [technicalDataOpen, setTechnicalDataOpen] = useState(false);
  const [mobileDetailsExpanded, setMobileDetailsExpanded] = useState(false);
  const [mapFocus, setMapFocus] = useState<{ latitude?: number; longitude?: number; request: number }>();
  const [unitOverride, setUnitOverride] = useState<UnitSystem>();
  const [language, setLanguage] = useState<Language>('nl');
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [mapTheme, setMapTheme] = useState<MapTheme>(defaultMapTheme);
  const [aircraftFilters, setAircraftFilters] = useState<AircraftFilters>(emptyAircraftFilters);
  const [aircraftSort, setAircraftSort] = useState<AircraftSort>('altitude-desc');
  const [aircraftFilterPresets, setAircraftFilterPresets] = useState<AircraftFilterPreset[]>([]);
  const [favoriteAircraftIds, setFavoriteAircraftIds] = useState<string[]>([]);
  const [localPreferencesReady, setLocalPreferencesReady] = useState(false);
  const syncPreferencesAppliedForRef = useRef<string | undefined>(undefined);
  const syncPreferencesLastRemoteRef = useRef<SyncPreferences | undefined>(undefined);
  const syncPreferencesPendingForRef = useRef<string | undefined>(undefined);
  const syncPreferencesReadyForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem('vector.unitSystem');
      if (saved === 'aeronautical' || saved === 'metric' || saved === 'imperial') setUnitOverride(saved);
      const savedLanguage = window.localStorage.getItem('vector.language');
      if (savedLanguage === 'nl' || savedLanguage === 'en') {
        setLanguage(savedLanguage);
        document.documentElement.lang = savedLanguage;
      }
      const savedTheme = parseTheme(window.localStorage.getItem('vector.theme'));
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
      setMapTheme(parseMapTheme(window.localStorage.getItem('vector.mapTheme')));
      if (window.localStorage.getItem('vector.mapLabels') === 'false') setLabelsVisible(false);
      if (window.localStorage.getItem('vector.aircraftShadows') === 'false') setAircraftShadowsVisible(false);
      if (window.localStorage.getItem('vector.legTrace') === 'false') setLegTraceVisible(false);
      setLegTracePeriod(parseLegTracePeriod(window.localStorage.getItem('vector.legTracePeriod')));
      if (window.localStorage.getItem('vector.actualRangeOutline') === 'true') setActualRangeVisible(true);
      if (window.localStorage.getItem('vector.distanceRings') === 'true') setDistanceRingsVisible(true);
      if (window.localStorage.getItem('vector.autoHideDetails') === 'true') setAutoHideDetails(true);
      setFavoriteAircraftIds(parseFavoriteAircraftIds(window.localStorage.getItem(favoriteAircraftStorageKey)));
      setAircraftFilterPresets(parseAircraftFilterPresets(window.localStorage.getItem(aircraftFilterPresetStorageKey)));
      const savedSort = window.localStorage.getItem('vector.aircraftSort');
      if (savedSort === 'altitude-desc' || savedSort === 'callsign-asc' || savedSort === 'distance-asc' || savedSort === 'seen-asc') {
        setAircraftSort(savedSort);
      }
      try {
        const savedFilters = JSON.parse(window.localStorage.getItem('vector.aircraftFilters') ?? '{}') as Partial<AircraftFilters>;
        setAircraftFilters({
          adsbOnly: savedFilters.adsbOnly === true,
          airborneOnly: savedFilters.airborneOnly === true,
          favoritesOnly: savedFilters.favoritesOnly === true,
          positionOnly: savedFilters.positionOnly === true,
        });
      } catch {
        setAircraftFilters(emptyAircraftFilters);
      }
      setLocalPreferencesReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(target?.isContentEditable || target?.matches('input, textarea, select'));

      if (event.key === '/' && !isEditing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }

      if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (searchInputRef.current?.value) setQuery('');
        else searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: MouseEvent) => {
      const menu = settingsMenuRef.current;
      const target = event.target;
      if (menu?.open && target instanceof Node && !menu.contains(target)) menu.open = false;
      if (target instanceof Node && !receiverDashboardRef.current?.contains(target)) {
        setReceiverDashboardOpen(false);
      }
    };

    document.addEventListener('click', closeMenusOnOutsideClick);
    return () => document.removeEventListener('click', closeMenusOnOutsideClick);
  }, []);

  const unitSystem = unitOverride ?? feed.config.unitSystem;
  const altitudeLegend = altitudeLegendScale(unitSystem);
  const seconds = new Intl.NumberFormat(localeForLanguage[language], { maximumFractionDigits: 1 });
  const t = (key: TranslationKey) => translate(language, key);
  const changeUnitSystem = (value: UnitSystem) => {
    setUnitOverride(value);
    window.localStorage.setItem('vector.unitSystem', value);
  };
  const changeLanguage = (value: Language) => {
    setLanguage(value);
    document.documentElement.lang = value;
    window.localStorage.setItem('vector.language', value);
  };
  const changeTheme = (value: Theme) => {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    window.localStorage.setItem('vector.theme', value);
  };
  const changeMapTheme = (value: MapTheme) => {
    setMapTheme(value);
    window.localStorage.setItem('vector.mapTheme', value);
  };
  const changeLabelsVisible = (visible: boolean) => {
    setLabelsVisible(visible);
    window.localStorage.setItem('vector.mapLabels', String(visible));
  };
  const changeAircraftShadowsVisible = (visible: boolean) => {
    setAircraftShadowsVisible(visible);
    window.localStorage.setItem('vector.aircraftShadows', String(visible));
  };
  const changeLegTraceVisible = (visible: boolean) => {
    setLegTraceVisible(visible);
    window.localStorage.setItem('vector.legTrace', String(visible));
  };
  const changeLegTracePeriod = (period: LegTracePeriod) => {
    setLegTracePeriod(period);
    window.localStorage.setItem('vector.legTracePeriod', String(period));
  };
  const changeActualRangeVisible = (visible: boolean) => {
    setActualRangeVisible(visible);
    window.localStorage.setItem('vector.actualRangeOutline', String(visible));
  };
  const changeDistanceRingsVisible = (visible: boolean) => {
    setDistanceRingsVisible(visible);
    window.localStorage.setItem('vector.distanceRings', String(visible));
  };
  const changeAutoHideDetails = (enabled: boolean) => {
    setAutoHideDetails(enabled);
    window.localStorage.setItem('vector.autoHideDetails', String(enabled));
  };
  const clearAircraftSelection = () => {
    setSelectedId(null);
    setFollowing(false);
    setMobileDetailsExpanded(false);
    if (autoHideDetails) setDetailsOpen(false);
  };
  const changeAircraftFilter = (key: AircraftFilterKey, enabled: boolean) => {
    setAircraftFilters((current) => {
      const next = { ...current, [key]: enabled };
      window.localStorage.setItem('vector.aircraftFilters', JSON.stringify(next));
      return next;
    });
  };
  const resetAircraftFilters = () => {
    setAircraftFilters(emptyAircraftFilters);
    window.localStorage.removeItem('vector.aircraftFilters');
  };
  const changeAircraftSort = (value: AircraftSort) => {
    setAircraftSort(value);
    window.localStorage.setItem('vector.aircraftSort', value);
  };
  const applyAircraftFilterPreset = (preset: AircraftFilterPreset) => {
    setAircraftFilters(preset.filters);
    setAircraftSort(preset.sort);
    window.localStorage.setItem('vector.aircraftFilters', JSON.stringify(preset.filters));
    window.localStorage.setItem('vector.aircraftSort', preset.sort);
  };
  const saveAircraftFilterPreset = (name: string) => {
    setAircraftFilterPresets((current) => {
      const next = normalizeAircraftFilterPresets([
        ...current,
        { id: createAircraftFilterPresetId(), name, filters: aircraftFilters, sort: aircraftSort },
      ]);
      window.localStorage.setItem(aircraftFilterPresetStorageKey, JSON.stringify(next));
      return next;
    });
  };
  const renameAircraftFilterPreset = (presetId: string, name: string) => {
    setAircraftFilterPresets((current) => {
      const next = normalizeAircraftFilterPresets(current.map((preset) => preset.id === presetId ? { ...preset, name } : preset));
      window.localStorage.setItem(aircraftFilterPresetStorageKey, JSON.stringify(next));
      return next;
    });
  };
  const deleteAircraftFilterPreset = (presetId: string) => {
    setAircraftFilterPresets((current) => {
      const next = current.filter((preset) => preset.id !== presetId);
      window.localStorage.setItem(aircraftFilterPresetStorageKey, JSON.stringify(next));
      return next;
    });
  };
  const toggleFavoriteAircraft = (aircraftId: string) => {
    setFavoriteAircraftIds((current) => {
      const next = toggleFavoriteAircraftId(current, aircraftId);
      window.localStorage.setItem(favoriteAircraftStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const preferenceSnapshot = useMemo<SyncPreferences>(() => ({
    actualRangeOutline: actualRangeVisible,
    aircraftShadows: aircraftShadowsVisible,
    aircraftFilters,
    aircraftSort,
    autoHideDetails,
    distanceRings: distanceRingsVisible,
    favoriteAircraft: favoriteAircraftIds,
    filterPresets: aircraftFilterPresets,
    language,
    legTrace: legTraceVisible,
    legTracePeriod,
    mapLabels: labelsVisible,
    mapTheme,
    theme,
    unitSystem,
  }), [actualRangeVisible, aircraftFilterPresets, aircraftFilters, aircraftShadowsVisible, aircraftSort, autoHideDetails, distanceRingsVisible, favoriteAircraftIds, labelsVisible, language, legTracePeriod, legTraceVisible, mapTheme, theme, unitSystem]);

  useEffect(() => {
    if (!syncProfileId) {
      syncPreferencesAppliedForRef.current = undefined;
      syncPreferencesLastRemoteRef.current = undefined;
      syncPreferencesPendingForRef.current = undefined;
      syncPreferencesReadyForRef.current = undefined;
      return;
    }
    const revisionKey = `${syncProfileId}:${syncRevision}`;
    if (
      !localPreferencesReady
      || syncLoading
      || syncPreferencesAppliedForRef.current === revisionKey
      || syncPreferencesPendingForRef.current === revisionKey
    ) return;

    const previousRemote = syncPreferencesLastRemoteRef.current;
    const saved = previousRemote
      ? applySyncPreferencePatch(syncedPreferences, createSyncPreferencePatch(previousRemote, preferenceSnapshot))
      : syncedPreferences;
    syncPreferencesPendingForRef.current = revisionKey;
    const frame = window.requestAnimationFrame(() => {
      if (hasSyncPreferences(saved)) {
      if (saved.unitSystem) {
        setUnitOverride(saved.unitSystem);
        window.localStorage.setItem('vector.unitSystem', saved.unitSystem);
      }
      if (saved.language) {
        setLanguage(saved.language);
        document.documentElement.lang = saved.language;
        window.localStorage.setItem('vector.language', saved.language);
      }
      if (saved.theme) {
        setTheme(saved.theme);
        document.documentElement.dataset.theme = saved.theme;
        window.localStorage.setItem('vector.theme', saved.theme);
      }
      if (saved.mapTheme) {
        setMapTheme(saved.mapTheme);
        window.localStorage.setItem('vector.mapTheme', saved.mapTheme);
      }
      if (saved.mapLabels !== undefined) {
        setLabelsVisible(saved.mapLabels);
        window.localStorage.setItem('vector.mapLabels', String(saved.mapLabels));
      }
      if (saved.aircraftShadows !== undefined) {
        setAircraftShadowsVisible(saved.aircraftShadows);
        window.localStorage.setItem('vector.aircraftShadows', String(saved.aircraftShadows));
      }
      if (saved.legTrace !== undefined) {
        setLegTraceVisible(saved.legTrace);
        window.localStorage.setItem('vector.legTrace', String(saved.legTrace));
      }
      if (saved.legTracePeriod !== undefined) {
        setLegTracePeriod(saved.legTracePeriod);
        window.localStorage.setItem('vector.legTracePeriod', String(saved.legTracePeriod));
      }
      if (saved.actualRangeOutline !== undefined) {
        setActualRangeVisible(saved.actualRangeOutline);
        window.localStorage.setItem('vector.actualRangeOutline', String(saved.actualRangeOutline));
      }
      if (saved.distanceRings !== undefined) {
        setDistanceRingsVisible(saved.distanceRings);
        window.localStorage.setItem('vector.distanceRings', String(saved.distanceRings));
      }
      if (saved.autoHideDetails !== undefined) {
        setAutoHideDetails(saved.autoHideDetails);
        window.localStorage.setItem('vector.autoHideDetails', String(saved.autoHideDetails));
      }
      if (saved.favoriteAircraft) {
        setFavoriteAircraftIds(saved.favoriteAircraft);
        window.localStorage.setItem(favoriteAircraftStorageKey, JSON.stringify(saved.favoriteAircraft));
      }
      if (saved.aircraftSort) {
        setAircraftSort(saved.aircraftSort);
        window.localStorage.setItem('vector.aircraftSort', saved.aircraftSort);
      }
      if (saved.aircraftFilters) {
        setAircraftFilters(saved.aircraftFilters);
        window.localStorage.setItem('vector.aircraftFilters', JSON.stringify(saved.aircraftFilters));
      }
      if (saved.filterPresets !== undefined) {
        setAircraftFilterPresets(saved.filterPresets);
        window.localStorage.setItem(aircraftFilterPresetStorageKey, JSON.stringify(saved.filterPresets));
      }
      } else {
        void saveSyncPreferences(preferenceSnapshot).catch(() => undefined);
      }
      syncPreferencesAppliedForRef.current = revisionKey;
      syncPreferencesLastRemoteRef.current = syncedPreferences;
      syncPreferencesPendingForRef.current = undefined;
      syncPreferencesReadyForRef.current = syncProfileId;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (syncPreferencesPendingForRef.current === revisionKey) syncPreferencesPendingForRef.current = undefined;
    };
  }, [localPreferencesReady, preferenceSnapshot, saveSyncPreferences, syncedPreferences, syncLoading, syncProfileId, syncRevision]);

  useEffect(() => {
    if (!syncConnected || !syncProfileId || syncPreferencesReadyForRef.current !== syncProfileId) return;
    const timeout = window.setTimeout(() => {
      void saveSyncPreferences(preferenceSnapshot).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [preferenceSnapshot, saveSyncPreferences, syncConnected, syncProfileId]);

  const centerLat = feed.config.receiverLatitude ?? feed.receiver?.latitude ?? 52.3086;
  const centerLon = feed.config.receiverLongitude ?? feed.receiver?.longitude ?? 4.7639;

  const displayedAircraft = useMemo(() => {
    if (!history.open || !history.currentSnapshot) return feed.aircraft;
    const liveAircraft = new Map(feed.aircraft.map((item) => [item.id, item]));
    return history.currentSnapshot.aircraft.map((item) => mergeAircraftMetadata(
      item,
      liveAircraft.get(item.id),
    ));
  }, [feed.aircraft, history.currentSnapshot, history.open]);

  const favoriteAircraftIdSet = useMemo(() => new Set(favoriteAircraftIds), [favoriteAircraftIds]);

  const filterMatchedAircraft = useMemo(() => displayedAircraft.filter((item) => {
    if (aircraftFilters.positionOnly && (item.latitude === undefined || item.longitude === undefined)) return false;
    if (aircraftFilters.airborneOnly && item.onGround) return false;
    if (aircraftFilters.adsbOnly && !item.source.startsWith('adsb')) return false;
    if (aircraftFilters.favoritesOnly && !favoriteAircraftIdSet.has(item.id)) return false;
    return true;
  }), [aircraftFilters, displayedAircraft, favoriteAircraftIdSet]);

  const filteredAircraft = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery ? filterMatchedAircraft.filter((item) =>
      [item.flight, item.registration, item.aircraftType, item.description, item.id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery)),
    ) : [...filterMatchedAircraft];

    return matches.sort((left, right) => {
      if (aircraftSort === 'callsign-asc') {
        return left.flight.localeCompare(right.flight, language, { numeric: true });
      }
      if (aircraftSort === 'distance-asc') {
        const leftDistance = distanceKilometres(centerLat, centerLon, left.latitude, left.longitude) ?? Number.POSITIVE_INFINITY;
        const rightDistance = distanceKilometres(centerLat, centerLon, right.latitude, right.longitude) ?? Number.POSITIVE_INFINITY;
        return leftDistance - rightDistance || left.flight.localeCompare(right.flight, language, { numeric: true });
      }
      if (aircraftSort === 'seen-asc') {
        return left.seenSeconds - right.seenSeconds || left.flight.localeCompare(right.flight, language, { numeric: true });
      }
      return (right.altitudeFt ?? Number.NEGATIVE_INFINITY) - (left.altitudeFt ?? Number.NEGATIVE_INFINITY)
        || left.flight.localeCompare(right.flight, language, { numeric: true });
    });
  }, [aircraftSort, centerLat, centerLon, filterMatchedAircraft, language, query]);

  const selected = selectedId === null
    ? undefined
    : displayedAircraft.find((item) => item.id === selectedId);
  const selectedIsFavorite = selected ? favoriteAircraftIdSet.has(selected.id) : false;
  const selectedAltitude = selected ? altitudeValue(selected, unitSystem, language) : undefined;
  const selectedSpeed = selected ? speedValue(selected.groundSpeedKts, unitSystem, language) : undefined;
  const selectedVerticalRate = selected ? verticalRateValue(selected.verticalRateFpm, unitSystem, language) : undefined;
  const selectedDistanceKilometres = selected
    ? distanceKilometres(centerLat, centerLon, selected.latitude, selected.longitude)
    : undefined;
  const selectedDistance = selected ? distanceValue(selectedDistanceKilometres, unitSystem, language) : undefined;
  const selectedKind = selected ? aircraftKind(selected) : undefined;
  const selectedRssiDbfs = history.open ? undefined : selected?.rssiDbfs;
  const selectedSignalLevel = signalStrengthLevel(selectedRssiDbfs);
  const selectedSignalLabel = selectedRssiDbfs === undefined
    ? '—'
    : `${selectedSignalLevel} / 4 · ${seconds.format(selectedRssiDbfs)} dBFS`;
  const activeFilterCount = Object.values(aircraftFilters).filter(Boolean).length;
  const mapAircraft = selected && !filterMatchedAircraft.some((item) => item.id === selected.id)
    ? [...filterMatchedAircraft, selected]
    : filterMatchedAircraft;
  const listReadingFor = (item: Aircraft) => {
    const altitude = formatAltitude(item, unitSystem, language);
    if (aircraftSort === 'distance-asc') {
      const distance = distanceValue(distanceKilometres(centerLat, centerLon, item.latitude, item.longitude), unitSystem, language);
      return {
        primary: `${distance.value} ${distance.unit}`,
        secondary: `${t('altitude')} ${altitude}`,
      };
    }
    if (aircraftSort === 'seen-asc') {
      return {
        primary: `${seconds.format(item.seenSeconds)} s`,
        secondary: `${t('altitude')} ${altitude}`,
      };
    }
    const speed = speedValue(item.groundSpeedKts, unitSystem, language);
    return {
      primary: altitude,
      secondary: `${speed.value} ${speed.unit}`,
      trend: trendArrow(item.verticalRateFpm),
    };
  };
  return (
    <main className="radar-app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>{feed.config.siteName}</strong>
            <span>{feed.config.receiverName}</span>
          </div>
        </div>

        <div className="live-summary" aria-label={t('liveReceiverStatus')}>
          <span className={`live-pill ${history.open ? 'history' : feed.status}`}><i /> {history.open ? t('history') : feed.status === 'live' ? 'Live' : feed.status}</span>
          <span><strong>{displayedAircraft.length}</strong> {t(displayedAircraft.length === 1 ? 'aircraftSingular' : 'aircraft')}</span>
          <span className="desktop-only"><strong>{history.open ? '—' : feed.messageRate || '—'}</strong> msg/s</span>
        </div>

        <div className="top-actions">
          <SyncMenu
            connected={vectorSync.connected}
            devices={vectorSync.devices}
            error={vectorSync.error}
            language={language}
            loading={vectorSync.loading}
            onClearError={vectorSync.clearError}
            onCreatePairingCode={vectorSync.createPairingCode}
            onDelete={vectorSync.deleteProfile}
            onDisconnect={vectorSync.disconnect}
            onDisconnectDevice={vectorSync.disconnectDevice}
            onPair={vectorSync.pair}
            onRenameDevice={vectorSync.renameDevice}
            onStart={() => vectorSync.start(preferenceSnapshot)}
          />
          <div className={`receiver-dashboard-menu ${receiverDashboardOpen ? 'open' : ''}`} ref={receiverDashboardRef}>
            <button
              className="settings-button receiver-dashboard-button"
              type="button"
              aria-expanded={receiverDashboardOpen}
              aria-label={t('openReceiverDashboard')}
              title={t('openReceiverDashboard')}
              onClick={() => setReceiverDashboardOpen((current) => !current)}
            >
              <VectorIcon name="receiver" />
            </button>
            {receiverDashboardOpen && (
              <ReceiverDashboard
                aircraft={feed.aircraft}
                lastUpdate={feed.lastUpdate}
                language={language}
                latitude={centerLat}
                longitude={centerLon}
                messageCount={feed.messageCount}
                messageRate={feed.messageRate}
                onClose={() => setReceiverDashboardOpen(false)}
                receiver={feed.receiver}
                receiverName={feed.config.receiverName}
                status={feed.status}
                statusLabel={t(statusText[feed.status])}
              />
            )}
          </div>
          <details className="settings-menu" ref={settingsMenuRef}>
            <summary className="settings-button" aria-label={t('settings')} title={t('settings')}>
              <VectorIcon name="settings" />
            </summary>
            <div className="settings-popover">
              <strong>{t('settings')}</strong>
              <label className="settings-field">
                <span>{t('theme')}</span>
                <select
                  aria-label={t('theme')}
                  value={theme}
                  onChange={(event) => changeTheme(event.target.value as Theme)}
                >
                  <option value="vector">{t('themeVector')}</option>
                  <option value="midnight">{t('themeMidnight')}</option>
                  <option value="radar">{t('themeRadar')}</option>
                  <option value="amber">{t('themeAmber')}</option>
                  <option value="daylight">{t('themeDaylight')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t('mapTheme')}</span>
                <select
                  aria-label={t('mapTheme')}
                  value={mapTheme}
                  onChange={(event) => changeMapTheme(event.target.value as MapTheme)}
                >
                  <option value="vector">{t('mapThemeVector')}</option>
                  <option value="standard">{t('mapThemeStandard')}</option>
                  <option value="light">{t('mapThemeLight')}</option>
                  <option value="dark">{t('mapThemeDark')}</option>
                  <option value="contrast">{t('mapThemeContrast')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t('units')}</span>
                <select
                  aria-label={t('unitSystem')}
                  value={unitSystem}
                  onChange={(event) => changeUnitSystem(event.target.value as UnitSystem)}
                >
                  <option value="metric">{t('metric')}</option>
                  <option value="aeronautical">{t('aeronautical')}</option>
                  <option value="imperial">{t('imperial')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t('language')}</span>
                <select
                  aria-label={t('language')}
                  value={language}
                  onChange={(event) => changeLanguage(event.target.value as Language)}
                >
                  <option value="nl">{t('dutch')}</option>
                  <option value="en">{t('english')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t('autoHideDetails')}</span>
                <select
                  aria-label={t('autoHideDetails')}
                  value={autoHideDetails ? 'yes' : 'no'}
                  onChange={(event) => changeAutoHideDetails(event.target.value === 'yes')}
                >
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </label>
              <label className="settings-field">
                <span>{t('legTracePeriod')}</span>
                <select
                  aria-label={t('legTracePeriod')}
                  value={String(legTracePeriod)}
                  onChange={(event) => changeLegTracePeriod(parseLegTracePeriod(event.target.value))}
                >
                  <option value="30">{t('traceLast30Minutes')}</option>
                  <option value="60">{t('traceLastHour')}</option>
                  <option value="120">{t('traceLast2Hours')}</option>
                  <option value="240">{t('traceLast4Hours')}</option>
                  <option value="360">{t('traceLast6Hours')}</option>
                  <option value="480">{t('traceLast8Hours')}</option>
                  <option value="full">{t('traceFull')}</option>
                </select>
              </label>
            </div>
          </details>
        </div>
      </header>

      <section className={`workspace ${detailsOpen ? '' : 'details-closed'}`}>
        <aside className={`aircraft-panel ${mobileListOpen ? 'mobile-open' : ''}`}>
          <div className="panel-heading">
            <div>
              <h1>{t('aircraftListTitle')}</h1>
            </div>
            <div className="panel-buttons">
              <AircraftFilterMenu
                activeFilterCount={activeFilterCount}
                filters={aircraftFilters}
                language={language}
                presets={aircraftFilterPresets}
                sort={aircraftSort}
                onApplyPreset={applyAircraftFilterPreset}
                onChangeFilter={changeAircraftFilter}
                onDeletePreset={deleteAircraftFilterPreset}
                onRenamePreset={renameAircraftFilterPreset}
                onReset={resetAircraftFilters}
                onSavePreset={saveAircraftFilterPreset}
              />
              <button className="mobile-sheet-close" aria-label={t('closeList')} onClick={() => setMobileListOpen(false)} type="button">
                <VectorIcon name="close" />
              </button>
            </div>
          </div>

          <label className="search-box">
            <VectorIcon className="search-icon" name="search" />
            <input
              ref={searchInputRef}
              aria-label={t('aircraftSearch')}
              aria-keyshortcuts="/"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>

          <div className="list-meta">
            <span>{filteredAircraft.length} {t(filteredAircraft.length === 1 ? 'resultSingular' : 'results')}</span>
            <select
              className="sort-select"
              aria-label={t('sortAircraft')}
              value={aircraftSort}
              onChange={(event) => changeAircraftSort(event.target.value as AircraftSort)}
            >
              <option value="altitude-desc">{t('altitude')} ↓</option>
              <option value="distance-asc">{t('distance')} ↑</option>
              <option value="callsign-asc">{t('callsign')} A–Z</option>
              <option value="seen-asc">{t('lastSeen')}</option>
            </select>
          </div>

          <div className="aircraft-list">
            {filteredAircraft.map((item) => {
              const reading = listReadingFor(item);
              const kind = aircraftKind(item);
              const isFavorite = favoriteAircraftIdSet.has(item.id);
              return (
                <button
                  className={`aircraft-row ${selected?.id === item.id ? 'selected' : ''} ${isFavorite ? 'favorite' : ''}`}
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setDetailsOpen(true);
                    setMobileDetailsExpanded(false);
                    setMobileListOpen(false);
                    setMapFocus({ latitude: item.latitude, longitude: item.longitude, request: Date.now() });
                  }}
                >
                  <span className="aircraft-glyph" title={aircraftKindLabel(kind, language)}>
                    <AircraftIcon
                      aircraft={item}
                      className="list-aircraft-icon"
                      rotation={aircraftIconRotation(kind, item.trackDeg)}
                      style={{
                        color: altitudeColor(item, theme),
                      }}
                    />
                  </span>
                  <span className="aircraft-identity">
                    <strong>
                      {formatCallsign(item.flight)}
                      {isFavorite && <VectorIcon className="favorite-list-icon" name="favorite" />}
                    </strong>
                    <small>{typeLabel(item, language)}</small>
                  </span>
                  <span className="aircraft-reading">
                    <strong>{reading.primary} {reading.trend && <i>{reading.trend}</i>}</strong>
                    <small>{reading.secondary}</small>
                  </span>
                </button>
              );
            })}
            {filteredAircraft.length === 0 && (
              <div className="empty-list">{t('noAircraftFound')}</div>
            )}
          </div>
        </aside>

        <section className={`map ${history.open ? 'history-open' : ''}`} aria-label={t('radarMap')}>
          <RadarMap
            actualRangeAvailable={feed.receiver?.outlineJson === true}
            actualRangeVisible={actualRangeVisible}
            aircraft={mapAircraft}
            aircraftShadowsVisible={aircraftShadowsVisible}
            center={[centerLon, centerLat]}
            dataBaseUrl={feed.config.dataBaseUrl}
            distanceRingsVisible={distanceRingsVisible}
            focusTarget={mapFocus}
            following={following}
            favoriteIds={favoriteAircraftIdSet}
            historyOpen={history.open}
            labelsVisible={labelsVisible}
            legTraceVisible={legTraceVisible && !history.open}
            legTracePeriod={legTracePeriod}
            language={language}
            mapStyleUrl={feed.config.mapStyleUrl}
            mapTheme={mapTheme}
            onDeselect={clearAircraftSelection}
            onActualRangeVisibleChange={changeActualRangeVisible}
            onAircraftShadowsVisibleChange={changeAircraftShadowsVisible}
            onDistanceRingsVisibleChange={changeDistanceRingsVisible}
            onHistoryToggle={() => {
              if (history.open) history.close();
              else {
                clearAircraftSelection();
                history.openHistory();
              }
            }}
            onLabelsVisibleChange={changeLabelsVisible}
            onLegTraceVisibleChange={changeLegTraceVisible}
            onSelect={(id) => { setSelectedId(id); setDetailsOpen(true); setMobileDetailsExpanded(false); }}
            recordLiveTrace={!history.open}
            selectedId={selected?.id}
            shadowTimestamp={history.open ? history.currentSnapshot?.timestamp : feed.lastUpdate ? feed.lastUpdate / 1_000 : undefined}
            theme={theme}
            unitSystem={unitSystem}
          />

          <div className="altitude-legend" aria-label={`${t('aircraftColorAltitude')} 0 ${t('to')} ${altitudeLegend.ticks.at(-1)?.label} ${altitudeLegend.unit}`}>
            <span>{t('altitude')} <em>{altitudeLegend.unit}</em></span>
            <div aria-hidden="true" style={{ background: altitudeLegendGradient(theme) }}>{altitudeLegend.ticks.map((tick) => <i key={tick.label} style={{ left: `${tick.position}%` }} />)}</div>
            <small>{altitudeLegend.ticks.map((tick) => <span key={tick.label} style={{ left: `${tick.position}%` }}>{tick.label}</span>)}</small>
          </div>

          <HistoryControls
            canNextPeriod={history.canStepForward}
            canPreviousPeriod={history.canStepBackward}
            currentTimestamp={history.currentSnapshot?.timestamp}
            error={history.error}
            index={history.index}
            language={language}
            loading={history.loading}
            open={history.open}
            playing={history.playing}
            snapshotCount={history.snapshots.length}
            source={history.source}
            speed={history.speed}
            onClose={history.close}
            onIndexChange={history.setIndex}
            onLoadAt={(date) => { clearAircraftSelection(); void history.loadAt(date); }}
            onNextPeriod={() => history.stepPeriod(1)}
            onPreviousPeriod={() => history.stepPeriod(-1)}
            onSpeedChange={history.setSpeed}
            onTogglePlaying={history.togglePlaying}
          />

          {selected && !mobileDetailsExpanded && (
            <aside className="mobile-aircraft-summary" aria-label={`${formatCallsign(selected.flight)} ${t('details')}`}>
              <span className="mobile-summary-icon" title={selectedKind ? aircraftKindLabel(selectedKind, language) : undefined}>
                <AircraftIcon
                  aircraft={selected}
                  rotation={aircraftIconRotation(selectedKind ?? 'unknown', selected.trackDeg)}
                  style={{ color: altitudeColor(selected, theme) }}
                />
              </span>
              <span className="mobile-summary-copy">
                <strong>{formatCallsign(selected.flight)}</strong>
                <small>
                  {selected.registration ?? selected.aircraftType ?? selected.id.toUpperCase()}
                  {' · '}{selectedAltitude?.value}{selectedAltitude?.unit ? ` ${selectedAltitude.unit}` : ''}
                </small>
              </span>
              <button
                type="button"
                aria-label={t('showFullDetails')}
                onClick={() => { setDetailsOpen(true); setMobileDetailsExpanded(true); }}
              >
                {t('details')} <span aria-hidden="true">›</span>
              </button>
            </aside>
          )}

          <button className="mobile-list-button" onClick={() => setMobileListOpen(true)} type="button">
            <strong>{displayedAircraft.length}</strong> {t(displayedAircraft.length === 1 ? 'aircraftSingular' : 'aircraft')}
            <VectorIcon className="mobile-list-icon" name="list" />
          </button>
        </section>

        <aside
          className={`detail-panel ${selected ? '' : 'detail-empty'} ${mobileDetailsExpanded ? 'mobile-expanded' : ''}`}
          aria-hidden={!detailsOpen}
          inert={detailsOpen ? undefined : true}
        >
          {!selected ? (
            <>
            <div className="detail-actions">
              <strong className="detail-panel-title">{t('aircraftInformation')}</strong>
              <div>
                <button aria-label={t('closeDetails')} data-tooltip={t('closeDetails')} onClick={() => setDetailsOpen(false)}>
                  <VectorIcon name="close" />
                </button>
              </div>
            </div>
            <div className="detail-empty-content">
              <span><VectorIcon name="follow" /></span>
              <h2>{t('noAircraftSelected')}</h2>
              <p>{t('noAircraftSelectedHelp')}</p>
            </div>
            </>
          ) : (
            <>
            <div className="detail-actions">
              <span className="detail-title-group">
                <strong className="detail-panel-title">{t('aircraftInformation')}</strong>
                <span className={`source-pill ${selected.source}`}>{sourceLabel(selected.source)}</span>
              </span>
              <div>
                <button
                  type="button"
                  className={`favorite-action ${selectedIsFavorite ? 'active' : ''}`}
                  aria-label={t(selectedIsFavorite ? 'removeFromFavorites' : 'addToFavorites')}
                  aria-pressed={selectedIsFavorite}
                  data-tooltip={t(selectedIsFavorite ? 'removeFromFavorites' : 'addToFavorites')}
                  onClick={() => toggleFavoriteAircraft(selected.id)}
                ><VectorIcon name="favorite" /></button>
                <button
                  className={following ? 'active' : ''}
                  aria-label={t(following ? 'stopFollowing' : 'followAircraft')}
                  aria-pressed={following}
                  data-tooltip={t(following ? 'stopFollowing' : 'followAircraft')}
                  onClick={() => setFollowing((value) => !value)}
                ><VectorIcon name="follow" /></button>
                <button className="mobile-details-collapse" aria-label={t('collapseDetails')} data-tooltip={t('collapseDetails')} onClick={() => setMobileDetailsExpanded(false)}>
                  <VectorIcon name="chevronDown" />
                </button>
                <button className="desktop-details-close" aria-label={t('closeDetails')} data-tooltip={t('closeDetails')} onClick={() => setDetailsOpen(false)}>
                  <VectorIcon name="close" />
                </button>
              </div>
            </div>

            <div className="flight-title">
              <span className="large-plane" title={selectedKind ? aircraftKindLabel(selectedKind, language) : undefined}>
                <AircraftIcon
                  aircraft={selected}
                  className="detail-aircraft-icon"
                  rotation={aircraftIconRotation(selectedKind ?? 'unknown', selected.trackDeg)}
                />
              </span>
              <div>
                <span className="eyebrow">{selected.registration ?? selected.id.toUpperCase()}</span>
                <h2>{formatCallsign(selected.flight)}</h2>
                <p>{selected.aircraftType ?? '—'} · {typeLabel(selected, language)}</p>
              </div>
            </div>

            <AircraftPhoto aircraft={selected} language={language} />

            <AircraftRoute aircraft={selected} language={language} />

            <section className="metric-section">
              <div className="section-title"><h3>{t('flightStatus')}</h3><span>{seconds.format(selected.seenSeconds)} s {t('timeAgo')}</span></div>
              <div className="metric-grid">
                <div><span>{t('altitude')}</span><strong>{selectedAltitude?.value} {selectedAltitude?.unit && <small>{selectedAltitude.unit}</small>}</strong><em className={selected.verticalRateFpm && selected.verticalRateFpm > 0 ? 'up' : ''}>{trendArrow(selected.verticalRateFpm)} {selectedVerticalRate?.value} {selectedVerticalRate?.unit}</em></div>
                <div><span>{t('groundSpeed')}</span><strong>{selectedSpeed?.value} <small>{selectedSpeed?.unit}</small></strong><em>{unitSystem === 'metric' ? t('metric') : unitSystem === 'imperial' ? t('imperial') : t('aeronautical')}</em></div>
                <div><span>{t('course')}</span><strong>{formatNumber(selected.trackDeg, language)}° <small>{directionLabel(selected.trackDeg)}</small></strong><em>{t('trueTrack')}</em></div>
                <div><span>Squawk</span><strong>{selected.squawk ?? '—'}</strong><em>{selected.squawk === '7700' ? t('emergency') : t('normal')}</em></div>
              </div>
            </section>

            <section className="signal-card">
              <div>
                <span
                  className="signal-bars"
                  role="img"
                  aria-label={`${t('signalStrength')}: ${selectedSignalLabel}`}
                  title={`${t('signalStrength')}: ${selectedSignalLabel}`}
                >
                  {signalBarLevels.map((level) => (
                    <i className={level <= selectedSignalLevel ? 'active' : ''} key={level} />
                  ))}
                </span>
                <span>
                  <strong>{sourceLabel(selected.source)} {t('reception')}{selectedRssiDbfs === undefined ? '' : ` · ${seconds.format(selectedRssiDbfs)} dBFS`}</strong>
                  <small>{selected.latitude === undefined ? t('noCurrentPosition') : `${selectedDistance?.value} ${selectedDistance?.unit} ${t('fromReceiver')}`} · {history.open ? '—' : formatNumber(selected.messages, language)} {t('messages')}{selected.messageRate === undefined || history.open ? '' : ` · ${seconds.format(selected.messageRate)} msg/s`}</small>
                </span>
              </div>
            </section>

            <section className={`technical-card ${technicalDataOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="technical-toggle"
                aria-controls="aircraft-technical-data"
                aria-expanded={technicalDataOpen}
                onClick={() => setTechnicalDataOpen((open) => !open)}
              >
                <strong>{t('technicalData')}</strong>
                <VectorIcon className="technical-chevron" name="chevronDown" />
              </button>

              {technicalDataOpen && (
                <AircraftTechnicalData
                  aircraft={selected}
                  distanceKilometres={selectedDistanceKilometres}
                  historyMode={history.open}
                  language={language}
                  unitSystem={unitSystem}
                />
              )}
            </section>

            </>
          )}
        </aside>
      </section>

      <footer className="statusbar">
        <span><i className={`status-dot ${history.open ? 'history' : feed.status}`} /> {history.open ? t('history') : t(statusText[feed.status])}</span>
        {history.open && history.currentSnapshot ? (
          <span className="desktop-only">{new Intl.DateTimeFormat(localeForLanguage[language], { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(history.currentSnapshot.timestamp * 1_000))}</span>
        ) : feed.error ? (
          <span className="desktop-only">{t(feed.error)}</span>
        ) : !feed.lastUpdate ? (
          <span className="desktop-only">{t('connecting')}</span>
        ) : null}
        <span className="status-spacer" />
        <span>{centerLat.toFixed(2)}° N, {centerLon.toFixed(2)}° E</span>
        <a className="desktop-only" href="/licenses/tar1090-GPL-2.0-or-later.txt" target="_blank" rel="noreferrer">Icons: tar1090 · GPL</a>
        <span className="desktop-only">readsb {feed.receiver?.version ?? '—'}</span>
      </footer>
    </main>
  );
}
