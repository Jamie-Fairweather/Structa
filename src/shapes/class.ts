import { CLASS_NAME_FACE, type ClassNode } from "../input";
import { baseline, wrap } from "../text";
import type { Sizes } from "../theme";
import type { CardBody, TextLine } from "./frame";

/** A class card: a fixed width, its name centred at the top. */
export function classBody(node: ClassNode, sizes: Sizes): CardBody {
  const c = sizes.classCard;
  const width = c.width;
  const names = wrap(node.label, CLASS_NAME_FACE, c.nameSize, width - 2 * c.paddingX);
  const offset = baseline(CLASS_NAME_FACE, c.nameSize, c.nameLineHeight);
  const texts = names.map(
    (text, i): TextLine => ({
      text,
      x: width / 2,
      y: c.paddingY + i * c.nameLineHeight + offset,
      face: CLASS_NAME_FACE,
      size: c.nameSize,
      anchor: "middle",
      color: "text",
      title: true,
    }),
  );
  return { kind: "class", width, height: 2 * c.paddingY + names.length * c.nameLineHeight, tooltip: node.label, texts };
}
