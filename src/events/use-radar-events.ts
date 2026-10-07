'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, FeedStatus } from '../domain/aircraft';
import type { AircraftFilterPreset } from '../domain/aircraft-filter-preset';
import { distanceKilometres } from '../units';
import {
  detectRadarEvents,
  emptyRadarEventMonitorState,
  mergeRadarEvents,
  parseRadarEvents,
  radarEventStorageKey,
  type RadarEvent,
  type RadarEventPreferences,
} from '../domain/radar-event';

type UseRadarEventsOptions = {
  aircraft: Aircraft[];
  enabled: boolean;
  favoriteIds: ReadonlySet<string>;
  preferences: RadarEventPreferences;
  presets: AircraftFilterPreset[];
  receiverLat?: number;
  receiverLon?: number;
  status: FeedStatus;
};

export function useRadarEvents({ aircraft, enabled, favoriteIds, preferences, presets, receiverLat, receiverLon, status }: UseRadarEventsOptions) {
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [ready, setReady] = useState(false);
  const monitorRef = useRef(emptyRadarEventMonitorState());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setEvents(parseRadarEvents(window.localStorage.getItem(radarEventStorageKey)));
      } catch {
        // Notifications still work when browser storage is unavailable.
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      if (events.length) window.localStorage.setItem(radarEventStorageKey, JSON.stringify(events));
      else window.localStorage.removeItem(radarEventStorageKey);
    } catch {
      // Keep the in-memory log if storage is full or blocked.
    }
  }, [events, ready]);

  useEffect(() => {
    if (!ready) return;
    const observe = () => {
      const now = Date.now();
      if (!enabled) {
        monitorRef.current = emptyRadarEventMonitorState();
        setEvents((current) => mergeRadarEvents(current, [], now));
        return;
      }
      const result = detectRadarEvents(
        monitorRef.current, aircraft, favoriteIds, status, preferences, now,
        document.visibilityState !== 'hidden',
        { presets, receiverKey: `${receiverLat}:${receiverLon}`,
          distanceKm: (item) => distanceKilometres(receiverLat, receiverLon, item.latitude, item.longitude) },
      );
      monitorRef.current = result.state;
      setEvents((current) => mergeRadarEvents(current, result.events, now));
    };
    observe();
    // A sustained outage must be confirmed even if the feed status stops changing.
    const timer = window.setInterval(observe, 5_000);
    document.addEventListener('visibilitychange', observe);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', observe);
    };
  }, [aircraft, enabled, favoriteIds, preferences, presets, ready, receiverLat, receiverLon, status]);

  const markAllRead = useCallback(() => {
    setEvents((current) => {
      if (current.every((event) => event.read)) return current;
      return current.map((event) => ({ ...event, read: true }));
    });
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    clear,
    events,
    markAllRead,
    unreadCount: events.filter((event) => !event.read).length,
  };
}
