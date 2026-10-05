/** Relative to the existing 32.4px map icon; list/detail icons stay fixed. */
export function aircraftMapIconScale(zoom: number): number {
  const progress = Number.isFinite(zoom) ? Math.max(0, Math.min(1, (zoom - 7.2) / 4.3)) : 0;
  const eased = progress * progress * (3 - 2 * progress);
  return 1 + (46 / 32.4 - 1) * eased;
}

type IconSizeAnimation = {
  now: () => number;
  requestFrame: (callback: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  shouldAnimate: () => boolean;
  setScale: (scale: number) => void;
};

/** Resize only after the camera stops, never alongside a zoom gesture. */
export function createAircraftIconSizer(initialZoom: number, animation: IconSizeAnimation) {
  let scale = aircraftMapIconScale(initialZoom);
  let frame: number | undefined;
  let generation = 0;
  let disposed = false;
  const stop = () => {
    generation++;
    if (frame !== undefined) animation.cancelFrame(frame);
    frame = undefined;
  };
  const apply = (next: number) => {
    scale = next;
    animation.setScale(scale);
  };
  apply(scale);
  return {
    zoomStart: stop,
    zoomEnd(zoom: number) {
      stop();
      if (disposed) return;
      const target = aircraftMapIconScale(zoom);
      if (Math.abs(target - scale) < .00001 || !animation.shouldAnimate()) {
        apply(target);
        return;
      }
      const from = scale, start = animation.now(), token = generation;
      const tick = (time: number) => {
        if (disposed || token !== generation) return;
        frame = undefined;
        const progress = animation.shouldAnimate() ? Math.max(0, Math.min(1, (time - start) / 180)) : 1;
        const eased = progress * progress * (3 - 2 * progress);
        apply(from + (target - from) * eased);
        if (progress < 1) frame = animation.requestFrame(tick);
      };
      frame = animation.requestFrame(tick);
    },
    dispose() { stop(); disposed = true; },
  };
}
