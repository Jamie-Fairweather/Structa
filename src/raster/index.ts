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

function wasm(): Uint8Array {
  source: if (typeof STRUCTA_RESVG_WASM === "undefined") {
    return readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"));
  }
  return brotliDecompressSync(Buffer.from(STRUCTA_RESVG_WASM!, "base64"));
}
