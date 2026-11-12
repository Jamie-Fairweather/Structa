import {
  CLASS_DESCRIPTION_FACE,
  CLASS_NAME_FACE,
  CLASS_SECTIONS,
  ROW_TEXT_FACE,
  type ClassNode,
  type ClassRow,
  type Visibility,
} from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { badge, measureBadge, type CardBody, type Row, type TextLine } from "./frame";

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
 * A class card, one standard width: the name and any description centred at
 * the top, then a section for the properties and one for the methods, each
 * under a divider. A class without properties or methods has no section for
 * them. The "… N more" line ends the last section, or has one of its own.
 */
export function classBody(node: ClassNode, sizes: Sizes): CardBody {
  const c = sizes.classCard;
  const width = c.width;
  const name = centred(node.label, CLASS_NAME_FACE, c.nameSize, c.nameLineHeight, c.paddingY, width, sizes);
  const texts: TextLine[] = name.texts.map((t) => ({ ...t, color: "text", title: true }));
  let y = name.bottom;
  if (node.description !== undefined) {
    const description = centred(node.description, CLASS_DESCRIPTION_FACE, c.descriptionSize, c.descriptionLineHeight, y + c.descriptionGap, width, sizes);
    texts.push(...description.texts.map((t): TextLine => ({ ...t, color: "mutedText" })));
    y = description.bottom;
  }
  y += c.paddingY;

  // Once any row has a visibility, every row's text starts after the symbol's column, so they line up.
  const symbols = CLASS_SECTIONS.some((section) => node[section].some((row) => row.visibility !== undefined));
  const textX = c.paddingX + (symbols ? measure("+ ", ROW_TEXT_FACE, sizes.row.fontSize) : 0);

  const sections = CLASS_SECTIONS.filter((section) => node[section].length > 0);
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

  const tooltip = node.description === undefined ? node.label : `${node.label}: ${node.description}`;
  return { kind: "class", width, height: y, tooltip, texts, dividers, rows, ...(more ? { more } : {}) };
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
  return {
    text: `… ${count} more`,
    x: textX,
    y: top + r.paddingY + baseline(ROW_TEXT_FACE, r.fontSize, r.lineHeight),
    face: ROW_TEXT_FACE,
    size: r.fontSize,
    anchor: "start",
    color: "mutedText",
  };
}

/**
 * One member's row, from `top` down: its text wrapped after its visibility
 * symbol and, when it has a status, clear of the badge at its right-hand end.
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
  const lines = wrap(member.text, ROW_TEXT_FACE, r.fontSize, room);
  const offset = baseline(ROW_TEXT_FACE, r.fontSize, r.lineHeight);
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
  return { row, height };
}
