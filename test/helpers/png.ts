import { decode } from "fast-png";
import { parseSvg } from "./svg";

/** A decoded PNG as 8-bit RGBA pixels, row by row. */
export interface Picture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** Decodes PNG bytes, failing the test on anything that isn't a well-formed 8-bit RGBA PNG. */
export function decodePng(png: Uint8Array): Picture {
  const image = decode(png);
  if (image.depth !== 8 || image.channels !== 4) {
    throw new Error(`expected an 8-bit RGBA PNG, got ${image.depth}-bit with ${image.channels} channels`);
  }
  return { width: image.width, height: image.height, rgba: image.data as Uint8Array };
}

/** A PNG's size from its header alone, for pictures too big to decode quickly. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The colour of one pixel as #rrggbb, with its alpha. */
export function pixel(picture: Picture, x: number, y: number): { color: string; alpha: number } {
  const at = 4 * (y * picture.width + x);
  const hex = [0, 1, 2].map((i) => picture.rgba[at + i]!.toString(16).padStart(2, "0")).join("");
  return { color: `#${hex}`, alpha: picture.rgba[at + 3]! };
}

/** The width and height an SVG's root element gives. */
export function svgSize(svg: string): { width: number; height: number } {
  const root = parseSvg(svg).documentElement!;
  return { width: Number(root.getAttribute("width")), height: Number(root.getAttribute("height")) };
}
