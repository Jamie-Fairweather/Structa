import type { ComponentKind } from "../input";
import { num } from "./svg";

/**
 * One step of an icon's drawing, on a grid 16 units square: a move, a
 * straight line, a curve through one control point, or an elliptical arc
 * (radii, the large-arc and sweep flags, then where it ends).
 */
type Step =
  | readonly ["M" | "L", number, number]
  | readonly ["Q", number, number, number, number]
  | readonly ["A", number, number, 0 | 1, 0 | 1, number, number]
  | readonly ["Z"];

const GRID = 16;

/** An ellipse round (cx, cy), drawn as two half arcs from its left-hand end. */
function ellipse(cx: number, cy: number, rx: number, ry: number): Step[] {
  return [
    ["M", cx - rx, cy],
    ["A", rx, ry, 1, 1, cx + rx, cy],
    ["A", rx, ry, 1, 1, cx - rx, cy],
  ];
}

/** A box from (left, top) to (right, bottom) with its corners rounded by `r`. */
function box(left: number, top: number, right: number, bottom: number, r: number): Step[] {
  return [
    ["M", left + r, top],
    ["L", right - r, top],
    ["Q", right, top, right, top + r],
    ["L", right, bottom - r],
    ["Q", right, bottom, right - r, bottom],
    ["L", left + r, bottom],
    ["Q", left, bottom, left, bottom - r],
    ["L", left, top + r],
    ["Q", left, top, left + r, top],
    ["Z"],
  ];
}

/**
 * Each component's icon: simple line drawings, so they read at a small size
 * and look alike in weight. None is a special card shape: they only sit
 * beside the kind word.
 */
const ICONS = new Map<ComponentKind, readonly Step[]>([
  // A hexagonal nut: a part that does work.
  [
    "service",
    [
      ["M", 8, 1.5],
      ["L", 13.6, 4.75],
      ["L", 13.6, 11.25],
      ["L", 8, 14.5],
      ["L", 2.4, 11.25],
      ["L", 2.4, 4.75],
      ["Z"],
      ...ellipse(8, 8, 2.5, 2.5),
    ],
  ],
  // A pair of braces: an interface others call.
  [
    "api",
    [
      ["M", 6, 2],
      ["Q", 4, 2, 4, 4],
      ["L", 4, 6.5],
      ["Q", 4, 8, 2.5, 8],
      ["Q", 4, 8, 4, 9.5],
      ["L", 4, 12],
      ["Q", 4, 14, 6, 14],
      ["M", 10, 2],
      ["Q", 12, 2, 12, 4],
      ["L", 12, 6.5],
      ["Q", 12, 8, 13.5, 8],
      ["Q", 12, 8, 12, 9.5],
      ["L", 12, 12],
      ["Q", 12, 14, 10, 14],
    ],
  ],
  // A window with a title bar: a screen people use.
  ["ui", [...box(1.5, 2.5, 14.5, 13.5, 1.5), ["M", 1.5, 5.5], ["L", 14.5, 5.5]]],
  // A clock: work that runs on a schedule.
  ["job", [...ellipse(8, 8, 6.25, 6.25), ["M", 8, 4.5], ["L", 8, 8], ["L", 10.75, 9.75]]],
  // A row of slots: messages waiting in turn.
  ["queue", [...box(1.5, 4, 14.5, 12, 1.5), ["M", 5.83, 4], ["L", 5.83, 12], ["M", 10.17, 4], ["L", 10.17, 12]]],
  // A cylinder: stored data.
  [
    "database",
    [
      ...ellipse(8, 4, 5.5, 2),
      ["M", 2.5, 4],
      ["L", 2.5, 12],
      ["A", 5.5, 2, 0, 0, 13.5, 12],
      ["L", 13.5, 4],
      ["M", 2.5, 8],
      ["A", 5.5, 2, 0, 0, 13.5, 8],
    ],
  ],
  // A lightning bolt: fast, close at hand.
  ["cache", [["M", 9, 1.5], ["L", 3.5, 9], ["L", 8, 9], ["L", 7, 14.5], ["L", 12.5, 7], ["L", 8, 7], ["Z"]]],
  // A globe: a system outside ours.
  ["external", [...ellipse(8, 8, 6.25, 6.25), ...ellipse(8, 8, 2.75, 6.25), ["M", 1.75, 8], ["L", 14.25, 8]]],
  // A book: code others build on.
  [
    "library",
    [
      ["M", 3, 3.5],
      ["Q", 3, 2, 4.5, 2],
      ["L", 13, 2],
      ["L", 13, 14],
      ["L", 4.5, 14],
      ["Q", 3, 14, 3, 12.5],
      ["Z"],
      ["M", 3, 12.5],
      ["Q", 3, 11, 4.5, 11],
      ["L", 13, 11],
    ],
  ],
  // A person: someone who uses the system.
  ["actor", [...ellipse(8, 5, 2.75, 2.75), ["M", 2.5, 14.5], ["A", 5.5, 5.5, 0, 1, 13.5, 14.5]]],
]);

/** Path data for an icon drawn in a square `size` px across, its top-left corner at (x, y). */
export function iconPath(name: ComponentKind, x: number, y: number, size: number): string {
  const k = size / GRID;
  const at = (px: number, py: number) => `${num(x + px * k)} ${num(y + py * k)}`;
  return ICONS.get(name)!
    .map((step) => {
      switch (step[0]) {
        case "M":
        case "L":
          return `${step[0]}${at(step[1], step[2])}`;
        case "Q":
          return `Q${at(step[1], step[2])} ${at(step[3], step[4])}`;
        case "A":
          return `A${num(step[1] * k)} ${num(step[2] * k)} 0 ${step[3]} ${step[4]} ${at(step[5], step[6])}`;
        case "Z":
          return "Z";
      }
    })
    .join(" ");
}
