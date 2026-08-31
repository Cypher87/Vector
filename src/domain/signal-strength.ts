export type SignalStrengthLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Converts readsb's per-aircraft RSSI in dBFS into four readable signal bars.
 * A missing value is represented by zero active bars instead of implying a
 * signal level that was not reported by the receiver.
 */
export const signalStrengthLevel = (rssiDbfs?: number): SignalStrengthLevel => {
  if (rssiDbfs === undefined || !Number.isFinite(rssiDbfs)) return 0;
  if (rssiDbfs >= -9) return 4;
  if (rssiDbfs >= -18) return 3;
  if (rssiDbfs >= -27) return 2;
  return 1;
};
