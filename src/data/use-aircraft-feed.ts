'use client';

import { useEffect, useRef, useState } from 'react';
import type { Aircraft, FeedStatus, Receiver, RuntimeConfig } from '../domain/aircraft';
import { distanceKilometres } from '../units';
import { loadAircraft, loadReceiver, loadRuntimeConfig } from './readsb';

type FeedState = {
  aircraft: Aircraft[];
  config: RuntimeConfig;
  receiver?: Receiver;
  status: FeedStatus;
  lastUpdate?: number;
  messageRate: number;
  error?: 'liveDataUnavailable' | 'receiverUnavailable';
};

const defaultConfig: RuntimeConfig = {
  dataBaseUrl: '/data/',
  historyBaseUrl: '/globe_history/',
  mapStyleUrl: '/map-style.json',
  siteName: 'Vector',
  receiverName: 'Local readsb receiver',
  unitSystem: 'metric',
};

const shortestAngleDifference = (from: number, to: number) => ((to - from + 540) % 360) - 180;

const stabilizeAircraft = (next: Aircraft, previous?: Aircraft): Aircraft => {
  if (!previous) return next;

  let latitude = next.latitude;
  let longitude = next.longitude;
  let trackDeg = next.trackDeg;
  const nearlyStationary = next.onGround || (next.groundSpeedKts !== undefined && next.groundSpeedKts < 4);

  if (
    nearlyStationary
    && previous.latitude !== undefined
    && previous.longitude !== undefined
    && latitude !== undefined
    && longitude !== undefined
  ) {
    const movementMetres = (distanceKilometres(previous.latitude, previous.longitude, latitude, longitude) ?? 0) * 1_000;
    if (movementMetres < 35) {
      latitude = previous.latitude;
      longitude = previous.longitude;
    }
  }

  if (previous.trackDeg !== undefined && trackDeg !== undefined) {
    const change = Math.abs(shortestAngleDifference(previous.trackDeg, trackDeg));
    if (nearlyStationary || change < 1.25) trackDeg = previous.trackDeg;
  }

  if (latitude === next.latitude && longitude === next.longitude && trackDeg === next.trackDeg) return next;
  return { ...next, latitude, longitude, trackDeg };
};

export function useAircraftFeed(): FeedState {
  const [state, setState] = useState<FeedState>({
    aircraft: [],
    config: defaultConfig,
    status: 'connecting',
    messageRate: 0,
  });
  const previous = useRef<{ messages: number; at: number } | undefined>(undefined);
  const previousAircraft = useRef(new Map<string, Aircraft>());

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();

    async function start() {
      const config = await loadRuntimeConfig(controller.signal);
      if (!active) return;
      setState((current) => ({ ...current, config }));

      let receiver: Receiver;
      try {
        receiver = await loadReceiver(config.dataBaseUrl, controller.signal);
        if (!active) return;
        setState((current) => ({ ...current, receiver }));
      } catch {
        if (!active) return;
        setState((current) => ({
          ...current,
          status: 'offline',
          error: 'receiverUnavailable',
        }));
        return;
      }

      const poll = async () => {
        try {
          const snapshot = await loadAircraft(config.dataBaseUrl, controller.signal);
          if (!active) return;
          const at = Date.now();
          const earlier = previous.current;
          const elapsedSeconds = earlier ? (at - earlier.at) / 1_000 : 0;
          const rate = earlier && elapsedSeconds > 0
            ? Math.max(0, Math.round((snapshot.messages - earlier.messages) / elapsedSeconds))
            : 0;
          previous.current = { messages: snapshot.messages, at };
          const stableAircraft = snapshot.aircraft.map((item) => stabilizeAircraft(item, previousAircraft.current.get(item.id)));
          previousAircraft.current = new Map(stableAircraft.map((item) => [item.id, item]));
          failures = 0;
          setState((current) => ({
            ...current,
            aircraft: stableAircraft,
            receiver,
            status: 'live',
            lastUpdate: at,
            messageRate: rate,
            error: undefined,
          }));
          timer = setTimeout(poll, receiver.refreshMs);
        } catch {
          if (!active || controller.signal.aborted) return;
          failures += 1;
          setState((current) => ({
            ...current,
            status: failures >= 3 ? 'offline' : 'stale',
            error: 'liveDataUnavailable',
          }));
          timer = setTimeout(poll, Math.min(15_000, receiver.refreshMs * 2 ** failures));
        }
      };

      void poll();
    }

    void start();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
