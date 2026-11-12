import { FONT_DATA_URLS } from "../../generated/font-files";
import { FONT_METRICS } from "../../generated/font-metrics";
import { CHARACTER_RANGES, FACES, type FaceId, type FaceStyle } from "./faces";

export { FACES } from "./faces";
export type { FaceId, FaceStyle } from "./faces";

interface FaceTable {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly missingAdvance: number;
  readonly widths: ReadonlyMap<number, number>;
}

const TABLES: ReadonlyMap<FaceId, FaceTable> = (() => {
  const tables = new Map<FaceId, FaceTable>();
  for (const data of FONT_METRICS) {
    const widths = new Map<number, number>();
    for (const [first, advances] of data.runs) advances.forEach((w, i) => widths.set(first + i, w));
    tables.set(data.face, { ...data, widths });
  }
  for (const { id } of FACES) {
    if (!tables.has(id)) throw new Error(`no font metrics for ${id}: run "bun run generate"`);
  }
  return tables;
})();

function table(face: FaceId): FaceTable {
  return TABLES.get(face)!;
}

export function faceStyle(face: FaceId): FaceStyle {
  return FACES.find((f) => f.id === face)!;
}

/** The face's font file, the same one the width tables were read from, as a `data:font/ttf;base64,` URL. */
export function fontDataUrl(face: FaceId): string {
  const url = FONT_DATA_URLS.get(face);
  if (url === undefined) throw new Error(`no font file for ${face}: run "bun run generate"`);
  return url;
}

/** A text field may use only characters every face it is drawn in has in its width table. */
function drawnByAll(codePoint: number, faces: readonly FaceId[]): boolean {
  return faces.every((face) => table(face).widths.has(codePoint));
}

/** The distinct characters in `text` that at least one of `faces` can't draw, in order of first appearance. */
export function undrawable(text: string, faces: readonly FaceId[]): string[] {
  const found = new Set<string>();
  for (const ch of text) {
    if (!found.has(ch) && !drawnByAll(ch.codePointAt(0)!, faces)) found.add(ch);
  }
  return [...found];
}

/**
 * The characters every one of `faces` can draw, as inclusive code-point
 * ranges in ascending order: exactly what `undrawable` lets through.
 */
export function drawableRanges(faces: readonly FaceId[]): [first: number, last: number][] {
  const ranges: [number, number][] = [];
  // The width tables hold only characters from these ranges.
  for (const [first, last] of CHARACTER_RANGES) {
    for (let codePoint = first; codePoint <= last; codePoint++) {
      if (!drawnByAll(codePoint, faces)) continue;
      const previous = ranges.at(-1);
      if (previous && previous[1] === codePoint - 1) previous[1] = codePoint;
      else ranges.push([codePoint, codePoint]);
    }
  }
  return ranges;
}

/** Width of `text` in px: the sum of its advance widths, with no kerning. */
export function measure(text: string, face: FaceId, size: number): number {
  const t = table(face);
  let units = 0;
  for (const ch of text) units += t.widths.get(ch.codePointAt(0)!) ?? t.missingAdvance;
  return (units * size) / t.unitsPerEm;
}

/**
 * Distance from the top of a line box to the text baseline, so the face's
 * ascender-to-descender box sits centred in the line.
 */
export function baseline(face: FaceId, size: number, lineHeight: number): number {
  const t = table(face);
  const ascent = (t.ascender * size) / t.unitsPerEm;
  const descent = (-t.descender * size) / t.unitsPerEm;
  return (lineHeight - ascent - descent) / 2 + ascent;
}

const EPSILON = 1e-6;
const BREAK_AFTER = new Set([" ", ",", ";", ")", "]", "}"]);

/**
 * Splits `text` into lines no wider than `width`. Lines break after spaces,
 * commas, semicolons and closing brackets; a token that fits nowhere is broken
 * at the last character that fits. Nothing is ever dropped except the spaces
 * a line breaks at.
 */
export function wrap(text: string, face: FaceId, size: number, width: number): string[] {
  const fits = (s: string) => measure(s.trimEnd(), face, size) <= width + EPSILON;

  const segments: string[] = [];
  let segment = "";
  for (const ch of text) {
    segment += ch;
    if (BREAK_AFTER.has(ch)) {
      segments.push(segment);
      segment = "";
    }
  }
  if (segment) segments.push(segment);

  const lines: string[] = [];
  let line = "";
  for (const next of segments) {
    if (fits(line + next)) {
      line += next;
      continue;
    }
    if (line.trim()) lines.push(line.trimEnd());
    let rest = next.trimStart();
    while (!fits(rest)) {
      const head = longestFittingPrefix(rest, face, size, width);
      lines.push(head);
      rest = rest.slice(head.length);
    }
    line = rest;
  }
  if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}

/** The longest prefix of `text` that fits in `width`, but always at least one character. */
function longestFittingPrefix(text: string, face: FaceId, size: number, width: number): string {
  let prefix = "";
  for (const ch of text) {
    if (prefix && measure(prefix + ch, face, size) > width + EPSILON) break;
    prefix += ch;
  }
  return prefix;
}
