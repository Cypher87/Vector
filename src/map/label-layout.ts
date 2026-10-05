import { aircraftMapIconScale } from './aircraft-map-size.ts';

export type LabelSide = 'right' | 'left' | 'top' | 'bottom';
export type LabelBox = { left: number; top: number; right: number; bottom: number };
export type LabelCandidate = {
  id: string; x: number; y: number; width: number; height: number;
  selected: boolean; favorite: boolean; focused: boolean; previous?: LabelSide;
};
export type LabelPlacement = { side: LabelSide; x: number; y: number; box: LabelBox };
export const boxesOverlap = (a: LabelBox, b: LabelBox) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
export const compactAircraftLabel = (zoom: number, important: boolean) => zoom < 7 && !important;

class BoxGrid {
  private cells = new Map<string, LabelBox[]>();
  private keys(box: LabelBox) {
    const keys: string[] = [];
    for (let x = Math.floor(box.left / 80); x <= Math.floor(box.right / 80); x++) {
      for (let y = Math.floor(box.top / 80); y <= Math.floor(box.bottom / 80); y++) keys.push(`${x}:${y}`);
    }
    return keys;
  }
  add(box: LabelBox) {
    for (const key of this.keys(box)) this.cells.set(key, [...(this.cells.get(key) ?? []), box]);
  }
  overlaps(box: LabelBox) {
    return this.keys(box).some((key) => this.cells.get(key)?.some((other) => boxesOverlap(box, other)));
  }
}

/** CSS pixels, never the canvas backing-buffer size (which varies with screen DPR). */
export function layoutAircraftLabels(candidates: LabelCandidate[], width: number, height: number, zoom: number, obstacles: LabelBox[] = []) {
  const result = new Map<string, LabelPlacement>();
  const labels = new BoxGrid();
  const icons = new BoxGrid();
  const iconScale = aircraftMapIconScale(zoom);
  for (const candidate of candidates) icons.add({ left: candidate.x - 15 * iconScale, right: candidate.x + 15 * iconScale,
    top: candidate.y - 17 * iconScale, bottom: candidate.y + 17 * iconScale });
  const ordered = [...candidates].sort((a, b) => Number(b.selected) - Number(a.selected)
    || Number(b.focused) - Number(a.focused) || Number(b.favorite) - Number(a.favorite)
    || Number(Boolean(b.previous)) - Number(Boolean(a.previous)) || a.id.localeCompare(b.id));
  const budget = Math.max(1, Math.floor(width * height / (zoom < 7 ? 22_000 : 12_000)));
  let ordinary = 0;
  for (const candidate of ordered) {
    if (candidate.x < 0 || candidate.x > width || candidate.y < 0 || candidate.y > height) continue;
    const important = candidate.selected || candidate.focused;
    if (!important && !candidate.favorite && (zoom < 5 || ordinary >= budget)) continue;
    const sides = [...new Set([candidate.previous, 'right', 'left', 'top', 'bottom'].filter(Boolean))] as LabelSide[];
    const placements = sides.map((side): LabelPlacement => {
      const x = side === 'right' ? 24 * iconScale : side === 'left' ? -24 * iconScale - candidate.width : -candidate.width / 2;
      const y = side === 'bottom' ? 26 * iconScale : side === 'top' ? -26 * iconScale - candidate.height : -candidate.height / 2;
      return { side, x, y, box: { left: candidate.x + x, right: candidate.x + x + candidate.width, top: candidate.y + y, bottom: candidate.y + y + candidate.height } };
    }).filter(({ box }) => box.left >= 6 && box.top >= 6 && box.right <= width - 6 && box.bottom <= height - 6
      && !obstacles.some((other) => boxesOverlap(box, other)) && !labels.overlaps(box));
    const placement = placements.find(({ box }) => !icons.overlaps(box)) ?? (important || candidate.favorite ? placements[0] : undefined);
    if (!placement) continue;
    result.set(candidate.id, placement);
    const box = placement.box;
    labels.add({ left: box.left - 5, right: box.right + 5, top: box.top - 5, bottom: box.bottom + 5 });
    if (!important && !candidate.favorite) ordinary++;
  }
  return result;
}
