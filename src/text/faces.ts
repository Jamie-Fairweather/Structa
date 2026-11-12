/** The six font faces Structa draws text in. */
export type FaceId =
  | "inter-regular"
  | "inter-semibold"
  | "inter-bold"
  | "inter-semibold-italic"
  | "mono-regular"
  | "mono-italic";

export interface FaceStyle {
  readonly id: FaceId;
  /** The family the font file's name records give, which the rasteriser and the build checks read. */
  readonly family: string;
  /**
   * The family an SVG's @font-face rules give the embedded face. Only Structa
   * uses it, so an SVG inlined into a web page can't take over the page's own
   * text in the plain family.
   */
  readonly embeddedFamily: string;
  /** CSS font-family list written into the SVG: the embedded face, the installed family, then a generic fallback. */
  readonly fontFamily: string;
  readonly weight: 400 | 600 | 700;
  readonly style: "normal" | "italic";
}

const INTER = {
  family: "Inter",
  embeddedFamily: "Structa Inter",
  fontFamily: "Structa Inter, Inter, sans-serif",
} as const;
const MONO = {
  family: "JetBrains Mono",
  embeddedFamily: "Structa JetBrains Mono",
  fontFamily: "Structa JetBrains Mono, JetBrains Mono, monospace",
} as const;

export const FACES: readonly FaceStyle[] = [
  { id: "inter-regular", ...INTER, weight: 400, style: "normal" },
  { id: "inter-semibold", ...INTER, weight: 600, style: "normal" },
  { id: "inter-bold", ...INTER, weight: 700, style: "normal" },
  { id: "inter-semibold-italic", ...INTER, weight: 600, style: "italic" },
  { id: "mono-regular", ...MONO, weight: 400, style: "normal" },
  { id: "mono-italic", ...MONO, weight: 400, style: "italic" },
];

/**
 * The one shared list of code-point ranges (inclusive) that Structa supports.
 * Width tables are filtered to it, and the font subset keeps exactly these.
 */
export const CHARACTER_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e], // Basic Latin (printable)
  [0x00a0, 0x00ff], // Latin-1 Supplement (printable)
  [0x0100, 0x017f], // Latin Extended-A
  [0x2010, 0x2015], // hyphens and dashes
  [0x2018, 0x201f], // quotes
  [0x2020, 0x2022], // daggers, bullet
  [0x2026, 0x2026], // ellipsis
  [0x2030, 0x2030], // per mille
  [0x2032, 0x2033], // primes
  [0x2039, 0x203a], // single angle quotes
  [0x20ac, 0x20ac], // euro
  [0x2122, 0x2122], // trade mark
  [0x2190, 0x2195], // arrows
  [0x21d0, 0x21d5], // double arrows
  [0x2212, 0x2212], // minus
  [0x221e, 0x221e], // infinity
  [0x2248, 0x2248], // almost equal
  [0x2260, 0x2260], // not equal
  [0x2264, 0x2265], // less/greater than or equal
];

/**
 * Metrics for one face as written by scripts/generate-fonts.ts.
 * Widths are advance widths in font units. `runs` lists consecutive code
 * points the face can draw: [first code point, widths...].
 */
export interface FaceMetricsData {
  readonly face: FaceId;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly missingAdvance: number;
  readonly runs: readonly (readonly [number, readonly number[]])[];
}
