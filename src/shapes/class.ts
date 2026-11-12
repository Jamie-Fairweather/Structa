import { CLASS_NAME_FACE, CLASS_SECTIONS, ROW_TEXT_FACE, type ClassNode, type ClassRow, type Visibility } from "../input";
import { baseline, measure, wrap } from "../text";
import type { Sizes } from "../theme";
import type { CardBody, Row, TextLine } from "./frame";

const SYMBOLS = new Map<Visibility, string>([
  ["public", "+"],
  ["private", "-"],
  ["protected", "#"],
  ["package", "~"],
]);

const ROW_KINDS = new Map<(typeof CLASS_SECTIONS)[number], Row["kind"]>([
  ["properties", "property"],
  ["methods", "method"],
]);

/**
 * A class card, one standard width: the name centred at the top, then a
 * section for the properties and one for the methods, each under a divider.
 * A class without properties or methods has no section for them.
 */
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

  // Once any row has a visibility, every row's text starts after the symbol's column, so they line up.
  const symbols = CLASS_SECTIONS.some((section) => node[section].some((row) => row.visibility !== undefined));
  const textX = c.paddingX + (symbols ? measure("+ ", ROW_TEXT_FACE, sizes.row.fontSize) : 0);

  let y = 2 * c.paddingY + names.length * c.nameLineHeight;
  const dividers: number[] = [];
  const rows: Row[] = [];
  for (const section of CLASS_SECTIONS) {
    if (node[section].length === 0) continue;
    dividers.push(y);
    y += c.sectionPaddingY;
    for (const member of node[section]) {
      const row = classRow(member, ROW_KINDS.get(section)!, y, width, textX, sizes);
      rows.push(row);
      y += row.box.height;
    }
    y += c.sectionPaddingY;
  }
  return { kind: "class", width, height: y, tooltip: node.label, texts, dividers, rows };
}

/** One member's row, from `top` down: its text wrapped after its visibility symbol. */
function classRow(member: ClassRow, kind: Row["kind"], top: number, width: number, textX: number, sizes: Sizes): Row {
  const r = sizes.row;
  const left = sizes.classCard.paddingX;
  const symbol = member.visibility === undefined ? undefined : SYMBOLS.get(member.visibility)!;
  const lines = wrap(member.text, ROW_TEXT_FACE, r.fontSize, width - left - textX);
  const offset = baseline(ROW_TEXT_FACE, r.fontSize, r.lineHeight);
  const height = 2 * r.paddingY + lines.length * r.lineHeight;
  return {
    id: member.id,
    kind,
    tooltip: symbol === undefined ? member.text : `${symbol} ${member.text}`,
    box: { x: r.tintInset, y: top, width: width - 2 * r.tintInset, height },
    // In a monospaced face, the symbol and its space fill the column the other lines start after.
    texts: lines.map((line, i) => ({
      text: i === 0 && symbol !== undefined ? `${symbol} ${line}` : line,
      x: i === 0 && symbol !== undefined ? left : textX,
      y: top + r.paddingY + i * r.lineHeight + offset,
      face: ROW_TEXT_FACE,
      size: r.fontSize,
      anchor: "start",
      color: "text",
    })),
  };
}
