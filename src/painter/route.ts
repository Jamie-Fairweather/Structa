import type { Cardinality } from "../input";
import type { Point } from "../geometry";
import type { Sizes } from "../theme";
import { num } from "./svg";

/**
 * Path data for an orthogonal route with rounded corners, starting `startGap`
 * after the first point and ending `endGap` short of the last, so a mark can
 * sit at either end.
 */
export function roundedRoute(points: readonly Point[], radius: number, startGap: number, endGap: number): string {
  const route = rounded(points, radius, startGap, endGap);
  if (!route) return "";
  let d = `M${xy(route.start)}`;
  for (const { before, corner, after } of route.corners) d += ` L${xy(before)} Q${xy(corner)} ${xy(after)}`;
  return `${d} L${xy(route.end)}`;
}

/** How long the path `roundedRoute` draws is, its rounded corners included. */
export function routeLength(points: readonly Point[], radius: number, startGap: number, endGap: number): number {
  const route = rounded(points, radius, startGap, endGap);
  if (!route) return 0;
  let length = 0;
  let at = route.start;
  for (const { before, corner, after } of route.corners) {
    length += distance(at, before) + curveLength(before, corner, after);
    at = after;
  }
  return length + distance(at, route.end);
}

/** A corner rounded off by a curve from `before` to `after`, pulled towards the `corner` itself. */
interface Corner {
  readonly before: Point;
  readonly corner: Point;
  readonly after: Point;
}

/**
 * The route `roundedRoute` draws: where it starts and ends, after the gaps,
 * and each corner it rounds off. A middle segment shares its length between
 * the corners at both ends; the first and last segments have a corner at one
 * end only.
 */
function rounded(points: readonly Point[], radius: number, startGap: number, endGap: number): { start: Point; corners: Corner[]; end: Point } | undefined {
  const pts = withoutRepeats(points);
  if (pts.length < 2) return undefined;
  pts[0] = towards(pts[0]!, pts[1]!, Math.min(startGap, distance(pts[0]!, pts[1]!)));
  const last = pts[pts.length - 1]!;
  const beforeLast = pts[pts.length - 2]!;
  const gap = Math.min(endGap, distance(beforeLast, last));
  pts[pts.length - 1] = towards(last, beforeLast, gap);
  const route = withoutRepeats(pts);

  const room = (i: number) => distance(route[i]!, route[i + 1]!) / (i === 0 || i === route.length - 2 ? 1 : 2);
  const corners: Corner[] = [];
  for (let i = 1; i < route.length - 1; i++) {
    const [prev, corner, next] = [route[i - 1]!, route[i]!, route[i + 1]!];
    const r = Math.min(radius, room(i - 1), room(i));
    corners.push({ before: towards(corner, prev, r), corner, after: towards(corner, next, r) });
  }
  return { start: route[0]!, corners, end: route[route.length - 1]! };
}

/** The length of the quadratic curve from `a` to `c` pulled towards `b`, summed over short steps. */
function curveLength(a: Point, b: Point, c: Point): number {
  const at = (t: number): Point => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * b.x + t ** 2 * c.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * b.y + t ** 2 * c.y,
  });
  const steps = 32;
  let length = 0;
  for (let s = 1; s <= steps; s++) length += distance(at((s - 1) / steps), at(s / steps));
  return length;
}

/** A triangle with its tip on the route's last point, pointing along the last segment, drawn tip first. */
export function arrowhead(points: readonly Point[], length: number, width: number): string {
  const { tip, at } = alongEnd(points);
  return `M${xy(tip)} L${xy(at(length, width / 2))} L${xy(at(length, -width / 2))} Z`;
}

/** An open arrowhead: two strokes meeting at its tip on the route's last point, pointing along the last segment. */
export function openArrowhead(points: readonly Point[], length: number, width: number): string {
  const { tip, at } = alongEnd(points);
  return `M${xy(at(length, width / 2))} L${xy(tip)} L${xy(at(length, -width / 2))}`;
}

/** A diamond lying along the route's last segment, its tip on the last point, drawn tip first. */
export function diamond(points: readonly Point[], length: number, width: number): string {
  const { tip, at } = alongEnd(points);
  return `M${xy(tip)} L${xy(at(length / 2, width / 2))} L${xy(at(length, 0))} L${xy(at(length / 2, -width / 2))} Z`;
}

/** How long the route's last straight run is. */
export function lastRun(points: readonly Point[]): number {
  const pts = withoutRepeats(points);
  return pts.length < 2 ? 0 : distance(pts[pts.length - 2]!, pts[pts.length - 1]!);
}

/**
 * The route's last point, and a way to find the point `back` px behind it
 * along the last segment and `side` px to one side of it.
 */
function alongEnd(points: readonly Point[]): { tip: Point; at: (back: number, side: number) => Point } {
  const pts = withoutRepeats(points);
  const tip = pts[pts.length - 1]!;
  const from = pts[pts.length - 2] ?? { x: tip.x, y: tip.y - 1 };
  const len = distance(from, tip);
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  return { tip, at: (back, side) => ({ x: tip.x - ux * back - uy * side, y: tip.y - uy * back + ux * side }) };
}

/**
 * A crow's-foot end at the route's `from` end, where it starts, or its `to`
 * end, where it ends: path data for its strokes, and its circle when it has
 * one. Its marks are measured out from the table along the route's straight
 * run: nearest the table a foot for many or a bar for one, then a bar for
 * one or a circle for zero. When another line ends `room` px away on the
 * same side, the marks are drawn narrower across the line, to keep clear of
 * that one's.
 */
export function crowsFoot(
  points: readonly Point[],
  end: "from" | "to",
  cardinality: Cardinality,
  sizes: Sizes["crowsFoot"],
  room = Number.POSITIVE_INFINITY,
): { d: string; circle?: { centre: Point; radius: number } } {
  const widest = Math.max(sizes.footWidth, sizes.barLength, 2 * sizes.circle);
  // Never so narrow that the marks vanish, however crowded the side.
  const narrow = Math.max(0.25, Math.min(1, (room - sizes.apart) / widest));
  const s = { ...sizes, footWidth: sizes.footWidth * narrow, barLength: sizes.barLength * narrow };
  const pts = withoutRepeats(points);
  const [tip, next] = end === "from" ? [pts[0]!, pts[1]] : [pts.at(-1)!, pts.at(-2)];
  // Outwards from the table along the line, and across it.
  const len = next ? distance(tip, next) : 0;
  const u = next && len > 0 ? { x: (next.x - tip.x) / len, y: (next.y - tip.y) / len } : { x: 1, y: 0 };
  const at = (along: number, across: number): Point => ({
    x: tip.x + u.x * along - u.y * across,
    y: tip.y + u.y * along + u.x * across,
  });
  const bar = (along: number) => `M${xy(at(along, -s.barLength / 2))} L${xy(at(along, s.barLength / 2))}`;

  const many = cardinality.endsWith("many");
  const inner = many
    ? `M${xy(at(0, -s.footWidth / 2))} L${xy(at(s.footLength, 0))} L${xy(at(0, s.footWidth / 2))}`
    : bar(s.bar);
  const beyond = (many ? s.footLength : s.bar) + s.gap;
  if (cardinality.startsWith("zero")) return { d: inner, circle: { centre: at(beyond + s.circle, 0), radius: s.circle * narrow } };
  if (cardinality === "many") return { d: inner };
  return { d: `${inner} ${bar(beyond)}` };
}

function withoutRepeats(points: readonly Point[]): Point[] {
  return points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 1e-6);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `by` px from `from` in the direction of `to`. */
function towards(from: Point, to: Point, by: number): Point {
  const len = distance(from, to);
  if (len === 0) return from;
  return { x: from.x + ((to.x - from.x) * by) / len, y: from.y + ((to.y - from.y) * by) / len };
}

function xy(p: Point): string {
  return `${num(p.x)} ${num(p.y)}`;
}
