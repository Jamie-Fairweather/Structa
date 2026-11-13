import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api";
import { StructaError, type Problem } from "../errors";
import type { Direction } from "../input";
import { createElk } from "./elk";
import { GROUPED, type LayoutProfile } from "./profiles";

export { PROFILES, type LayoutProfile } from "./profiles";

/**
 * What layout needs from a card: its fixed size, where on that box lines may
 * meet it, and its input path for error messages.
 */
export interface LayoutCard {
  readonly width: number;
  readonly height: number;
  /**
   * Where on its box lines may meet the card, measured from the box's
   * top-left corner: across its top from `left` to `right`, and down its
   * left and right sides from `top` to `bottom`. ELK spreads the lines it
   * ends on each side over that stretch, and those on the bottom over the
   * top's: it can't give them apart. A line between fixed ports goes where
   * its ports are.
   */
  readonly landing: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly path: string;
  /**
   * A note: an aside, not a step in the flow. ELK places a note joined to one
   * card by a line beside that card, and the line straight between them.
   */
  readonly note?: boolean;
  /**
   * The id of the area it's laid out in, when areas are given. A note joined
   * to a card must be in that card's area: ELK fails on one joined across areas.
   */
  readonly area?: string;
}

/**
 * An area to lay out as a box round its cards and the areas inside it, at
 * least `minWidth` wide, with `padding` inside its edges.
 */
export interface LayoutArea {
  readonly id: string;
  /** The id of the area it's inside. */
  readonly parent?: string;
  readonly minWidth: number;
  readonly padding: { readonly top: number; readonly side: number; readonly bottom: number };
  readonly path: string;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * A label at one end of a line: its size, and how far along the line from
 * the card it must start, such as to be past a mark there. ELK gets a box
 * that much longer along the line, and the label goes at its far end.
 */
interface EndLabelSize extends Size {
  readonly clear: number;
}

/** A line between two cards, given as indexes into the card list, with its labels' fixed sizes. */
export interface LayoutLine {
  readonly source: number;
  readonly target: number;
  /** A label ELK centres on the line. */
  readonly label?: Size;
  /** Labels ELK puts beside the line, just off the card, where it leaves its source and where it reaches its target. */
  readonly sourceLabel?: EndLabelSize;
  readonly targetLabel?: EndLabelSize;
  /**
   * Its target is laid out before its source along the flow, as a parent
   * class is before its child. ELK gets the line the other way round, with a
   * high direction priority, and the rest of its part of the graph with no
   * loops for ELK's cycle breaking to turn it back in; the route still comes
   * back from source to target.
   */
  readonly targetFirst?: boolean;
  /**
   * Keys for ends this line may share. Two or more lines whose ends meet one
   * card with the same key meet it at one point, and ELK routes them into it
   * as one tree, as UML draws lines into one parent under one triangle. A
   * count at a shared end is shown once, by the first of those lines.
   */
  readonly joins?: { readonly source?: string; readonly target?: string };
  /**
   * For a line whose ends attach at fixed points: where on each card's side
   * its ends may go. Layout puts each on its card's left or right side, as the
   * side rule picks. Without it, ELK attaches the line anywhere.
   */
  readonly ports?: { readonly source: PortSpan; readonly target: PortSpan };
  readonly path: string;
}

/**
 * Where on its card's left or right side a line's end attaches: somewhere
 * from `top` to `bottom`, measured down from the top of the card's box. A lone
 * end sits halfway. Ends that share a span and a side each get a port of
 * their own, spread evenly either side of its middle, `gap` apart, or closer
 * when that many wouldn't fit: all on one point when the span has no height.
 * They're ordered by where their lines go, so they don't cross as they leave,
 * and a line to the same card has its two ends side by side.
 */
export interface PortSpan {
  readonly top: number;
  readonly bottom: number;
  readonly gap: number;
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
  /** The top-left corner of the line's label, and of the labels at its ends, when it has them. */
  readonly label?: Point;
  readonly sourceLabel?: Point;
  readonly targetLabel?: Point;
}

/**
 * The labels a line can have, each with the letter its generated id starts
 * with and, for messages, the field of the input line it shows.
 */
const LABELS = [
  ["label", "l", "label"],
  ["sourceLabel", "s", "fromLabel"],
  ["targetLabel", "t", "toLabel"],
] as const;

type LabelName = (typeof LABELS)[number][0];

export interface PlacedArea<A> {
  readonly area: A;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Positioned areas and cards and routed lines, with the content's top-left corner at (0, 0). */
export interface Scene<C, L, A> {
  readonly width: number;
  readonly height: number;
  /** In the order given: each parent before the areas inside it. */
  readonly areas: readonly PlacedArea<A>[];
  readonly cards: readonly PlacedCard<C>[];
  readonly lines: readonly RoutedLine<L>[];
}

interface Graph<C, L, A> {
  readonly cards: readonly C[];
  readonly lines: readonly L[];
  /** Each parent before the areas inside it. None: the areas, if any, don't affect the layout. */
  readonly areas: readonly A[];
}

/** The direction is the one layout setting agents choose. */
const ELK_DIRECTION = new Map<Direction, string>([
  ["down", "DOWN"],
  ["right", "RIGHT"],
]);

/**
 * A card's own options that keep the lines ELK ends on each of its sides on
 * the stretch of that side its landing gives them: room ELK leaves free at
 * either end of each side. ELK reads that room as if the diagram ran left to
 * right, so going down the top and bottom sides take theirs from its "top"
 * and "bottom", and the left and right sides from its "left" and "right".
 * The bottom gets the top's room too, so only a card with lines over its
 * `top` gets it at all. ELK only reads it per card, as an individual
 * spacing; none when lines may meet every side anywhere.
 */
function landingOptions(card: LayoutCard, direction: Direction, top: boolean): Record<string, string> {
  const { width, height, landing } = card;
  // To the hundredth of a pixel, never below 0, so ELK reads plain numbers.
  const room = (value: number) => Math.max(0, Math.round(value * 100) / 100);
  const across = top ? [landing.left, width - landing.right].map(room) : [0, 0];
  const down = [landing.top, height - landing.bottom].map(room);
  if ([...across, ...down].every((room) => room <= 0)) return {};
  const [before, after, left, right] = direction === "down" ? [...across, ...down] : [...down, ...across];
  return { "elk.spacing.individual": `elk.spacing.portsSurrounding:[top=${before},left=${left},bottom=${after},right=${right}]` };
}

/** A port's side: left or right, or, for a provisional port, wherever ELK puts it. */
type Side = "left" | "right" | "free";

/**
 * The sides a line with ports attaches on, and whether ELK is given it
 * reversed, so that it runs with the flow, from an earlier layer to a later one.
 */
interface Sides {
  readonly source: Side;
  readonly target: Side;
  readonly reversed: boolean;
}

/**
 * A line as far as `endsAcross` needs it: `sides` when it meets its cards
 * only on their left and right sides, as lines with ports do, and as a
 * note's connector does going down.
 */
export type CountedLine = Pick<LayoutLine, "source" | "target" | "targetFirst" | "joins"> & { readonly sides?: boolean };

/**
 * For each of `cardCount` cards, how many line ends ELK may put on its top
 * side: none when no line meets its top, and otherwise as many as meet its
 * top or its bottom, whichever is more, as ELK spreads both over the same
 * stretch. Going down, a line meets its target's top and leaves its source's
 * bottom, or the other way round when its target comes first, and ELK runs
 * a line from a card to itself off the card's left side. Going right, lines
 * meet cards' left and right sides, and only a line from a card to itself
 * goes over its top, with both its ends there. Lines that join meet a card
 * at one point. A line ELK turns round to break a loop leaves its source's
 * top and meets its target's bottom; that card has a line coming in, so it
 * has room on its top, if less than it gets.
 */
export function endsAcross(cardCount: number, lines: readonly CountedLine[], direction: Direction): number[] {
  const top = Array.from({ length: cardCount }, () => new Set<string>());
  const bottom = Array.from({ length: cardCount }, () => new Set<string>());
  lines.forEach((line, i) => {
    if (line.sides) return;
    if (line.source === line.target) {
      if (direction === "right") top[line.source]!.add(`${i} source`).add(`${i} target`);
      return;
    }
    if (direction === "right") return;
    // Ends that join count once: they share a key.
    const key = (end: "source" | "target") => {
      const joined = line.joins?.[end];
      return joined === undefined ? `${i} ${end}` : `joined ${joined}`;
    };
    const [into, outOf] = line.targetFirst ? [bottom, top] : [top, bottom];
    into[line.target]!.add(key("target"));
    outOf[line.source]!.add(key("source"));
  });
  return top.map((ends, card) => (ends.size === 0 ? 0 : Math.max(ends.size, bottom[card]!.size)));
}

/** In pass 1, every line with ports has provisional ones, which ELK places as it would any line's ends. */
const PROVISIONAL: Sides = { source: "free", target: "free", reversed: false };

/** The most layout passes a diagram with ports gets: pass 1, then pass 2 and its reruns. */
const MAX_PASSES = 6;

/**
 * Lays the cards and lines out with ELK, inside boxes for the areas when any
 * are given. Only generated ids (n0, a0, p0_0, j0_0, e0, l0, …) reach ELK. The whole
 * profile goes in as global options, plus the direction and the options for
 * area boxes when there are any. Each card keeps the lines ELK ends on it
 * where its landing says.
 *
 * Lines with ports are laid out at least twice. Pass 1 gives each line end a
 * provisional port; the side rule then picks each end's side from where pass
 * 1 put the cards, and pass 2 lays the graph out again with only the ports
 * used, keeping pass 1's arrangement. When ELK still has to move a table to
 * make room for the lines at its sides, so that a side picked no longer
 * faces, those sides are picked again from where pass 2 put the tables, and
 * pass 2 runs again from there.
 */
export async function layout<C extends LayoutCard, L extends LayoutLine, A extends LayoutArea>(
  graph: Graph<C, L, A>,
  profile: LayoutProfile,
  direction: Direction,
): Promise<Scene<C, L, A>> {
  if (!graph.lines.some((line) => line.ports)) return run(graph, profile, direction, {});
  let scene = await run(graph, profile, direction, { sides: graph.lines.map(() => PROVISIONAL) });
  let sides = pickSides(graph.lines, scene, direction);
  for (let pass = 2; ; pass++) {
    const next = await run(graph, profile, direction, { sides, from: scene });
    const again = pickSides(graph.lines, next, direction, sides);
    const held = again.every((s, i) => s.source === sides[i]!.source && s.target === sides[i]!.target);
    if (held || pass === MAX_PASSES) return next;
    scene = next;
    sides = again;
  }
}

/**
 * The side rule. With direction right, a line leaves the earlier of its two
 * tables (along the flow) on the right and enters the later one on the left;
 * tables that share a layer use their right sides. With direction down, each
 * end uses the side facing the other table's centre, and both ends use the
 * same side when the tables overlap across the flow. A table's link to itself
 * uses its right side at both ends.
 *
 * A line that runs against the flow goes to ELK reversed, so the next pass
 * keeps each table in the layer order this one found. Tables that overlap
 * across the flow may share either side, so a line between them keeps the
 * one it was given `previous`ly while both its ends still share it.
 */
function pickSides<C extends LayoutCard>(
  lines: readonly LayoutLine[],
  scene: Scene<C, unknown, unknown>,
  direction: Direction,
  previous?: readonly Sides[],
): Sides[] {
  return lines.map((line, i) => {
    const a = scene.cards[line.source]!;
    const b = scene.cards[line.target]!;
    if (line.source === line.target) return { source: "right", target: "right", reversed: false };
    // Which comes first along the flow: -1 the source, 1 the target, 0 neither (they share a layer).
    const along = direction === "right" ? order(a.x, a.card.width, b.x, b.card.width) : order(a.y, a.card.height, b.y, b.card.height);
    const reversed = along > 0;
    if (direction === "right") {
      if (along === 0) return { source: "right", target: "right", reversed };
      return reversed ? { source: "left", target: "right", reversed } : { source: "right", target: "left", reversed };
    }
    const [centreA, centreB] = [a.x + a.card.width / 2, b.x + b.card.width / 2];
    if (order(a.x, a.card.width, b.x, b.card.width) === 0) {
      const before = previous?.[i];
      if (before && before.source !== "free" && before.source === before.target) return { ...before, reversed };
      const side: Side = centreB >= centreA ? "right" : "left";
      return { source: side, target: side, reversed };
    }
    return { source: centreB > centreA ? "right" : "left", target: centreA > centreB ? "right" : "left", reversed };
  });
}

/** -1 when the span at `a` ends before the one at `b` starts, 1 when it starts after that one ends, 0 when they overlap. */
function order(a: number, aSize: number, b: number, bSize: number): -1 | 0 | 1 {
  if (a + aSize <= b) return -1;
  if (b + bSize <= a) return 1;
  return 0;
}

/**
 * How ELK is given one line: the ids its ends attach to, whether it's
 * reversed, and, when its ports are fixed, where in each card its own source
 * and target must end up.
 */
interface Ends {
  readonly sources: string[];
  readonly targets: string[];
  readonly reversed: boolean;
  readonly fixed?: { readonly source: Point; readonly target: Point };
  /** Its counts that ELK isn't given, at ends it shares with an earlier line showing the same count. */
  readonly quiet?: ReadonlySet<LabelName>;
}

/**
 * What one pass is given beyond the graph: each line's sides (lines without
 * ports ignore theirs), and the earlier pass whose arrangement it keeps.
 */
interface Pass<C> {
  readonly sides?: readonly Sides[];
  readonly from?: Scene<C, unknown, unknown>;
}

/** One ELK layout pass. */
async function run<C extends LayoutCard, L extends LayoutLine, A extends LayoutArea>(
  graph: Graph<C, L, A>,
  profile: LayoutProfile,
  direction: Direction,
  { sides = [], from }: Pass<C>,
): Promise<Scene<C, L, A>> {
  const ports = placePorts(graph, sides, from);
  const against = againstFlow(graph.lines, graph.cards.length);
  const joints = joinPorts(graph.lines, against);
  const ends = graph.lines.map((line, i): Ends => {
    const own = ports.byLine.get(i);
    if (!own) {
      const joined = joints.byLine.get(i);
      const [source, target] = [joined?.source ?? `n${line.source}`, joined?.target ?? `n${line.target}`];
      const quiet = joined?.quiet ? { quiet: joined.quiet } : {};
      return against[i] ? { sources: [target], targets: [source], reversed: true, ...quiet } : { sources: [source], targets: [target], reversed: false, ...quiet };
    }
    const { source, target } = own;
    const fixed = source.at && target.at ? { fixed: { source: source.at, target: target.at } } : {};
    return sides[i]!.reversed
      ? { sources: [target.id], targets: [source.id], reversed: true, ...fixed }
      : { sources: [source.id], targets: [target.id], reversed: false, ...fixed };
  });
  // With direction down, where tables sit across the flow decides their sides, so
  // a pass that keeps an earlier one's arrangement starts from where that one put
  // them, and ELK moves them only as far as the lines need. With direction right,
  // the sides only depend on the layer order, which reversing lines keeps, so ELK
  // stays free to line the tables up for straight lines between their headers.
  // Inside area boxes ELK 0.12.1's interactive strategies scatter the cards out of
  // their boxes, so there each pass lays out afresh, and the side rule's reruns
  // settle the sides.
  const seeded = from !== undefined && direction === "down" && graph.areas.length === 0;
  const elkGraph = buildGraph(graph, direction, ports.byCard, joints.byCard, ends, seeded ? from : undefined);
  // Outside the try: a missing elk.bundled.js is a broken install, not a layout failure.
  const elk = createElk();
  let result: ElkNode;
  try {
    const layoutOptions = {
      ...profile.options,
      ...(graph.areas.length > 0 ? GROUPED : {}),
      ...(seeded ? profile.keepArrangement : {}),
      "elk.direction": ELK_DIRECTION.get(direction)!,
    };
    result = await elk.layout(elkGraph, { layoutOptions });
  } catch (error) {
    throw layoutFailed([{ path: "$", message: `the layout engine failed: ${(error as Error)?.message ?? error}` }]);
  }
  return readScene(result, graph, ends, direction);
}

/**
 * The graph handed to ELK. Each area is a node holding the areas inside it,
 * in the order given, then its cards, in theirs; each line sits in the
 * innermost area holding both its ends, attached as `ends` says. Without
 * areas, the root holds every card and every line. Each card has the `ports`
 * its lines use, and the ports where lines join it, `joints`, which ELK puts
 * where it likes. In a pass that keeps the arrangement of the pass `from`,
 * each card starts where that one put it.
 */
function buildGraph(
  graph: Graph<LayoutCard, LayoutLine, LayoutArea>,
  direction: Direction,
  ports: ReadonlyMap<number, readonly Port[]>,
  joints: ReadonlyMap<number, readonly string[]>,
  ends: readonly Ends[],
  from: Scene<unknown, unknown, unknown> | undefined,
): ElkNode {
  const root = { id: "root", children: [] as ElkNode[], edges: [] as ElkExtendedEdge[] };
  const index = new Map(graph.areas.map((area, i) => [area.id, i]));
  const boxes = graph.areas.map((area, i) => ({
    id: `a${i}`,
    layoutOptions: areaOptions(area, direction),
    children: [] as ElkNode[],
    edges: [] as ElkExtendedEdge[],
  }));
  /** The nodes from the root down to the area's box: the root alone outside any area. */
  const chain = (id: string | undefined): (typeof root)[] => {
    const i = id === undefined ? undefined : index.get(id);
    return i === undefined ? [root] : [...chain(graph.areas[i]!.parent), boxes[i]!];
  };
  const chains = graph.cards.map((card) => chain(card.area));

  graph.areas.forEach((area, i) => chain(area.parent).at(-1)!.children.push(boxes[i]!));
  // A note's connector meets a card's side going down, and ELK puts it where it likes going right.
  const notes = (line: LayoutLine) => graph.cards[line.source]!.note === true || graph.cards[line.target]!.note === true;
  const counted = graph.lines.map((line) => ({ ...line, sides: line.ports !== undefined || notes(line) }));
  const across = endsAcross(graph.cards.length, counted, direction);
  graph.cards.forEach((card, i) => {
    const own = elkPorts(ports.get(i) ?? []);
    const joined = (joints.get(i) ?? []).map((id) => ({ id, width: 0, height: 0 }));
    const all = [...(own.ports ?? []), ...joined];
    // Which nodes are notes, the ports a card has and where lines may meet it are part of the graph, not of the profile, so they go on each card.
    const layoutOptions = {
      ...(card.note ? { "elk.commentBox": "true" } : {}),
      ...landingOptions(card, direction, across[i]! > 0),
      ...own.layoutOptions,
    };
    chains[i]!.at(-1)!.children.push({
      id: `n${i}`,
      ...(from ? { x: from.cards[i]!.x, y: from.cards[i]!.y } : {}),
      width: card.width,
      height: card.height,
      ...(Object.keys(layoutOptions).length > 0 ? { layoutOptions } : {}),
      ...(all.length > 0 ? { ports: all } : {}),
    });
  });
  graph.lines.forEach((line, i) => {
    const [from, to] = [chains[line.source]!, chains[line.target]!];
    let shared = 0;
    while (from[shared + 1] !== undefined && from[shared + 1] === to[shared + 1]) shared++;
    const { reversed } = ends[i]!;
    // ELK puts a tail label where its line starts and a head label where it ends: on a line it gets the other way round, they swap.
    const placements = new Map([
      ["label", undefined],
      ["sourceLabel", reversed ? "HEAD" : "TAIL"],
      ["targetLabel", reversed ? "TAIL" : "HEAD"],
    ]);
    const labels = LABELS.flatMap(([name, letter]) => {
      const size = line[name];
      if (!size || !givenToElk(line, ends[i]!, name)) return [];
      const placement = placements.get(name);
      // ELK skips a label with no text, so the label's generated id stands in for its text.
      const id = `${letter}${i}`;
      return [{ id, text: id, ...elkSize(size, direction), ...(placement ? { layoutOptions: { "elk.edgeLabels.placement": placement } } : {}) }];
    });
    from[shared]!.edges.push({
      id: `e${i}`,
      sources: ends[i]!.sources,
      targets: ends[i]!.targets,
      ...(line.targetFirst ? { layoutOptions: TARGET_FIRST } : {}),
      ...(labels.length > 0 ? { labels } : {}),
    });
  });
  return root;
}

/**
 * On a parent-first line, given to ELK the other way round: ELK's greedy
 * cycle breaking weighs each line by its direction priority. That alone
 * doesn't keep such a line along the flow, so `againstFlow` also gives ELK
 * its part of the graph with no loops to break. Which lines are like this
 * is part of the graph, not of the profile.
 */
const TARGET_FIRST = { "elk.layered.priority.direction": "100" };

/**
 * Which lines without ports ELK gets the other way round: every parent-first
 * line, so it runs from parent to child, and the lines that would close a
 * loop through one.
 *
 * ELK's greedy cycle breaking ranks cards by how much more weight leaves them
 * than reaches them, and turns round whatever lines then run backwards. Where
 * a connected part of the graph has a loop, that can be any line in it, a
 * parent's whatever its priority: a class with two children of its own
 * outranks its parent once its children have lines back to that parent. So
 * in each part with a parent-first line, the other lines are taken in order,
 * and each one that would close a loop with the lines before it goes the
 * other way round too. ELK gets that part with no loops at all, so its cycle
 * breaking, left at its default, has nothing there to turn. Elsewhere ELK
 * breaks loops as it would.
 *
 * Inside area boxes, parents in one box and children in another can need one
 * box before the other and after it too: then ELK still turns one of their
 * lines round.
 */
function againstFlow(lines: readonly LayoutLine[], cardCount: number): boolean[] {
  const against = lines.map((line) => !line.ports && line.targetFirst === true);
  // Each card's part of the graph, named by one card in it.
  const part = Array.from({ length: cardCount }, (_, i) => i);
  const root = (i: number): number => (part[i] === i ? i : (part[i] = root(part[i]!)));
  for (const line of lines) {
    const [a, b] = [root(line.source), root(line.target)];
    part[Math.max(a, b)] = Math.min(a, b);
  }
  const ordered = new Set(lines.flatMap((line, i) => (against[i] ? [root(line.source)] : [])));
  // The lines ELK gets, so far: the cards each card's lines run to.
  const next = Array.from({ length: cardCount }, () => [] as number[]);
  const reaches = (from: number, to: number): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    for (let card = stack.pop(); card !== undefined; card = stack.pop()) {
      if (card === to) return true;
      for (const n of next[card]!) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return false;
  };
  lines.forEach((line, i) => {
    if (against[i]) next[line.target]!.push(line.source);
  });
  lines.forEach((line, i) => {
    if (against[i] || line.ports || line.source === line.target || !ordered.has(root(line.source))) return;
    against[i] = reaches(line.target, line.source);
    next[against[i] ? line.target : line.source]!.push(against[i] ? line.source : line.target);
  });
  return against;
}

/** Where the lines that join at one port go in: the port's id at each end, and the counts ELK isn't given. */
interface Joined {
  readonly source?: string;
  readonly target?: string;
  readonly quiet?: ReadonlySet<LabelName>;
}

/**
 * The ports where lines join. Ends of two or more lines without ports that
 * meet one card with the same `joins` key, and that ELK gets going the same
 * way, share one port there: ELK routes them into it as one tree. Each port
 * has a generated id, j<card>_<n>, in the order the lines use them, and ELK
 * puts it where it likes. A count at a shared end is the same on each of
 * its lines, so only the first of them gives it to ELK.
 */
function joinPorts(lines: readonly LayoutLine[], against: readonly boolean[]) {
  const groups = new Map<string, { card: number; line: number; end: "source" | "target" }[]>();
  lines.forEach((line, i) => {
    if (line.ports || line.source === line.target) return;
    for (const end of ["source", "target"] as const) {
      const key = line.joins?.[end];
      if (key === undefined) continue;
      // Whether ELK gets this end as where the line starts.
      const starts = (end === "source") !== against[i];
      const group = JSON.stringify([line[end], starts, key]);
      groups.set(group, [...(groups.get(group) ?? []), { card: line[end], line: i, end }]);
    }
  });
  const byCard = new Map<number, string[]>();
  const byLine = new Map<number, Joined>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const { card } = group[0]!;
    const ports = byCard.get(card) ?? [];
    byCard.set(card, ports);
    const id = `j${card}_${ports.length}`;
    ports.push(id);
    group.forEach(({ line, end }, k) => {
      const joined = byLine.get(line) ?? {};
      const label: LabelName = end === "source" ? "sourceLabel" : "targetLabel";
      const quiet = k > 0 && lines[line]![label] ? new Set([...(joined.quiet ?? []), label]) : joined.quiet;
      byLine.set(line, { ...joined, [end]: id, ...(quiet ? { quiet } : {}) });
    });
  }
  return { byCard, byLine };
}

/**
 * An area box's own options: room for its name, and its padding. ELK 0.12.1
 * reads a compound node's minimum size the other way round when laying out
 * downwards, so the width goes second then. It also fails inside a compound
 * node that asks for the model-order hint, so each area box turns it off:
 * the root's hint, from the profile, still orders the cards in every area.
 */
function areaOptions(area: LayoutArea, direction: Direction): Record<string, string> {
  const { top, side, bottom } = area.padding;
  return {
    "elk.padding": `[top=${top},left=${side},bottom=${bottom},right=${side}]`,
    "elk.nodeSize.constraints": "MINIMUM_SIZE",
    "elk.nodeSize.minimum": direction === "down" ? `(0,${area.minWidth})` : `(${area.minWidth},0)`,
    "elk.layered.considerModelOrder.strategy": "NONE",
  };
}

/** One end of a line with ports, in one pass. */
interface End {
  readonly line: number;
  readonly end: "source" | "target";
  readonly card: number;
  readonly span: PortSpan;
  readonly side: Side;
}

/** An end's own port: its generated id, its side and, once fixed, where on its card it sits. */
interface Port {
  readonly id: string;
  readonly side: Side;
  readonly at?: Point;
}

/**
 * Every line end's own port for one pass: zero-size, with generated ids (p0_0,
 * p0_1, …) in the order the lines use them, so only the ports used exist.
 * Provisional ports are free. Fixed ones sit on their card's left or right
 * side, spread over their span with the others that share it, in the order
 * their lines head off, as seen in the pass `from` whose arrangement this one keeps.
 */
function placePorts<C extends LayoutCard>(
  graph: Graph<C, LayoutLine, unknown>,
  sides: readonly Sides[],
  from: Scene<C, unknown, unknown> | undefined,
) {
  const ends = graph.lines.flatMap((line, i): [End, End] | [] => {
    const side = sides[i];
    if (!line.ports || !side) return [];
    return [
      { line: i, end: "source", card: line.source, span: line.ports.source, side: side.source },
      { line: i, end: "target", card: line.target, span: line.ports.target, side: side.target },
    ];
  });

  // How far down its card each fixed end sits: spread over its span with the ends that share it and its side.
  const heights = new Map<End, number>();
  const groups = new Map<string, End[]>();
  for (const end of ends) {
    if (end.side === "free") continue;
    const key = `${end.card} ${end.side} ${end.span.top} ${end.span.bottom}`;
    groups.set(key, [...(groups.get(key) ?? []), end]);
  }
  for (const group of groups.values()) {
    const headed = group.map((end) => ({ end, heading: heading(end, graph, sides, from) }));
    // Ties go by line, then source before target, so a line to its own card has its ends side by side.
    headed.sort((a, b) => a.heading - b.heading || a.end.line - b.end.line || (a.end.end === "source" ? -1 : 1));
    const { top, bottom, gap } = group[0]!.span;
    const step = group.length > 1 ? Math.min(gap, (bottom - top) / (group.length - 1)) : 0;
    headed.forEach(({ end }, j) => heights.set(end, (top + bottom) / 2 + (j - (group.length - 1) / 2) * step));
  }

  const byCard = new Map<number, Port[]>();
  const port = (end: End): Port => {
    const list = byCard.get(end.card) ?? [];
    byCard.set(end.card, list);
    const y = heights.get(end);
    const x = end.side === "right" ? graph.cards[end.card]!.width : 0;
    const made: Port = { id: `p${end.card}_${list.length}`, side: end.side, ...(y === undefined ? {} : { at: { x, y } }) };
    list.push(made);
    return made;
  };
  const byLine = new Map<number, { source: Port; target: Port }>();
  for (let k = 0; k < ends.length; k += 2) byLine.set(ends[k]!.line, { source: port(ends[k]!), target: port(ends[k + 1]!) });
  return { byLine, byCard };
}

/**
 * Which way a line heads as it leaves its card's side, as seen in the pass
 * `from`: the angle from this end towards its other end, measured outwards
 * from the side, from straight up (-π/2) to straight down (π/2), and on round
 * for a line that doubles back. Ports down a side in this order don't cross
 * as they leave. A line to its own card heads straight out before it loops
 * back, and without an earlier pass every line heads straight out.
 */
function heading<C extends LayoutCard>(
  end: End,
  graph: Graph<C, LayoutLine, unknown>,
  sides: readonly Sides[],
  from: Scene<C, unknown, unknown> | undefined,
): number {
  const line = graph.lines[end.line]!;
  if (!from || line.source === line.target) return 0;
  const other =
    end.end === "source"
      ? { card: line.target, span: line.ports!.target, side: sides[end.line]!.target }
      : { card: line.source, span: line.ports!.source, side: sides[end.line]!.source };
  const point = ({ card, span, side }: { card: number; span: PortSpan; side: Side }): Point => {
    const placed = from.cards[card]!;
    return { x: placed.x + (side === "right" ? placed.card.width : 0), y: placed.y + (span.top + span.bottom) / 2 };
  };
  const [here, there] = [point(end), point(other)];
  return Math.atan2(there.y - here.y, end.side === "right" ? there.x - here.x : here.x - there.x);
}

/** ELK's view of a card's ports: fixed where they are, or, while provisional, free. */
function elkPorts(ports: readonly Port[]): Pick<ElkNode, "ports" | "layoutOptions"> {
  if (ports.length === 0) return {};
  if (ports.every((port) => !port.at)) {
    return { layoutOptions: { "elk.portConstraints": "FREE" }, ports: ports.map(({ id }) => ({ id, width: 0, height: 0 })) };
  }
  return {
    layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    ports: ports.map(({ id, side, at }) => ({
      id,
      width: 0,
      height: 0,
      x: at!.x,
      y: at!.y,
      layoutOptions: { "elk.port.side": side === "right" ? "EAST" : "WEST" },
    })),
  };
}

const BUG_HINT = "this is a bug in Structa: please report it with the input JSON";

function layoutFailed(problems: readonly Omit<Problem, "hint">[]): StructaError {
  return new StructaError(
    "LAYOUT_FAILED",
    problems.map((p) => ({ ...p, hint: BUG_HINT })),
  );
}

/**
 * Maps ELK's result back to our areas, cards and lines, failing loudly if
 * anything was dropped or mangled. A line ELK was given reversed has its
 * route turned back round, so it runs from its own source.
 */
function readScene<C extends LayoutCard, L extends LayoutLine, A extends LayoutArea>(
  result: ElkNode,
  graph: Graph<C, L, A>,
  ends: readonly Ends[],
  direction: Direction,
): Scene<C, L, A> {
  const problems: Omit<Problem, "hint">[] = [];
  const returned = new Map<string, ElkNode | ElkExtendedEdge>();
  // Every element at every depth: positions are all relative to the root.
  const collect = (node: ElkNode) => {
    for (const element of [...(node.children ?? []), ...(node.edges ?? [])]) {
      if (returned.has(element.id)) problems.push({ path: "$", message: `the layout engine repeated "${element.id}"` });
      returned.set(element.id, element);
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(result);
  const take = (id: string) => {
    const element = returned.get(id);
    returned.delete(id);
    return element;
  };

  const areas: PlacedArea<A>[] = [];
  graph.areas.forEach((area, i) => {
    const node = take(`a${i}`) as ElkNode | undefined;
    if (!node) return problems.push({ path: area.path, message: "the layout engine dropped this area" });
    const { x, y, width, height } = node;
    if (![x, y, width, height].every(isFiniteNumber)) {
      return problems.push({ path: area.path, message: "the layout engine gave this area no position or size" });
    }
    if (width! < area.minWidth) return problems.push({ path: area.path, message: "the layout engine made this area too narrow for its name" });
    areas.push({ area, x: x!, y: y!, width: width!, height: height! });
  });

  const cards: PlacedCard<C>[] = [];
  /** Where each card that was placed is, by its index. */
  const placed = new Map<number, Point>();
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
    placed.set(i, { x: node.x, y: node.y });
  });
  /** Whether a route ends where it must: on a fixed port of each of its cards, or anywhere without one. */
  const onPorts = (line: L, route: readonly Point[], fixed: Ends["fixed"]): boolean => {
    if (!fixed) return true;
    const near = (p: Point, card: number, at: Point) => {
      const c = placed.get(card);
      return c === undefined || Math.hypot(p.x - (c.x + at.x), p.y - (c.y + at.y)) < 0.01;
    };
    return near(route[0]!, line.source, fixed.source) && near(route.at(-1)!, line.target, fixed.target);
  };

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
    if (ends[i]!.reversed) route.reverse();
    if (!onPorts(line, route, ends[i]!.fixed)) return problems.push({ path: line.path, message: "the layout engine moved this line's ends off its ports" });
    const labels = readLabels(edge, i, line, ends[i]!, route, direction);
    if (Array.isArray(labels)) return problems.push(...labels);
    // A loop's end labels go beside its own ends: ELK doesn't place them.
    const loop =
      line.source === line.target
        ? {
            ...(line.sourceLabel ? { sourceLabel: besideLoopEnd(route, line.sourceLabel) } : {}),
            ...(line.targetLabel ? { targetLabel: besideLoopEnd([...route].reverse(), line.targetLabel) } : {}),
          }
        : {};
    lines.push({ line, points: route, ...labels, ...loop });
  });

  for (const id of returned.keys()) {
    problems.push({ path: "$", message: `the layout engine returned an unexpected element "${id}"` });
  }
  if (problems.length > 0) throw layoutFailed(problems);
  return normalise(areas, cards, labelLoops(areas, cards, lines));
}

/** How far a loop's label sits from the loop. */
const LOOP_LABEL_GAP = 4;

/**
 * ELK can leave the label of a line from a table to itself away from its
 * loop, nearer another line. Each such label goes just outside its loop
 * instead, level with the loop's middle, wherever that's clear of every
 * card, every other label and every other line, and inside just the area
 * boxes its table is in, clear of their names; otherwise it stays where ELK
 * put it.
 */
function labelLoops<C extends LayoutCard, L extends LayoutLine, A extends LayoutArea>(
  areas: readonly PlacedArea<A>[],
  cards: readonly PlacedCard<C>[],
  lines: RoutedLine<L>[],
): RoutedLine<L>[] {
  const placed = [...lines];
  placed.forEach(({ line, points, label }, i) => {
    if (!label || !line.label || !line.ports || line.source !== line.target) return;
    const beside = {
      x: Math.max(...points.map((p) => p.x)) + LOOP_LABEL_GAP,
      y: (points[0]!.y + points.at(-1)!.y) / 2 - line.label.height / 2,
    };
    const box = { ...beside, ...line.label };
    const table = cards[line.source]!;
    const tableBox = { x: table.x, y: table.y, width: table.card.width, height: table.card.height };
    const clear =
      cards.every((c) => !overlaps(box, { x: c.x, y: c.y, width: c.card.width, height: c.card.height })) &&
      areas.every((a) => {
        if (!inside(tableBox, a)) return !overlaps(box, a);
        return inside(box, a) && !overlaps(box, { x: a.x, y: a.y, width: a.width, height: a.area.padding.top });
      }) &&
      placed.every((other, j) => {
        if (j === i) return true;
        const otherBox = other.label && other.line.label ? { ...other.label, ...other.line.label } : undefined;
        return !(otherBox && overlaps(box, otherBox)) && !other.points.some((p, k) => k > 0 && overlaps(box, segmentBox(other.points[k - 1]!, p)));
      });
    if (clear) placed[i] = { ...placed[i]!, label: beside };
  });
  return placed;
}

/** A box: a card's, a label's, an area's or a straight run's. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether two boxes share any area or touch, a segment's flat box included. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** Whether box `a` lies wholly within box `b`. */
function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}

/** The box a straight run fills: flat for a level or upright run. */
function segmentBox(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Where ELK put each of line `i`'s labels, or what went wrong with them. An
 * end label goes at the far end of its box from the card, at `route`'s end.
 */
function readLabels(
  edge: ElkExtendedEdge,
  i: number,
  line: LayoutLine,
  ends: Ends,
  route: readonly Point[],
  direction: Direction,
): Partial<Record<LabelName, Point>> | Omit<Problem, "hint">[] {
  const returned = edge.labels ?? [];
  const found: Partial<Record<LabelName, Point>> = {};
  const problems: Omit<Problem, "hint">[] = [];
  for (const [name, letter, field] of LABELS) {
    const size = line[name];
    if (!size || !givenToElk(line, ends, name)) continue;
    const path = `${line.path}.${field}`;
    const matches = returned.filter((label) => label.id === `${letter}${i}`);
    const label = matches[0];
    const given = elkSize(size, direction);
    if (matches.length !== 1 || !label) problems.push({ path, message: "the layout engine dropped this label" });
    else if (label.width !== given.width || label.height !== given.height) problems.push({ path, message: "the layout engine changed this label's size" });
    else if (!isFiniteNumber(label.x) || !isFiniteNumber(label.y)) problems.push({ path, message: "the layout engine gave this label no position" });
    else if (!("clear" in size)) found[name] = { x: label.x, y: label.y };
    else found[name] = pastClearance({ x: label.x, y: label.y, ...given }, size.clear, name === "sourceLabel" ? route[0]! : route.at(-1)!, direction);
  }
  for (const label of returned) {
    if (!LABELS.some(([name, letter]) => line[name] && givenToElk(line, ends, name) && label.id === `${letter}${i}`)) {
      problems.push({ path: line.path, message: `the layout engine returned an unexpected label "${label.id}"` });
    }
  }
  return problems.length > 0 ? problems : found;
}

/**
 * Whether ELK is given a line's label to place. It places every label but
 * those at the ends of a line from a card to itself: it would stack them in
 * one block beside the loop, where neither shows which end it's at. They're
 * put beside their own ends instead, as ELK puts other lines' end labels.
 * Nor is it given a count at an end shared with an earlier line, which shows
 * the same count there.
 */
function givenToElk(line: LayoutLine, ends: Ends, name: LabelName): boolean {
  return name === "label" || (line.source !== line.target && !ends.quiet?.has(name));
}

/**
 * The box ELK gets for a label: an end label's is longer along the line by
 * how far from the card it must start. ELK ends every line that isn't a
 * loop, and has no fixed ports, on a card's sides across the flow: its top
 * or bottom going down, its left or right going right, so that's the way
 * along the line. Only lines between tables have fixed ports, and they have
 * no end labels.
 */
function elkSize(size: Size | EndLabelSize, direction: Direction): Size {
  const clear = "clear" in size ? size.clear : 0;
  return direction === "down" ? { width: size.width, height: size.height + clear } : { width: size.width + clear, height: size.height };
}

/**
 * Where an end label goes in the box ELK put just off the card at `end`, the
 * line's end: `clear` along from the side of the box nearer the card.
 */
function pastClearance(box: Point & Size, clear: number, end: Point, direction: Direction): Point {
  if (direction === "down") return { x: box.x, y: end.y <= box.y + box.height / 2 ? box.y + clear : box.y };
  return { x: end.x <= box.x + box.width / 2 ? box.x + clear : box.x, y: box.y };
}

/** How far ELK puts an end label from the card, and from its line. */
const END_LABEL_SPACING = { card: 2, line: 3 };

/**
 * Where a label of `size` goes beside the end of a loop at `route[0]`: just
 * off the card, or `clear` along from it, and beside the loop's first run,
 * on its side away from the loop's other end, so it's clear of the loop.
 */
function besideLoopEnd(route: readonly Point[], size: EndLabelSize): Point {
  const start = route[0]!;
  const next = route.find((p) => Math.hypot(p.x - start.x, p.y - start.y) > 1e-6) ?? { x: start.x, y: start.y - 1 };
  const length = Math.hypot(next.x - start.x, next.y - start.y);
  // Out of the card along the run, and across it, away from the other end.
  const out = { x: (next.x - start.x) / length, y: (next.y - start.y) / length };
  const other = route.at(-1)!;
  const side = (start.x - other.x) * -out.y + (start.y - other.y) * out.x < 0 ? -1 : 1;
  const across = { x: -out.y * side, y: out.x * side };
  const [alongSize, acrossSize] = Math.abs(out.x) > 0.5 ? [size.width, size.height] : [size.height, size.width];
  const at = (a: number, b: number) => ({ x: start.x + out.x * a + across.x * b, y: start.y + out.y * a + across.y * b });
  const near = at(END_LABEL_SPACING.card + size.clear, END_LABEL_SPACING.line);
  const far = at(END_LABEL_SPACING.card + size.clear + alongSize, END_LABEL_SPACING.line + acrossSize);
  return { x: Math.min(near.x, far.x), y: Math.min(near.y, far.y) };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalise<C extends LayoutCard, L extends LayoutLine, A>(
  areas: PlacedArea<A>[],
  cards: PlacedCard<C>[],
  lines: RoutedLine<L>[],
): Scene<C, L, A> {
  const boxes = [
    ...areas,
    ...cards.map((c) => ({ x: c.x, y: c.y, width: c.card.width, height: c.card.height })),
    ...lines.flatMap((l) =>
      LABELS.flatMap(([name]) => {
        const [at, size] = [l[name], l.line[name]];
        return at && size ? [{ ...at, width: size.width, height: size.height }] : [];
      }),
    ),
  ];
  const xs = [...boxes.flatMap((b) => [b.x, b.x + b.width]), ...lines.flatMap((l) => l.points.map((p) => p.x))];
  const ys = [...boxes.flatMap((b) => [b.y, b.y + b.height]), ...lines.flatMap((l) => l.points.map((p) => p.y))];
  if (xs.length === 0) return { width: 0, height: 0, areas: [], cards: [], lines: [] };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const move = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY });
  return {
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    areas: areas.map((a) => ({ ...a, ...move(a) })),
    cards: cards.map((c) => ({ card: c.card, ...move(c) })),
    lines: lines.map((l) => ({
      line: l.line,
      points: l.points.map(move),
      ...Object.fromEntries(LABELS.flatMap(([name]) => (l[name] ? [[name, move(l[name])]] : []))),
    })),
  };
}
