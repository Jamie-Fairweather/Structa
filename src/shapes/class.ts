import {
  ABSTRACT_CLASS_NAME_FACE,
  ABSTRACT_ROW_TEXT_FACE,
  CLASS_DESCRIPTION_FACE,
  CLASS_NAME_FACE,
  ENUM_SECTIONS,
  MEMBER_SECTIONS,
  ROW_TEXT_FACE,
  STEREOTYPE_FACE,
  type ClassNode,
  type ClassRow,
  type ClassSection,
  type Visibility,
} from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { badge, measureBadge, underline, type CardBody, type Row, type TextLine } from "./frame";

const SYMBOLS = new Map<Visibility, string>([
  ["public", "+"],
  ["private", "-"],
  ["protected", "#"],
  ["package", "~"],
]);

const ROW_KINDS = new Map<ClassSection, Row["kind"]>([
  ["properties", "property"],
  ["methods", "method"],
  ["values", "value"],
]);

/**
 * A class card, one standard width: any stereotype as a muted «…» line, then
 * the name and any description, centred at the top; then a section for the
 * properties and one for the methods, each under a divider, or an enum's one
 * section of values. Each section keeps its place, as in UML: a class with
 * methods but no properties has an empty properties section, so its methods
 * are still under the second divider. A class without methods has no methods
 * section, and one with no rows has neither. The "… N more" line ends the
 * last section, or has one of its own.
 */
export function classBody(node: ClassNode, sizes: Sizes): CardBody {
  const c = sizes.classCard;
  const width = c.width;
  const texts: TextLine[] = [];
  let y: number = c.paddingY;
  if (node.stereotype !== undefined) {
    const line = centred(`«${node.stereotype}»`, STEREOTYPE_FACE, c.stereotypeSize, c.stereotypeLineHeight, y, width, sizes);
    texts.push(...line.texts.map((t): TextLine => ({ ...t, color: "mutedText" })));
    y = line.bottom;
  }
  const nameFace = node.abstract || node.stereotype === "abstract" ? ABSTRACT_CLASS_NAME_FACE : CLASS_NAME_FACE;
  const name = centred(node.label, nameFace, c.nameSize, c.nameLineHeight, y, width, sizes);
  texts.push(...name.texts.map((t): TextLine => ({ ...t, color: "text", title: true })));
  y = name.bottom;
  if (node.description !== undefined) {
    const top = y + c.descriptionGap;
    const description = centred(node.description, CLASS_DESCRIPTION_FACE, c.descriptionSize, c.descriptionLineHeight, top, width, sizes);
    texts.push(...description.texts.map((t): TextLine => ({ ...t, color: "mutedText" })));
    y = description.bottom;
  }
  y += c.paddingY;

  // An enum has only its values; any other class only its members.
  const drawn: readonly ClassSection[] = node.stereotype === "enum" ? ENUM_SECTIONS : MEMBER_SECTIONS;
  // Once any row has a visibility, every row's text starts after the symbol's column, so they line up.
  const symbols = drawn.some((section) => node[section].some((row) => row.visibility !== undefined));
  const textX = c.paddingX + (symbols ? measure("+ ", ROW_TEXT_FACE, sizes.row.fontSize) : 0);

  // Every section up to the last one with rows, empty ones included.
  const sections = drawn.filter((_, i) => drawn.slice(i).some((section) => node[section].length > 0));
  // The "… N more" line ends the last section, or has a section of its own on a class with no rows.
  const count = Math.max(sections.length, node.more === undefined ? 0 : 1);
  const dividers: number[] = [];
  const rows: Row[] = [];
  let more: TextLine | undefined;
  for (let i = 0; i < count; i++) {
    dividers.push(y);
    y += c.sectionPaddingY;
    const section = sections[i];
    for (const member of section ? node[section] : []) {
      const { row, height } = classRow(member, ROW_KINDS.get(section!)!, y, width, textX, sizes);
      rows.push(row);
      y += height;
    }
    if (i === count - 1 && node.more !== undefined) {
      more = moreLine(node.more, y, textX, sizes);
      y += 2 * sizes.row.paddingY + sizes.row.lineHeight;
    }
    y += c.sectionPaddingY;
  }

  const named = node.stereotype === undefined ? node.label : `«${node.stereotype}» ${node.label}`;
  const tooltip = node.description === undefined ? named : `${named}: ${node.description}`;
  const outline = { kind: "rounded", radius: sizes.card.radius } as const;
  return { kind: "class", width, height: y, outline, tooltip, texts, dividers, rows, ...(more ? { more } : {}) };
}

/** `text` wrapped to the card's width and centred on it, its lines from `top` down. */
function centred(text: string, face: FaceId, size: number, lineHeight: number, top: number, width: number, sizes: Sizes) {
  const lines = wrap(text, face, size, width - 2 * sizes.classCard.paddingX);
  const offset = baseline(face, size, lineHeight);
  return {
    texts: lines.map((line, i) => ({ text: line, x: width / 2, y: top + i * lineHeight + offset, face, size, anchor: "middle" as const })),
    bottom: top + lines.length * lineHeight,
  };
}

/** The muted "… N more" line, placed like a one-line row from `top` down, in line with the rows' text. */
function moreLine(count: number, top: number, textX: number, sizes: Sizes): TextLine {
  const r = sizes.row;
  const y = top + r.paddingY + baseline(ROW_TEXT_FACE, r.fontSize, r.lineHeight);
  return { ...rowText(`… ${count} more`, textX, y, sizes), color: "mutedText" };
}

/**
 * One row, a member or an enum value, from `top` down: its text wrapped after
 * its visibility symbol and, when it has a status, clear of the badge at its
 * right-hand end. An abstract row's text is italic and a static row's is
 * underlined; its symbol, a mark in its own column, stays upright and plain.
 */
function classRow(
  member: ClassRow,
  kind: Row["kind"],
  top: number,
  width: number,
  textX: number,
  sizes: Sizes,
): { row: Row; height: number } {
  const r = sizes.row;
  const left = sizes.classCard.paddingX;
  const { status } = member;
  const symbol = member.visibility === undefined ? undefined : SYMBOLS.get(member.visibility)!;
  const badgeWidth = status === undefined ? 0 : measureBadge(status, sizes);
  const room = width - left - textX - (status === undefined ? 0 : badgeWidth + r.badgeGap);
  const face = member.abstract ? ABSTRACT_ROW_TEXT_FACE : ROW_TEXT_FACE;
  const lines = wrap(member.text, face, r.fontSize, room);
  const offset = baseline(face, r.fontSize, r.lineHeight);
  const height = 2 * r.paddingY + lines.length * r.lineHeight;
  const row: Row = {
    id: member.id,
    kind,
    ...(status === undefined
      ? {}
      : {
          status,
          // Centred on the first line, so it stays level with the row's start when the text wraps.
          badge: badge(status, width - left - badgeWidth, top + r.paddingY + (r.lineHeight - sizes.badge.height) / 2, sizes),
        }),
    tooltip: symbol === undefined ? member.text : `${symbol} ${member.text}`,
    // A tint never quite touches the next row's, so a run of rows with a status reads as separate rows.
    box: { x: r.tintInset, y: top + r.tintGap / 2, width: width - 2 * r.tintInset, height: height - r.tintGap },
    // The symbol sits in its own column, level with the first line, so a removed row's strike starts after it.
    ...(symbol === undefined
      ? {}
      : { symbol: rowText(symbol, left, top + r.paddingY + baseline(ROW_TEXT_FACE, r.fontSize, r.lineHeight), sizes) }),
    texts: lines.map((line, i) => {
      const t = rowText(line, textX, top + r.paddingY + i * r.lineHeight + offset, sizes, face);
      return member.static ? { ...t, underline: underline(t, sizes) } : t;
    }),
  };
  return { row, height };
}

/** A line of row text with its baseline at `y`. */
function rowText(text: string, x: number, y: number, sizes: Sizes, face: FaceId = ROW_TEXT_FACE): TextLine {
  return { text, x, y, face, size: sizes.row.fontSize, anchor: "start", color: "text" };
}
