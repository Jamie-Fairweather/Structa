import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import {
  badgeBox,
  boundsOf,
  byClassIn,
  cardById,
  cards,
  depthInShape,
  drawnTextBoxes,
  parseSvg,
  outlineBox,
  outlineOf,
  parsePath,
  polygonOf,
  rectBox,
  svgDoc,
  textLines,
  titleOf,
} from "./helpers/svg";

/** Every shape once, in a short run from start to end: making a pot of tea. */
function teaRun() {
  return {
    type: "flow",
    nodes: [
      { id: "kettle", label: "Kettle on", shape: "start" },
      { id: "leaves", label: "Pick the leaves", shape: "io" },
      { id: "brew", label: "Brew the tea", shape: "subprocess" },
      { id: "strong", label: "Strong enough?", shape: "decision" },
      { id: "pour", label: "Pour a cup", shape: "step" },
      { id: "done", label: "Drink it", shape: "end" },
      { id: "tip", label: "Warm the pot first", shape: "note" },
    ],
    edges: [
      { from: "kettle", to: "leaves" },
      { from: "leaves", to: "brew" },
      { from: "brew", to: "strong" },
      { from: "strong", to: "pour", label: "yes" },
      { from: "strong", to: "brew", label: "no" },
      { from: "pour", to: "done" },
    ],
  };
}

describe("flowchart shapes", () => {
  it("draws every shape as a card of its own kind", async () => {
    const doc = await svgDoc(teaRun());

    expect(cards(doc).map((c) => [c.getAttribute("data-id"), c.getAttribute("data-kind")])).toEqual([
      ["kettle", "start"],
      ["leaves", "io"],
      ["brew", "subprocess"],
      ["strong", "decision"],
      ["pour", "step"],
      ["done", "end"],
      ["tip", "note"],
    ]);
    expect(textLines(cardById(doc, "strong"))).toEqual(["Strong enough?"]);
    expect(titleOf(cardById(doc, "tip"))).toBe("Warm the pot first");
  });

  it.each(["start", "end"])("draws %s as a pill: a box with fully rounded ends", async (id) => {
    const doc = await svgDoc(teaRun());

    const outline = outlineOf(cardById(doc, id === "start" ? "kettle" : "done"));
    expect(outline.localName).toBe("rect");
    expect(Number(outline.getAttribute("rx"))).toBeCloseTo(rectBox(outline).height / 2, 5);
  });

  it("draws a step as a rounded box, its corners much less round than a pill's", async () => {
    const doc = await svgDoc(teaRun());

    const outline = outlineOf(cardById(doc, "pour"));
    expect(outline.localName).toBe("rect");
    expect(Number(outline.getAttribute("rx"))).toBeGreaterThan(2);
    expect(Number(outline.getAttribute("rx"))).toBeLessThan(rectBox(outline).height / 3);
  });

  it("draws a decision as a diamond: its corners at the middle of each side of its box", async () => {
    const doc = await svgDoc(teaRun());

    const corners = polygonOf(outlineOf(cardById(doc, "strong")));
    const { x, y, width, height } = boundsOf(corners);
    expect(corners).toEqual([
      { x: x + width / 2, y },
      { x: x + width, y: y + height / 2 },
      { x: x + width / 2, y: y + height },
      { x, y: y + height / 2 },
    ]);
    // Wider than tall, as decisions usually are.
    expect(width).toBeGreaterThan(height);
  });

  it("draws io as a slanted box: level top and bottom, the top shifted right, the sides parallel", async () => {
    const doc = await svgDoc(teaRun());

    const [topLeft, topRight, bottomRight, bottomLeft] = polygonOf(outlineOf(cardById(doc, "leaves")));
    expect(topLeft!.y).toBe(topRight!.y);
    expect(bottomLeft!.y).toBe(bottomRight!.y);
    expect(bottomLeft!.y).toBeGreaterThan(topLeft!.y);
    const slant = topLeft!.x - bottomLeft!.x;
    expect(slant).toBeGreaterThan(4);
    expect(topRight!.x - bottomRight!.x).toBeCloseTo(slant, 5);
  });

  it("draws a subprocess as a box with a second bar inside each side", async () => {
    const doc = await svgDoc(teaRun());

    const card = cardById(doc, "brew");
    const box = rectBox(outlineOf(card));
    const bars = parsePath(byClassIn(card, "marks")[0]!.getAttribute("d")!);
    const runs = bars.filter((c) => c.command === "M").map((m, i) => [m.points[0]!, bars[2 * i + 1]!.points[0]!]);
    expect(runs).toHaveLength(2);
    const [left, right] = runs.sort((a, b) => a[0]!.x - b[0]!.x);
    for (const [from, to] of [left!, right!]) {
      // Upright, from the top border to the bottom border.
      expect(from!.x).toBe(to!.x);
      expect([Math.min(from!.y, to!.y), Math.max(from!.y, to!.y)]).toEqual([box.y, box.y + box.height]);
    }
    const inset = left![0]!.x - box.x;
    expect(inset).toBeGreaterThan(4);
    expect(box.x + box.width - right![0]!.x).toBeCloseTo(inset, 5);
  });

  it("draws a note as a box with its bottom-right corner folded over", async () => {
    const doc = await svgDoc(teaRun());

    const card = cardById(doc, "tip");
    const corners = polygonOf(outlineOf(card));
    const { x, y, width, height } = boundsOf(corners);
    expect(corners).toHaveLength(5);
    const [, , cutTop, cutBottom] = corners;
    const fold = x + width - cutBottom!.x;
    expect(fold).toBeGreaterThan(4);
    expect(corners).toEqual([
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height - fold },
      { x: x + width - fold, y: y + height },
      { x, y: y + height },
    ]);
    expect(cutTop!.x).toBe(x + width);
    // The folded-over flap is drawn in the cut corner.
    const flap = parsePath(byClassIn(card, "marks")[0]!.getAttribute("d")!).flatMap((c) => c.points);
    expect(flap).toContainEqual({ x: x + width - fold, y: y + height - fold });
  });

  const SHAPES = ["start", "end", "step", "decision", "io", "subprocess", "note"] as const;

  /** One card of `shape` with this label and any other fields. */
  async function shapeCard(shape: string, label: string, extra: Record<string, unknown> = {}) {
    const doc = await svgDoc({ type: "flow", nodes: [{ id: "s", label, shape, ...extra }] });
    const card = cardById(doc, "s");
    return { card, box: outlineBox(card), lines: textLines(card) };
  }

  const LONG = "Check the soil is damp all the way down to the roots before you water the seedlings";

  it.each(SHAPES)("sizes a %s to its text, between a minimum and a maximum width", async (shape) => {
    const tiny = await shapeCard(shape, "Go");
    const alsoTiny = await shapeCard(shape, "Up");
    const medium = await shapeCard(shape, "Check the soil");
    const longer = await shapeCard(shape, "Check the soil is damp");
    const huge = await shapeCard(shape, LONG);
    // Runs of W fill every wrapped line to the same width, so both reach the maximum.
    const widest = await shapeCard(shape, "W".repeat(90));
    const alsoWidest = await shapeCard(shape, "W".repeat(100));

    expect(alsoTiny.box.width).toBe(tiny.box.width);
    expect(medium.box.width).toBeGreaterThan(tiny.box.width);
    expect(longer.box.width).toBeGreaterThan(medium.box.width);
    // Past the maximum, text wraps onto more lines and the shape grows taller, not wider.
    expect(huge.lines.length).toBeGreaterThan(2);
    expect(huge.lines.join(" ")).toBe(LONG);
    expect(huge.box.height).toBeGreaterThan(longer.box.height);
    expect(alsoWidest.box.width).toBe(widest.box.width);
    expect(alsoWidest.box.height).toBeGreaterThan(widest.box.height);
    expect(widest.box.width).toBeGreaterThan(longer.box.width);
  });

  it.each(SHAPES)("keeps every line of a %s's text, and its description's, inside its outline, however long", async (shape) => {
    const texts = [
      ["Go"],
      ["Check the soil is damp"],
      [LONG],
      ["W".repeat(100)],
      ["Go", "Only when the top inch is dry"],
      ["Check the soil", "W".repeat(300)],
      [LONG, `${LONG}, ${LONG}, ${LONG}`],
    ];
    for (const [label, description] of texts) {
      // Rendered with its fonts, so each line's drawn width can be measured in the face it uses.
      const input = { type: "flow", nodes: [{ id: "s", label, shape, ...(description ? { description } : {}) }] };
      const doc = parseSvg((await render(input)).svg);
      const card = cardById(doc, "s");
      const drawn = drawnTextBoxes(doc);

      expect(textLines(card).length).toBeGreaterThan(0);
      for (const t of Array.from(card.getElementsByTagName("text"))) {
        const { x, y, width, height } = drawn.get(t)!;
        for (const corner of [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ]) {
          expect(depthInShape(corner, card), `${shape} "${t.textContent}"`).toBeGreaterThan(0);
        }
      }
    }
  });

  describe("status", () => {
    it.each(SHAPES)("sits a %s's badge on its visible top border, inside its width", async (shape) => {
      for (const label of ["Go", "Check the soil is damp all the way down"]) {
        const { card, box } = await shapeCard(shape, label, { status: "unchanged" });
        const badge = badgeBox(card)!;

        expect(badge.y + badge.height / 2).toBeCloseTo(box.y, 5);
        expect(badge.x).toBeGreaterThanOrEqual(box.x);
        expect(badge.x + badge.width).toBeLessThanOrEqual(box.x + box.width);
        // Its lower half covers the border: the middle of its bottom edge is inside the shape.
        expect(depthInShape({ x: badge.x + badge.width / 2, y: badge.y + badge.height }, card), label).toBeGreaterThan(0);
      }
    });

    it("centres a decision's badge on its top corner", async () => {
      const { card, box } = await shapeCard("decision", "Frost tonight?", { status: "new" });
      const badge = badgeBox(card)!;

      expect(badge.x + badge.width / 2).toBeCloseTo(box.x + box.width / 2, 5);
    });

    it.each(["subprocess", "note"])("draws a %s's extra lines in its status colour, faded with it when removed", async (shape) => {
      for (const [status, colour] of [["new", "#1f883d"], ["removed", "#cf222e"], [undefined, "#d1d9e0"]] as const) {
        const { card } = await shapeCard(shape, "Prick out", status ? { status } : {});
        const marks = byClassIn(card, "marks")[0]!;

        expect(marks.getAttribute("stroke")).toBe(colour);
        expect(marks.getAttribute("stroke")).toBe(outlineOf(card).getAttribute("stroke"));
        expect(marks.getAttribute("stroke-width")).toBe(outlineOf(card).getAttribute("stroke-width"));
        expect((marks.parentNode as Element).getAttribute("class")).toBe(status === "removed" ? "faded" : "card");
      }
    });

    it.each(SHAPES)("strikes through a removed %s's label and keeps its REMOVED badge clear", async (shape) => {
      const { card } = await shapeCard(shape, "Thin out", { status: "removed" });

      expect(byClassIn(card, "strike")).toHaveLength(1);
      expect(byClassIn(byClassIn(card, "faded")[0]!, "outline")).toHaveLength(1);
      expect(textLines(byClassIn(card, "badge")[0]!)).toEqual(["REMOVED"]);
    });
  });

  describe("descriptions", () => {
    it.each([
      ["light", "#1f2328", "#59636e"],
      ["dark", "#e6edf3", "#8b949e"],
    ] as const)("draws a %s description under the label, wrapped, smaller, lighter and muted", async (theme, text, muted) => {
      const description = "Use a can with a fine rose, so the compost isn't washed away from the roots";
      const input = { type: "flow", nodes: [{ id: "water", label: "Water the seedlings", shape: "step", description }] };
      const card = cardById(await svgDoc(input, theme), "water");

      const [label, ...under] = Array.from(card.getElementsByTagName("text"));
      expect(label!.textContent).toBe("Water the seedlings");
      expect(under.length).toBeGreaterThan(1);
      expect(under.map((t) => t.textContent).join(" ")).toBe(description);
      expect(label!.getAttribute("fill")).toBe(text);
      for (const t of under) {
        expect(t.getAttribute("fill")).toBe(muted);
        expect(t.getAttribute("font-weight")).toBe("400");
        expect(Number(t.getAttribute("font-size"))).toBeLessThan(Number(label!.getAttribute("font-size")));
        expect(t.getAttribute("x")).toBe(label!.getAttribute("x"));
        expect(t.getAttribute("text-anchor")).toBe("middle");
      }
      const baselines = [label!, ...under].map((t) => Number(t.getAttribute("y")));
      expect([...baselines].sort((a, b) => a - b)).toEqual(baselines);
    });

    it("puts the description in the tooltip, on a line under the label", async () => {
      const input = { type: "flow", nodes: [{ id: "pot", label: "Pot them on", shape: "subprocess", description: "Into 9 cm pots" }] };

      expect(titleOf(cardById(await svgDoc(input), "pot"))).toBe("Pot them on\nInto 9 cm pots");
    });

    it.each(SHAPES)("makes a %s bigger to hold its description", async (shape) => {
      const bare = await shapeCard(shape, "Go");
      const short = await shapeCard(shape, "Go", { description: "Now" });
      const wide = await shapeCard(shape, "Go", { description: "Only once the frost has passed" });

      expect(short.box.height).toBeGreaterThan(bare.box.height);
      expect(wide.box.width).toBeGreaterThan(short.box.width);
      expect(wide.lines.join(" ")).toBe("Go Only once the frost has passed");
    });

    it("doesn't strike through a removed shape's description, only its label", async () => {
      const input = { type: "flow", nodes: [{ id: "net", label: "Net the brassicas", shape: "step", status: "removed", description: "Pigeons now leave them alone" }] };
      const card = cardById(await svgDoc(input), "net");

      expect(byClassIn(card, "strike")).toHaveLength(1);
    });
  });

  it("fills a note in its own colour, set for each theme, and every other shape in the card colour", async () => {
    for (const theme of ["light", "dark"] as const) {
      const doc = await svgDoc(teaRun(), theme);
      const fills = new Map(cards(doc).map((c) => [c.getAttribute("data-kind"), outlineOf(c).getAttribute("fill")]));
      const card = theme === "light" ? "#ffffff" : "#161b22";

      for (const kind of ["start", "io", "subprocess", "decision", "step", "end"]) expect(fills.get(kind), kind).toBe(card);
      expect(fills.get("note")).toMatch(/^#[0-9a-f]{6}$/);
      expect(fills.get("note")).not.toBe(card);
    }
    const light = outlineOf(cardById(await svgDoc(teaRun(), "light"), "tip")).getAttribute("fill");
    const dark = outlineOf(cardById(await svgDoc(teaRun(), "dark"), "tip")).getAttribute("fill");
    expect(light).not.toBe(dark);
  });
});
