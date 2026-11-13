// Text faces come from the input definitions, which check each field's text against them.
import {
  DESCRIPTION_FACE,
  LINE_LABEL_FACE,
  TITLE_FACE,
  type ClassEdge,
  type Diagram,
  type FlowEdge,
  type FlowNode,
  type Status,
} from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { classBody } from "./class";
import { shapeBody } from "./flow";
import { frameCards, strikeThrough, type Card, type TextLine } from "./frame";

export { buildAreaBoxes, type AreaBox } from "./area";
export { type Badge, type Box, type Card, type LevelLine, type Row, type Tag, type TextLine } from "./frame";
export { buildLegend, type Legend, type LegendItem } from "./legend";
export { entry, nearest, type Mark, type Outline, type Point } from "./outline";

export interface Line {
  readonly id: string;
  /** A flowchart's line, or the relationship a class line shows. */
  readonly kind: "flow" | ClassEdge["kind"];
  readonly from: string;
  readonly to: string;
  /** Whether an arrowhead is drawn where the line meets `to`. */
  readonly arrow: boolean;
  readonly status?: Status;
  readonly emphasis: boolean;
  /** Sized here; ELK places it. */
  readonly label?: LineLabel;
  readonly tooltip: string;
}

/** A line's label: a pill of wrapped text. Its texts are relative to the pill's top-left corner. */
export interface LineLabel {
  readonly width: number;
  readonly height: number;
  readonly texts: readonly TextLine[];
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
 * Sizes every card of the diagram through the shared card frame. A card in
 * an area shows the area's name in a tag, unless the area boxes are drawn:
 * then the boxes name the areas.
 */
export function buildCards(diagram: Diagram, sizes: Sizes): Card[] {
  const names = new Map(diagram.areas.map((area) => [area.id, area.label]));
  const tagOf = (node: { readonly area?: string }) =>
    diagram.groupAreas || node.area === undefined ? undefined : names.get(node.area);
  if (diagram.type === "class") return frameCards(diagram.nodes, sizes, tagOf, (node, minWidth) => classBody(node, sizes, minWidth));
  return frameCards(diagram.nodes, sizes, tagOf, (node, minWidth) => shapeBody(node, sizes, minWidth));
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

/**
 * A line between two cards. A flowchart's line has an arrow at `to`; an
 * association is a plain line, so its tooltip names the two ends without one.
 */
export function buildLine(edge: FlowEdge | ClassEdge, fromLabel: string, toLabel: string, sizes: Sizes): Line {
  const kind = "kind" in edge ? edge.kind : "flow";
  const arrow = kind === "flow";
  const ends = `${fromLabel} ${arrow ? "→" : "–"} ${toLabel}`;
  return {
    id: edge.id,
    kind,
    from: edge.from,
    to: edge.to,
    arrow,
    ...(edge.status === undefined ? {} : { status: edge.status }),
    emphasis: edge.emphasis,
    ...(edge.label === undefined ? {} : { label: lineLabel(edge.label, edge.status === "removed", sizes) }),
    tooltip: edge.label === undefined ? ends : `${ends}: ${edge.label}`,
  };
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
