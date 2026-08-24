// All Vector silhouettes point north in their unrotated state, matching the
// readsb bearing convention: 0° north, 90° east.
export const aircraftHeadingRotation = (trackDeg = 0, mapBearingDeg = 0) =>
  trackDeg - mapBearingDeg;
