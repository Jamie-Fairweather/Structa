/**
 * A small reader for the parts of a TrueType file the build needs: the table
 * list, units per em, vertical metrics, per-character advance widths and the
 * name records.
 */
export interface TtfFont {
  readonly tables: readonly string[];
  readonly unitsPerEm: number;
  /** hhea ascender and descender, in font units (descender is negative). */
  readonly ascender: number;
  readonly descender: number;
  /** Advance of glyph 0 (.notdef), what a renderer draws for a missing character. */
  readonly missingAdvance: number;
  /** Every code point the font has a glyph for, in ascending order. */
  readonly characters: readonly number[];
  /** Every record in the name table, in table order. */
  readonly names: readonly NameRecord[];
  /** Advance width in font units, or undefined when the font has no glyph. */
  advance(codePoint: number): number | undefined;
}

export interface NameRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly languageId: number;
  readonly nameId: number;
  /** The string, decoded as UTF-16BE on the Unicode and Windows platforms and one byte per character otherwise. */
  readonly value: string;
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

  const { glyphOf, ranges } = readCmap(view, table("cmap"));
  const characters: number[] = [];
  for (const [first, last] of ranges) {
    for (let codePoint = first; codePoint <= last; codePoint++) {
      if (glyphOf(codePoint) !== 0) characters.push(codePoint);
    }
  }

  return {
    tables: [...tableOffsets.keys()].sort(),
    unitsPerEm,
    ascender,
    descender,
    missingAdvance: advanceOf(0),
    characters,
    names: readNames(view, table("name")),
    advance(codePoint) {
      const glyph = glyphOf(codePoint);
      return glyph === 0 ? undefined : advanceOf(glyph);
    },
  };
}

function readNames(view: DataView, name: number): NameRecord[] {
  const count = view.getUint16(name + 2);
  const strings = name + view.getUint16(name + 4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const record = name + 6 + i * 12;
    const platformId = view.getUint16(record);
    const length = view.getUint16(record + 8);
    const start = strings + view.getUint16(record + 10);
    const twoByte = platformId === 0 || platformId === 3;
    let value = "";
    for (let at = start; at < start + length; at += twoByte ? 2 : 1) {
      value += String.fromCharCode(twoByte ? view.getUint16(at) : view.getUint8(at));
    }
    records.push({
      platformId,
      encodingId: view.getUint16(record + 2),
      languageId: view.getUint16(record + 4),
      nameId: view.getUint16(record + 6),
      value,
    });
  }
  return records;
}

interface Cmap {
  /** The glyph id for a code point, 0 when the font has none. */
  readonly glyphOf: (codePoint: number) => number;
  /** The code point ranges (inclusive) the subtable covers; some may map to glyph 0. */
  readonly ranges: readonly (readonly [number, number])[];
}

/** Reads the best Unicode cmap subtable. */
function readCmap(view: DataView, cmap: number): Cmap {
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
    const ranges: [number, number][] = [];
    for (let g = 0; g < groups; g++) ranges.push([view.getUint32(sub + 16 + g * 12), view.getUint32(sub + 20 + g * 12)]);
    const glyphOf = (codePoint: number) => {
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
    return { glyphOf, ranges };
  }

  if (format4 !== undefined) {
    const sub = format4;
    const segCount = view.getUint16(sub + 6) / 2;
    const endCodes = sub + 14;
    const startCodes = endCodes + segCount * 2 + 2;
    const idDeltas = startCodes + segCount * 2;
    const idRangeOffsets = idDeltas + segCount * 2;
    const ranges: [number, number][] = [];
    for (let s = 0; s < segCount; s++) {
      // The last segment, ending at 0xFFFF, only closes the table.
      const end = Math.min(view.getUint16(endCodes + s * 2), 0xfffe);
      const start = view.getUint16(startCodes + s * 2);
      if (start <= end) ranges.push([start, end]);
    }
    const glyphOf = (codePoint: number) => {
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
    return { glyphOf, ranges };
  }

  throw new Error("font has no Unicode cmap subtable");
}
