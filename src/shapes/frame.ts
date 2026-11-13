import { AREA_LABEL_FACE, STEREOTYPE_FACE, type ArchitectureKind, type ComponentKind, type FlowShape, type Status } from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
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

/** An area's name in a chip with slightly rounded corners, in neutral colours: areas have none of their own. */
export interface Tag extends Box {
  /** The area's id. */
  readonly area: string;
  readonly radius: number;
  readonly word: Omit<TextLine, "color">;
}

/**
 * A row inside a card, such as a class member, with its own tooltip, status
 * and data attributes. The frame strikes through a removed row's text.
 */
export interface Row {
  readonly id: string;
  readonly kind: "property" | "method" | "value" | "column";
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

/** A component's icon: its kind's, drawn in a square `size` px across with its top-left corner at (x, y). */
export interface Icon {
  readonly name: ComponentKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Where a card's status badge and area tag sit on its top border. */
export type BorderPlace =
  /**
   * The badge toward the right-hand end, `inset` px in from it, and the tag
   * toward the left-hand end, `tagInset` px in from it (`inset` when not given).
   */
  | { readonly align: "end"; readonly inset: number; readonly tagInset?: number }
  /** Centred together, the tag then the badge, as on the top corner of a diamond. */
  | { readonly align: "middle" };

/** The colour a card's outline is filled with. */
export type CardFill = keyof Pick<ThemeColors, "cardFill" | "noteFill">;

/**
 * What a card builder makes: the card's outline size and its contents,
 * relative to the outline's top-left corner. It should be at least the
 * `minWidth` the frame asks for; a narrower one sits centred in a wider box.
 */
export interface CardBody {
  readonly kind: FlowShape | ArchitectureKind | "table";
  readonly width: number;
  readonly height: number;
  readonly outline: OutlineShape;
  readonly marks?: readonly Mark[];
  readonly fill?: CardFill;
  /** Default: toward the ends, the theme's inset in from them. */
  readonly border?: BorderPlace;
  readonly tooltip: string;
  readonly icon?: Icon;
  readonly texts: readonly TextLine[];
  /** Thin lines right across the card between its sections, at these heights. */
  readonly dividers?: readonly number[];
  readonly rows?: readonly Row[];
  /** The muted "… N more" line after the rows, for rows left out on purpose. */
  readonly more?: TextLine;
  /**
   * The card's header, its name and description, from its top down to its
   * first divider: where on its sides a line that names no row attaches.
   * Only cards whose lines attach at fixed points, such as tables, have one.
   */
  readonly header?: Span;
}

/** A stretch of a card from `top` down to `bottom`. */
export interface Span {
  readonly top: number;
  readonly bottom: number;
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
  readonly icon?: Icon;
  readonly texts: readonly TextLine[];
  readonly dividers: readonly number[];
  readonly rows: readonly Row[];
  readonly more?: TextLine;
  readonly badge?: Badge;
  /** The tag naming the card's innermost area, when tags are shown. */
  readonly tag?: Tag;
  /** As in CardBody, measured from the top of the card's box. */
  readonly header?: Span;
}

/** What sits on a card's top border. */
interface CardHeader {
  readonly status?: Status;
  /** The name of the area the tag shows. */
  readonly tag?: string;
}

/** A node the frame can build a card from. */
interface Framed {
  readonly id: string;
  readonly status?: Status;
  /** The id of the innermost area the card is in. */
  readonly area?: string;
}

/** Badge words are fixed, so they need no checking against the font. */
const BADGE_FACE: FaceId = "inter-bold";

/**
 * The shared card frame: every card builder goes through it, once for all of
 * a diagram's cards. It tells `build` how wide each card must be to hold what
 * sits on its border, then adds the badge and the tag, and strikes through a
 * removed card's title (the painter fades the rest). `tagOf` gives the name a
 * card's tag shows, if it has one.
 *
 * Once any card has something on its border, every card's box handed to ELK
 * grows upwards by half a badge: the band the status badge (top-right) and
 * the area tag (top-left) overhang. Giving it to every card keeps the outlines
 * of cards side by side lined up.
 */
export function frameCards<N extends Framed>(
  nodes: readonly N[],
  sizes: Sizes,
  tagOf: (node: N) => string | undefined,
  build: (node: N, minWidth: number) => CardBody,
): Card[] {
  const headers = nodes.map((node): CardHeader => {
    const tag = tagOf(node);
    return { ...(node.status === undefined ? {} : { status: node.status }), ...(tag === undefined ? {} : { tag }) };
  });
  const band = Math.max(sizes.badge.height, sizes.tag.height);
  const top = headers.some((header) => borderWidth(header, undefined, sizes) > 0) ? band / 2 : 0;
  return nodes.map((node, i) => frameCard(node, headers[i]!, top, sizes, build));
}

/**
 * How wide a card must be to hold what sits on its top border, placed as
 * `place` says; 0 when nothing does. Both ends keep at least the theme's
 * inset; a body's own place only moves where its tag starts.
 */
function borderWidth(header: CardHeader, place: BorderPlace | undefined, sizes: Sizes): number {
  const { status, tag } = header;
  if (status === undefined && tag === undefined) return 0;
  const inset = sizes.badge.inset;
  const widths = (status === undefined ? 0 : measureBadge(status, sizes)) + (tag === undefined ? 0 : measureTag(tag, sizes));
  const gap = status !== undefined && tag !== undefined ? sizes.tag.gap : 0;
  const left = tag !== undefined && place?.align === "end" ? (place.tagInset ?? place.inset) : inset;
  return left + widths + gap + inset;
}

function frameCard<N extends Framed>(
  node: N,
  header: CardHeader,
  top: number,
  sizes: Sizes,
  build: (node: N, minWidth: number) => CardBody,
): Card {
  const { id } = node;
  const { status } = header;
  let body = build(node, borderWidth(header, undefined, sizes));
  // The body's own place for the badge and tag may need more room: then it's built again, that wide.
  const minWidth = borderWidth(header, body.border, sizes);
  if (body.width < minWidth) body = build(node, minWidth);
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
    ...(body.icon ? { icon: shift(body.icon) } : {}),
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
    ...onBorder(header, node.area, width, top, body.border, sizes),
    ...(body.header ? { header: { top: body.header.top + top, bottom: body.header.bottom + top } } : {}),
  };
}

/**
 * The badge and the tag on a card's top border, centred on it at `top`, in a
 * box `width` wide. The badge stays at least the theme's inset inside the
 * box, and clear of the tag.
 */
function onBorder(
  { status, tag: label }: CardHeader,
  area: string | undefined,
  width: number,
  top: number,
  place: BorderPlace | undefined,
  sizes: Sizes,
): { badge?: Badge; tag?: Tag } {
  const tagWidth = label === undefined ? 0 : measureTag(label, sizes);
  const badgeWidth = status === undefined ? 0 : measureBadge(status, sizes);
  const gap = label !== undefined && status !== undefined ? sizes.tag.gap : 0;
  let tagX: number;
  let badgeX: number;
  if (place?.align === "middle") {
    tagX = (width - (tagWidth + gap + badgeWidth)) / 2;
    badgeX = tagX + tagWidth + gap;
  } else {
    const inset = place?.inset ?? sizes.badge.inset;
    tagX = place?.tagInset ?? inset;
    badgeX = Math.max(label === undefined ? sizes.badge.inset : tagX + tagWidth + gap, width - inset - badgeWidth);
  }
  return {
    ...(status === undefined ? {} : { badge: badge(status, badgeX, top - sizes.badge.height / 2, sizes) }),
    ...(label === undefined || area === undefined ? {} : { tag: tag(area, label, tagX, top - sizes.tag.height / 2, sizes) }),
  };
}

/**
 * The top of a standard card, such as a class or a table, `width` wide: any
 * «stereotype» as a muted line, then its name centred, and any description
 * muted under it, with padding above and below. It ends at `bottom`, where
 * the card's first divider goes.
 */
export function cardHead(
  label: string,
  nameFace: FaceId,
  description: string | undefined,
  descriptionFace: FaceId,
  width: number,
  sizes: Sizes,
  stereotype?: string,
): { texts: TextLine[]; bottom: number } {
  const c = sizes.standardCard;
  const texts: TextLine[] = [];
  let y: number = c.paddingY;
  if (stereotype !== undefined) {
    const line = centred(`«${stereotype}»`, STEREOTYPE_FACE, c.stereotypeSize, c.stereotypeLineHeight, y, width, sizes);
    texts.push(...line.texts.map((t): TextLine => ({ ...t, color: "mutedText" })));
    y = line.bottom;
  }
  const name = centred(label, nameFace, c.nameSize, c.nameLineHeight, y, width, sizes);
  texts.push(...name.texts.map((t): TextLine => ({ ...t, color: "text", title: true })));
  y = name.bottom;
  if (description !== undefined) {
    const top = y + c.descriptionGap;
    const lines = centred(description, descriptionFace, c.descriptionSize, c.descriptionLineHeight, top, width, sizes);
    texts.push(...lines.texts.map((t): TextLine => ({ ...t, color: "mutedText" })));
    y = lines.bottom;
  }
  return { texts, bottom: y + c.paddingY };
}

/** `text` wrapped to a card `width` wide and centred on it, its lines from `top` down. */
function centred(text: string, face: FaceId, size: number, lineHeight: number, top: number, width: number, sizes: Sizes) {
  const lines = wrap(text, face, size, width - 2 * sizes.standardCard.paddingX);
  const offset = baseline(face, size, lineHeight);
  return {
    texts: lines.map((line, i) => ({ text: line, x: width / 2, y: top + i * lineHeight + offset, face, size, anchor: "middle" as const })),
    bottom: top + lines.length * lineHeight,
  };
}

/**
 * The muted "… N more" line, placed like a one-line row from `top` down, in
 * line with the rows' text, in the face the rows are drawn in.
 */
export function moreLine(count: number, top: number, textX: number, face: FaceId, sizes: Sizes): TextLine {
  const r = sizes.row;
  const y = top + r.paddingY + baseline(face, r.fontSize, r.lineHeight);
  return { text: `… ${count} more`, x: textX, y, face, size: r.fontSize, anchor: "start", color: "mutedText" };
}

/**
 * The band a row's tint fills: the row from `top` down, `height` tall, inset
 * from the sides of a card `width` wide. A tint never quite touches the next
 * row's, so a run of rows with a status reads as separate rows.
 */
export function rowBand(top: number, height: number, width: number, sizes: Sizes): Box {
  const r = sizes.row;
  return { x: r.tintInset, y: top + r.tintGap / 2, width: width - 2 * r.tintInset, height: height - r.tintGap };
}

/**
 * A row's badge, ending at `right`, for a row from `top`. It's centred on the
 * row's first line, so it stays level with the row's start when the text wraps.
 */
export function rowBadge(status: Status, right: number, top: number, sizes: Sizes): Badge {
  const r = sizes.row;
  return badge(status, right - measureBadge(status, sizes), top + r.paddingY + (r.lineHeight - sizes.badge.height) / 2, sizes);
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

/** A card's text, wrapped: its lines from the top of the block, and the block's size. */
export interface TextBlock {
  readonly width: number;
  readonly height: number;
  /** Baselines are relative to the top of the block; x is 0, the block's centre line. */
  readonly lines: readonly TextLine[];
}

/** Text wrapped to `wrapWidth` and centred on x = 0, its baselines from y = 0 down. */
export function paragraph(
  text: string,
  face: FaceId,
  { fontSize: size, lineHeight }: { readonly fontSize: number; readonly lineHeight: number },
  color: TextLine["color"],
  wrapWidth: number,
): TextBlock {
  const lines = wrap(text, face, size, wrapWidth);
  const offset = baseline(face, size, lineHeight);
  return {
    width: Math.max(...lines.map((line) => measure(line, face, size))),
    height: lines.length * lineHeight,
    lines: lines.map((line, i) => ({ text: line, x: 0, y: i * lineHeight + offset, face, size, anchor: "middle", color })),
  };
}

/** A width for `natural`, rounded up and kept between `min` and `max`, but never under `minWidth`. */
export function fit(natural: number, min: number, max: number, minWidth: number): number {
  return Math.max(minWidth, Math.min(max, Math.max(min, Math.ceil(natural))));
}

function badgeWord(status: Status): string {
  return status.toUpperCase();
}

/** How wide a status's badge is. */
export function measureBadge(status: Status, sizes: Sizes): number {
  const b = sizes.badge;
  return Math.ceil(measure(badgeWord(status), BADGE_FACE, b.fontSize) + 2 * b.paddingX);
}

/** How wide the tag showing an area named `label` is. */
export function measureTag(label: string, sizes: Sizes): number {
  const t = sizes.tag;
  return Math.ceil(measure(label, AREA_LABEL_FACE, t.fontSize) + 2 * t.paddingX);
}

/** The tag of the area `area`, named `label`, with its top-left corner at (x, y). Cards and the legend share it. */
export function tag(area: string, label: string, x: number, y: number, sizes: Sizes): Tag {
  const t = sizes.tag;
  const width = measureTag(label, sizes);
  return {
    area,
    x,
    y,
    width,
    height: t.height,
    radius: t.radius,
    word: {
      text: label,
      x: x + width / 2,
      y: y + baseline(AREA_LABEL_FACE, t.fontSize, t.height),
      face: AREA_LABEL_FACE,
      size: t.fontSize,
      anchor: "middle",
    },
  };
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
