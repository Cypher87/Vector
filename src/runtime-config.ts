import type { RuntimeConfig } from './domain/aircraft';

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  dataBaseUrl: '/api/readsb?source=live',
  historyBaseUrl: '/api/readsb?source=history',
  mapStyleUrl: '/map-style.json',
  siteName: 'Vector',
  receiverName: 'Local readsb receiver',
  unitSystem: 'metric',
};
