// The label's face comes from the input definitions, which check labels against it.
import { STEP_LABEL_FACE, type FlowEdge, type FlowStep } from "../input";
import { baseline, measure, wrap } from "../text";
import type { Sizes } from "../theme";
import { frameCard, type Card, type CardBody } from "./frame";

export type { Badge, Box, Card, TextLine } from "./frame";

export interface Line {
  readonly id: string;
  readonly kind: "flow";
  readonly from: string;
  readonly to: string;
  readonly tooltip: string;
}

/** Sizes every card, each through the shared card frame. */
export function buildCards(nodes: readonly FlowStep[], sizes: Sizes): Card[] {
  const band = nodes.some((node) => node.status !== undefined);
  return nodes.map((node) => frameCard(node.id, { status: node.status }, band, sizes, (minWidth) => stepBody(node, sizes, minWidth)));
}

/** A step: a rounded box sized to its wrapped label between a minimum and maximum width. */
function stepBody(node: FlowStep, sizes: Sizes, frameWidth: number): CardBody {
  const s = sizes.step;
  const lines = wrap(node.label, STEP_LABEL_FACE, s.fontSize, s.maxWidth - 2 * s.paddingX);
  const textWidth = Math.max(...lines.map((l) => measure(l, STEP_LABEL_FACE, s.fontSize)));
  const width = Math.max(frameWidth, Math.min(s.maxWidth, Math.max(s.minWidth, Math.ceil(textWidth + 2 * s.paddingX))));
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
    })),
  };
}

export function buildLine(edge: FlowEdge, fromLabel: string, toLabel: string): Line {
  return { id: edge.id, kind: "flow", from: edge.from, to: edge.to, tooltip: `${fromLabel} → ${toLabel}` };
}
