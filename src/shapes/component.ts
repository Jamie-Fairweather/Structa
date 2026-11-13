// Text faces come from the input definitions, which check each field's text against them.
import { CARD_DESCRIPTION_FACE, COMPONENT_LABEL_FACE, KIND_WORD_FACE, type ComponentNode } from "../input";
import { baseline, measure } from "../text";
import type { Sizes } from "../theme";
import { fit, paragraph, type CardBody, type TextBlock, type TextLine } from "./frame";

/**
 * A component card. Every kind has the same rounded card: its kind's icon
 * and kind word in a muted line at the top, then its label, then any
 * description, smaller and muted, each centred and wrapped. It sizes to its
 * text between a minimum and a maximum width, and is at least `minHeight`
 * tall, its contents centred top to bottom.
 */
export function componentBody(node: ComponentNode, sizes: Sizes, minWidth: number, minHeight: number): CardBody {
  const c = sizes.component;
  const { size: iconSize, gap: iconGap } = c.icon;
  const wordSize = c.kindWord.fontSize;
  const wrapWidth = c.maxWidth - 2 * c.paddingX;
  // The icon and the word after it are one line, centred as a whole.
  const kindWidth = iconSize + iconGap + measure(node.kind, KIND_WORD_FACE, wordSize);
  const label = paragraph(node.label, COMPONENT_LABEL_FACE, c.label, "text", wrapWidth);
  const description: TextBlock | undefined =
    node.description === undefined ? undefined : paragraph(node.description, CARD_DESCRIPTION_FACE, c.description, "mutedText", wrapWidth);
  const textWidth = Math.max(kindWidth, label.width, description?.width ?? 0);
  const width = fit(textWidth + 2 * c.paddingX, c.minWidth, c.maxWidth, minWidth);

  const left = (width - kindWidth) / 2;
  const labelGap = c.kindWord.lineHeight + c.labelGap;
  const descriptionGap = labelGap + label.height + c.description.gap;
  const natural = (description ? descriptionGap + description.height : labelGap + label.height) + 2 * c.paddingY;
  const height = Math.max(natural, Math.ceil(minHeight));
  // Where the contents start: the padding in from the top, or lower in a card made taller than they need.
  const top = c.paddingY + (height - natural) / 2;
  const word: TextLine = {
    text: node.kind,
    x: left + iconSize + iconGap,
    y: top + baseline(KIND_WORD_FACE, wordSize, c.kindWord.lineHeight),
    face: KIND_WORD_FACE,
    size: wordSize,
    anchor: "start",
    color: "mutedText",
  };
  const labelTop = top + labelGap;
  const descriptionTop = top + descriptionGap;
  const place = (block: TextBlock, at: number) => block.lines.map((line) => ({ ...line, x: width / 2, y: at + line.y }));
  const named = `${node.label} (${node.kind})`;
  return {
    kind: node.kind,
    width,
    height,
    outline: { kind: "rounded", radius: sizes.card.radius },
    tooltip: node.description === undefined ? named : `${named}: ${node.description}`,
    icon: { name: node.kind, x: left, y: top + (c.kindWord.lineHeight - iconSize) / 2, size: iconSize },
    texts: [
      word,
      // The label is the card's name, so it's struck through when the card is removed; the description isn't.
      ...place(label, labelTop).map((line) => ({ ...line, title: true })),
      ...(description ? place(description, descriptionTop) : []),
    ],
  };
}
