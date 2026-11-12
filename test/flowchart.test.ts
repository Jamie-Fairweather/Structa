import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import {
  allElements,
  cardBox,
  cardById,
  cards,
  distanceOutside,
  distanceToOutline,
  lineGeometry,
  lines,
  parseSvg,
  textLines,
  titleOf,
  type Point,
} from "./helpers/svg";

const opts = { embedFonts: false } as const;

describe("step-only flowcharts", () => {
  it("draws a one-step flowchart as an SVG with one card", async () => {
    const { svg } = await render(
      { type: "flow", nodes: [{ id: "water", label: "Water the seedlings", shape: "step" }] },
      opts,
    );

    const doc = parseSvg(svg);
    const found = cards(doc);
    expect(found).toHaveLength(1);
    const card = found[0]!;
    expect(card.getAttribute("data-id")).toBe("water");
    expect(card.getAttribute("data-kind")).toBe("step");
    expect(titleOf(card)).toBe("Water the seedlings");
    expect(textLines(card)).toEqual(["Water the seedlings"]);
  });

  it("draws an empty flowchart as an empty canvas", async () => {
    const doc = parseSvg((await render({ type: "flow", nodes: [] }, opts)).svg);

    expect(cards(doc)).toHaveLength(0);
    expect(Number(doc.documentElement!.getAttribute("width"))).toBeGreaterThan(0);
  });

  async function stepCard(label: string) {
    const doc = parseSvg((await render({ type: "flow", nodes: [{ id: "s", label, shape: "step" }] }, opts)).svg);
    const card = cardById(doc, "s");
    return { card, box: cardBox(card), lines: textLines(card) };
  }

  it("sizes a step to its text, within a minimum and maximum width", async () => {
    const tiny = await stepCard("Go");
    const alsoTiny = await stepCard("Up");
    const medium = await stepCard("Check the soil is damp");
    const longer = await stepCard("Check the soil is damp all the way");
    const huge = await stepCard("Check the soil is damp all the way down to the roots before you water again");

    expect(alsoTiny.box.width).toBe(tiny.box.width);
    expect(medium.box.width).toBeGreaterThan(tiny.box.width);
    expect(longer.box.width).toBeGreaterThan(medium.box.width);
    expect(huge.lines.length).toBeGreaterThan(1);
    expect(huge.box.width).toBeGreaterThanOrEqual(longer.box.width);
    expect(huge.box.height).toBeGreaterThan(longer.box.height);
  });

  it("wraps long labels after spaces without losing any text", async () => {
    const label = "Check the soil is damp all the way down to the roots before you water again";
    const { lines: wrapped } = await stepCard(label);

    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join(" ")).toBe(label);
  });

  it.each([",", ";", ")", "]", "}"])("breaks after %s when there are no spaces", async (mark) => {
    const words = ["soil", "compost", "grit", "bark", "chips", "pellets", "feed", "water", "light", "sand", "loam"];
    const label = words.map((w) => w + mark).join("");
    const { lines: wrapped } = await stepCard(label);

    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join("")).toBe(label);
    for (const line of wrapped) expect(line.at(-1)).toBe(mark);
  });

  it("breaks a token that fits nowhere at the last character that fits, never truncating", async () => {
    const label = "W".repeat(60);
    const { lines: wrapped } = await stepCard(label);

    expect(wrapped.join("")).toBe(label);
    const chunk = wrapped[0]!.length;
    expect(wrapped.length).toBe(Math.ceil(60 / chunk));
    for (const line of wrapped.slice(0, -1)) expect(line.length).toBe(chunk);
    // `chunk` letters fit on one line, and one more doesn't.
    expect((await stepCard("W".repeat(chunk))).lines).toHaveLength(1);
    expect((await stepCard("W".repeat(chunk + 1))).lines).toHaveLength(2);
  });

  it("puts the baseline from the font's ascender and descender, not dominant-baseline", async () => {
    const { card, box } = await stepCard("Water it in");
    const text = card.getElementsByTagName("text")[0]!;

    // Inter: ascender 1984, descender -494, 2048 units per em, drawn at 14px.
    // Centring that box puts the baseline (1984 - 494) / 2 / 2048 * 14 = 5.09px below the middle.
    expect(Number(text.getAttribute("y")) - (box.y + box.height / 2)).toBeCloseTo(5.09, 2);
    expect(text.hasAttribute("dominant-baseline")).toBe(false);
  });

  const repot = {
    type: "flow",
    nodes: [
      { id: "pick", label: "Pick a bigger pot", shape: "step" },
      { id: "compost", label: "Add fresh compost", shape: "step" },
      { id: "move", label: "Move the plant across", shape: "step" },
      { id: "water", label: "Water it in", shape: "step" },
    ],
    edges: [
      { from: "pick", to: "compost" },
      { id: "fill-then-move", from: "compost", to: "move" },
      { from: "move", to: "water" },
      { from: "pick", to: "water" },
    ],
  };

  it("draws each edge as a line with its id, kind and a tooltip", async () => {
    const doc = parseSvg((await render(repot, opts)).svg);

    expect(
      lines(doc).map((l) => [l.getAttribute("data-id"), l.getAttribute("data-kind"), titleOf(l)]),
    ).toEqual([
      ["edges[0]", "flow", "Pick a bigger pot → Add fresh compost"],
      ["fill-then-move", "flow", "Add fresh compost → Move the plant across"],
      ["edges[2]", "flow", "Move the plant across → Water it in"],
      ["edges[3]", "flow", "Pick a bigger pot → Water it in"],
    ]);
  });

  /** Which way a move between two points goes: it must be horizontal or vertical. `undefined` for no move. */
  function heading(from: Point, to: Point): "across" | "down" | undefined {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    expect(Math.min(dx, dy)).toBeLessThanOrEqual(0.01);
    if (Math.max(dx, dy) <= 0.01) return undefined;
    return dx > dy ? "across" : "down";
  }

  it("routes lines at right angles with rounded corners, from card edge to card edge", async () => {
    const doc = parseSvg((await render(repot, opts)).svg);

    for (const [i, edge] of repot.edges.entries()) {
      const { route, arrowTip, arrowBase } = lineGeometry(lines(doc)[i]!);
      const target = cardBox(cardById(doc, edge.to));
      expect(route[0]!.command).toBe("M");
      expect(distanceToOutline(route[0]!.points[0]!, cardBox(cardById(doc, edge.from)))).toBeLessThanOrEqual(1);
      expect(distanceToOutline(arrowTip, target)).toBeLessThanOrEqual(1);

      // Straight runs are horizontal or vertical and never turn, so there are no sharp corners.
      // Every turn is a curve whose control point is the bend: it comes in one way and leaves the other.
      let at = route[0]!.points[0]!;
      let going: "across" | "down" | undefined;
      for (const { command, points } of route.slice(1)) {
        expect(["L", "Q"]).toContain(command);
        if (command === "L") {
          for (const p of points) {
            const run = heading(at, p);
            if (going && run) expect(run).toBe(going);
            going = run ?? going;
            at = p;
          }
        } else {
          const [bend, end] = points as [Point, Point];
          const into = heading(at, bend);
          const out = heading(bend, end);
          expect(into).toBeDefined();
          if (going) expect(into).toBe(going);
          expect(out).toBeDefined();
          expect(out).not.toBe(into);
          going = out;
          at = end;
        }
      }

      // The route stops where the arrowhead's base sits, outside the target card, and the
      // arrowhead carries on the same way into the card, its tip on the edge.
      expect(Math.hypot(at.x - arrowBase.x, at.y - arrowBase.y)).toBeLessThanOrEqual(0.02);
      expect(heading(arrowBase, arrowTip)).toBe(going);
      expect(distanceOutside(arrowBase, target)).toBeGreaterThan(distanceOutside(arrowTip, target));
    }

    // pick -> water skips two cards, so it bends, and its bends are curves.
    expect(lineGeometry(lines(doc)[3]!).route.filter((c) => c.command === "Q").length).toBeGreaterThan(0);
  });

  it("paints lines over the cards", async () => {
    const doc = parseSvg((await render(repot, opts)).svg);
    const groups = allElements(doc)
      .map((el) => el.getAttribute("class"))
      .filter((kind) => kind === "card" || kind === "line");

    expect(groups).toEqual(["card", "card", "card", "card", "line", "line", "line", "line"]);
  });
});
