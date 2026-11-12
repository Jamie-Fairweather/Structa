import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import {
  cardBox,
  cardById,
  cards,
  distanceToOutline,
  lineGeometry,
  lines,
  parseSvg,
  textLines,
  titleOf,
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

  it("routes lines at right angles with rounded corners, from card edge to card edge", async () => {
    const doc = parseSvg((await render(repot, opts)).svg);

    for (const [i, edge] of repot.edges.entries()) {
      const line = lines(doc)[i]!;
      const { route, arrowTip } = lineGeometry(line);
      expect(route[0]!.command).toBe("M");
      expect(distanceToOutline(route[0]!.points[0]!, cardBox(cardById(doc, edge.from)))).toBeLessThanOrEqual(1);
      expect(distanceToOutline(arrowTip, cardBox(cardById(doc, edge.to)))).toBeLessThanOrEqual(1);

      // Every straight run is horizontal or vertical; corners are curves whose control point is the bend.
      let at = route[0]!.points[0]!;
      for (const { command, points } of route.slice(1)) {
        expect(["L", "Q"]).toContain(command);
        for (const p of points) {
          expect(Math.min(Math.abs(p.x - at.x), Math.abs(p.y - at.y))).toBeLessThanOrEqual(0.01);
          at = p;
        }
      }
    }
  });
});
