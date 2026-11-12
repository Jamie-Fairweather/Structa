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
