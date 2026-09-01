import type { Aircraft, AircraftMetadata } from './aircraft';

export const combineAircraftMetadata = (
  fallback: AircraftMetadata | undefined,
  preferred: AircraftMetadata,
): AircraftMetadata => ({
  category: preferred.category ?? fallback?.category,
  registration: preferred.registration ?? fallback?.registration,
  aircraftType: preferred.aircraftType ?? fallback?.aircraftType,
  description: preferred.description ?? fallback?.description,
  ownerOperator: preferred.ownerOperator ?? fallback?.ownerOperator,
  year: preferred.year ?? fallback?.year,
  dbFlags: preferred.dbFlags ?? fallback?.dbFlags,
});

export const mergeAircraftMetadata = (aircraft: Aircraft, metadata?: AircraftMetadata): Aircraft => {
  if (!metadata) return aircraft;

  return {
    ...aircraft,
    category: metadata.category ?? aircraft.category,
    registration: metadata.registration ?? aircraft.registration,
    aircraftType: metadata.aircraftType ?? aircraft.aircraftType,
    description: metadata.description ?? aircraft.description,
    ownerOperator: metadata.ownerOperator ?? aircraft.ownerOperator,
    year: metadata.year ?? aircraft.year,
    dbFlags: metadata.dbFlags ?? aircraft.dbFlags,
  };
};
