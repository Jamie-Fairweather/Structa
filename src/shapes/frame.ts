import type { FlowShape, Status } from "../input";
import { baseline, measure, type FaceId } from "../text";
import type { Sizes, ThemeColors } from "../theme";
import { move, placeOutline, type Mark, type Outline, type OutlineShape, type Point } from "./outline";

/** A line of text, positioned relative to the top-left corner of whatever holds it. */
export interface TextLine {
  readonly text: string;
  readonly x: number;
  /** The baseline. */
  readonly y: number;
  readonly face: FaceId;
  readonly size: number;
  readonly anchor: "start" | "middle";
  readonly color: keyof Pick<ThemeColors, "text" | "mutedText">;
  /** Part of a card's name, so struck through when the card is removed. */
  readonly title?: boolean;
  /** A level line through the text, in its colour. */
  readonly strike?: LevelLine;
  /** A level line under the text, in its colour. */
  readonly underline?: LevelLine;
}

/** A level line from x1 to x2 at height y, such as one through or under a line of text. */
export interface LevelLine {
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The status word in a small pill. Its colours come from the status. */
export interface Badge extends Box {
  readonly status: Status;
  readonly word: Omit<TextLine, "color">;
}

/**
 * A row inside a card, such as a class member, with its own tooltip, status
 * and data attributes. The frame strikes through a removed row's text.
 */
export interface Row {
  readonly id: string;
  readonly kind: "property" | "method" | "value";
  readonly status?: Status;
  readonly tooltip: string;
  /** The band the row's tint fills when it has a status. */
  readonly box: Box;
  /**
   * A mark in a column before the first line, such as a class member's
   * visibility. It's never struck through, so it stays readable on a removed row.
   */
  readonly symbol?: TextLine;
  readonly texts: readonly TextLine[];
  readonly badge?: Badge;
}

/** Where a card's status badge sits on its top border. */
export type BadgePlace =
  /** Toward the right-hand end, `inset` px in from it. */
  | { readonly align: "end"; readonly inset: number }
  /** Centred, as on the top corner of a diamond. */
  | { readonly align: "middle" };

/** The colour a card's outline is filled with. */
export type CardFill = keyof Pick<ThemeColors, "cardFill" | "noteFill">;

/**
 * What a card builder makes: the card's outline size and its contents,
 * relative to the outline's top-left corner. It should be at least the
 * `minWidth` the frame asks for; a narrower one sits centred in a wider box.
 */
export interface CardBody {
  readonly kind: FlowShape | "class";
  readonly width: number;
  readonly height: number;
  readonly outline: OutlineShape;
  readonly marks?: readonly Mark[];
  readonly fill?: CardFill;
  /** Default: toward the right-hand end, the theme's inset in from it. */
  readonly badge?: BadgePlace;
  readonly tooltip: string;
  readonly texts: readonly TextLine[];
  /** Thin lines right across the card between its sections, at these heights. */
  readonly dividers?: readonly number[];
  readonly rows?: readonly Row[];
  /** The muted "… N more" line after the rows, for rows left out on purpose. */
  readonly more?: TextLine;
}

/** A card sized before layout. Its box (`width` × `height`) is exactly what ELK is given. */
export interface Card {
  readonly id: string;
  readonly kind: CardBody["kind"];
  /** The id of the innermost area the card is in. */
  readonly area?: string;
  readonly status?: Status;
  readonly width: number;
  readonly height: number;
  /** The card's drawn outline inside its box: below the band its badge overhangs. */
  readonly outline: Outline;
  readonly marks: readonly Mark[];
  readonly fill: CardFill;
  readonly tooltip: string;
  readonly texts: readonly TextLine[];
  readonly dividers: readonly number[];
  readonly rows: readonly Row[];
  readonly more?: TextLine;
  readonly badge?: Badge;
}

/** What sits on a card's top border, read from the node the card is built from. */
export interface CardHeader {
  readonly status?: Status;
}

/** A node the frame can build a card from. */
type Framed = CardHeader & { readonly id: string; readonly area?: string };

/** Badge words are fixed, so they need no checking against the font. */
const BADGE_FACE: FaceId = "inter-bold";

/**
 * The shared card frame: every card builder goes through it, once for all of
 * a diagram's cards. It tells `build` how wide each card must be to hold what
 * sits on its border, then adds the badge and strikes through a removed
 * card's title (the painter fades the rest).
 *
 * Once any card has something on its border, every card's box handed to ELK
 * grows upwards by half a badge: the band the status badge (top-right) and
 * the area tag (top-left) overhang. Giving it to every card keeps the outlines
 * of cards side by side lined up.
 */
export function frameCards<N extends Framed>(
  nodes: readonly N[],
  sizes: Sizes,
  build: (node: N, minWidth: number) => CardBody,
): Card[] {
  const top = nodes.some((node) => borderWidth(node, sizes) > 0) ? sizes.badge.height / 2 : 0;
  return nodes.map((node) => frameCard(node, top, sizes, build));
}

/** How wide a card must be to hold what sits on its top border; 0 when nothing does. */
function borderWidth(header: CardHeader, sizes: Sizes): number {
  return header.status === undefined ? 0 : measureBadge(header.status, sizes) + 2 * sizes.badge.inset;
}

function frameCard<N extends Framed>(node: N, top: number, sizes: Sizes, build: (node: N, minWidth: number) => CardBody): Card {
  const { id, status } = node;
  const minWidth = borderWidth(node, sizes);
  const body = build(node, minWidth);
  // A body narrower than its border needs sits centred in a wider box, so a badge never hangs off the card.
  const width = Math.max(body.width, minWidth);
  const at = { x: (width - body.width) / 2, y: top };
  const shift = <P extends Point>(p: P): P => ({ ...p, ...move(p, at) });
  const shiftText = (t: TextLine, struck: boolean): TextLine => {
    const moved = shift(t);
    const { underline } = t;
    return {
      ...moved,
      ...(underline ? { underline: { ...underline, x1: underline.x1 + at.x, x2: underline.x2 + at.x, y: underline.y + at.y } } : {}),
      ...(struck ? { strike: strikeThrough(moved, sizes) } : {}),
    };
  };

  return {
    id,
    kind: body.kind,
    ...(node.area === undefined ? {} : { area: node.area }),
    ...(status === undefined ? {} : { status }),
    width,
    height: top + body.height,
    outline: placeOutline(body.outline, { ...at, width: body.width, height: body.height }),
    marks: (body.marks ?? []).map((mark) => mark.map((p) => move(p, at))),
    fill: body.fill ?? "cardFill",
    tooltip: body.tooltip,
    texts: body.texts.map((t) => shiftText(t, status === "removed" && t.title === true)),
    dividers: (body.dividers ?? []).map((y) => y + top),
    rows: (body.rows ?? []).map((row) => ({
      ...row,
      box: shift(row.box),
      ...(row.symbol ? { symbol: shift(row.symbol) } : {}),
      texts: row.texts.map((t) => shiftText(t, row.status === "removed")),
      ...(row.badge ? { badge: { ...shift(row.badge), word: shift(row.badge.word) } } : {}),
    })),
    ...(body.more ? { more: shift(body.more) } : {}),
    ...(status === undefined ? {} : { badge: badge(status, badgeX(status, width, body.badge, sizes), top - sizes.badge.height / 2, sizes) }),
  };
}

/** Where the left end of a card's badge goes, kept at least the theme's inset inside the card's box. */
function badgeX(status: Status, width: number, place: BadgePlace | undefined, sizes: Sizes): number {
  const badgeWidth = measureBadge(status, sizes);
  if (place?.align === "middle") return (width - badgeWidth) / 2;
  return Math.max(sizes.badge.inset, width - (place?.inset ?? sizes.badge.inset) - badgeWidth);
}

/** A line through the middle of the letters of `t`, as wide as the text is drawn. */
export function strikeThrough(t: TextLine, sizes: Sizes): LevelLine {
  return levelLine(t, t.y - t.size * sizes.strike.rise);
}

/** A line just under the baseline of `t`, as wide as the text is drawn. */
export function underline(t: TextLine, sizes: Sizes): LevelLine {
  return levelLine(t, t.y + t.size * sizes.underline.drop);
}

function levelLine(t: TextLine, y: number): LevelLine {
  const width = measure(t.text, t.face, t.size);
  const x1 = t.anchor === "middle" ? t.x - width / 2 : t.x;
  return { x1, x2: x1 + width, y };
}

function badgeWord(status: Status): string {
  return status.toUpperCase();
}

/** How wide a status's badge is. */
export function measureBadge(status: Status, sizes: Sizes): number {
  const b = sizes.badge;
  return Math.ceil(measure(badgeWord(status), BADGE_FACE, b.fontSize) + 2 * b.paddingX);
}

/** A badge with its top-left corner at (x, y). Cards and the legend share it. */
export function badge(status: Status, x: number, y: number, sizes: Sizes): Badge {
  const b = sizes.badge;
  const width = measureBadge(status, sizes);
  return {
    status,
    x,
    y,
    width,
    height: b.height,
    word: {
      text: badgeWord(status),
      x: x + width / 2,
      y: y + baseline(BADGE_FACE, b.fontSize, b.height),
      face: BADGE_FACE,
      size: b.fontSize,
      anchor: "middle",
    },
  };
}
