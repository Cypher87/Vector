import type { AircraftMetadata } from '../domain/aircraft.ts';
import { combineAircraftMetadata } from '../domain/aircraft-metadata.ts';
import { ResourceError } from './bounded-resource.ts';

export function parseAircraftMetadataRequest(requestUrl: string): string[] {
  const parameters = new URL(requestUrl).searchParams;
  if ([...parameters.keys()].some((key) => key !== 'ids') || parameters.getAll('ids').length !== 1) {
    throw new ResourceError('Exactly one aircraft ID list is required', 400);
  }
  const ids = [...new Set((parameters.get('ids') ?? '').split(',').map((id) => id.trim().toLowerCase()))];
  if (!ids.length || ids.length > 200 || ids.some((id) => !/^[a-f0-9]{6}$/.test(id))) {
    throw new ResourceError('The aircraft ID list is invalid', 400);
  }
  return ids;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const asText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const traceRecord = (value: unknown): AircraftMetadata => {
  const record = asRecord(value);
  if (!record) return {};
  return {
    category: asText(record.category), registration: asText(record.r), aircraftType: asText(record.t),
    description: asText(record.desc), ownerOperator: asText(record.ownOp),
    year: asText(record.year) ?? (asNumber(record.year) === undefined ? undefined : String(record.year)),
    dbFlags: asNumber(record.dbFlags),
  };
};

/** readsb records metadata in both the trace root and state snapshots at index 8. */
export function parseReadsbTraceMetadata(value: unknown): AircraftMetadata | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  let metadata = traceRecord(root);
  if (Array.isArray(root.trace)) {
    for (const point of root.trace) {
      if (Array.isArray(point)) metadata = combineAircraftMetadata(metadata, traceRecord(point[8]));
    }
  }
  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}
