import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { readTtf } from "../scripts/lib/ttf";
import { render, StructaError } from "../src/index";
import { colourDifference, decodePng, inkEdges, pixel, pngSize, svgSize, type Region } from "./helpers/png";
import { byClassIn, cardBox, cards, fontFaceRules, parseSvg } from "./helpers/svg";

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

describe("text in PNGs", () => {
  const SCALE = 4;
  const oneStep = (label: string) => ({ type: "flow", nodes: [{ id: "step", label, shape: "step" }] });
  const oneRow = (text: string) => ({ type: "class", nodes: [{ id: "card", label: "Sample", methods: [{ text }] }] });

  /**
   * How wide `text` is drawn in the PNG of `diagram`, in SVG px, from the
   * left edge of its ink to the right; and how wide the font the SVG embeds
   * for its face says the text is, from its advance widths. `region` is where
   * the text is the only thing drawn, on the plain card fill, in SVG px.
   */
  async function drawn(diagram: object, text: string, region: (card: Element) => Region): Promise<{ ink: number; advances: number }> {
    const { svg, png } = await render(diagram, { formats: ["svg", "png"], scale: SCALE });
    const doc = parseSvg(svg);
    // Drawn on one line: the text is a single <text> element.
    const found = Array.from(doc.getElementsByTagName("text")).filter((t) => t.textContent === text);
    expect(found).toHaveLength(1);
    const t = found[0]!;
    const face = [t.getAttribute("font-family")!.split(",")[0], t.getAttribute("font-weight"), t.getAttribute("font-style") || "normal"].join(" ");
    const rule = fontFaceRules(doc).find((r) => r.face === face);
    const font = readTtf(Buffer.from(/base64,([^"]+)"/.exec(rule!.src)![1]!, "base64"));
    const size = Number(t.getAttribute("font-size"));
    const advances = [...text].reduce((sum, ch) => sum + font.advance(ch.codePointAt(0)!)!, 0) * (size / font.unitsPerEm);

    // The region in whole PNG pixels, rounded inwards.
    const box = region(cards(doc)[0]!);
    const [x, y] = [Math.ceil(box.x * SCALE), Math.ceil(box.y * SCALE)];
    const scaled = { x, y, width: Math.floor((box.x + box.width) * SCALE) - x, height: Math.floor((box.y + box.height) * SCALE) - y };
    const { left, right } = inkEdges(decodePng(png), scaled);
    return { ink: (right - left) / SCALE, advances };
  }

  /** Inside a card, clear of its border by `inset`, from `top` down. */
  function inside(card: Element, inset: number, top = cardBox(card).y + inset): Region {
    const box = cardBox(card);
    return { x: box.x + inset, y: top, width: box.width - 2 * inset, height: box.y + box.height - inset - top };
  }

  /** Drawn twice over, the ink is wider by exactly one drawing of the sample: its advance widths. */
  async function expectAsWideAsTables(draw: (text: string) => Promise<{ ink: number; advances: number }>, sample: string) {
    const once = await draw(sample);
    const twice = await draw(sample + sample);

    expect(twice.advances).toBeCloseTo(2 * once.advances, 6);
    expect(Math.abs(twice.ink - once.ink - once.advances)).toBeLessThan(0.5);
  }

  // Kerning pairs (AV, To, Wa, ff), digits, accents and symbols: drawn with no kerning, each takes exactly its advance.
  // Each sample fits on one line twice over.
  it.each(["AVATAR Wave", "To do today", "Waffle office", "Mix 0-9 at 18°", "Café über Ærø", "→ ≠ … ≤ ≥ ×", "{x: 1, y: [2]}"])(
    "draws %j in Inter SemiBold, as step labels are, as wide as the width tables within 0.5px",
    async (sample) => {
      // Only the label is drawn inside the step, clear of its border.
      await expectAsWideAsTables((label) => drawn(oneStep(label), label, (card) => inside(card, 4)), sample);
    },
  );

  // Code ligature pairs (-> != <= >= === www), digits, accents and symbols: drawn with no ligatures, each character
  // takes exactly its advance. Each sample fits on one row twice over.
  it.each(["{x: 1, y: [2]}", "-> != <= >= === www", "→ ≠ … ≤ ≥ ×", "Mix 0-9 at 18°", "Café über Ærø", "fn(a): T[]"])(
    "draws %j in JetBrains Mono Regular, as class rows are, as wide as the width tables within 0.5px",
    async (sample) => {
      // Below the card's last divider, only the row is drawn.
      const row = (card: Element) => inside(card, 4, Number(byClassIn(card, "divider").at(-1)!.getAttribute("y1")) + 2);
      await expectAsWideAsTables((text) => drawn(oneRow(text), text, row), sample);
    },
  );

  // Still open on #11. Fill each check in with the ticket that first draws the
  // face (titles, descriptions and line labels in #8, italics in #14).
  it.todo("draws Inter Regular, Bold and SemiBold Italic and JetBrains Mono Italic as wide as the width tables (#8, #14)");
  it.todo("draws the same word at weights 400, 600 and 700 as three different images (once #8's titles, descriptions or line labels draw 400 and 700)");
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

/** The size of a diagram's SVG, which is its PNG's size at scale 1. */
async function sizeOf(diagram: object): Promise<{ width: number; height: number }> {
  return svgSize((await render(diagram, { embedFonts: false })).svg);
}

/**
 * The largest n from `low` to `high` for which `fits(n)` holds, when it holds
 * for every n up to some point and for none after. Laying out is quick, so
 * the limit tests find the diagram that comes closest under a limit rather
 * than hard-coding one that card sizes would soon move.
 */
async function largest(low: number, high: number, fits: (n: number) => Promise<boolean>): Promise<number> {
  expect(await fits(low)).toBe(true);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (await fits(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The longest row of steps whose PNG at scale 4 is no wider than 16,384 px. */
const longestRow = () => largest(1, 100, async (n) => (await sizeOf(row(n))).width * 4 <= 16_384);

describe("PNG size limits", () => {
  it("refuses a PNG with a side over 16,384 px with TOO_LARGE, and suggests a scale that fits", async () => {
    const tooLong = row((await longestRow()) + 1);
    const { width, height } = await sizeOf(tooLong);
    expect(width * 4).toBeGreaterThan(16_384);
    expect(width * 3).toBeLessThanOrEqual(16_384);

    const error = await rejection(render(tooLong, { formats: ["svg", "png"], scale: 4 }));

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
    const { svg, png } = await render(row(await longestRow()), { formats: ["svg", "png"], embedFonts: false, scale: 4 });

    const { width, height } = svgSize(svg);
    expect(width * 4).toBeGreaterThan(15_500);
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
    // A grid near the limit, its first column widened a character at a time to come as close under it as it can.
    const sowing = "Sow tray # thinly and evenly, then cover the seed with a fine layer of sieved compost";
    const diagram = (length: number) => seedTrays(15, 24, sowing.slice(0, length));
    const pixels = async (length: number) => {
      const { width, height } = await sizeOf(diagram(length));
      return width * 4 * height * 4;
    };
    const length = await largest("Sow tray #".length, sowing.length, async (n) => (await pixels(n)) <= 100_000_000);

    const { svg, png } = await render(diagram(length), { formats: ["svg", "png"], embedFonts: false, scale: 4 });

    const { width, height } = svgSize(svg);
    expect(width * 4 * height * 4).toBeGreaterThan(99_000_000);
    expect(width * 4 * height * 4).toBeLessThanOrEqual(100_000_000);
    expect(pngSize(png)).toEqual({ width: width * 4, height: height * 4 });
  });
});
