import {
  COLUMN_NAME_FACE,
  COLUMN_TYPE_FACE,
  TABLE_DESCRIPTION_FACE,
  TABLE_NAME_FACE,
  type TableColumn,
  type TableNode,
} from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes } from "../theme";
import { cardHead, described, measureBadge, rowBadge, rowBand, rowSections, type CardBody, type PlaceRow, type Row, type TextLine } from "./frame";

/**
 * A table card, as wide as a class card: the table's name centred at the top,
 * then its columns under a divider, one row each. A column's type sits in a
 * column of its own, lined up after the longest name. Only a tag and a badge
 * too wide for the standard width make it wider, `minWidth`.
 */
export function tableBody(node: TableNode, sizes: Sizes, minWidth: number): CardBody {
  const c = sizes.standardCard;
  const width = Math.max(c.width, minWidth);
  const head = cardHead(node.label, TABLE_NAME_FACE, node.description, TABLE_DESCRIPTION_FACE, width, sizes);
  const columns = columnsAt(node.columns, width, sizes);
  // A table with no columns has no section of them.
  const sections = node.columns.length === 0 ? [] : [node.columns.map((column): PlaceRow => (top) => columnRow(column, top, columns, sizes))];
  const more = node.more === undefined ? undefined : { count: node.more, x: columns.nameX, face: COLUMN_NAME_FACE };
  const { bottom, ...rows } = rowSections(sections, more, head.bottom, sizes);
  const outline = { kind: "rounded", radius: sizes.card.radius } as const;
  // The header runs from the top of the card to its divider; without one, it's the whole card.
  const header = { top: 0, bottom: head.bottom };
  return { kind: "table", width, height: bottom, outline, tooltip: described(node.label, node.description), texts: head.texts, ...rows, header };
}

/** Key markers are fixed words, so they need no checking against the font. */
const MARKER_FACE: FaceId = "inter-bold";

/** A column's key markers, in a fixed order: "PK FK UQ", or "" for none. */
function markers(column: TableColumn): string {
  return [column.pk && "PK", column.fk && "FK", column.unique && "UQ"].filter(Boolean).join(" ");
}

/** Where a table's names and types start, and how wide each may be, the same for every row. */
interface Columns {
  readonly width: number;
  readonly nameX: number;
  readonly typeX: number;
}

/**
 * Once any column has a key marker, every name starts after the widest
 * markers, so they line up. The type lines up after the longest name, but the
 * names take at most a share of the row; longer ones wrap. They give up some
 * of that, down to a smaller share, so that each type's longest word fits
 * whole beside its row's badge.
 */
function columnsAt(columns: readonly TableColumn[], width: number, sizes: Sizes): Columns {
  const { paddingX } = sizes.standardCard;
  const t = sizes.tableCard;
  const widestMarkers = Math.max(0, ...columns.map((column) => measure(markers(column), MARKER_FACE, t.markerSize)));
  const nameX = paddingX + (widestMarkers > 0 ? Math.ceil(widestMarkers) + t.markerGap : 0);
  const room = width - paddingX - nameX;
  const longest = Math.max(0, ...columns.map((column) => measure(column.name, COLUMN_NAME_FACE, sizes.row.fontSize)));
  const afterNames = nameX + Math.min(Math.ceil(longest) + t.typeGap, Math.floor(room * t.nameShare));
  const wholeWords = Math.min(
    ...columns.map((column) => {
      const widestWord = Math.max(...typeText(column).split(" ").map((word) => measure(word, COLUMN_TYPE_FACE, sizes.row.fontSize)));
      return Math.floor(typeRight(column, width, sizes) - widestWord);
    }),
  );
  const typeX = Math.min(afterNames, Math.max(nameX + Math.floor(room * t.minNameShare), wholeWords));
  return { width, nameX, typeX };
}

/** A column's type as drawn: with ? after it when the column is nullable. */
function typeText(column: TableColumn): string {
  return column.nullable ? `${column.type}?` : column.type;
}

/** Where a column's type must end: clear of the badge at the row's right-hand end, when it has one. */
function typeRight({ status }: TableColumn, width: number, sizes: Sizes): number {
  const right = width - sizes.standardCard.paddingX;
  return status === undefined ? right : right - measureBadge(status, sizes) - sizes.row.badgeGap;
}

/**
 * One column's row, from `top` down: its key markers, its name wrapped in its
 * own column, then its type, with ? after it when the column is nullable.
 */
function columnRow(column: TableColumn, top: number, at: Columns, sizes: Sizes): { row: Row; height: number } {
  const r = sizes.row;
  const { paddingX } = sizes.standardCard;
  const { status } = column;
  const type = typeText(column);
  const names = wrap(column.name, COLUMN_NAME_FACE, r.fontSize, at.typeX - sizes.tableCard.typeGap - at.nameX);
  const types = wrap(type, COLUMN_TYPE_FACE, r.fontSize, typeRight(column, at.width, sizes) - at.typeX);
  const height = 2 * r.paddingY + Math.max(names.length, types.length) * r.lineHeight;
  // Every text in the row sits on the baseline of a line of row text, the markers too.
  const baselineAt = (i: number) => top + r.paddingY + i * r.lineHeight + baseline(COLUMN_NAME_FACE, r.fontSize, r.lineHeight);
  const line = (text: string, i: number, x: number, face: FaceId, color: TextLine["color"]): TextLine => ({
    text,
    x,
    y: baselineAt(i),
    face,
    size: r.fontSize,
    anchor: "start",
    color,
  });
  const keys = markers(column);
  const row: Row = {
    id: column.name,
    kind: "column",
    ...(status === undefined ? {} : { status, badge: rowBadge(status, at.width - paddingX, top, sizes) }),
    tooltip: `${keys === "" ? "" : `${keys} `}${column.name}: ${type}`,
    box: rowBand(top, height, at.width, sizes),
    // The markers sit in their own column, like a class member's visibility, so a removed row's strike starts after them.
    ...(keys === ""
      ? {}
      : {
          symbol: {
            text: keys,
            x: paddingX,
            y: baselineAt(0),
            face: MARKER_FACE,
            size: sizes.tableCard.markerSize,
            anchor: "start",
            color: "mutedText",
          },
        }),
    texts: [
      ...names.map((text, i) => line(text, i, at.nameX, COLUMN_NAME_FACE, "text")),
      ...types.map((text, i) => line(text, i, at.typeX, COLUMN_TYPE_FACE, "mutedText")),
    ],
  };
  return { row, height };
}
