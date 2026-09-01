'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, AircraftHistorySnapshot, AircraftMetadata } from '../domain/aircraft';
import { combineAircraftMetadata, mergeAircraftMetadata } from '../domain/aircraft-metadata';
import { loadAircraftMetadata, loadAircraftReplayChunk } from './readsb';

export type HistorySource = 'receiver' | 'session';

type HistoryState = {
  error: boolean;
  index: number;
  loading: boolean;
  open: boolean;
  playbackTimestamp?: number;
  playing: boolean;
  snapshots: AircraftHistorySnapshot[];
  source: HistorySource;
  speed: number;
};

type AircraftHistoryOptions = {
  aircraft: Aircraft[];
  historyBaseUrl: string;
  lastUpdate?: number;
  receiverHaveReplay: boolean;
};

const CAPTURE_INTERVAL_MS = 5_000;
const SESSION_RETENTION_MS = 30 * 60 * 1_000;
const REPLAY_CHUNK_MS = 30 * 60 * 1_000;
const PLAYBACK_TICK_MS = 100;

const closestSnapshotIndex = (snapshots: AircraftHistorySnapshot[], targetSeconds: number) => {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  snapshots.forEach((snapshot, index) => {
    const distance = Math.abs(snapshot.timestamp - targetSeconds);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
};

const receiverChunkStart = (timestampMs: number) => {
  const start = new Date(timestampMs);
  start.setUTCMinutes(Math.floor(start.getUTCMinutes() / 30) * 30, 0, 0);
  return start.getTime();
};

const latestReceiverChunkStart = (referenceMs: number) => receiverChunkStart(referenceMs) - REPLAY_CHUNK_MS;

const availableReceiverTarget = (target: Date, referenceMs: number) => {
  const currentChunkStart = receiverChunkStart(referenceMs);
  const lastAvailable = currentChunkStart - 10_000;
  if (target.getTime() <= lastAvailable) return target;

  return new Date(currentChunkStart - 29 * 60_000);
};

const replayCacheKey = (target: Date) => `heading-v2-${target.getUTCFullYear()}-${target.getUTCMonth()}-${target.getUTCDate()}-${target.getUTCHours()}-${Math.floor(target.getUTCMinutes() / 30)}`;

const interpolateNumber = (from: number | undefined, to: number | undefined, progress: number) =>
  from === undefined || to === undefined ? from : from + (to - from) * progress;

const interpolateAngle = (from: number | undefined, to: number | undefined, progress: number) => {
  if (from === undefined || to === undefined) return from;
  const difference = ((to - from + 540) % 360) - 180;
  return (from + difference * progress + 360) % 360;
};

const interpolateSnapshot = (
  snapshots: AircraftHistorySnapshot[],
  index: number,
  playbackTimestamp?: number,
): AircraftHistorySnapshot | undefined => {
  const current = snapshots[index];
  if (!current) return undefined;
  const timestamp = playbackTimestamp ?? current.timestamp;
  const next = snapshots[index + 1];
  if (!next || next.timestamp <= current.timestamp || timestamp <= current.timestamp) {
    return timestamp === current.timestamp ? current : { ...current, timestamp };
  }

  const progress = Math.max(0, Math.min(1, (timestamp - current.timestamp) / (next.timestamp - current.timestamp)));
  const nextAircraft = new Map(next.aircraft.map((item) => [item.id, item]));
  return {
    timestamp,
    aircraft: current.aircraft.map((item) => {
      const destination = nextAircraft.get(item.id);
      if (!destination) return item;
      return {
        ...item,
        altitudeFt: interpolateNumber(item.altitudeFt, destination.altitudeFt, progress),
        groundSpeedKts: interpolateNumber(item.groundSpeedKts, destination.groundSpeedKts, progress),
        latitude: interpolateNumber(item.latitude, destination.latitude, progress),
        longitude: interpolateNumber(item.longitude, destination.longitude, progress),
        trackDeg: interpolateAngle(item.trackDeg, destination.trackDeg, progress),
      };
    }),
  };
};

export function useAircraftHistory({ aircraft, historyBaseUrl, lastUpdate, receiverHaveReplay }: AircraftHistoryOptions) {
  const sessionSnapshotsRef = useRef<AircraftHistorySnapshot[]>([]);
  const replayCacheRef = useRef(new Map<string, AircraftHistorySnapshot[]>());
  const aircraftMetadataRef = useRef(new Map<string, AircraftMetadata>());
  const metadataLookupRef = useRef(new Set<string>());
  const lastCaptureRef = useRef(0);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<HistoryState>({
    error: false,
    index: 0,
    loading: false,
    open: false,
    playing: false,
    snapshots: [],
    source: 'session',
    speed: 30,
  });

  useEffect(() => {
    for (const item of aircraft) {
      aircraftMetadataRef.current.set(
        item.id,
        combineAircraftMetadata(aircraftMetadataRef.current.get(item.id), item),
      );
    }
    if (!lastUpdate || lastUpdate - lastCaptureRef.current < CAPTURE_INTERVAL_MS) return;
    lastCaptureRef.current = lastUpdate;
    const oldestTimestamp = (lastUpdate - SESSION_RETENTION_MS) / 1_000;
    const nextSnapshots = [
      ...sessionSnapshotsRef.current.filter((snapshot) => snapshot.timestamp >= oldestTimestamp),
      { aircraft, timestamp: lastUpdate / 1_000 },
    ];
    sessionSnapshotsRef.current = nextSnapshots;

    setState((current) => {
      if (!current.open || current.source !== 'session') return current;
      const wasAtEnd = current.index >= current.snapshots.length - 1;
      const index = current.playing
        ? Math.min(current.index, nextSnapshots.length - 1)
        : wasAtEnd ? nextSnapshots.length - 1 : Math.min(current.index, nextSnapshots.length - 1);
      return {
        ...current,
        index,
        playbackTimestamp: current.playing ? current.playbackTimestamp : nextSnapshots[index]?.timestamp,
        snapshots: nextSnapshots,
      };
    });
  }, [aircraft, lastUpdate]);

  const sessionFallback = useCallback((target: Date, error: boolean) => {
    const snapshots = sessionSnapshotsRef.current.length > 0
      ? [...sessionSnapshotsRef.current]
      : [{ aircraft, timestamp: (lastUpdate ?? Date.now()) / 1_000 }];
    const index = closestSnapshotIndex(snapshots, target.getTime() / 1_000);
    setState((current) => ({
      ...current,
      error,
      index,
      loading: false,
      open: true,
      playbackTimestamp: snapshots[index]?.timestamp,
      playing: false,
      snapshots,
      source: 'session',
    }));
  }, [aircraft, lastUpdate]);

  const loadReceiverAt = useCallback(async (
    target: Date,
    options: { fallbackToSession: boolean; playAfterLoad: boolean },
  ) => {
    requestRef.current?.abort();
    if (!receiverHaveReplay) {
      sessionFallback(target, false);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({ ...current, error: false, loading: true, open: true, playing: false }));
    try {
      const receiverTarget = availableReceiverTarget(target, lastUpdate ?? Date.now());
      const cacheKey = replayCacheKey(receiverTarget);
      let snapshots = replayCacheRef.current.get(cacheKey);
      if (!snapshots) {
        snapshots = await loadAircraftReplayChunk(historyBaseUrl, receiverTarget, controller.signal);
        replayCacheRef.current.set(cacheKey, snapshots);
        if (replayCacheRef.current.size > 12) {
          const oldestKey = replayCacheRef.current.keys().next().value;
          if (oldestKey) replayCacheRef.current.delete(oldestKey);
        }
      }
      if (controller.signal.aborted) return;
      const metadataIds = [...new Set(snapshots.flatMap((snapshot) => snapshot.aircraft.map((item) => item.id)))]
        .filter((id) => /^[0-9a-f]{6}$/.test(id) && !metadataLookupRef.current.has(id));
      if (metadataIds.length > 0) {
        try {
          const databaseMetadata = await loadAircraftMetadata(metadataIds, controller.signal);
          if (controller.signal.aborted) return;
          for (const id of metadataIds) metadataLookupRef.current.add(id);
          for (const [id, metadata] of databaseMetadata) {
            aircraftMetadataRef.current.set(
              id,
              combineAircraftMetadata(metadata, aircraftMetadataRef.current.get(id) ?? {}),
            );
          }
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      const enrichedSnapshots = snapshots.map((snapshot) => ({
        ...snapshot,
        aircraft: snapshot.aircraft.map((item) => mergeAircraftMetadata(
          item,
          aircraftMetadataRef.current.get(item.id),
        )),
      }));
      const index = closestSnapshotIndex(enrichedSnapshots, receiverTarget.getTime() / 1_000);
      setState((current) => ({
        ...current,
        error: false,
        index,
        loading: false,
        open: true,
        playbackTimestamp: snapshots[index]?.timestamp,
        playing: options.playAfterLoad && snapshots.length > 1,
        snapshots: enrichedSnapshots,
        source: 'receiver',
      }));
    } catch {
      if (controller.signal.aborted) return;
      if (options.fallbackToSession) {
        sessionFallback(target, true);
      } else {
        setState((current) => ({ ...current, error: true, loading: false, playing: false }));
      }
    }
  }, [historyBaseUrl, lastUpdate, receiverHaveReplay, sessionFallback]);

  const loadAt = useCallback(async (target: Date) => {
    const currentChunkStart = receiverChunkStart(lastUpdate ?? Date.now());
    if (target.getTime() >= currentChunkStart && sessionSnapshotsRef.current.length > 0) {
      sessionFallback(target, false);
      return;
    }
    await loadReceiverAt(target, { fallbackToSession: false, playAfterLoad: false });
  }, [lastUpdate, loadReceiverAt, sessionFallback]);

  const openHistory = useCallback(() => {
    const target = new Date((lastUpdate ?? Date.now()) - 5 * 60 * 1_000);
    const snapshots = sessionSnapshotsRef.current.length > 0
      ? [...sessionSnapshotsRef.current]
      : [{ aircraft, timestamp: (lastUpdate ?? Date.now()) / 1_000 }];
    const currentChunkStart = receiverChunkStart(lastUpdate ?? Date.now());
    const earliestSessionTimestamp = snapshots[0]?.timestamp ?? Number.POSITIVE_INFINITY;
    if (target.getTime() >= currentChunkStart || target.getTime() / 1_000 >= earliestSessionTimestamp) {
      sessionFallback(target, false);
      return;
    }
    setState((current) => ({
      ...current,
      error: false,
      index: snapshots.length - 1,
      loading: receiverHaveReplay,
      open: true,
      playbackTimestamp: snapshots.at(-1)?.timestamp,
      playing: false,
      snapshots,
      source: 'session',
    }));
    void loadReceiverAt(target, { fallbackToSession: true, playAfterLoad: false });
  }, [aircraft, lastUpdate, loadReceiverAt, receiverHaveReplay, sessionFallback]);

  const close = useCallback(() => {
    requestRef.current?.abort();
    setState((current) => ({ ...current, loading: false, open: false, playing: false }));
  }, []);

  const setIndex = useCallback((index: number) => {
    setState((current) => {
      const boundedIndex = Math.max(0, Math.min(index, current.snapshots.length - 1));
      return {
        ...current,
        index: boundedIndex,
        playbackTimestamp: current.snapshots[boundedIndex]?.timestamp,
        playing: false,
      };
    });
  }, []);

  const togglePlaying = useCallback(() => {
    setState((current) => {
      if (current.playing) return { ...current, playing: false };
      if (current.snapshots.length < 2) return current;

      const atEnd = current.index >= current.snapshots.length - 1;
      const hasNextReceiverChunk = current.source === 'receiver'
        && receiverChunkStart((current.snapshots[current.index]?.timestamp ?? 0) * 1_000) < latestReceiverChunkStart(lastUpdate ?? Date.now());
      const restartCurrentPeriod = atEnd && !hasNextReceiverChunk;
      const index = restartCurrentPeriod ? 0 : current.index;

      return {
        ...current,
        index,
        playbackTimestamp: restartCurrentPeriod
          ? current.snapshots[index]?.timestamp
          : current.playbackTimestamp ?? current.snapshots[index]?.timestamp,
        playing: true,
      };
    });
  }, [lastUpdate]);

  const setSpeed = useCallback((speed: number) => {
    setState((current) => ({ ...current, speed }));
  }, []);

  const stepPeriod = useCallback((direction: -1 | 1) => {
    const current = state.snapshots[state.index];
    if (!current) return;
    const timestamp = state.playbackTimestamp ?? current.timestamp;
    void loadAt(new Date(timestamp * 1_000 + direction * REPLAY_CHUNK_MS));
  }, [loadAt, state.index, state.playbackTimestamp, state.snapshots]);

  useEffect(() => {
    if (!state.open || !state.playing) return;
    let previousTick = performance.now();
    const timer = window.setInterval(() => {
      const tick = performance.now();
      const elapsedSeconds = Math.min(1, Math.max(0, tick - previousTick) / 1_000);
      previousTick = tick;
      setState((current) => {
        if (!current.open || !current.playing || current.snapshots.length < 2) return current;
        const finalTimestamp = current.snapshots.at(-1)?.timestamp;
        const startTimestamp = current.playbackTimestamp ?? current.snapshots[current.index]?.timestamp;
        if (finalTimestamp === undefined || startTimestamp === undefined) return { ...current, playing: false };

        const playbackTimestamp = Math.min(finalTimestamp, startTimestamp + elapsedSeconds * current.speed);
        let index = current.index;
        while (index + 1 < current.snapshots.length && current.snapshots[index + 1].timestamp <= playbackTimestamp) {
          index += 1;
        }
        return { ...current, index, playbackTimestamp };
      });
    }, PLAYBACK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [state.open, state.playing]);

  useEffect(() => {
    if (!state.open || !state.playing || state.index < state.snapshots.length - 1) return;
    const current = state.snapshots[state.index];
    const hasNextReceiverChunk = current
      && state.source === 'receiver'
      && receiverChunkStart(current.timestamp * 1_000) < latestReceiverChunkStart(lastUpdate ?? Date.now());
    const sessionSnapshots = sessionSnapshotsRef.current;
    const firstSessionIndex = current
      ? sessionSnapshots.findIndex((snapshot) => snapshot.timestamp > current.timestamp)
      : -1;
    const frame = window.requestAnimationFrame(() => {
      if (hasNextReceiverChunk) {
        const nextChunk = receiverChunkStart(current.timestamp * 1_000) + REPLAY_CHUNK_MS;
        void loadReceiverAt(new Date(nextChunk), { fallbackToSession: false, playAfterLoad: true });
      } else if (state.source === 'receiver' && firstSessionIndex >= 0) {
        setState((value) => ({
          ...value,
          error: false,
          index: firstSessionIndex,
          loading: false,
          playbackTimestamp: sessionSnapshots[firstSessionIndex].timestamp,
          playing: sessionSnapshots.length - firstSessionIndex > 1,
          snapshots: [...sessionSnapshots],
          source: 'session',
        }));
      } else {
        setState((value) => ({ ...value, playing: false }));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastUpdate, loadReceiverAt, state.index, state.open, state.playing, state.snapshots, state.source]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const currentSnapshot = interpolateSnapshot(state.snapshots, state.index, state.playbackTimestamp);
  const hasEarlierReceiverHistory = receiverHaveReplay && Boolean(currentSnapshot);
  const hasLaterSessionHistory = Boolean(
    currentSnapshot && lastUpdate && lastUpdate / 1_000 > currentSnapshot.timestamp,
  );
  const canStepBackward = state.source === 'receiver'
    ? Boolean(currentSnapshot)
    : state.index > 0 || hasEarlierReceiverHistory;
  const canStepForward = state.source === 'receiver'
    ? Boolean(currentSnapshot && lastUpdate
      && (receiverChunkStart(currentSnapshot.timestamp * 1_000) < latestReceiverChunkStart(lastUpdate) || hasLaterSessionHistory))
    : state.index < state.snapshots.length - 1;

  return {
    ...state,
    canStepBackward,
    canStepForward,
    close,
    currentSnapshot,
    loadAt,
    openHistory,
    setIndex,
    setSpeed,
    stepPeriod,
    togglePlaying,
  };
}
