export type SyncDeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export type SyncDeviceMetadata = {
  browser?: string;
  operatingSystem?: string;
  type: SyncDeviceType;
};

export type SyncDeviceSummary = SyncDeviceMetadata & {
  createdAt: number;
  current: boolean;
  id: string;
  lastSeenAt: number;
  name?: string;
  online?: boolean;
};
