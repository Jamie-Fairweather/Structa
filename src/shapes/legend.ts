import { STATUSES, type Area, type Status } from "../input";
import type { Sizes } from "../theme";
import { badge, measureBadge, measureTag, tag, type Badge, type LevelLine, type Tag } from "./frame";

/**
 * The legend under the diagram: one item per status used, then one per area,
 * in rows. Positions are relative to its top-left corner.
 */
export interface Legend {
  readonly width: number;
  readonly height: number;
  readonly items: readonly LegendItem[];
}

export type LegendItem = StatusItem | AreaItem;

/** A short line in the status's line colour, then the status's badge. */
export interface StatusItem {
  readonly kind: "status";
  readonly status: Status;
  readonly swatch: LevelLine;
  readonly badge: Badge;
}

/** An area's tag, as its cards show it. */
export interface AreaItem {
  readonly kind: "area";
  readonly tag: Tag;
}

/**
 * A legend of the statuses in `used`, always in the same order, then of the
 * `areas`, in the order given. Nothing when there's neither. The items run
 * left to right in rows no wider than `maxWidth`, so a long list of areas
 * makes the legend taller, not the diagram wider. An item wider than that,
 * which no status or area name is, gets a row of its own.
 */
export function buildLegend(
  used: Iterable<Status | undefined>,
  areas: readonly Area[],
  maxWidth: number,
  sizes: Sizes,
): Legend | undefined {
  const seen = new Set(used);
  const statuses = STATUSES.filter((status) => seen.has(status));
  if (statuses.length === 0 && areas.length === 0) return undefined;
  const { swatchLength, swatchGap, itemGap, rowGap } = sizes.legend;
  const rowHeight = Math.max(sizes.badge.height, sizes.tag.height);

  let x = 0;
  let y = 0;
  let width = 0;
  /** The top-left corner of the next item, `itemWidth` wide: on this row if it fits, or at the start of the next. */
  const place = (itemWidth: number) => {
    if (x > 0 && x + itemWidth > maxWidth) {
      x = 0;
      y += rowHeight + rowGap;
    }
    const at = { x, y };
    width = Math.max(width, x + itemWidth);
    x += itemWidth + itemGap;
    return at;
  };
  const statusItems = statuses.map((status): StatusItem => {
    const at = place(swatchLength + swatchGap + measureBadge(status, sizes));
    const swatch = { x1: at.x, x2: at.x + swatchLength, y: at.y + rowHeight / 2 };
    const pill = badge(status, swatch.x2 + swatchGap, at.y + (rowHeight - sizes.badge.height) / 2, sizes);
    return { kind: "status", status, swatch, badge: pill };
  });
  const areaItems = areas.map((area): AreaItem => {
    const at = place(measureTag(area.label, sizes));
    return { kind: "area", tag: tag(area.id, area.label, at.x, at.y + (rowHeight - sizes.tag.height) / 2, sizes) };
  });
  return { width, height: y + rowHeight, items: [...statusItems, ...areaItems] };
}
