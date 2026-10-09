import type { Aircraft } from './aircraft.ts';
import { canNotifyForPreset, type AircraftFilterPreset } from './aircraft-filter-preset.ts';
import { matchesAircraftFilters } from './aircraft-filters.ts';

export const filterMatchDelayMs = 10_000;
export const filterMatchRearmMs = 5 * 60_000;
export type MatchedFilter = { id: string; name: string };
type Contact = { since: number; notified: boolean; outsideSince?: number };
type WatchedFilter = { signature: string; contacts: Map<string, Contact> };
export type FilterNotificationState = Map<string, WatchedFilter>;
export type FilterNotificationContext = {
  presets: readonly AircraftFilterPreset[];
  distanceKm: (aircraft: Aircraft) => number | undefined;
  /** A receiver change must establish a new baseline for distance filters. */
  receiverKey: string;
  /** Saved rules, not the aircraft currently resolved by those rules. */
  favoriteSignature?: readonly string[];
};

/** Observe the entire fresh feed, independently of the map, search and active view. */
export function observeFilterNotifications(
  previous: FilterNotificationState,
  aircraft: readonly Aircraft[],
  favoriteIds: ReadonlySet<string>,
  context: FilterNotificationContext,
  timestamp: number,
  baseline: boolean,
): { state: FilterNotificationState; matches: Map<string, MatchedFilter[]> } {
  const state: FilterNotificationState = new Map();
  const matches = new Map<string, MatchedFilter[]>();
  const entered = new Set<string>();
  const distances = new Map<string, number | undefined>();
  for (const preset of context.presets) {
    if (!preset.notifyOnMatch || !canNotifyForPreset(preset)) continue;
    const signature = JSON.stringify([
      preset.filters,
      preset.filters.favoritesOnly ? context.favoriteSignature ?? [...favoriteIds].sort() : null,
      preset.filters.distance === null ? null : context.receiverKey,
    ]);
    const old = previous.get(preset.id);
    const reset = baseline || !old || old.signature !== signature;
    const contacts = new Map<string, Contact>();
    const matching = new Set<string>();
    for (const item of aircraft) {
      if (preset.filters.distance !== null && !distances.has(item.id)) distances.set(item.id, context.distanceKm(item));
      if (!matchesAircraftFilters(item, preset.filters, { favoriteIds, distanceKm: distances.get(item.id) })) continue;
      matching.add(item.id);
      const reasons = matches.get(item.id) ?? [];
      reasons.push({ id: preset.id, name: preset.name });
      matches.set(item.id, reasons);
      const previousContact = reset ? undefined : old.contacts.get(item.id);
      const contact = previousContact?.outsideSince !== undefined && timestamp - previousContact.outsideSince >= filterMatchRearmMs
        ? undefined : previousContact;
      const next: Contact = contact ? { since: contact.since, notified: contact.notified }
        : { since: timestamp, notified: reset };
      if (!next.notified && timestamp - next.since >= filterMatchDelayMs) {
        next.notified = true;
        entered.add(item.id);
      }
      contacts.set(item.id, next);
    }
    if (!reset) {
      for (const [id, contact] of old.contacts) {
        if (matching.has(id) || !contact.notified) continue;
        const outsideSince = contact.outsideSince ?? timestamp;
        if (timestamp - outsideSince < filterMatchRearmMs) contacts.set(id, { ...contact, outsideSince });
      }
    }
    state.set(preset.id, { signature, contacts });
  }
  for (const id of matches.keys()) if (!entered.has(id)) matches.delete(id);
  return { state, matches };
}
