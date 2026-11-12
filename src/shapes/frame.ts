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

/** What a card builder makes: the card's outline size and its contents, relative to the outline's top-left corner. */
export interface CardBody {
  readonly kind: "step";
  readonly width: number;
  readonly height: number;
  readonly tooltip: string;
  readonly texts: readonly TextLine[];
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
  readonly badge?: Badge;
}

/** What sits on a card's top border. */
export interface CardHeader {
  readonly status?: Status;
}

/** Badge words are fixed, so they need no checking against the font. */
const BADGE_FACE: FaceId = "inter-bold";

/**
 * The shared card frame: every card builder goes through it. It tells the
 * builder how wide the card must be to hold what sits on its border, then
 * adds the badge.
 *
 * With `band`, the box handed to ELK grows upwards by half a badge: the band
 * the status badge (top-right) and the area tag (top-left) overhang. It is
 * given to every card once any card has something on its border, so the
 * outlines of cards side by side still line up.
 */
export function frameCard(
  id: string,
  header: CardHeader,
  band: boolean,
  sizes: Sizes,
  build: (minWidth: number) => CardBody,
): Card {
  const { status } = header;
  const badgeWidth = status === undefined ? 0 : measureBadge(status, sizes);
  const body = build(status === undefined ? 0 : badgeWidth + 2 * sizes.badge.inset);
  const top = band ? sizes.badge.height / 2 : 0;
  const outline = { x: 0, y: top, width: body.width, height: body.height };

  return {
    id,
    kind: body.kind,
    ...(status === undefined ? {} : { status }),
    width: body.width,
    height: top + body.height,
    outline,
    tooltip: body.tooltip,
    texts: body.texts.map((t) => ({ ...t, y: t.y + top })),
    ...(status === undefined
      ? {}
      : { badge: badge(status, outline.width - sizes.badge.inset - badgeWidth, top - sizes.badge.height / 2, sizes) }),
  };
}

function badgeWord(status: Status): string {
  return status.toUpperCase();
}

function measureBadge(status: Status, sizes: Sizes): number {
  const b = sizes.badge;
  return Math.ceil(measure(badgeWord(status), BADGE_FACE, b.fontSize) + 2 * b.paddingX);
}

/** A badge with its top-left corner at (x, y). */
function badge(status: Status, x: number, y: number, sizes: Sizes): Badge {
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
