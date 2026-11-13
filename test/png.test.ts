import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { readTtf } from "../scripts/lib/ttf";
import { render } from "../src/index";
import { rejection } from "./helpers/errors";
import { changedRegion, colourDifference, decodePng, difference, inkArea, inkEdges, pixel, pngSize, svgSize, type Picture, type Region } from "./helpers/png";
import { byClassIn, cards, drawnTextBoxes, fontFaceRules, outlineBox, parseSvg, svgDoc, textFaces, type FaceName } from "./helpers/svg";

const examplesDir = fileURLToPath(new URL("../examples/", import.meta.url));

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
    const box = outlineBox(cards(parseSvg(svg))[0]!);
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
  /** A no-break space: drawn in place of some text, it draws nothing there and moves nothing else. */
  const NOTHING = "\u00a0";
  const oneStep = (label: string) => ({ type: "flow", nodes: [{ id: "step", label, shape: "step" }] });
  const oneRow = (text: string) => ({ type: "class", nodes: [{ id: "card", label: "Sample", methods: [{ text }] }] });
  const abstractRow = (text: string) => ({ type: "class", nodes: [{ id: "card", label: "Sample", methods: [{ text, abstract: true }] }] });
  const abstractClass = (label: string) => ({ type: "class", nodes: [{ id: "card", label, abstract: true }] });
  /** Four steps in a row under a title or a description, wider than any sample here twice over: the text can't widen the picture. */
  const headed = (field: "title" | "description") => (text: string) => ({
    type: "flow",
    direction: "right",
    [field]: text,
    nodes: ["Sow", "Water", "Thin", "Pick"].map((label, i) => ({ id: `step${i}`, label, shape: "step" })),
    edges: [0, 1, 2].map((i) => ({ from: `step${i}`, to: `step${i + 1}` })),
  });

  /** One drawing of some text: the face it's drawn in, and how wide it is drawn and how wide its font says it is, in SVG px. */
  interface Drawn {
    /** As "family weight style", from the SVG. */
    readonly face: FaceName;
    /** From the left edge of its ink in the PNG to the right. */
    readonly ink: number;
    /** The sum of its advance widths in the font the SVG embeds for its face. */
    readonly advances: number;
  }
  type Draw = (text: string) => Promise<Drawn>;

  /** The one <text> that draws `text` on one line, its face, and the sum of its advance widths in that face's embedded font, in SVG px. */
  function advancesOf(doc: Document, text: string): { element: Element; face: FaceName; advances: number } {
    const found = Array.from(doc.getElementsByTagName("text")).filter((t) => t.textContent === text);
    expect(found).toHaveLength(1);
    const element = found[0]!;
    const face = [element.getAttribute("font-family")!.split(",")[0], element.getAttribute("font-weight"), element.getAttribute("font-style") || "normal"].join(" ");
    const rule = fontFaceRules(doc).find((r) => r.face === face);
    const font = readTtf(Buffer.from(/base64,([^"]+)"/.exec(rule!.src)![1]!, "base64"));
    const size = Number(element.getAttribute("font-size"));
    const advances = [...text].reduce((sum, ch) => sum + font.advance(ch.codePointAt(0)!)!, 0) * (size / font.unitsPerEm);
    return { element, face, advances };
  }

  /** Draws text in `diagram`, measuring it in `region`, where the text is the only thing drawn, on the plain card fill, in SVG px. */
  const inRegion =
    (diagram: (text: string) => object, region: (card: Element) => Region): Draw =>
    async (text) => {
      const { svg, png } = await render(diagram(text), { formats: ["svg", "png"], scale: SCALE });
      const doc = parseSvg(svg);
      const { face, advances } = advancesOf(doc, text);
      // The region in whole PNG pixels, rounded inwards.
      const box = region(cards(doc)[0]!);
      const [x, y] = [Math.ceil(box.x * SCALE), Math.ceil(box.y * SCALE)];
      const scaled = { x, y, width: Math.floor((box.x + box.width) * SCALE) - x, height: Math.floor((box.y + box.height) * SCALE) - y };
      const { left, right } = inkEdges(decodePng(png), scaled);
      return { face, ink: (right - left) / SCALE, advances };
    };

  /**
   * `text` drawn in `diagram`, over whatever lies behind it, like the page's
   * grid dots: the diagram's PNG, and as a background the PNG of the same
   * diagram with NOTHING in place of the text. The two differ only where the
   * text is drawn.
   */
  const blanks = new Map<(text: string) => object, Promise<Picture>>();
  async function drawnAlone(diagram: (text: string) => object, text: string) {
    const draw = (t: string) => render(diagram(t), { formats: ["svg", "png"], scale: SCALE });
    if (!blanks.has(diagram)) blanks.set(diagram, draw(NOTHING).then(({ png }) => decodePng(png)));
    const [drawn, background] = await Promise.all([draw(text), blanks.get(diagram)!]);
    const doc = parseSvg(drawn.svg);
    const { element, face, advances } = advancesOf(doc, text);
    const picture = decodePng(drawn.png);

    // Nothing else moved: every pixel that changed is in the text's box, give or take a letter's overhang.
    const box = drawnTextBoxes(doc).get(element)!;
    const changed = changedRegion(picture, background)!;
    const slack = 2;
    expect([
      changed.x >= (box.x - slack) * SCALE,
      changed.y >= (box.y - slack) * SCALE,
      changed.x + changed.width <= (box.x + box.width + slack) * SCALE,
      changed.y + changed.height <= (box.y + box.height + slack) * SCALE,
    ]).toEqual([true, true, true, true]);
    return { element, face, advances, picture, background };
  }

  /** Draws text alone in `diagram`, measuring it across the whole picture. */
  const alone =
    (diagram: (text: string) => object): Draw =>
    async (text) => {
      const { face, advances, picture, background } = await drawnAlone(diagram, text);
      const ink = difference(picture, background);
      const { left, right } = inkEdges(ink, { x: 0, y: 0, width: ink.width, height: ink.height });
      return { face, ink: (right - left) / SCALE, advances };
    };

  /** Inside a card, clear of its border by `inset`, from `top` down. */
  function inside(card: Element, inset: number, top = outlineBox(card).y + inset): Region {
    const box = outlineBox(card);
    return { x: box.x + inset, y: top, width: box.width - 2 * inset, height: box.y + box.height - inset - top };
  }
  /** Below a class card's last divider, only its row is drawn. */
  const belowRows = (card: Element) => inside(card, 4, Number(byClassIn(card, "divider").at(-1)!.getAttribute("y1")) + 2);

  // Kerning pairs (AV, To, Wa, ff), digits, accents and symbols: drawn with no kerning, each takes exactly its advance.
  const INTER = ["AVATAR Wave", "To do today", "Waffle office", "Mix 0-9 at 18°", "Café über Ærø", "→ ≠ … ≤ ≥ ×", "{x: 1, y: [2]}"];
  // Slanted letters overhang their advances at both ends, by the same amount once and twice over, so the check holds.
  const INTER_ITALIC = ["AVATAR Wave", "Waffle office", "Café über Ærø", "→ ≠ … ≤ ≥ ×"];
  // Code ligature pairs (-> != <= >= === www), digits, accents and symbols: drawn with no ligatures, each character takes exactly its advance.
  const MONO = ["{x: 1, y: [2]}", "-> != <= >= === www", "→ ≠ … ≤ ≥ ×", "Mix 0-9 at 18°", "Café über Ærø", "fn(a): T[]"];
  const MONO_ITALIC = ["{x: 1, y: [2]}", "-> != <= >= === www", "Café über Ærø", "fn(a): T[]"];

  // Every face render() draws text in: the six the spec names, each with text drawn in it and samples that fit on one line twice over.
  const FACES: readonly (readonly [name: string, face: FaceName, as: string, draw: Draw, samples: readonly string[]])[] = [
    ["Inter Regular", "Structa Inter 400 normal", "a diagram's description", alone(headed("description")), INTER],
    ["Inter SemiBold", "Structa Inter 600 normal", "a step's label", inRegion(oneStep, (card) => inside(card, 4)), INTER],
    ["Inter Bold", "Structa Inter 700 normal", "a diagram's title", alone(headed("title")), INTER],
    // A class with no rows draws only its name.
    ["Inter SemiBold Italic", "Structa Inter 600 italic", "an abstract class's name", inRegion(abstractClass, (card) => inside(card, 4)), INTER_ITALIC],
    ["JetBrains Mono Regular", "Structa JetBrains Mono 400 normal", "a class's row", inRegion(oneRow, belowRows), MONO],
    ["JetBrains Mono Italic", "Structa JetBrains Mono 400 italic", "an abstract row", inRegion(abstractRow, belowRows), MONO_ITALIC],
  ];

  it("draws text in exactly these faces: every face the examples use between them", async () => {
    const used = new Set<FaceName>();
    for (const file of readdirSync(examplesDir).filter((name) => name.endsWith(".json"))) {
      for (const face of textFaces(await svgDoc(JSON.parse(readFileSync(join(examplesDir, file), "utf8"))))) used.add(face);
    }

    expect([...used].sort()).toEqual(FACES.map(([, face]) => face).sort());
  });

  describe.each(FACES)("in %s (%s), as %s is drawn", (_name, face, _as, draw, samples) => {
    // Drawn twice over, the ink is wider by exactly one drawing of the sample: its advance widths.
    it.each(samples)("draws %j as wide as the width tables within 0.5px", async (sample) => {
      const once = await draw(sample);
      const twice = await draw(sample + sample);

      expect([once.face, twice.face]).toEqual([face, face]);
      expect(twice.advances).toBeCloseTo(2 * once.advances, 6);
      expect(Math.abs(twice.ink - once.ink - once.advances)).toBeLessThan(0.5);
    });
  });

  // JetBrains Mono's italic is as wide as its upright face, so only the picture shows the rasteriser found the italic.
  it.each([
    ["an abstract class's name", { label: "Trowel" }, { label: "Trowel", abstract: true }],
    ["an abstract row", { label: "Trowel", methods: [{ text: "dig(depth: cm): Hole" }] }, { label: "Trowel", methods: [{ text: "dig(depth: cm): Hole", abstract: true }] }],
  ])("draws %s in the italic face, not the upright one", async (_name, upright, italic) => {
    const picture = async (node: object) =>
      decodePng((await render({ type: "class", nodes: [{ id: "card", ...node }] }, { formats: ["png"], scale: 1 })).png);
    const [plain, slanted] = [await picture(upright), await picture(italic)];

    expect([slanted.width, slanted.height]).toEqual([plain.width, plain.height]);
    expect(Buffer.from(slanted.rgba).equals(Buffer.from(plain.rgba))).toBe(false);
  });

  // A heavier face draws thicker strokes, so the same word covers more of the square of its font size, whatever that size is.
  it("draws the same word at weights 400, 600 and 700 as three different images, each heavier than the last", async () => {
    const weights: [FaceName, (text: string) => object][] = [
      ["Structa Inter 400 normal", headed("description")],
      ["Structa Inter 600 normal", oneStep],
      ["Structa Inter 700 normal", headed("title")],
    ];
    const heaviness: number[] = [];
    for (const [face, diagram] of weights) {
      const drawn = await drawnAlone(diagram, "Seedling");
      const size = Number(drawn.element.getAttribute("font-size")) * SCALE;

      expect(drawn.face).toBe(face);
      heaviness.push(inkArea(drawn.picture, drawn.background, drawn.element.getAttribute("fill")!) / size ** 2);
    }

    const [regular, semibold, bold] = heaviness;
    expect(semibold).toBeGreaterThan(regular! * 1.05);
    expect(bold).toBeGreaterThan(semibold! * 1.05);
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
