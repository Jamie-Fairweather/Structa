/**
 * A small reader for the parts of a TrueType file the build needs: the table
 * list, units per em, vertical metrics and per-character advance widths.
 */
export interface TtfFont {
  readonly tables: readonly string[];
  readonly unitsPerEm: number;
  /** hhea ascender and descender, in font units (descender is negative). */
  readonly ascender: number;
  readonly descender: number;
  /** Advance of glyph 0 (.notdef), what a renderer draws for a missing character. */
  readonly missingAdvance: number;
  /** Advance width in font units, or undefined when the font has no glyph. */
  advance(codePoint: number): number | undefined;
}

export function readTtf(bytes: Uint8Array): TtfFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new Error("not a TrueType font");
  }

  const tableOffsets = new Map<string, number>();
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    tableOffsets.set(tag, view.getUint32(record + 8));
  }
  const table = (tag: string): number => {
    const offset = tableOffsets.get(tag);
    if (offset === undefined) throw new Error(`font has no ${tag} table`);
    return offset;
  };

  const unitsPerEm = view.getUint16(table("head") + 18);
  const hhea = table("hhea");
  const ascender = view.getInt16(hhea + 4);
  const descender = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);
  const hmtx = table("hmtx");
  const advanceOf = (glyph: number): number =>
    view.getUint16(hmtx + 4 * Math.min(glyph, numberOfHMetrics - 1));

  const glyphOf = readCmap(view, table("cmap"));

  return {
    tables: [...tableOffsets.keys()].sort(),
    unitsPerEm,
    ascender,
    descender,
    missingAdvance: advanceOf(0),
    advance(codePoint) {
      const glyph = glyphOf(codePoint);
      return glyph === 0 ? undefined : advanceOf(glyph);
    },
  };
}

/** Returns a code point to glyph id lookup from the best Unicode cmap subtable. */
function readCmap(view: DataView, cmap: number): (codePoint: number) => number {
  const count = view.getUint16(cmap + 2);
  let format4: number | undefined;
  let format12: number | undefined;
  for (let i = 0; i < count; i++) {
    const record = cmap + 4 + i * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const subtable = cmap + view.getUint32(record + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = view.getUint16(subtable);
    if (format === 12) format12 ??= subtable;
    if (format === 4) format4 ??= subtable;
  }

  if (format12 !== undefined) {
    const sub = format12;
    const groups = view.getUint32(sub + 12);
    return (codePoint) => {
      for (let g = 0; g < groups; g++) {
        const group = sub + 16 + g * 12;
        const start = view.getUint32(group);
        const end = view.getUint32(group + 4);
        if (codePoint >= start && codePoint <= end) {
          return view.getUint32(group + 8) + (codePoint - start);
        }
      }
      return 0;
    };
  }

  if (format4 !== undefined) {
    const sub = format4;
    const segCount = view.getUint16(sub + 6) / 2;
    const endCodes = sub + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    return (codePoint) => {
      if (codePoint > 0xffff) return 0;
      for (let s = 0; s < segCount; s++) {
        const end = view.getUint16(endCodes + s * 2);
        if (codePoint > end) continue;
        const start = view.getUint16(startCodes + s * 2);
        if (codePoint < start) return 0;
        const delta = view.getInt16(idDeltas + s * 2);
        const rangeOffsetAt = idRangeOffsets + s * 2;
        const rangeOffset = view.getUint16(rangeOffsetAt);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = view.getUint16(rangeOffsetAt + rangeOffset + (codePoint - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }

  throw new Error("font has no Unicode cmap subtable");
}
