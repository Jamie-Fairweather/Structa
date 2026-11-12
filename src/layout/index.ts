import type { ElkNode } from "elkjs/lib/elk-api";
import { createElk } from "./elk";
import type { LayoutProfile } from "./profiles";

export { FLOW_PROFILE, type LayoutProfile } from "./profiles";

/** What layout needs from a card: its fixed size, and its input path for error messages. */
export interface LayoutCard {
  readonly width: number;
  readonly height: number;
  readonly path: string;
}

export interface PlacedCard<C> {
  readonly card: C;
  readonly x: number;
  readonly y: number;
}

/** Positioned cards, with the content's top-left corner at (0, 0). */
export interface Scene<C> {
  readonly width: number;
  readonly height: number;
  readonly cards: readonly PlacedCard<C>[];
}

/** Lays the cards out with ELK. Only generated ids (n0, n1, …) reach ELK. */
export async function layout<C extends LayoutCard>(
  graph: { readonly cards: readonly C[] },
  profile: LayoutProfile,
): Promise<Scene<C>> {
  const elkGraph: ElkNode = {
    id: "root",
    children: graph.cards.map((card, i) => ({ id: `n${i}`, width: card.width, height: card.height })),
  };
  const result = await createElk().layout(elkGraph, { layoutOptions: { ...profile.options } });
  const byId = new Map((result.children ?? []).map((node) => [node.id, node]));
  const cards = graph.cards.map((card, i) => {
    const node = byId.get(`n${i}`)!;
    return { card, x: node.x!, y: node.y! };
  });
  return normalise(cards);
}

function normalise<C extends LayoutCard>(cards: PlacedCard<C>[]): Scene<C> {
  const minX = Math.min(...cards.map((c) => c.x));
  const minY = Math.min(...cards.map((c) => c.y));
  const maxX = Math.max(...cards.map((c) => c.x + c.card.width));
  const maxY = Math.max(...cards.map((c) => c.y + c.card.height));
  return {
    width: maxX - minX,
    height: maxY - minY,
    cards: cards.map((c) => ({ card: c.card, x: c.x - minX, y: c.y - minY })),
  };
}
