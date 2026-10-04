import type { Aircraft, FeedStatus, Receiver, RuntimeConfig } from '../domain/aircraft.ts';

export type FeedState = {
  aircraft: Aircraft[];
  config: RuntimeConfig;
  receiver?: Receiver;
  status: FeedStatus;
  /** Receiver timestamp, not the time at which an HTTP request completed. */
  lastUpdate?: number;
  dataAgeSeconds?: number;
  messageCount: number;
  messageRate: number;
  error?: 'liveDataUnavailable' | 'receiverUnavailable' | 'liveDataOutdated';
};

type Snapshot = { now: number; messages: number; aircraft: Aircraft[] };
type FeedDependencies = {
  loadConfig: (signal: AbortSignal) => Promise<RuntimeConfig>;
  loadReceiver: (base: string, signal: AbortSignal) => Promise<Receiver>;
  loadAircraft: (base: string, signal: AbortSignal) => Promise<Snapshot>;
  stabilize?: (aircraft: Aircraft, previous?: Aircraft) => Aircraft;
};

export const feedRequestTimeoutMs = 10_000;
export const feedRetryMaximumMs = 15_000;
export const feedStaleAfterMs = 15_000;

export function initialFeedState(config: RuntimeConfig): FeedState {
  return { aircraft: [], config, status: 'connecting', messageCount: 0, messageRate: 0 };
}

/** One cancellable polling loop, shared by startup, normal polling and recovery. */
export function startAircraftFeed(
  dependencies: FeedDependencies,
  initial: FeedState,
  onChange: (state: FeedState) => void,
) {
  let state = initial;
  let stopped = false;
  let busy = false;
  let failures = 0;
  let config: RuntimeConfig | undefined;
  let receiver: Receiver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let previous: Snapshot | undefined;
  let previousAircraft = new Map<string, Aircraft>();

  const publish = (change: Partial<FeedState>) => {
    if (stopped) return;
    state = { ...state, ...change };
    onChange(state);
  };
  const isFresh = (timestamp: number) => {
    const age = Date.now() - timestamp;
    // Also reject a seriously incorrect receiver clock instead of claiming to be live.
    return age >= -30_000 && age <= Math.max(feedStaleAfterMs, (receiver?.refreshMs ?? 1_000) * 3);
  };

  const refreshAge = () => {
    if (state.lastUpdate === undefined || stopped) return;
    const dataAgeSeconds = Math.max(0, Math.floor((Date.now() - state.lastUpdate) / 1_000));
    const expired = state.status === 'live' && !isFresh(state.lastUpdate);
    if (dataAgeSeconds !== state.dataAgeSeconds || expired) {
      publish({
        dataAgeSeconds,
        ...(expired ? { status: 'stale', error: 'liveDataOutdated', messageRate: 0 } : {}),
      });
    }
  };

  async function bounded<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    request = controller;
    let abortListener: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      abortListener = () => reject(new Error('Feed request interrupted'));
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), feedRequestTimeoutMs);
    try {
      return await Promise.race([load(controller.signal), interrupted]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortListener!);
      if (request === controller) request = undefined;
    }
  }

  async function poll() {
    if (stopped || busy) return;
    busy = true;
    let delay = receiver?.refreshMs ?? 1_000;
    let error: FeedState['error'] = 'receiverUnavailable';
    try {
      if (!config) {
        config = await bounded(dependencies.loadConfig);
        if (stopped) return;
        publish({ config });
      }
      if (!receiver) {
        const base = config.dataBaseUrl;
        receiver = await bounded((signal) => dependencies.loadReceiver(base, signal));
        if (stopped) return;
        publish({ receiver });
      }
      error = 'liveDataUnavailable';
      const base = config.dataBaseUrl;
      const snapshot = await bounded((signal) => dependencies.loadAircraft(base, signal));
      if (stopped) return;
      if (!Number.isFinite(snapshot.now) || snapshot.now <= 0) throw new Error('Invalid receiver timestamp');

      failures = 0;
      delay = receiver.refreshMs;
      const timestamp = snapshot.now * 1_000;
      const fresh = isFresh(timestamp);
      // Repeated/cached JSON must not reset marker interpolation or record new history.
      const advanced = snapshot.now !== previous?.now;
      const elapsed = previous ? snapshot.now - previous.now : 0;
      const aircraft = advanced ? snapshot.aircraft.map((item) => {
        const prior = previousAircraft.get(item.id);
        return {
          ...(dependencies.stabilize?.(item, prior) ?? item),
          messageRate: prior && elapsed > 0 ? Math.max(0, (item.messages - prior.messages) / elapsed) : undefined,
        };
      }) : state.aircraft;
      const rate = advanced && previous && elapsed > 0
        ? Math.max(0, Math.round((snapshot.messages - previous.messages) / elapsed)) : 0;
      if (advanced) {
        previous = snapshot;
        previousAircraft = new Map(aircraft.map((item) => [item.id, item]));
      }
      publish({
        aircraft,
        lastUpdate: timestamp,
        dataAgeSeconds: Math.max(0, Math.floor((Date.now() - timestamp) / 1_000)),
        messageCount: snapshot.messages,
        messageRate: fresh ? rate : 0,
        status: fresh ? 'live' : 'stale',
        error: fresh ? undefined : 'liveDataOutdated',
      });
    } catch {
      if (stopped) return;
      failures += 1;
      publish({
        status: state.lastUpdate === undefined || failures >= 3 ? 'offline' : 'stale',
        error,
        messageRate: 0,
      });
      delay = Math.min(feedRetryMaximumMs, (receiver?.refreshMs ?? 1_000) * 2 ** Math.min(failures, 4));
      if (failures >= 3) {
        // Recover configuration and receiver metadata as well after a server restart.
        config = undefined;
        receiver = undefined;
      }
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    }
  }

  const watchdog = setInterval(refreshAge, 1_000);
  void poll();
  return {
    resume() {
      refreshAge();
      if (stopped || busy) return;
      clearTimeout(timer);
      void poll();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      request?.abort();
    },
  };
}
