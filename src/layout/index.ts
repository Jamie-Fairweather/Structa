import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api";
import { StructaError, type Problem } from "../errors";
import { createElk } from "./elk";
import type { LayoutProfile } from "./profiles";

export { FLOW_PROFILE, type LayoutProfile } from "./profiles";

/** What layout needs from a card: its fixed size, and its input path for error messages. */
export interface LayoutCard {
  readonly width: number;
  readonly height: number;
  readonly path: string;
}

/** A line between two cards, given as indexes into the card list. */
export interface LayoutLine {
  readonly source: number;
  readonly target: number;
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
}

/** Positioned cards and routed lines, with the content's top-left corner at (0, 0). */
export interface Scene<C, L> {
  readonly width: number;
  readonly height: number;
  readonly cards: readonly PlacedCard<C>[];
  readonly lines: readonly RoutedLine<L>[];
}

/** Lays the cards and lines out with ELK. Only generated ids (n0, e0, …) reach ELK. */
export async function layout<C extends LayoutCard, L extends LayoutLine>(
  graph: { readonly cards: readonly C[]; readonly lines: readonly L[] },
  profile: LayoutProfile,
): Promise<Scene<C, L>> {
  const elkGraph: ElkNode = {
    id: "root",
    children: graph.cards.map((card, i) => ({ id: `n${i}`, width: card.width, height: card.height })),
    edges: graph.lines.map((line, i) => ({ id: `e${i}`, sources: [`n${line.source}`], targets: [`n${line.target}`] })),
  };
  // Outside the try: a missing elk.bundled.js is a broken install, not a layout failure.
  const elk = createElk();
  let result: ElkNode;
  try {
    result = await elk.layout(elkGraph, { layoutOptions: { ...profile.options } });
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
    lines.push({ line, points: points.map(({ x, y }) => ({ x, y })) });
  });

  for (const id of returned.keys()) {
    problems.push({ path: "$", message: `the layout engine returned an unexpected element "${id}"` });
  }
  if (problems.length > 0) throw layoutFailed(problems);
  return normalise(cards, lines);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalise<C extends LayoutCard, L>(cards: PlacedCard<C>[], lines: RoutedLine<L>[]): Scene<C, L> {
  const xs = [...cards.flatMap((c) => [c.x, c.x + c.card.width]), ...lines.flatMap((l) => l.points.map((p) => p.x))];
  const ys = [...cards.flatMap((c) => [c.y, c.y + c.card.height]), ...lines.flatMap((l) => l.points.map((p) => p.y))];
  if (xs.length === 0) return { width: 0, height: 0, cards: [], lines: [] };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const move = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });
  return {
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    cards: cards.map((c) => ({ card: c.card, ...move(c) })),
    lines: lines.map((l) => ({ line: l.line, points: l.points.map(move) })),
  };
}
