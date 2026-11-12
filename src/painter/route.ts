import type { Point } from "../layout";
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

  let d = `M${xy(route[0]!)}`;
  for (let i = 1; i < route.length - 1; i++) {
    const [prev, corner, next] = [route[i - 1]!, route[i]!, route[i + 1]!];
    const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
    d += ` L${xy(towards(corner, prev, r))} Q${xy(corner)} ${xy(towards(corner, next, r))}`;
  }
  return `${d} L${xy(route[route.length - 1]!)}`;
}

/** A filled triangle with its tip on the route's last point, pointing along the last segment. */
export function arrowhead(points: readonly Point[], length: number, width: number): string {
  const pts = withoutRepeats(points);
  const tip = pts[pts.length - 1]!;
  const from = pts[pts.length - 2] ?? { x: tip.x, y: tip.y - 1 };
  const len = distance(from, tip);
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const base = { x: tip.x - ux * length, y: tip.y - uy * length };
  const half = width / 2;
  const left = { x: base.x - uy * half, y: base.y + ux * half };
  const right = { x: base.x + uy * half, y: base.y - ux * half };
  return `M${xy(tip)} L${xy(left)} L${xy(right)} Z`;
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
