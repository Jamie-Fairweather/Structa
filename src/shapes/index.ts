// Text faces come from the input definitions, which check each field's text against them.
import {
  DESCRIPTION_FACE,
  END_LABEL_FACE,
  LINE_LABEL_FACE,
  TITLE_FACE,
  type ArchitectureEdge,
  type Cardinality,
  type ClassEdge,
  type Diagram,
  type ErEdge,
  type FlowEdge,
  type FlowNode,
  type Status,
} from "../input";
import type { LayoutLine, PortSpan } from "../layout";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { classBody } from "./class";
import { componentBody } from "./component";
import { shapeBody } from "./flow";
import { described, frameCards, strikeThrough, type Card, type LineEnds, type Span, type TextLine } from "./frame";
import { tableBody } from "./table";

export { buildAreaBoxes, type AreaBox } from "./area";
export { type Badge, type Card, type Icon, type Landing, type LevelLine, type Row, type Tag, type TextLine } from "./frame";
export { buildLegend, type AreaItem, type Legend, type LegendItem, type StatusItem } from "./legend";
export { distanceToBox, entry, nearest, type Mark, type Outline } from "./outline";

/**
 * What's drawn where a line meets a card: a filled arrowhead, as on a
 * flowchart; an open arrow, just two strokes; UML's hollow triangle, at a
 * parent; or a diamond, filled or hollow, at an owner.
 */
export type EndMark = "arrow" | "open-arrow" | "hollow-triangle" | "filled-diamond" | "hollow-diamond";

/** Everything about one kind of mark at a line's end: how big it is, how the line and other lines meet it, and how it's drawn. */
export interface LineEnd {
  /** How big it is: `length` along the line and `width` across it, before it's fitted to a short run. */
  readonly size: (sizes: Sizes) => { readonly length: number; readonly width: number };
  /**
   * Whether the line's route stops short of its end by the mark's length: at
   * the base of a triangle or the far corner of a diamond, so it never runs
   * through a hollow one. An open arrow's strokes meet at its tip, so the
   * route runs right up to it.
   */
  readonly stopsShort: boolean;
  /**
   * Whether lines that meet one card with this mark share it there, as UML
   * draws the lines into one parent under one triangle, and the lines from
   * one owner at one diamond.
   */
  readonly shared: boolean;
  /**
   * How it's drawn, solid whatever the line's pattern: its path, pointing
   * along the line's last run with its tip on the line's end; what fills it,
   * the line's colour or, for a hollow mark, an opaque fill that hides what's
   * under it; and whether it's stroked in the line's colour, as thick as the
   * line, round a closed path or along open strokes.
   */
  readonly drawn: {
    readonly path: "arrowhead" | "open-arrowhead" | "diamond";
    readonly fill: "line" | "hollow" | "none";
    readonly stroke: "none" | "closed" | "open";
  };
}

/** Every line-end mark, and everything about it. */
export const LINE_ENDS: { readonly [mark in EndMark]: LineEnd } = {
  arrow: {
    size: (sizes) => ({ length: sizes.line.arrowLength, width: sizes.line.arrowWidth }),
    stopsShort: true,
    shared: false,
    drawn: { path: "arrowhead", fill: "line", stroke: "none" },
  },
  // The same size as a filled arrowhead: just its outline.
  "open-arrow": {
    size: (sizes) => ({ length: sizes.line.arrowLength, width: sizes.line.arrowWidth }),
    stopsShort: false,
    shared: false,
    drawn: { path: "open-arrowhead", fill: "none", stroke: "open" },
  },
  "hollow-triangle": {
    size: (sizes) => sizes.lineEnd.triangle,
    stopsShort: true,
    shared: true,
    drawn: { path: "arrowhead", fill: "hollow", stroke: "closed" },
  },
  "filled-diamond": {
    size: (sizes) => sizes.lineEnd.diamond,
    stopsShort: true,
    shared: true,
    drawn: { path: "diamond", fill: "line", stroke: "closed" },
  },
  "hollow-diamond": {
    size: (sizes) => sizes.lineEnd.diamond,
    stopsShort: true,
    shared: true,
    drawn: { path: "diamond", fill: "hollow", stroke: "closed" },
  },
};

export interface Line {
  readonly id: string;
  /** A flowchart's line, the relationship a class line shows, how one part of a system talks to another, or a relationship between tables. */
  readonly kind: LineKind;
  readonly from: string;
  readonly to: string;
  /**
   * What the line's stroke looks like, which shows its kind: dashed for
   * implements, dependency and async lines, dotted for a relationship the
   * database doesn't enforce.
   */
  readonly pattern: "solid" | "dashed" | "dotted";
  /** What's drawn where the line meets each of its cards, if anything, but crow's feet. */
  readonly marks: { readonly from?: EndMark; readonly to?: EndMark };
  /** A relationship's crow's-foot ends: how many rows at each end go with one at the other. */
  readonly ends?: { readonly from: Cardinality; readonly to: Cardinality };
  readonly status?: Status;
  readonly emphasis: boolean;
  /** Sized here; ELK places it. */
  readonly label?: LineLabel;
  /** A class line's counts, beside the line where it leaves `from` and where it reaches `to`. Sized here; ELK places them. */
  readonly fromLabel?: EndLabel;
  readonly toLabel?: EndLabel;
  readonly tooltip: string;
}

/** A line's label: a pill of wrapped text, or a count beside an end. Its texts are relative to its box's top-left corner. */
export interface LineLabel {
  readonly width: number;
  readonly height: number;
  readonly texts: readonly TextLine[];
}

/** A count beside a line's end. */
export interface EndLabel extends LineLabel {
  /** How far along the line from the card it must start, to be past the mark at its end: 0 at an end with none. */
  readonly clear: number;
}

/** The diagram's title and description, relative to the header's top-left corner. */
export interface Header {
  readonly width: number;
  readonly height: number;
  readonly title: readonly TextLine[];
  readonly description: readonly TextLine[];
}

/** The title, then the description under it, each wrapped. Nothing when the diagram has neither. */
export function buildHeader(title: string | undefined, description: string | undefined, sizes: Sizes): Header | undefined {
  if (title === undefined && description === undefined) return undefined;
  const h = sizes.header;
  const titleBlock = block(title, TITLE_FACE, h.titleSize, h.titleLineHeight, 0, "text", h.maxWidth);
  const descriptionTop = titleBlock.height === 0 ? 0 : titleBlock.height + h.gap;
  const descriptionBlock = block(
    description,
    DESCRIPTION_FACE,
    h.descriptionSize,
    h.descriptionLineHeight,
    descriptionTop,
    "mutedText",
    h.maxWidth,
  );
  return {
    width: Math.ceil(Math.max(titleBlock.width, descriptionBlock.width)),
    height: descriptionBlock.height === 0 ? titleBlock.height : descriptionTop + descriptionBlock.height,
    title: titleBlock.texts,
    description: descriptionBlock.texts,
  };
}

/** `text` wrapped to `maxWidth`, left-aligned, its lines from `top` down; nothing at all without text. */
function block(
  text: string | undefined,
  face: FaceId,
  size: number,
  lineHeight: number,
  top: number,
  color: TextLine["color"],
  maxWidth: number,
): { width: number; height: number; texts: TextLine[] } {
  const lines = text === undefined ? [] : wrap(text, face, size, maxWidth);
  return {
    width: Math.max(0, ...lines.map((line) => measure(line, face, size))),
    height: lines.length * lineHeight,
    texts: lines.map((line, i) => ({
      text: line,
      x: 0,
      y: top + i * lineHeight + baseline(face, size, lineHeight),
      face,
      size,
      anchor: "start",
      color,
    })),
  };
}

/**
 * A line, or a note's connector, as far as sizing cards goes: the cards it
 * joins, by their index among the diagram's nodes, and, as layout gives it
 * to ELK, whether it goes in parent first and which of its ends join others.
 */
export interface CardLine extends Pick<LayoutLine, "source" | "target" | "targetFirst" | "joins"> {
  readonly kind: Line["kind"] | Connector["kind"];
}

/**
 * Sizes every card of the diagram through the shared card frame. A card in
 * an area shows the area's name in a tag, unless the area boxes are drawn:
 * then the boxes name the areas. Each card leaves room on its top and sides
 * for the ends of the `lines` ELK will put there, clear of its badge and tag.
 */
export function buildCards(diagram: Diagram, sizes: Sizes, lines: readonly CardLine[]): Card[] {
  const names = new Map(diagram.areas.map((area) => [area.id, area.label]));
  const tagOf = (node: { readonly area?: string }) =>
    diagram.groupAreas || node.area === undefined ? undefined : names.get(node.area);
  const ends = endsOnCards(diagram, lines);
  if (diagram.type === "class") return frameCards(diagram.nodes, sizes, tagOf, ends, (node, minWidth) => classBody(node, sizes, minWidth));
  if (diagram.type === "er") return frameCards(diagram.nodes, sizes, tagOf, ends, (node, minWidth) => tableBody(node, sizes, minWidth));
  if (diagram.type === "architecture") {
    // A class in an architecture diagram is the same class card a class diagram draws.
    return frameCards(diagram.nodes, sizes, tagOf, ends, (node, minWidth, minHeight) =>
      node.kind === "class" ? classBody(node, sizes, minWidth) : componentBody(node, sizes, minWidth, minHeight),
    );
  }
  return frameCards(diagram.nodes, sizes, tagOf, ends, (node, minWidth, minHeight) => shapeBody(node, sizes, minWidth, minHeight));
}

/**
 * How many line ends ELK will put on each card's top, and on either of its
 * sides, as layout gives it the lines. On its top: none when no line meets
 * it there, and otherwise as many as meet its top or its bottom, whichever
 * is more, as ELK spreads both over the same stretch. Going down, a line
 * meets its target's top and leaves its source's bottom, or the other way
 * round when its target comes first; going right, the same on their left
 * and right sides. ELK runs a line from a card to itself over the card's
 * top going right, and off one of its sides going down, with both its ends
 * there. It puts a note beside the shape it's about, across the flow, and
 * runs their connector straight between them: over the top or under the
 * bottom of each going right, so each end counts on its card's top, and to
 * one side or the other going down, so it counts on both. Lines that join
 * meet a card at one point. A line ELK turns round to break a loop meets
 * the other sides; going down, that card has a line coming in, so it has
 * room on its top, if less than it gets. Lines between tables attach at
 * fixed points on their sides instead.
 */
function endsOnCards(diagram: Diagram, lines: readonly CardLine[]): LineEnds[] {
  const none = diagram.nodes.map(() => ({ top: 0, sides: 0 }));
  if (diagram.type === "er") return none;
  const sides = () => diagram.nodes.map(() => new Set<string>());
  const [top, bottom, left, right] = [sides(), sides(), sides(), sides()];
  const across = diagram.direction === "right";
  lines.forEach((line, i) => {
    if (line.kind === "connector") {
      for (const card of [line.source, line.target]) for (const side of across ? [top] : [left, right]) side[card]!.add(`${i}`);
      return;
    }
    if (line.source === line.target) {
      (across ? top : left)[line.source]!.add(`${i} source`).add(`${i} target`);
      return;
    }
    // Ends that join count once: they share a key.
    const key = (end: "source" | "target") => {
      const joined = line.joins?.[end];
      return joined === undefined ? `${i} ${end}` : `joined ${joined}`;
    };
    // Into a card's side facing back along the flow, and out of the one facing on.
    const [into, outOf] = across ? [left, right] : [top, bottom];
    const [atTarget, atSource] = line.targetFirst ? [outOf, into] : [into, outOf];
    atTarget[line.target]!.add(key("target"));
    atSource[line.source]!.add(key("source"));
  });
  return none.map((_, card) => ({
    top: top[card]!.size === 0 ? 0 : Math.max(top[card]!.size, bottom[card]!.size),
    sides: Math.max(left[card]!.size, right[card]!.size),
  }));
}

/** A note's dotted line to the shape it's about: no arrow, no label and no status of its own. */
export interface Connector {
  readonly kind: "connector";
  /** The note's id. */
  readonly from: string;
  /** The id of the shape it's about. */
  readonly to: string;
  /** Faded with its note when the note is removed. */
  readonly faded: boolean;
  readonly tooltip: string;
}

export function buildConnector(note: FlowNode, about: FlowNode): Connector {
  return {
    kind: "connector",
    from: note.id,
    to: about.id,
    faded: note.status === "removed",
    tooltip: `${note.label} (about ${about.label})`,
  };
}

type LineKind = "flow" | ClassEdge["kind"] | "relationship" | ArchitectureEdge["kind"];

/** How a kind of line is drawn, and what its tooltip says between the two cards it joins. */
interface Look extends Pick<Line, "pattern" | "marks"> {
  readonly says: string;
}

/**
 * How each kind of line is drawn: its pattern means its kind, as its colour
 * means its status. A flowchart's line and a call have a filled arrow at
 * `to`, and an async line an open one. Class lines are drawn as UML draws
 * them: inherits and implements point a hollow triangle at the parent,
 * `to`; composition and aggregation put a diamond at the owner, `from`; a
 * dependency points an open arrow at what it needs, and so does a directed
 * association. A class line's tooltip says what it means in words; an
 * association just joins its two cards. A relationship between tables has
 * crow's feet for ends instead of marks.
 */
const DIRECTED: Look = { pattern: "solid", marks: { to: "open-arrow" }, says: "→" };
const LOOKS = new Map<LineKind, Look>([
  ["flow", { pattern: "solid", marks: { to: "arrow" }, says: "→" }],
  ["inherits", { pattern: "solid", marks: { to: "hollow-triangle" }, says: "inherits from" }],
  ["implements", { pattern: "dashed", marks: { to: "hollow-triangle" }, says: "implements" }],
  ["composition", { pattern: "solid", marks: { from: "filled-diamond" }, says: "owns" }],
  ["aggregation", { pattern: "solid", marks: { from: "hollow-diamond" }, says: "has" }],
  ["association", { pattern: "solid", marks: {}, says: "–" }],
  ["dependency", { pattern: "dashed", marks: { to: "open-arrow" }, says: "depends on" }],
  ["relationship", { pattern: "solid", marks: {}, says: "–" }],
  ["call", { pattern: "solid", marks: { to: "arrow" }, says: "→" }],
  ["async", { pattern: "dashed", marks: { to: "open-arrow" }, says: "→" }],
]);

/**
 * A line between two cards, its tooltip naming them, with any counts and
 * its label. An async line's tooltip says so, since a dash is easy to miss.
 * A relationship between tables has a crow's foot at each end, and its
 * tooltip names each end's cardinality; it's dotted when it isn't enforced.
 */
export function buildLine(edge: FlowEdge | ClassEdge | ErEdge | ArchitectureEdge, fromName: string, toName: string, sizes: Sizes): Line {
  const relationship = "fromCardinality" in edge ? edge : undefined;
  const kind: LineKind = "kind" in edge ? edge.kind : relationship ? "relationship" : "flow";
  const { says, ...look } = "directed" in edge && edge.directed === true ? DIRECTED : LOOKS.get(kind)!;
  const pattern = relationship?.enforced === false ? "dotted" : look.pattern;
  const counts: Pick<ClassEdge, "fromLabel" | "toLabel"> = "fromLabel" in edge || "toLabel" in edge ? edge : {};
  // Each end's card, with the count beside that end when there is one.
  const named = (name: string, count: string | undefined) => (count === undefined ? name : `${name} (${count})`);
  const ends = relationship
    ? `${fromName} (${relationship.fromCardinality}) – ${toName} (${relationship.toCardinality})${relationship.enforced ? "" : ", not enforced"}`
    : `${named(fromName, counts.fromLabel)} ${says} ${named(toName, counts.toLabel)}${kind === "async" ? " (async)" : ""}`;
  const removed = edge.status === "removed";
  return {
    id: edge.id,
    kind,
    from: edge.from,
    to: edge.to,
    pattern,
    marks: look.marks,
    ...(relationship ? { ends: { from: relationship.fromCardinality, to: relationship.toCardinality } } : {}),
    ...(edge.status === undefined ? {} : { status: edge.status }),
    emphasis: edge.emphasis,
    ...(edge.label === undefined ? {} : { label: lineLabel(edge.label, removed, sizes) }),
    ...(counts.fromLabel === undefined ? {} : { fromLabel: endLabel(counts.fromLabel, removed, look.marks.from, sizes) }),
    ...(counts.toLabel === undefined ? {} : { toLabel: endLabel(counts.toLabel, removed, look.marks.to, sizes) }),
    tooltip: described(ends, edge.label),
  };
}

/** A count beside one end of a line: one line of text centred in its padded box, struck through when the line is removed. */
function endLabel(count: string, removed: boolean, mark: EndMark | undefined, sizes: Sizes): EndLabel {
  const e = sizes.endLabel;
  const width = Math.ceil(measure(count, END_LABEL_FACE, e.fontSize) + 2 * e.paddingX);
  const line: TextLine = {
    text: count,
    x: width / 2,
    y: e.paddingY + baseline(END_LABEL_FACE, e.fontSize, e.lineHeight),
    face: END_LABEL_FACE,
    size: e.fontSize,
    anchor: "middle",
    color: "text",
  };
  return {
    width,
    height: e.lineHeight + 2 * e.paddingY,
    texts: [removed ? { ...line, strike: strikeThrough(line, sizes) } : line],
    clear: mark === undefined ? 0 : LINE_ENDS[mark].size(sizes).length + e.markGap,
  };
}

/** The columns a line's ends name, by name: an end that names none attaches at its table's header. */
export interface LineColumns {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Where a line between two tables attaches, from the top of each table's box.
 * An end that names a column sits at the middle of that column's row, on one
 * point it shares with every other end on that side of the row. An end that
 * names none sits at the middle of its table's header when it's alone there;
 * ends that share a side of a header, such as a table's link to itself, are
 * spread either side of its middle, kept below the card's rounded corners and
 * as far above its divider. A line from a column back to that same column
 * would loop out and back along itself from one point, so its two ends are
 * spread apart within the row instead. Nothing for cards that lines may meet
 * anywhere.
 */
export function linePorts(from: Card, to: Card, columns: LineColumns, sizes: Sizes): { source: PortSpan; target: PortSpan } | undefined {
  if (!from.header || !to.header) return undefined;
  const loop = from === to && columns.from !== undefined && columns.from === columns.to;
  return { source: endPorts(from, from.header, columns.from, loop, sizes), target: endPorts(to, to.header, columns.to, loop, sizes) };
}

/**
 * Where one end attaches: the middle of the row of the column it names, which
 * validation made sure is there, or the header. The two ends of a loop to its
 * own column sit half the row's band apart about its middle, so their marks
 * stay within the row.
 */
function endPorts(card: Card, header: Span, column: string | undefined, loop: boolean, sizes: Sizes): PortSpan {
  if (column === undefined) return headerPorts(header, sizes);
  // A row's band is centred on the row.
  const { y, height } = card.rows.find((row) => row.id === column)!.box;
  if (loop) return { top: y, bottom: y + height, gap: height / 2 };
  const middle = y + height / 2;
  return { top: middle, bottom: middle, gap: 0 };
}

function headerPorts({ top, bottom }: Span, sizes: Sizes): PortSpan {
  const middle = (top + bottom) / 2;
  const half = Math.max(0, (bottom - top) / 2 - sizes.card.radius);
  return { top: middle - half, bottom: middle + half, gap: sizes.tableCard.portGap };
}

/** A line's label: its text wrapped and centred in a pill, struck through when the line is removed. */
function lineLabel(label: string, removed: boolean, sizes: Sizes): LineLabel {
  const l = sizes.lineLabel;
  const lines = wrap(label, LINE_LABEL_FACE, l.fontSize, l.maxWidth - 2 * l.paddingX);
  const textWidth = Math.max(...lines.map((line) => measure(line, LINE_LABEL_FACE, l.fontSize)));
  const width = Math.ceil(textWidth + 2 * l.paddingX);
  const offset = baseline(LINE_LABEL_FACE, l.fontSize, l.lineHeight);
  return {
    width,
    height: 2 * l.paddingY + lines.length * l.lineHeight,
    texts: lines.map((text, i) => {
      const line: TextLine = {
        text,
        x: width / 2,
        y: l.paddingY + i * l.lineHeight + offset,
        face: LINE_LABEL_FACE,
        size: l.fontSize,
        anchor: "middle",
        color: "text",
      };
      return removed ? { ...line, strike: strikeThrough(line, sizes) } : line;
    }),
  };
}
