import type { Aircraft } from '../domain/aircraft';

type UnknownRecord = Record<string, unknown>;

export type AircraftPhoto = {
  height?: number;
  link: string;
  photographer?: string;
  src: string;
  width?: number;
};

const PLANESPOTTERS_API = 'https://api.planespotters.net/pub/photos/';
const photoCache = new Map<string, AircraftPhoto | null>();
const pendingPhotos = new Map<string, Promise<AircraftPhoto | null>>();
type AircraftPhotoLookup = Pick<Aircraft, 'aircraftType' | 'id' | 'registration'>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const safeHttpsUrl = (value: unknown): string | undefined => {
  const candidate = asString(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const parsePhoto = (value: unknown): AircraftPhoto | null => {
  const response = asRecord(value);
  const firstPhoto = response && Array.isArray(response.photos) ? asRecord(response.photos[0]) : undefined;
  if (!firstPhoto) return null;

  const large = asRecord(firstPhoto.thumbnail_large);
  const thumbnail = large ?? asRecord(firstPhoto.thumbnail);
  const size = thumbnail ? asRecord(thumbnail.size) : undefined;
  const src = thumbnail ? safeHttpsUrl(thumbnail.src) : undefined;
  const link = safeHttpsUrl(firstPhoto.link);
  if (!src || !link) return null;

  return {
    src,
    link,
    photographer: asString(firstPhoto.photographer),
    width: size ? asNumber(size.width) : undefined,
    height: size ? asNumber(size.height) : undefined,
  };
};

const cacheKey = (aircraft: AircraftPhotoLookup) => [
  aircraft.id.toLowerCase(),
  aircraft.registration?.toUpperCase() ?? '',
  aircraft.aircraftType?.toUpperCase() ?? '',
].join(':');

export async function loadAircraftPhoto(aircraft: AircraftPhotoLookup): Promise<AircraftPhoto | null> {
  const hex = aircraft.id.toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;

  const key = cacheKey(aircraft);
  if (photoCache.has(key)) return photoCache.get(key) ?? null;

  const pending = pendingPhotos.get(key);
  if (pending) return pending;

  const request = (async () => {
    const url = new URL(`hex/${hex}`, PLANESPOTTERS_API);
    if (aircraft.registration) url.searchParams.set('reg', aircraft.registration);
    if (aircraft.aircraftType) url.searchParams.set('icaoType', aircraft.aircraftType);

    try {
      const response = await fetch(url, {
        cache: 'force-cache',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      const photo = parsePhoto(await response.json());
      photoCache.set(key, photo);
      return photo;
    } catch {
      return null;
    } finally {
      pendingPhotos.delete(key);
    }
  })();

  pendingPhotos.set(key, request);
  return request;
}
