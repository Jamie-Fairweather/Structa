import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api";
import { StructaError, type Problem } from "../errors";
import type { Direction } from "../input";
import { createElk } from "./elk";
import type { LayoutProfile } from "./profiles";

export { CLASS_PROFILE, FLOW_PROFILE, type LayoutProfile } from "./profiles";

/**
 * What layout needs from a card: its fixed size, how far below the top of
 * that box its drawn outline starts (the band its badge overhangs), and its
 * input path for error messages.
 */
export interface LayoutCard {
  readonly width: number;
  readonly height: number;
  readonly outline: { readonly y: number };
  readonly path: string;
}

/** A line between two cards, given as indexes into the card list, with its label's fixed size. */
export interface LayoutLine {
  readonly source: number;
  readonly target: number;
  readonly label?: { readonly width: number; readonly height: number };
  readonly path: string;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PlacedCard<C> {
  readonly card: C;
  readonly x: number;
  readonly y: number;
}

export interface RoutedLine<L> {
  readonly line: L;
  /** Start point, bend points and end point, at right angles. */
  readonly points: readonly Point[];
  /** The top-left corner of the line's label, when it has one. */
  readonly label?: Point;
}

/** Positioned cards and routed lines, with the content's top-left corner at (0, 0). */
export interface Scene<C, L> {
  readonly width: number;
  readonly height: number;
  readonly cards: readonly PlacedCard<C>[];
  readonly lines: readonly RoutedLine<L>[];
}

/** The direction is the one layout setting agents choose. */
const ELK_DIRECTION = new Map<Direction, string>([
  ["down", "DOWN"],
  ["right", "RIGHT"],
]);

/**
 * Keeps lines that end on a card's left or right side below the band its
 * badge overhangs. ELK reads this margin as if the diagram ran left to right,
 * so for "down" the top of each side is its "left". It only works as a global
 * option, so it is given when any card has a band.
 */
const BAND_CLEARANCE = new Map<Direction, (band: number) => string>([
  ["down", (band) => `[top=0,left=${band},bottom=0,right=0]`],
  ["right", (band) => `[top=${band},left=0,bottom=0,right=0]`],
]);

/**
 * Lays the cards and lines out with ELK. Only generated ids (n0, e0, …) reach
 * ELK. The whole profile goes in as global options, plus the direction and,
 * when cards have a band, the clearance that keeps lines off it.
 */
export async function layout<C extends LayoutCard, L extends LayoutLine>(
  graph: { readonly cards: readonly C[]; readonly lines: readonly L[] },
  profile: LayoutProfile,
  direction: Direction,
): Promise<Scene<C, L>> {
  const elkGraph: ElkNode = {
    id: "root",
    children: graph.cards.map((card, i) => ({ id: `n${i}`, width: card.width, height: card.height })),
    edges: graph.lines.map((line, i) => ({
      id: `e${i}`,
      sources: [`n${line.source}`],
      targets: [`n${line.target}`],
      // ELK skips a label with no text, so the label's generated id stands in for its text.
      ...(line.label ? { labels: [{ id: `l${i}`, text: `l${i}`, width: line.label.width, height: line.label.height }] } : {}),
    })),
  };
  // Outside the try: a missing elk.bundled.js is a broken install, not a layout failure.
  const elk = createElk();
  let result: ElkNode;
  try {
    const band = Math.max(0, ...graph.cards.map((card) => card.outline.y));
    const layoutOptions = {
      ...profile.options,
      "elk.direction": ELK_DIRECTION.get(direction)!,
      ...(band > 0 ? { "elk.spacing.portsSurrounding": BAND_CLEARANCE.get(direction)!(band) } : {}),
    };
    result = await elk.layout(elkGraph, { layoutOptions });
  } catch (error) {
    throw layoutFailed([{ path: "$", message: `the layout engine failed: ${(error as Error)?.message ?? error}` }]);
  }
  return readScene(result, graph);
}

const BUG_HINT = "this is a bug in Structa: please report it with the input JSON";

function layoutFailed(problems: readonly Omit<Problem, "hint">[]): StructaError {
  return new StructaError(
    "LAYOUT_FAILED",
    problems.map((p) => ({ ...p, hint: BUG_HINT })),
  );
}

/** Maps ELK's result back to our cards and lines, failing loudly if anything was dropped or mangled. */
function readScene<C extends LayoutCard, L extends LayoutLine>(
  result: ElkNode,
  graph: { readonly cards: readonly C[]; readonly lines: readonly L[] },
): Scene<C, L> {
  const problems: Omit<Problem, "hint">[] = [];
  const returned = new Map<string, ElkNode | ElkExtendedEdge>();
  for (const element of [...(result.children ?? []), ...(result.edges ?? [])]) {
    if (returned.has(element.id)) problems.push({ path: "$", message: `the layout engine repeated "${element.id}"` });
    returned.set(element.id, element);
  }
  const take = (id: string) => {
    const element = returned.get(id);
    returned.delete(id);
    return element;
  };

  const cards: PlacedCard<C>[] = [];
  graph.cards.forEach((card, i) => {
    const node = take(`n${i}`) as ElkNode | undefined;
    if (!node) return problems.push({ path: card.path, message: "the layout engine dropped this card" });
    if (node.width !== card.width || node.height !== card.height) {
      return problems.push({ path: card.path, message: "the layout engine changed this card's size" });
    }
    if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
      return problems.push({ path: card.path, message: "the layout engine gave this card no position" });
    }
    cards.push({ card, x: node.x, y: node.y });
  });

  const lines: RoutedLine<L>[] = [];
  graph.lines.forEach((line, i) => {
    const edge = take(`e${i}`) as ElkExtendedEdge | undefined;
    if (!edge) return problems.push({ path: line.path, message: "the layout engine dropped this line" });
    const sections = edge.sections ?? [];
    const section = sections[0];
    const points: ElkPoint[] = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint] : [];
    if (sections.length !== 1 || !points.every((p) => isFiniteNumber(p?.x) && isFiniteNumber(p?.y))) {
      return problems.push({ path: line.path, message: "the layout engine gave this line no usable route" });
    }
    const route = points.map(({ x, y }) => ({ x, y }));
    if (!line.label) return lines.push({ line, points: route });
    const label = readLabel(edge, i, line.label);
    if (typeof label === "string") return problems.push({ path: `${line.path}.label`, message: label });
    lines.push({ line, points: route, label });
  });

  for (const id of returned.keys()) {
    problems.push({ path: "$", message: `the layout engine returned an unexpected element "${id}"` });
  }
  if (problems.length > 0) throw layoutFailed(problems);
  return normalise(cards, lines);
}

/** Where ELK put line `i`'s one label, or what went wrong with it. */
function readLabel(edge: ElkExtendedEdge, i: number, size: { width: number; height: number }): Point | string {
  const labels = edge.labels ?? [];
  const label = labels[0];
  if (labels.length !== 1 || label?.id !== `l${i}`) return "the layout engine dropped this label";
  if (label.width !== size.width || label.height !== size.height) return "the layout engine changed this label's size";
  if (!isFiniteNumber(label.x) || !isFiniteNumber(label.y)) return "the layout engine gave this label no position";
  return { x: label.x, y: label.y };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalise<C extends LayoutCard, L extends LayoutLine>(cards: PlacedCard<C>[], lines: RoutedLine<L>[]): Scene<C, L> {
  const boxes = [
    ...cards.map((c) => ({ x: c.x, y: c.y, width: c.card.width, height: c.card.height })),
    ...lines.flatMap((l) => (l.label && l.line.label ? [{ ...l.label, ...l.line.label }] : [])),
  ];
  const xs = [...boxes.flatMap((b) => [b.x, b.x + b.width]), ...lines.flatMap((l) => l.points.map((p) => p.x))];
  const ys = [...boxes.flatMap((b) => [b.y, b.y + b.height]), ...lines.flatMap((l) => l.points.map((p) => p.y))];
  if (xs.length === 0) return { width: 0, height: 0, cards: [], lines: [] };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const move = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });
  return {
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    cards: cards.map((c) => ({ card: c.card, ...move(c) })),
    lines: lines.map((l) => ({ line: l.line, points: l.points.map(move), ...(l.label ? { label: move(l.label) } : {}) })),
  };
}
