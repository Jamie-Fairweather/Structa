import { STATUSES, type Area, type Status } from "../input";
import type { Sizes } from "../theme";
import { badge, tag, type Badge, type LevelLine, type Tag } from "./frame";

/**
 * The legend under the diagram: one item per status used, then one per area,
 * in a row. Positions are relative to its top-left corner.
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
 * areas, in the order given. Every area is used: each holds a card. Nothing
 * when there's neither.
 */
export function buildLegend(used: Iterable<Status | undefined>, areas: readonly Area[], sizes: Sizes): Legend | undefined {
  const seen = new Set(used);
  const statuses = STATUSES.filter((status) => seen.has(status));
  if (statuses.length === 0 && areas.length === 0) return undefined;
  const { swatchLength, swatchGap, itemGap } = sizes.legend;
  const height = Math.max(sizes.badge.height, sizes.tag.height);

  let x = 0;
  const statusItems = statuses.map((status): StatusItem => {
    const swatch = { x1: x, x2: x + swatchLength, y: height / 2 };
    const pill = badge(status, swatch.x2 + swatchGap, (height - sizes.badge.height) / 2, sizes);
    x = pill.x + pill.width + itemGap;
    return { kind: "status", status, swatch, badge: pill };
  });
  const areaItems = areas.map((area): AreaItem => {
    const chip = tag(area.id, area.label, x, (height - sizes.tag.height) / 2, sizes);
    x = chip.x + chip.width + itemGap;
    return { kind: "area", tag: chip };
  });
  return { width: x - itemGap, height, items: [...statusItems, ...areaItems] };
}
