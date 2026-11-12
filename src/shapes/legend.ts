import { STATUSES, type Status } from "../input";
import type { Sizes } from "../theme";
import { badge, type Badge, type Strike } from "./frame";

/** The legend under the diagram: one item per status used, in a row. Positions are relative to its top-left corner. */
export interface Legend {
  readonly width: number;
  readonly height: number;
  readonly items: readonly LegendItem[];
}

/** A short line in the status's line colour, then the status's badge. */
export interface LegendItem {
  readonly status: Status;
  readonly swatch: Strike;
  readonly badge: Badge;
}

/**
 * A legend of the statuses in `used`, always in the same order. Nothing when
 * no status is used.
 */
export function buildLegend(used: Iterable<Status | undefined>, sizes: Sizes): Legend | undefined {
  const seen = new Set(used);
  const statuses = STATUSES.filter((status) => seen.has(status));
  if (statuses.length === 0) return undefined;
  const { swatchLength, swatchGap, itemGap } = sizes.legend;
  const height = sizes.badge.height;

  let x = 0;
  const items = statuses.map((status): LegendItem => {
    const swatch = { x1: x, x2: x + swatchLength, y: height / 2 };
    const pill = badge(status, swatch.x2 + swatchGap, 0, sizes);
    x = pill.x + pill.width + itemGap;
    return { status, swatch, badge: pill };
  });
  return { width: x - itemGap, height, items };
}
