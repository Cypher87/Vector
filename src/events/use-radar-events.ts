'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, FeedStatus } from '../domain/aircraft';
import {
  detectRadarEvents,
  emptyRadarEventMonitorState,
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
  status: FeedStatus;
};

export function useRadarEvents({ aircraft, enabled, favoriteIds, preferences, status }: UseRadarEventsOptions) {
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [ready, setReady] = useState(false);
  const monitorRef = useRef(emptyRadarEventMonitorState());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setEvents(parseRadarEvents(window.localStorage.getItem(radarEventStorageKey)));
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!enabled) {
      monitorRef.current = emptyRadarEventMonitorState();
      return;
    }

    const result = detectRadarEvents(
      monitorRef.current,
      aircraft,
      favoriteIds,
      status,
      preferences,
    );
    monitorRef.current = result.state;
    if (result.events.length === 0) return;

    setEvents((current) => {
      const next = [...result.events.reverse(), ...current].slice(0, 100);
      window.localStorage.setItem(radarEventStorageKey, JSON.stringify(next));
      return next;
    });
  }, [aircraft, enabled, favoriteIds, preferences, ready, status]);

  const markAllRead = useCallback(() => {
    setEvents((current) => {
      if (current.every((event) => event.read)) return current;
      const next = current.map((event) => ({ ...event, read: true }));
      window.localStorage.setItem(radarEventStorageKey, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    window.localStorage.removeItem(radarEventStorageKey);
  }, []);

  return {
    clear,
    events,
    markAllRead,
    unreadCount: events.filter((event) => !event.read).length,
  };
}
