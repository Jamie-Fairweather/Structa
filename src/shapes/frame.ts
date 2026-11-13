import { AREA_LABEL_FACE, STEREOTYPE_FACE, type ArchitectureKind, type ComponentKind, type FlowShape, type Status } from "../input";
import { baseline, measure, wrap, type FaceId } from "../text";
import type { Sizes, ThemeColors } from "../theme";
import { distanceToBox, entry, move, placeOutline, type Mark, type Outline, type OutlineShape, type Point } from "./outline";

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
  /**
   * Either side of the middle, the tag to its left and the badge to its
   * right, as either side of a diamond's top corner: lines meet the corner
   * between them. The border falls away `drop` px for every px out from the
   * middle, and each sits centred on it where it starts.
   */
  | { readonly align: "middle"; readonly drop: number };

/** The colour a card's outline is filled with. */
export type CardFill = keyof Pick<ThemeColors, "cardFill" | "noteFill">;

/**
 * What a card builder makes: the card's outline size and its contents,
 * relative to the outline's top-left corner. It should be at least the
 * `minWidth` the frame asks for; a narrower one sits centred in a wider box.
 * A builder whose text sits centred in its outline, as a flowchart shape's
 * does, is at least the `minHeight` asked for too; others keep the height
 * their contents need.
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
  /** Where on its box lines may meet the card, clear of its badge and tag. */
  readonly landing: Landing;
}

/**
 * Where on a card's box lines may meet it, clear of the badge and the tag on
 * its top border: across its top from `left` to `right`, and down its left
 * and right sides from `top` to `bottom`, all measured from the box's
 * top-left corner. Nothing sits on its bottom.
 */
export interface Landing {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /**
   * Whether any line meets the card's top. Layout spreads the lines on a
   * card's bottom over the same stretch as those on its top, so only then
   * does it keep them between `left` and `right`.
   */
  readonly onTop: boolean;
}

/**
 * How many line ends a card must leave room for: on its top, and on either
 * of its sides, the one that gets more.
 */
export interface LineEnds {
  readonly top: number;
  readonly sides: number;
}

/** What sits on a card's top border, and how many lines must find room beside it. */
interface CardHeader {
  readonly status?: Status;
  /** The name of the area the tag shows. */
  readonly tag?: string;
  /** How many line ends its top and sides must leave room for. */
  readonly lines: LineEnds;
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
 *
 * `lines` says how many line ends each card's top and sides must leave
 * room for. A card with a badge or a tag is wide enough to give those on its
 * top that room clear of both, and, when it can be, tall enough to give
 * those on its sides theirs.
 */
export function frameCards<N extends Framed>(
  nodes: readonly N[],
  sizes: Sizes,
  tagOf: (node: N) => string | undefined,
  lines: readonly LineEnds[],
  build: (node: N, minWidth: number, minHeight: number) => CardBody,
): Card[] {
  const headers = nodes.map((node, i): CardHeader => {
    const tag = tagOf(node);
    const ends = lines[i] ?? { top: 0, sides: 0 };
    return { ...(node.status === undefined ? {} : { status: node.status }), ...(tag === undefined ? {} : { tag }), lines: ends };
  });
  const top = headers.some((header) => header.status !== undefined || header.tag !== undefined) ? bandHeight(sizes) / 2 : 0;
  return nodes.map((node, i) => frameCard(node, headers[i]!, top, sizes, build));
}

/** How tall the badge and the tag are together: the band they take up across a card's top border. */
function bandHeight(sizes: Sizes): number {
  return Math.max(sizes.badge.height, sizes.tag.height);
}

/** How much of a card's top a number of lines needs, `pitch` apart and as far from what's either side of them; none for none. */
function landingRoom(lines: number, sizes: Sizes): number {
  return lines === 0 ? 0 : (lines + 1) * sizes.landing.pitch;
}

/**
 * How much of a card's side a number of lines needs: as on its top, but none
 * for one alone, which meets the side's middle however little room there is.
 */
function sideRoom(lines: number, sizes: Sizes): number {
  return lines < 2 ? 0 : landingRoom(lines, sizes);
}

/** The most times a card is built taller to make room on its sides: enough for a diamond, which grows less than it's asked to. */
const MAX_TALLER = 12;

/**
 * How wide a card must be to hold what sits on its top border, placed as
 * `place` says, with room for its lines beside them; 0 when nothing sits
 * there. Both ends keep at least the theme's inset; a body's own place only
 * moves where its tag starts. On a diamond's top corner, the tag and the
 * badge sit either side of the lines' room, so the wider of them sets both
 * halves.
 */
function borderWidth(header: CardHeader, place: BorderPlace | undefined, sizes: Sizes): number {
  const { status, tag } = header;
  if (status === undefined && tag === undefined) return 0;
  const inset = sizes.badge.inset;
  const { clearance } = sizes.landing;
  const tagWidth = tag === undefined ? 0 : measureTag(tag, sizes);
  const badgeWidth = status === undefined ? 0 : measureBadge(status, sizes);
  const room = landingRoom(header.lines.top, sizes);
  if (place?.align === "middle") return 2 * (room / 2 + clearance + Math.max(tagWidth, badgeWidth) + inset);
  const left = tag !== undefined && place?.align === "end" ? (place.tagInset ?? place.inset) : inset;
  const gap = status !== undefined && tag !== undefined ? sizes.tag.gap : 0;
  const packed = left + tagWidth + gap + badgeWidth + inset;
  if (room === 0) return packed;
  // The lines' room between the tag and the badge, or the end of the card where either is missing.
  const beforeRoom = tag === undefined ? 0 : left + tagWidth + clearance;
  const afterRoom = status === undefined ? 0 : clearance + badgeWidth + inset;
  return Math.max(packed, beforeRoom + room + afterRoom);
}

/**
 * One card. A card with a badge or a tag whose sides take lines is built
 * taller, if it can be, until its sides have room for them clear of both,
 * as its top does: or, for one line alone, until a line can meet a side at
 * all. A diamond needs this most, as its badge and tag sit down its edges.
 */
function frameCard<N extends Framed>(
  node: N,
  header: CardHeader,
  top: number,
  sizes: Sizes,
  build: (node: N, minWidth: number, minHeight: number) => CardBody,
): Card {
  const fitted = (minHeight: number) => {
    const body = build(node, borderWidth(header, undefined, sizes), minHeight);
    // The body's own place for the badge and tag may need more room: then it's built again, that wide.
    const minWidth = borderWidth(header, body.border, sizes);
    return body.width < minWidth ? build(node, minWidth, minHeight) : body;
  };
  let card = frameBody(node, header, top, fitted(0), sizes);
  const { sides } = header.lines;
  if (sides === 0 || (header.status === undefined && header.tag === undefined)) return card;
  for (let k = 0; k < MAX_TALLER; k++) {
    const short = sideRoom(sides, sizes) - (card.outline.height - 2 * sideDrop(card, sizes));
    if (short <= 0) break;
    const body = fitted(card.outline.height + Math.ceil(Math.min(short, card.outline.height)));
    if (body.height <= card.outline.height) break;
    card = frameBody(node, header, top, body, sizes);
  }
  return card;
}

/** A card round a built body, its outline `top` below the top of its box. */
function frameBody<N extends Framed>(node: N, header: CardHeader, top: number, body: CardBody, sizes: Sizes): Card {
  const { id } = node;
  const { status } = header;
  // A body narrower than its border needs sits centred in a wider box, so a badge never hangs off the card.
  const width = Math.max(body.width, borderWidth(header, body.border, sizes));
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

  const outline = placeOutline(body.outline, { ...at, width: body.width, height: body.height });
  const { overTop, ...items } = onBorder(header, node.area, width, top, body.border, sizes);
  // Down its sides, as far below the outline's top as above its bottom, so that a line alone meets a side's middle.
  const drop = Math.min(sideDrop({ outline, width, ...items }, sizes), body.height / 2);
  const landing: Landing = { ...overTop, top: top + drop, bottom: top + body.height - drop, onTop: header.lines.top > 0 };
  return {
    id,
    kind: body.kind,
    ...(node.area === undefined ? {} : { area: node.area }),
    ...(status === undefined ? {} : { status }),
    width,
    height: top + body.height,
    outline,
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
    ...items,
    landing,
    ...(body.header ? { header: { top: body.header.top + top, bottom: body.header.bottom + top } } : {}),
  };
}

/**
 * The badge and the tag on a card's top border, whose top is at `top` in a
 * box `width` wide, and where across its top lines may meet the card. The
 * badge stays at least the theme's inset inside the box, and clear of the
 * tag. On a diamond they sit either side of its top corner, with room
 * between them for the lines that meet it there, each centred on the
 * slanted edge where it starts.
 *
 * Lines meet the top at least the theme's clearance from the tag and the
 * badge, on a stretch centred on the card when there's room for them there,
 * as there is when the badge and the tag are short, and otherwise on all the
 * room between them.
 */
function onBorder(
  header: CardHeader,
  area: string | undefined,
  width: number,
  top: number,
  place: BorderPlace | undefined,
  sizes: Sizes,
): { badge?: Badge; tag?: Tag; overTop: { left: number; right: number } } {
  const { status, tag: label } = header;
  if (status === undefined && label === undefined) return { overTop: { left: 0, right: width } };
  const { clearance } = sizes.landing;
  const room = landingRoom(header.lines.top, sizes);
  const tagWidth = label === undefined ? 0 : measureTag(label, sizes);
  const badgeWidth = status === undefined ? 0 : measureBadge(status, sizes);
  const gap = label !== undefined && status !== undefined ? sizes.tag.gap : 0;
  let tagX: number;
  let badgeX: number;
  // Where the border runs under the badge and the tag: on a diamond, down its edges, where each starts.
  let border = top;
  let stretch: { left: number; right: number };
  if (place?.align === "middle") {
    const middle = width / 2;
    const out = room / 2 + clearance;
    tagX = middle - out - tagWidth;
    badgeX = middle + out;
    border = top + place.drop * out;
    stretch = { left: middle - room / 2, right: middle + room / 2 };
  } else {
    const inset = place?.inset ?? sizes.badge.inset;
    tagX = place?.tagInset ?? inset;
    badgeX = Math.max(label === undefined ? sizes.badge.inset : tagX + tagWidth + gap, width - inset - badgeWidth);
    const from = label === undefined ? 0 : tagX + tagWidth + clearance;
    const to = status === undefined ? width : badgeX - clearance;
    stretch = across(from, to, width, room);
  }
  return {
    ...(status === undefined ? {} : { badge: badge(status, badgeX, border - sizes.badge.height / 2, sizes) }),
    ...(label === undefined || area === undefined ? {} : { tag: tag(area, label, tagX, border - sizes.tag.height / 2, sizes) }),
    overTop: stretch,
  };
}

/**
 * How far below the top of its outline, and as far above its bottom, lines
 * may meet a card's sides: so that a level line in from either side of the
 * card's box anywhere between, run on until it meets the outline, keeps the
 * theme's clearance from the badge and the tag. Where a pill's ends, a box's
 * rounded corners or a diamond's edges curve or slant in under them, a line
 * would run on close to them, or into them; one coming in above them keeps
 * clear, but not those just under it. 0 on a card with neither, and
 * infinitely far when even a line to the middle of a side doesn't keep clear.
 */
function sideDrop({ outline, width, badge, tag }: Pick<Card, "outline" | "width" | "badge" | "tag">, sizes: Sizes): number {
  const boxes = [badge, tag].filter((box) => box !== undefined);
  if (boxes.length === 0) return 0;
  const { clearance } = sizes.landing;
  // Each side of the box, and a point further in from it.
  const sides: readonly (readonly [number, number])[] = [
    [0, 1],
    [width, width - 1],
  ];
  const clear = (drop: number) => {
    const y = outline.y + drop;
    return sides.every(([x, inward]) => {
      const met = entry({ outline }, { x, y }, { x: inward, y });
      return met === undefined || boxes.every((box) => distanceToBox({ x, y }, met, box) >= clearance);
    });
  };
  // A line every pixel down the outline: lines too close to the badge or the tag come many pixels together.
  const { height } = outline;
  const steps = Math.ceil(height);
  const step = height / steps;
  const fromEnd = (drop: number) => Math.min(drop, height - drop);
  let worst: number | undefined;
  for (let k = 0; k <= steps; k++) {
    const drop = k * step;
    if (!clear(drop) && (worst === undefined || fromEnd(drop) > fromEnd(worst))) worst = drop;
  }
  if (worst === undefined) return 0;
  // The line furthest from the outline's ends that doesn't keep clear, and the next one toward the middle, which does.
  const lower = worst > height / 2;
  let [close, clearOf] = [worst, worst + (lower ? -step : step)];
  if (lower ? clearOf < height / 2 : clearOf > height / 2) return Number.POSITIVE_INFINITY;
  for (let k = 0; k < 20; k++) {
    const middle = (close + clearOf) / 2;
    if (clear(middle)) clearOf = middle;
    else close = middle;
  }
  // To the hundredth of a pixel, so ELK gets plain numbers.
  return Math.ceil(fromEnd(clearOf) * 100) / 100;
}

/**
 * The stretch across a card `width` wide where its lines meet it, within the
 * free stretch from `from` to `to`: centred on the card when `room` fits
 * there, otherwise all of it. Where nothing is free, a point midway.
 */
function across(from: number, to: number, width: number, room: number): { left: number; right: number } {
  const half = Math.min(width / 2 - from, to - width / 2);
  if (half >= 0 && 2 * half >= room) return { left: width / 2 - half, right: width / 2 + half };
  if (to >= from) return { left: from, right: to };
  return { left: (from + to) / 2, right: (from + to) / 2 };
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
