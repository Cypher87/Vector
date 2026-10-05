import type { Aircraft } from '../domain/aircraft.ts';

// Decoration only: readsb does not report engine/rotor RPM. Be conservative
// when a contact is stationary, on the ground, or has an old/missing position.
export function aircraftIconMotionActive(aircraft: Aircraft): boolean {
  const age = aircraft.positionSeenSeconds ?? aircraft.seenSeconds;
  return !aircraft.onGround
    && Number.isFinite(aircraft.latitude) && Number.isFinite(aircraft.longitude)
    && Number.isFinite(aircraft.groundSpeedKts) && aircraft.groundSpeedKts! >= 3
    && age >= 0 && age < 8;
}

// Stable across feed updates, so nearby rotors do not all turn in lockstep.
export function aircraftIconMotionPhase(id: string): string {
  let hash = 0;
  for (const character of id.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `-${hash % 2400}ms`;
}
