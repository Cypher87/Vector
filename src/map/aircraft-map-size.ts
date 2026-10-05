/** Relative to the existing 32.4px map icon; list/detail icons stay fixed. */
export function aircraftMapIconScale(zoom: number): number {
  const progress = Number.isFinite(zoom) ? Math.max(0, Math.min(1, (zoom - 7.2) / 4.3)) : 0;
  const eased = progress * progress * (3 - 2 * progress);
  return 1 + (46 / 32.4 - 1) * eased;
}
