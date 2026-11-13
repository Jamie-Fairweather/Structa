// Text faces come from the input definitions, which check each field's text against them.
import { CARD_DESCRIPTION_FACE, NOTE_LABEL_FACE, STEP_LABEL_FACE, type FlowNode, type FlowShape } from "../input";
import type { Sizes } from "../theme";
import { fit, paragraph, type BorderPlace, type CardBody, type CardFill, type TextBlock } from "./frame";
import type { Mark, OutlineShape } from "./outline";

/** How one shape fits round its text. */
interface Geometry {
  /** How wide its text may wrap. */
  readonly wrapWidth: number;
  /** Its outline's size for a block of text this big, at least `minWidth` wide. */
  size(text: { readonly width: number; readonly height: number }, minWidth: number): { width: number; height: number };
  outline(width: number, height: number): OutlineShape;
  marks?(width: number, height: number): Mark[];
  /** Where its badge and tag sit on its top border. */
  border?(width: number, height: number): BorderPlace;
  readonly fill?: CardFill;
}

/** A flowchart shape or note: its text wrapped and centred in the outline its shape draws round it. */
export function shapeBody(node: FlowNode, sizes: Sizes, minWidth: number): CardBody {
  const geometry = GEOMETRY.get(node.shape)!(sizes);
  const text = textBlock(node, sizes, geometry.wrapWidth);
  const { width, height } = geometry.size(text, minWidth);
  const top = (height - text.height) / 2;
  return {
    kind: node.shape,
    width,
    height,
    outline: geometry.outline(width, height),
    ...(geometry.marks ? { marks: geometry.marks(width, height) } : {}),
    ...(geometry.fill ? { fill: geometry.fill } : {}),
    ...(geometry.border ? { border: geometry.border(width, height) } : {}),
    tooltip: node.description === undefined ? node.label : `${node.label}\n${node.description}`,
    texts: text.lines.map((line) => ({ ...line, x: width / 2, y: top + line.y })),
  };
}

/**
 * The label, then any description under it in smaller, muted text, each
 * wrapped to `wrapWidth` and centred. Notes draw their label smaller and lighter.
 */
function textBlock(node: FlowNode, sizes: Sizes, wrapWidth: number): TextBlock {
  const note = node.shape === "note";
  const label = paragraph(node.label, note ? NOTE_LABEL_FACE : STEP_LABEL_FACE, note ? sizes.note : sizes.shapeText, "text", wrapWidth);
  // The label is the card's name, so it's struck through when the card is removed; the description isn't.
  const named = { ...label, lines: label.lines.map((line) => ({ ...line, title: true })) };
  if (node.description === undefined) return named;
  const d = sizes.shapeDescription;
  const description = paragraph(node.description, CARD_DESCRIPTION_FACE, d, "mutedText", wrapWidth);
  const top = label.height + d.gap;
  return {
    width: Math.max(label.width, description.width),
    height: top + description.height,
    lines: [...named.lines, ...description.lines.map((line) => ({ ...line, y: top + line.y }))],
  };
}

const GEOMETRY = new Map<FlowShape, (sizes: Sizes) => Geometry>([
  ["step", (sizes) => box(sizes.step, sizes.card.radius)],
  ["start", terminal],
  ["end", terminal],
  ["decision", decision],
  ["io", io],
  ["subprocess", subprocess],
  ["note", note],
]);

interface BoxSizes {
  readonly paddingX: number;
  readonly paddingY: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minHeight: number;
}

/** A box with corners of `radius`, its text `extraX` further in from each side than the padding. */
function box(s: BoxSizes, radius: number, extraX = 0): Geometry {
  const sideX = s.paddingX + extraX;
  return {
    wrapWidth: s.maxWidth - 2 * sideX,
    size: (text, minWidth) => ({
      width: fit(text.width + 2 * sideX, s.minWidth, s.maxWidth, minWidth),
      height: Math.max(s.minHeight, text.height + 2 * s.paddingY),
    }),
    outline: () => ({ kind: "rounded", radius }),
  };
}

/**
 * Start and end: a pill. With its ends rounded at most `maxRadius`, text
 * padded `paddingX` from the ends always stays inside: the padding is enough
 * for the corner of the text to clear the curve.
 */
function terminal(sizes: Sizes): Geometry {
  const s = sizes.terminal;
  const radius = (height: number) => Math.min(height / 2, s.maxRadius);
  return {
    ...box(s, 0),
    outline: (_width, height) => ({ kind: "rounded", radius: radius(height) }),
    // In from the ends far enough that the badge and the tag still meet the curving ends.
    border: (_width, height) => ({ align: "end", inset: Math.max(sizes.badge.inset, radius(height) / 2) }),
  };
}

/**
 * A diamond round its text. The padded text block, w × h, fits exactly
 * inside a diamond W × H when w / W + h / H = 1; W = w + aspect × h, H =
 * h + w / aspect is that diamond, `aspect` times as wide as tall. Wrapping at
 * half the maximum width keeps W - w positive however wide is allowed.
 */
function decision(sizes: Sizes): Geometry {
  const s = sizes.decision;
  return {
    wrapWidth: s.maxWidth / 2 - 2 * s.paddingX,
    size: (text, minWidth) => {
      const w = text.width + 2 * s.paddingX;
      const h = text.height + 2 * s.paddingY;
      const width = fit(w + s.aspect * h, s.minWidth, s.maxWidth, minWidth);
      return { width, height: Math.max(s.minHeight, Math.ceil((h * width) / (width - w))) };
    },
    outline: (width, height) => ({
      kind: "polygon",
      points: [
        { x: width / 2, y: 0 },
        { x: width, y: height / 2 },
        { x: width / 2, y: height },
        { x: 0, y: height / 2 },
      ],
    }),
    // Either side of the top corner, on the slanted edges: further out they would float off them.
    border: (width, height) => ({ align: "middle", drop: height / width }),
  };
}

/**
 * Input or output: a box leaning right. The text keeps the padding from the
 * slanted sides too, since it's centred and the padding is over half the slant.
 */
function io(sizes: Sizes): Geometry {
  const s = sizes.io;
  return {
    ...box(s, 0, s.slant / 2),
    // The top edge starts `slant` in from the box's left: the tag keeps the inset from where it starts.
    border: () => ({ align: "end", inset: sizes.badge.inset, tagInset: s.slant + sizes.badge.inset }),
    outline: (width, height) => ({
      kind: "polygon",
      points: [
        { x: s.slant, y: 0 },
        { x: width, y: 0 },
        { x: width - s.slant, y: height },
        { x: 0, y: height },
      ],
    }),
  };
}

/** A box with an upright bar inside each side, the text between the bars. */
function subprocess(sizes: Sizes): Geometry {
  const s = sizes.subprocess;
  return {
    ...box(s, s.radius, s.barInset),
    marks: (width, height) => [
      [
        { x: s.barInset, y: 0 },
        { x: s.barInset, y: height },
      ],
      [
        { x: width - s.barInset, y: 0 },
        { x: width - s.barInset, y: height },
      ],
    ],
  };
}

/** An aside in its own fill, its bottom-right corner folded over. */
function note(sizes: Sizes): Geometry {
  const s = sizes.note;
  return {
    ...box(s, 0),
    outline: (width, height) => ({
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height - s.fold },
        { x: width - s.fold, y: height },
        { x: 0, y: height },
      ],
    }),
    marks: (width, height) => [
      [
        { x: width - s.fold, y: height },
        { x: width - s.fold, y: height - s.fold },
        { x: width, y: height - s.fold },
      ],
    ],
    fill: "noteFill",
  };
}
