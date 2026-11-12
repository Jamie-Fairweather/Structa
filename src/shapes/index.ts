import type { FlowEdge, FlowStep } from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes, ThemeColors } from "../theme";

/** A line of text inside a card, positioned relative to the card's top-left corner. */
export interface CardText {
  readonly text: string;
  readonly x: number;
  /** The baseline. */
  readonly y: number;
  readonly face: FaceId;
  readonly size: number;
  readonly anchor: "start" | "middle";
  readonly color: keyof Pick<ThemeColors, "text" | "mutedText">;
}

/** A card sized before layout. Its box is exactly what ELK is given. */
export interface Card {
  readonly id: string;
  readonly kind: "step";
  readonly width: number;
  readonly height: number;
  readonly tooltip: string;
  readonly texts: readonly CardText[];
}

export interface Line {
  readonly id: string;
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
  readonly tooltip: string;
}

const STEP_LABEL_FACE: FaceId = "inter-semibold";

/** A step: a rounded box sized to its wrapped label between a minimum and maximum width. */
export function buildStep(node: FlowStep, sizes: Sizes): Card {
  const s = sizes.step;
  const lines = wrap(node.label, STEP_LABEL_FACE, s.fontSize, s.maxWidth - 2 * s.paddingX);
  const textWidth = Math.max(...lines.map((l) => measure(l, STEP_LABEL_FACE, s.fontSize)));
  const width = Math.min(s.maxWidth, Math.max(s.minWidth, Math.ceil(textWidth + 2 * s.paddingX)));
  const height = Math.max(s.minHeight, 2 * s.paddingY + lines.length * s.lineHeight);
  const top = (height - lines.length * s.lineHeight) / 2;
  const offset = baseline(STEP_LABEL_FACE, s.fontSize, s.lineHeight);

  return {
    id: node.id,
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
    })),
  };
}

export function buildLine(edge: FlowEdge, fromLabel: string, toLabel: string): Line {
  return { id: edge.id, kind: "flow", from: edge.from, to: edge.to, tooltip: `${fromLabel} → ${toLabel}` };
}
