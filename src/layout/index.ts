import type { ElkNode, ElkPoint } from "elkjs/lib/elk-api";
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
  const result = await createElk().layout(elkGraph, { layoutOptions: { ...profile.options } });

  const nodes = new Map((result.children ?? []).map((node) => [node.id, node]));
  const edges = new Map((result.edges ?? []).map((edge) => [edge.id, edge]));
  const cards = graph.cards.map((card, i) => {
    const node = nodes.get(`n${i}`)!;
    return { card, x: node.x!, y: node.y! };
  });
  const lines = graph.lines.map((line, i) => {
    const section = edges.get(`e${i}`)!.sections![0]!;
    const points: ElkPoint[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    return { line, points: points.map(({ x, y }) => ({ x, y })) };
  });
  return normalise(cards, lines);
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
