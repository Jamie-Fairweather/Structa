// Text faces come from the input definitions, which check each field's text against them.
import {
  DESCRIPTION_FACE,
  LINE_LABEL_FACE,
  STEP_LABEL_FACE,
  TITLE_FACE,
  type FlowEdge,
  type FlowStep,
  type Status,
} from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { frameCards, strikeThrough, type Card, type CardBody, type TextLine } from "./frame";

export { topAt, type Badge, type Box, type Card, type Strike, type TextLine } from "./frame";
export { buildLegend, type Legend, type LegendItem } from "./legend";

export interface Line {
  readonly id: string;
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
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

/** Sizes every card through the shared card frame. */
export function buildCards(nodes: readonly FlowStep[], sizes: Sizes): Card[] {
  return frameCards(nodes, sizes, (node, minWidth) => stepBody(node, sizes, minWidth));
}

/** A step: a rounded box sized to its wrapped label between a minimum and maximum width, and at least `minWidth`. */
function stepBody(node: FlowStep, sizes: Sizes, minWidth: number): CardBody {
  const s = sizes.step;
  const lines = wrap(node.label, STEP_LABEL_FACE, s.fontSize, s.maxWidth - 2 * s.paddingX);
  const textWidth = Math.max(...lines.map((l) => measure(l, STEP_LABEL_FACE, s.fontSize)));
  const width = Math.max(minWidth, Math.min(s.maxWidth, Math.max(s.minWidth, Math.ceil(textWidth + 2 * s.paddingX))));
  const height = Math.max(s.minHeight, 2 * s.paddingY + lines.length * s.lineHeight);
  const top = (height - lines.length * s.lineHeight) / 2;
  const offset = baseline(STEP_LABEL_FACE, s.fontSize, s.lineHeight);

  return {
    kind: "step",
    width,
    height,
    tooltip: node.label,
    texts: lines.map((text, i) => ({
      text,
      x: width / 2,
      y: top + i * s.lineHeight + offset,
      face: STEP_LABEL_FACE,
      size: s.fontSize,
      anchor: "middle",
      color: "text",
      title: true,
    })),
  };
}

export function buildLine(edge: FlowEdge, fromLabel: string, toLabel: string, sizes: Sizes): Line {
  const ends = `${fromLabel} → ${toLabel}`;
  return {
    id: edge.id,
    kind: "flow",
    from: edge.from,
    to: edge.to,
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
