/**
 * Trims a TrueType font for shipping with HarfBuzz's subsetter (the wasm
 * build in the harfbuzzjs dev dependency; it never ships).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Every OpenType layout table: kerning, ligatures, contextual alternates and
 * their legacy and AAT forms. Without them every renderer draws exactly the
 * summed advance widths the width tables hold.
 */
export const LAYOUT_TABLES: readonly string[] = ["BASE", "GDEF", "GPOS", "GSUB", "JSTF", "MATH", "kern", "kerx", "mort", "morx"];

/** The WebAssembly constructors this file uses; the project's types (ES2022 and Node) don't declare them. */
interface WasmApi {
  readonly Module: new (bytes: Uint8Array) => unknown;
  readonly Instance: new (module: unknown, imports: object) => { readonly exports: unknown };
}

/** The parts of hb-subset's C API this file calls. Pointers are byte offsets into `memory`. */
interface HarfBuzz {
  readonly memory: { readonly buffer: ArrayBuffer };
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, which: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

// Values from HarfBuzz's hb-blob.h and hb-subset.h.
const HB_MEMORY_MODE_DUPLICATE = 0;
const SETS = { dropTableTag: 3, nameId: 4, nameLangId: 5, layoutFeatureTag: 6 } as const;
/** Keep name records on every platform, not only the Unicode ones. */
const HB_SUBSET_FLAGS_NAME_LEGACY = 0x08;
/** Keep the outline of glyph 0 (.notdef), so it stays as it was. */
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40;

let harfBuzz: HarfBuzz | undefined;

function loadHarfBuzz(): HarfBuzz {
  if (!harfBuzz) {
    const wasm = readFileSync(createRequire(import.meta.url).resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
    const { Module, Instance } = (globalThis as unknown as { WebAssembly: WasmApi }).WebAssembly;
    const instance = new Instance(new Module(wasm), {});
    const exports = instance.exports as unknown as HarfBuzz & { _initialize?: () => void };
    exports._initialize?.();
    harfBuzz = exports;
  }
  return harfBuzz;
}

function tag(name: string): number {
  return ((name.charCodeAt(0) << 24) | (name.charCodeAt(1) << 16) | (name.charCodeAt(2) << 8) | name.charCodeAt(3)) >>> 0;
}

/**
 * Cuts a TTF down to the code points in `ranges` (inclusive), drops every
 * OpenType layout table, and keeps every name record, so each face keeps its
 * family, weight and style names.
 */
export function trimFont(font: Uint8Array, ranges: readonly (readonly [number, number])[]): Uint8Array {
  const hb = loadHarfBuzz();
  const data = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, data);
  const blob = hb.hb_blob_create(data, font.byteLength, HB_MEMORY_MODE_DUPLICATE, 0, 0);
  hb.free(data);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) throw new Error("HarfBuzz couldn't start a subset");
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const [first, last] of ranges) {
    for (let codePoint = first; codePoint <= last; codePoint++) hb.hb_set_add(unicodes, codePoint);
  }
  const dropTables = hb.hb_subset_input_set(input, SETS.dropTableTag);
  for (const table of LAYOUT_TABLES) hb.hb_set_add(dropTables, tag(table));
  // The layout tables are dropped, so no feature may pull extra glyphs in.
  hb.hb_set_clear(hb.hb_subset_input_set(input, SETS.layoutFeatureTag));
  // Every name id in every language: an empty set, inverted.
  for (const which of [SETS.nameId, SETS.nameLangId]) {
    const set = hb.hb_subset_input_set(input, which);
    hb.hb_set_clear(set);
    hb.hb_set_invert(set);
  }
  hb.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NAME_LEGACY | HB_SUBSET_FLAGS_NOTDEF_OUTLINE);

  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  hb.hb_face_destroy(face);
  if (subset === 0) throw new Error("HarfBuzz couldn't subset the font");
  const result = hb.hb_face_reference_blob(subset);
  const bytes = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(result, 0), hb.hb_blob_get_length(result)).slice();
  hb.hb_blob_destroy(result);
  hb.hb_face_destroy(subset);
  return bytes;
}
