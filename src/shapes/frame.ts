import type { Status } from "../input";
import { baseline, measure, type FaceId } from "../text";
import type { Sizes, ThemeColors } from "../theme";

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
  readonly strike?: Strike;
}

export interface Strike {
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
  readonly kind: "property" | "method";
  readonly status?: Status;
  readonly tooltip: string;
  /** The band the row's tint fills when it has a status. */
  readonly box: Box;
  readonly texts: readonly TextLine[];
  readonly badge?: Badge;
}

/** What a card builder makes: the card's outline size and its contents, relative to the outline's top-left corner. */
export interface CardBody {
  readonly kind: "step" | "class";
  readonly width: number;
  readonly height: number;
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
  readonly status?: Status;
  readonly width: number;
  readonly height: number;
  /** The card's drawn outline inside its box: below the band its badge overhangs. */
  readonly outline: Box;
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
type Framed = CardHeader & { readonly id: string };

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
  // A body narrower than its border needs is widened, its contents centred, so a badge never hangs off the card.
  const width = Math.max(body.width, minWidth);
  const dx = (width - body.width) / 2;
  const outline = { x: 0, y: top, width, height: body.height };
  const move = <P extends { readonly x: number; readonly y: number }>(p: P): P => ({ ...p, x: p.x + dx, y: p.y + top });
  const moveText = (t: TextLine, struck: boolean): TextLine => {
    const moved = move(t);
    return struck ? { ...moved, strike: strikeThrough(moved, sizes) } : moved;
  };

  return {
    id,
    kind: body.kind,
    ...(status === undefined ? {} : { status }),
    width,
    height: top + body.height,
    outline,
    tooltip: body.tooltip,
    texts: body.texts.map((t) => moveText(t, status === "removed" && t.title === true)),
    dividers: (body.dividers ?? []).map((y) => y + top),
    rows: (body.rows ?? []).map((row) => ({
      ...row,
      box: move(row.box),
      texts: row.texts.map((t) => moveText(t, row.status === "removed")),
      ...(row.badge ? { badge: { ...move(row.badge), word: move(row.badge.word) } } : {}),
    })),
    ...(body.more ? { more: move(body.more) } : {}),
    ...(status === undefined
      ? {}
      : { badge: badge(status, width - sizes.badge.inset - measureBadge(status, sizes), top - sizes.badge.height / 2, sizes) }),
  };
}

/**
 * How far below the top of its box a card's drawn shape starts, `x` from the
 * box's left edge: the top of its badge where the badge is (following the
 * pill's rounded ends), otherwise its outline.
 */
export function topAt(card: Card, x: number): number {
  const { badge, outline } = card;
  if (!badge) return outline.y;
  const r = badge.height / 2;
  const dx = x - Math.min(Math.max(x, badge.x + r), badge.x + badge.width - r);
  if (Math.abs(dx) >= r) return outline.y;
  return Math.min(outline.y, badge.y + r - Math.sqrt(r * r - dx * dx));
}

/** A line through the middle of the letters of `t`, as wide as the text is drawn. */
export function strikeThrough(t: TextLine, sizes: Sizes): Strike {
  const width = measure(t.text, t.face, t.size);
  const x1 = t.anchor === "middle" ? t.x - width / 2 : t.x;
  return { x1, x2: x1 + width, y: t.y - t.size * sizes.strike.rise };
}

function badgeWord(status: Status): string {
  return status.toUpperCase();
}

function measureBadge(status: Status, sizes: Sizes): number {
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
