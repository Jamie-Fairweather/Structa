import type { Box } from "./frame";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A card's drawn outline: a rounded box, or a closed run of straight edges.
 * Its box is the outline's bounding box. The painter draws it, and lines are
 * ended on it, so both read the one description.
 */
export type Outline = Box & OutlineShape;

/** An outline's shape, relative to the top-left corner of whatever holds it. */
export type OutlineShape =
  | { readonly kind: "rounded"; readonly radius: number }
  | {
      readonly kind: "polygon";
      /** The corners, clockwise from the top-left. The polygon is always convex. */
      readonly points: readonly Point[];
    };

/** An open run of straight lines drawn on a card in its border colour, like a subprocess's side bars. */
export type Mark = readonly Point[];

/** `shape` placed with its box at `box`, its points moved there too. */
export function placeOutline(shape: OutlineShape, box: Box): Outline {
  return shape.kind === "rounded" ? { ...box, ...shape } : { ...box, kind: "polygon", points: shape.points.map((p) => move(p, box)) };
}

export function move(p: Point, by: { readonly x: number; readonly y: number }): Point {
  return { x: p.x + by.x, y: p.y + by.y };
}

/** What's drawn of a card that lines end on: its outline, and the badge and the tag on its border. */
interface Drawn {
  readonly outline: Outline;
  /** A pill. */
  readonly badge?: Box;
  /** A box with corners of `radius`. */
  readonly tag?: Box & { readonly radius: number };
}

/**
 * Where the straight line from `from` through `to` first meets what's drawn
 * of a card, its outline or the badge or tag on it, coming from `from`'s
 * side: the first meeting point along the whole line, even one behind `from`.
 * Undefined when the line misses them. Everything is relative to the card's box.
 */
export function entry(card: Drawn, from: Point, to: Point): Point | undefined {
  const direction = { x: to.x - from.x, y: to.y - from.y };
  if (Math.hypot(direction.x, direction.y) < EPSILON) return undefined;
  const { outline, badge, tag } = card;
  const meets = [
    ...(outline.kind === "rounded" ? roundedMeets(outline, outline.radius, from, direction) : polygonMeets(outline.points, from, direction)),
    ...(badge ? roundedMeets(badge, badge.height / 2, from, direction) : []),
    ...(tag ? roundedMeets(tag, tag.radius, from, direction) : []),
  ];
  if (meets.length === 0) return undefined;
  const t = Math.min(...meets);
  return { x: from.x + t * direction.x, y: from.y + t * direction.y };
}

/** The point on what's drawn of a card, its outline or the badge or tag on it, nearest to `p`. Relative to the card's box. */
export function nearest(card: Drawn, p: Point): Point {
  const { outline, badge, tag } = card;
  const found = [
    ...(outline.kind === "rounded"
      ? [roundedNearest(outline, outline.radius, p)]
      : outline.points.map((a, i) => segmentNearest(a, outline.points[(i + 1) % outline.points.length]!, p))),
    ...(badge ? [roundedNearest(badge, badge.height / 2, p)] : []),
    ...(tag ? [roundedNearest(tag, tag.radius, p)] : []),
  ];
  const away = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  return found.reduce((best, q) => (away(q) < away(best) ? q : best));
}

/** The point on the outline of a box with corners of `radius` nearest to `p`. */
function roundedNearest(box: Box, radius: number, p: Point): Point {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const [left, top, right, bottom] = [box.x, box.y, box.x + box.width, box.y + box.height];
  // The nearest point of the box the corners' centres span: the outline is r beyond it.
  const c = { x: clamp(p.x, left + r, right - r), y: clamp(p.y, top + r, bottom - r) };
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  if (d > EPSILON) return { x: c.x + (r * (p.x - c.x)) / d, y: c.y + (r * (p.y - c.y)) / d };
  // Deep inside: straight out to the nearest side.
  const sides = [
    { d: p.x - left, at: { x: left, y: p.y } },
    { d: right - p.x, at: { x: right, y: p.y } },
    { d: p.y - top, at: { x: p.x, y: top } },
    { d: bottom - p.y, at: { x: p.x, y: bottom } },
  ];
  return sides.reduce((best, side) => (side.d < best.d ? side : best)).at;
}

/** The point on the segment a–b nearest to `p`. */
function segmentNearest(a: Point, b: Point, p: Point): Point {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const length = edge.x ** 2 + edge.y ** 2;
  const t = length < EPSILON ? 0 : clamp(((p.x - a.x) * edge.x + (p.y - a.y) * edge.y) / length, 0, 1);
  return { x: a.x + t * edge.x, y: a.y + t * edge.y };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Where the line `from + t × direction` meets a box with corners of `radius`, as values of t. */
function roundedMeets(box: Box, radius: number, from: Point, direction: Point): number[] {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const [left, top, right, bottom] = [box.x, box.y, box.x + box.width, box.y + box.height];
  // The four straight sides, short of the corners, then the four corners.
  const sides: [Point, Point][] = [
    [{ x: left + r, y: top }, { x: right - r, y: top }],
    [{ x: right, y: top + r }, { x: right, y: bottom - r }],
    [{ x: right - r, y: bottom }, { x: left + r, y: bottom }],
    [{ x: left, y: bottom - r }, { x: left, y: top + r }],
  ];
  const meets = sides.flatMap(([a, b]) => segmentMeets(a, b, from, direction));
  if (r <= EPSILON) return meets;
  for (const centre of [
    { x: left + r, y: top + r },
    { x: right - r, y: top + r },
    { x: right - r, y: bottom - r },
    { x: left + r, y: bottom - r },
  ]) {
    // A corner's quarter circle lies beyond its centre, away from the middle of the box.
    const outward = { x: Math.sign(centre.x - (left + right) / 2), y: Math.sign(centre.y - (top + bottom) / 2) };
    for (const t of circleMeets(centre, r, from, direction)) {
      const p = { x: from.x + t * direction.x, y: from.y + t * direction.y };
      if ((p.x - centre.x) * outward.x >= -EPSILON && (p.y - centre.y) * outward.y >= -EPSILON) meets.push(t);
    }
  }
  return meets;
}

/** Where the line `from + t × direction` meets the edges of a polygon, as values of t. */
function polygonMeets(points: readonly Point[], from: Point, direction: Point): number[] {
  return points.flatMap((a, i) => segmentMeets(a, points[(i + 1) % points.length]!, from, direction));
}

/** Where the line `from + t × direction` meets the segment a–b, as values of t: both ends when it runs along it. */
function segmentMeets(a: Point, b: Point, from: Point, direction: Point): number[] {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const toA = { x: a.x - from.x, y: a.y - from.y };
  const denominator = cross(direction, edge);
  const length = Math.hypot(direction.x, direction.y) * Math.hypot(edge.x, edge.y);
  if (Math.abs(denominator) <= EPSILON * length) {
    // Parallel: it only meets the segment by running along it.
    if (Math.abs(cross(toA, direction)) > EPSILON * Math.hypot(direction.x, direction.y)) return [];
    const along = (p: Point) => ((p.x - from.x) * direction.x + (p.y - from.y) * direction.y) / (direction.x ** 2 + direction.y ** 2);
    return [along(a), along(b)];
  }
  const u = cross(toA, direction) / denominator;
  return u >= -EPSILON && u <= 1 + EPSILON ? [cross(toA, edge) / denominator] : [];
}

/** Where the line `from + t × direction` meets a circle, as values of t. */
function circleMeets(centre: Point, r: number, from: Point, direction: Point): number[] {
  const f = { x: from.x - centre.x, y: from.y - centre.y };
  const a = direction.x ** 2 + direction.y ** 2;
  const b = 2 * (f.x * direction.x + f.y * direction.y);
  const c = f.x ** 2 + f.y ** 2 - r * r;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

const EPSILON = 1e-9;
