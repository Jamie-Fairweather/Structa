import { describe, expect, it } from "vitest";
import { render, StructaError } from "../src/index";
import { colourDifference, decodePng, pixel, pngSize, svgSize } from "./helpers/png";
import { cardBox, cards, parseSvg } from "./helpers/svg";

const pottingOn = {
  type: "flow",
  nodes: [
    { id: "water", label: "Water the seedlings", shape: "step" },
    { id: "lift", label: "Lift each one by a leaf", shape: "step" },
    { id: "pot", label: "Pot it on into a bigger pot", shape: "step" },
  ],
  edges: [
    { from: "water", to: "lift" },
    { from: "lift", to: "pot" },
  ],
};

describe("PNG output", () => {
  it("returns a PNG that decodes, twice the SVG's size by default", async () => {
    const { svg, png } = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false });

    const picture = decodePng(png);
    const size = svgSize(svg);
    expect([picture.width, picture.height]).toEqual([size.width * 2, size.height * 2]);
  });

  it("returns only the png key, as a plain Uint8Array, when only png is asked for", async () => {
    const result = await render(pottingOn, { formats: ["png"] });

    expect(Object.keys(result)).toEqual(["png"]);
    expect(Object.getPrototypeOf(result.png)).toBe(Uint8Array.prototype);
  });

  it("draws the same PNG whether or not the SVG embeds its fonts, alone or beside the SVG", async () => {
    const embedded = await render(pottingOn, { formats: ["svg", "png"] });
    const plain = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false });
    const alone = await render(pottingOn, { formats: ["png"], embedFonts: false });

    expect(embedded.svg).not.toBe(plain.svg);
    expect(embedded.png).toEqual(plain.png);
    expect(alone.png).toEqual(plain.png);
  });

  it.each([
    ["light", "#f4f5f7", "#ffffff"],
    ["dark", "#0d1117", "#161b22"],
  ] as const)("draws the %s theme: its page and card colours", async (theme, page, card) => {
    const { svg, png } = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false, theme, scale: 1 });

    const picture = decodePng(png);
    const box = cardBox(cards(parseSvg(svg))[0]!);
    expect(pixel(picture, 0, 0)).toEqual({ color: page, alpha: 255 });
    // Inside the first card, past its rounded corner and above its text. The
    // card's shadow filter works in linear RGB, and the round trip back can
    // move a channel by one.
    const inside = pixel(picture, box.x + 12, box.y + 4);
    expect(inside.alpha).toBe(255);
    expect(colourDifference(inside.color, card)).toBeLessThanOrEqual(1);
  });

  it.each([1, 2, 3, 4])("makes the PNG exactly %i times the SVG's whole-pixel size", async (scale) => {
    const { svg, png } = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false, scale });

    const picture = decodePng(png);
    const size = svgSize(svg);
    expect([picture.width, picture.height]).toEqual([size.width * scale, size.height * scale]);
  });
});

/** A line of `length` short steps, left to right. */
function row(length: number) {
  const nodes = Array.from({ length }, (_, i) => ({ id: `stop${i}`, label: `Stop ${i + 1}`, shape: "step" }));
  const edges = nodes.slice(1).map((node, i) => ({ from: `stop${i}`, to: node.id }));
  return { type: "flow", direction: "right", nodes, edges };
}

/**
 * One step fanning out into `columns` columns of `rows` steps each. The
 * first column's labels are `firstColumn` with the tray's number in place of
 * #, which sets that column's width; the others are short.
 */
function seedTrays(columns: number, rows: number, firstColumn = "Tray #") {
  const nodes = [{ id: "tin", label: "Open the seed tin", shape: "step" }];
  const edges: { from: string; to: string }[] = [];
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const tray = `${c + 1}-${r + 1}`;
      nodes.push({ id: `tray${tray}`, label: (c === 0 ? firstColumn : "Tray #").replace("#", tray), shape: "step" });
      edges.push({ from: r === 0 ? "tin" : `tray${c + 1}-${r}`, to: `tray${tray}` });
    }
  }
  return { type: "flow", nodes, edges };
}

async function rejection(promise: Promise<unknown>): Promise<StructaError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  return error as StructaError;
}

describe("PNG size limits", () => {
  it("refuses a PNG with a side over 16,384 px with TOO_LARGE, and suggests a scale that fits", async () => {
    const { svg } = await render(row(25), { embedFonts: false });
    const { width, height } = svgSize(svg);
    expect(width * 4).toBeGreaterThan(16_384);
    expect(width * 3).toBeLessThanOrEqual(16_384);

    const error = await rejection(render(row(25), { formats: ["svg", "png"], scale: 4 }));

    expect(error.code).toBe("TOO_LARGE");
    expect(error.problems).toEqual([
      {
        path: "$",
        message: `the PNG would be ${width * 4} by ${height * 4} px, but neither side may be over 16384 px`,
        hint: "use a scale of 3 or less, or split the diagram",
      },
    ]);
  });

  it("draws a PNG with a side just under 16,384 px", async () => {
    const { svg, png } = await render(row(24), { formats: ["svg", "png"], embedFonts: false, scale: 4 });

    const { width, height } = svgSize(svg);
    expect(width * 4).toBeGreaterThan(16_000);
    expect(pngSize(png)).toEqual({ width: width * 4, height: height * 4 });
  });

  it("refuses a PNG of over 100,000,000 pixels with TOO_LARGE, even with both sides in the limit", async () => {
    const { svg } = await render(seedTrays(16, 26), { embedFonts: false });
    const { width, height } = svgSize(svg);
    const [w, h] = [width * 4, height * 4];
    expect(Math.max(w, h)).toBeLessThanOrEqual(16_384);

    const error = await rejection(render(seedTrays(16, 26), { formats: ["png"], scale: 4 }));

    expect(error.code).toBe("TOO_LARGE");
    expect(error.problems).toEqual([
      {
        path: "$",
        message: `the PNG would be ${w} by ${h} px, ${w * h} pixels in all, but it may have at most 100000000`,
        hint: "use a scale of 3 or less, or split the diagram",
      },
    ]);
  });

  it("reports both limits when a PNG breaks both", async () => {
    const { svg } = await render(seedTrays(30, 15), { embedFonts: false });
    const { width, height } = svgSize(svg);
    const [w, h] = [width * 4, height * 4];

    const error = await rejection(render(seedTrays(30, 15), { formats: ["png"], scale: 4 }));

    expect(error.code).toBe("TOO_LARGE");
    expect(error.problems).toEqual([
      {
        path: "$",
        message: `the PNG would be ${w} by ${h} px, but neither side may be over 16384 px`,
        hint: "use a scale of 3 or less, or split the diagram",
      },
      {
        path: "$",
        message: `the PNG would be ${w} by ${h} px, ${w * h} pixels in all, but it may have at most 100000000`,
        hint: "use a scale of 3 or less, or split the diagram",
      },
    ]);
  });

  it("asks for the diagram to be split when even scale 1 is too large", async () => {
    const { svg } = await render(row(100), { embedFonts: false });
    const { width, height } = svgSize(svg);

    const error = await rejection(render(row(100), { formats: ["png"], scale: 1 }));

    expect(error.code).toBe("TOO_LARGE");
    expect(error.problems).toEqual([
      {
        path: "$",
        message: `the PNG would be ${width} by ${height} px, but neither side may be over 16384 px`,
        hint: "split the diagram into smaller ones",
      },
    ]);
  });

  it("draws a PNG just under 100,000,000 pixels", { timeout: 120_000 }, async () => {
    // Tuned to come out just under the limit: if the layout or sizes change, retune the first column's label.
    const diagram = seedTrays(15, 24, "Sow tray # thinly");
    const { svg, png } = await render(diagram, { formats: ["svg", "png"], embedFonts: false, scale: 4 });

    const { width, height } = svgSize(svg);
    const pixels = width * 4 * height * 4;
    expect(pixels).toBeGreaterThan(99_500_000);
    expect(pixels).toBeLessThanOrEqual(100_000_000);
    expect(pngSize(png)).toEqual({ width: width * 4, height: height * 4 });
  });
});
