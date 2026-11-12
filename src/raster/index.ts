/**
 * Turns Structa's SVG into a PNG with resvg's WebAssembly build, drawing the
 * text with the same font files the width tables were read from.
 *
 * This is the only module that obtains the wasm. In source and test runs it
 * reads the package's index_bg.wasm from node_modules. The build injects
 * STRUCTA_RESVG_WASM, that same file brotli-compressed and base64-encoded,
 * and drops the `source:` statement, so structa.mjs carries the wasm inside.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { brotliDecompressSync } from "node:zlib";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { StructaError, type Problem } from "../errors";
import { FACES, fontFile } from "../text";

/** How many PNG pixels to draw per SVG pixel. render() and the CLI accept exactly these. */
export const SCALES = [1, 2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];
export const DEFAULT_SCALE: Scale = 2;

/** Set by the build (esbuild `define`); undeclared in source runs. */
declare const STRUCTA_RESVG_WASM: string | undefined;

/** resvg can be initialised only once per process, so every PNG render awaits this one promise. */
let ready: Promise<void> | undefined;

/**
 * Draws `svg`, which must carry no fonts of its own, as a PNG `scale` times
 * its size. The SVG's width and height are whole pixels, so the PNG is
 * exactly width × scale by height × scale.
 */
export async function rasterise(svg: string, scale: Scale): Promise<Uint8Array> {
  ready ??= (async () => initWasm(wasm()))();
  await ready;
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { fontBuffers: FACES.map(({ id }) => fontFile(id)) } });
  try {
    // resvg reads the SVG's own size before drawing anything.
    const tooLarge = sizeProblems(resvg.width, resvg.height, scale);
    if (tooLarge.length > 0) throw new StructaError("TOO_LARGE", tooLarge);
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}

/** The largest PNG drawn: no side over MAX_SIDE px, and no more than MAX_PIXELS in all. */
const MAX_SIDE = 16_384;
const MAX_PIXELS = 100_000_000;

/** What's wrong with drawing a `width` × `height` SVG at `scale`: one problem per limit it breaks. */
function sizeProblems(width: number, height: number, scale: Scale): Problem[] {
  const fits = (s: number) => width * s <= MAX_SIDE && height * s <= MAX_SIDE && width * s * height * s <= MAX_PIXELS;
  if (fits(scale)) return [];
  const smaller = SCALES.filter((s) => s < scale && fits(s)).at(-1);
  const hint = smaller === undefined ? "split the diagram into smaller ones" : `use a scale of ${smaller} or less, or split the diagram`;
  const [w, h] = [width * scale, height * scale];
  const size = `the PNG would be ${w} by ${h} px`;
  const problems: Problem[] = [];
  if (w > MAX_SIDE || h > MAX_SIDE) problems.push({ path: "$", message: `${size}, but neither side may be over ${MAX_SIDE} px`, hint });
  if (w * h > MAX_PIXELS) problems.push({ path: "$", message: `${size}, ${w * h} pixels in all, but it may have at most ${MAX_PIXELS}`, hint });
  return problems;
}

function wasm(): Uint8Array {
  source: if (typeof STRUCTA_RESVG_WASM === "undefined") {
    return readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"));
  }
  return brotliDecompressSync(Buffer.from(STRUCTA_RESVG_WASM!, "base64"));
}
