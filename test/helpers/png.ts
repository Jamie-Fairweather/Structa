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

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The left and right edges of the dark ink inside a region of a light
 * background, in pixels, found to a fraction of a pixel: where the ink seen
 * from each side first adds up to `ink` fully dark pixels. The same ink
 * drawn at a different position gives edges moved by just that much.
 */
export function inkEdges(picture: Picture, region: Region, ink = 4): { left: number; right: number } {
  const columns: number[] = [];
  for (let x = region.x; x < region.x + region.width; x++) {
    let sum = 0;
    for (let y = region.y; y < region.y + region.height; y++) {
      const at = 4 * (y * picture.width + x);
      sum += 1 - (picture.rgba[at]! + picture.rgba[at + 1]! + picture.rgba[at + 2]!) / (3 * 255);
    }
    columns.push(sum);
  }
  const edge = (order: readonly number[]): number => {
    let seen = 0;
    for (const [i, column] of order.entries()) {
      if (seen + column >= ink) return i + (ink - seen) / column;
      seen += column;
    }
    throw new Error("the region has less ink than asked for");
  };
  return { left: region.x + edge(columns), right: region.x + region.width - edge([...columns].reverse()) };
}

/** The red, green and blue of a #rrggbb colour. */
function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** The largest difference between two #rrggbb colours in any one channel. */
export function colourDifference(a: string, b: string): number {
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - y[i]!)));
}

function expectSameSize(a: Picture, b: Picture): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`the pictures differ in size: ${a.width} by ${a.height} px and ${b.width} by ${b.height} px`);
  }
}

/**
 * Where `picture` differs from `background`, a picture of the same size: white
 * where they match, darker the more they differ. Whatever one draws and the
 * other doesn't comes out as dark ink on white, whatever lay behind it.
 */
export function difference(picture: Picture, background: Picture): Picture {
  expectSameSize(picture, background);
  const rgba = new Uint8Array(picture.rgba.length);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : 255 - Math.abs(picture.rgba[i]! - background.rgba[i]!);
  return { width: picture.width, height: picture.height, rgba };
}

/** The smallest region, in pixels, holding every pixel two pictures of the same size differ in; undefined when they match. */
export function changedRegion(a: Picture, b: Picture): Region | undefined {
  expectSameSize(a, b);
  let [left, top, right, bottom] = [a.width, a.height, -1, -1];
  for (let at = 0; at < a.rgba.length; at += 4) {
    if ([0, 1, 2, 3].every((c) => a.rgba[at + c] === b.rgba[at + c])) continue;
    const [x, y] = [(at / 4) % a.width, Math.floor(at / 4 / a.width)];
    [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
  }
  return right < 0 ? undefined : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * How many pixels of ink in `colour` (#rrggbb) `picture` draws over
 * `background`, a picture of the same size without it: each pixel counts for
 * how far it has gone from the background's colour towards `colour`.
 */
export function inkArea(picture: Picture, background: Picture, colour: string): number {
  expectSameSize(picture, background);
  const ink = channels(colour);
  let area = 0;
  for (let at = 0; at < picture.rgba.length; at += 4) {
    let moved = 0;
    let full = 0;
    for (let c = 0; c < 3; c++) {
      moved += Math.abs(picture.rgba[at + c]! - background.rgba[at + c]!);
      full += Math.abs(ink[c]! - background.rgba[at + c]!);
    }
    if (moved === 0) continue;
    if (full === 0) throw new Error(`ink in ${colour} drawn over the same colour can't be measured`);
    area += moved / full;
  }
  return area;
}

/** The width and height an SVG's root element gives. */
export function svgSize(svg: string): { width: number; height: number } {
  const root = parseSvg(svg).documentElement!;
  return { width: Number(root.getAttribute("width")), height: Number(root.getAttribute("height")) };
}
