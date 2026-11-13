import type { Cardinality } from "../input";
import type { Point } from "../layout";
import type { Sizes } from "../theme";
import { num } from "./svg";

/**
 * Path data for an orthogonal route with rounded corners, ending `endGap`
 * short of the last point so an arrowhead can sit there.
 */
export function roundedRoute(points: readonly Point[], radius: number, endGap: number): string {
  const pts = withoutRepeats(points);
  if (pts.length < 2) return "";
  const last = pts[pts.length - 1]!;
  const beforeLast = pts[pts.length - 2]!;
  const gap = Math.min(endGap, distance(beforeLast, last));
  pts[pts.length - 1] = towards(last, beforeLast, gap);
  const route = withoutRepeats(pts);

  // A middle segment shares its length between the corners at both ends; the
  // first and last segments have a corner at one end only.
  const room = (i: number) => distance(route[i]!, route[i + 1]!) / (i === 0 || i === route.length - 2 ? 1 : 2);
  let d = `M${xy(route[0]!)}`;
  for (let i = 1; i < route.length - 1; i++) {
    const [prev, corner, next] = [route[i - 1]!, route[i]!, route[i + 1]!];
    const r = Math.min(radius, room(i - 1), room(i));
    d += ` L${xy(towards(corner, prev, r))} Q${xy(corner)} ${xy(towards(corner, next, r))}`;
  }
  return `${d} L${xy(route[route.length - 1]!)}`;
}

/** A filled triangle with its tip on the route's last point, pointing along the last segment. */
export function arrowhead(points: readonly Point[], length: number, width: number): string {
  const { tip, left, right } = arrowCorners(points, length, width);
  return `M${xy(tip)} L${xy(left)} L${xy(right)} Z`;
}

/** An open arrowhead: two strokes meeting at its tip on the route's last point, pointing along the last segment. */
export function openArrowhead(points: readonly Point[], length: number, width: number): string {
  const { tip, left, right } = arrowCorners(points, length, width);
  return `M${xy(left)} L${xy(tip)} L${xy(right)}`;
}

/** The tip and the two back corners of an arrowhead on the route's last point. */
function arrowCorners(points: readonly Point[], length: number, width: number): { tip: Point; left: Point; right: Point } {
  const pts = withoutRepeats(points);
  const tip = pts[pts.length - 1]!;
  const from = pts[pts.length - 2] ?? { x: tip.x, y: tip.y - 1 };
  const len = distance(from, tip);
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const base = { x: tip.x - ux * length, y: tip.y - uy * length };
  const half = width / 2;
  return {
    tip,
    left: { x: base.x - uy * half, y: base.y + ux * half },
    right: { x: base.x + uy * half, y: base.y - ux * half },
  };
}

/**
 * A crow's-foot end on the route's start or end: path data for its strokes,
 * and its circle when it has one. Its marks are measured out from the table
 * along the route's straight run: nearest the table a foot for many or a bar
 * for one, then a bar for one or a circle for zero. When another line ends
 * `room` px away on the same side, the marks are drawn narrower across the
 * line, to keep clear of that one's.
 */
export function crowsFoot(
  points: readonly Point[],
  end: "start" | "end",
  cardinality: Cardinality,
  sizes: Sizes["crowsFoot"],
  room = Number.POSITIVE_INFINITY,
): { d: string; circle?: { centre: Point; radius: number } } {
  const widest = Math.max(sizes.footWidth, sizes.barLength, 2 * sizes.circle);
  // Never so narrow that the marks vanish, however crowded the side.
  const narrow = Math.max(0.25, Math.min(1, (room - sizes.apart) / widest));
  const s = { ...sizes, footWidth: sizes.footWidth * narrow, barLength: sizes.barLength * narrow };
  const pts = withoutRepeats(points);
  const [tip, next] = end === "start" ? [pts[0]!, pts[1]] : [pts.at(-1)!, pts.at(-2)];
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
