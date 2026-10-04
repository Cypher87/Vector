'use client';

import { useEffect, useState } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { DEFAULT_RUNTIME_CONFIG } from '../runtime-config';
import { distanceKilometres } from '../units';
import { loadAircraft, loadReceiver, loadRuntimeConfig } from './readsb';
import { initialFeedState, startAircraftFeed, type FeedState } from './aircraft-feed';

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
  const [state, setState] = useState(() => initialFeedState(DEFAULT_RUNTIME_CONFIG));
  useEffect(() => {
    const feed = startAircraftFeed({
      loadConfig: loadRuntimeConfig,
      loadReceiver,
      loadAircraft,
      stabilize: stabilizeAircraft,
    }, initialFeedState(DEFAULT_RUNTIME_CONFIG), setState);
    const resume = () => {
      if (document.visibilityState !== 'hidden') feed.resume();
    };
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
      feed.stop();
    };
  }, []);
  return state;
}
