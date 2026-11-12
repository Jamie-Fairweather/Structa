import { describe, expect, it } from "vitest";
import { cardById, lineGeometry, lines, outlineBox, svgDoc, textLines, type Box } from "./helpers/svg";

/**
 * Proving bread dough, with a decision that loops back to an earlier step.
 * Its lines are listed with the loop in the middle.
 */
function proving(direction: "down" | "right" = "down") {
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "mix", label: "Mix the dough", shape: "start" },
      { id: "knead", label: "Knead it", shape: "step" },
      { id: "rest", label: "Leave it to rise", shape: "subprocess" },
      { id: "risen", label: "Doubled in size?", shape: "decision" },
      { id: "shape", label: "Shape the loaf", shape: "step" },
      { id: "bake", label: "Bake", shape: "end" },
    ],
    edges: [
      { from: "mix", to: "knead" },
      { from: "knead", to: "rest" },
      { from: "rest", to: "risen" },
      { from: "risen", to: "rest", label: "no" },
      { from: "risen", to: "shape", label: "yes" },
      { from: "shape", to: "bake" },
    ],
  };
}

/** Where a box starts along the flow, and where it ends. */
function along(box: Box, direction: "down" | "right"): [number, number] {
  return direction === "down" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
}

describe("loops", () => {
  it.each(["down", "right"] as const)(
    "keeps the steps in reading order and runs the loop back against the flow, direction %s",
    async (direction) => {
      const input = proving(direction);
      const doc = await svgDoc(input);

      const order = input.nodes.map((node) => along(outlineBox(cardById(doc, node.id)), direction));
      for (let i = 1; i < order.length; i++) {
        expect(order[i]![0], `${input.nodes[i]!.id} after ${input.nodes[i - 1]!.id}`).toBeGreaterThan(order[i - 1]![1]);
      }

      // The loop's arrow points back up the flow, into the step it returns to.
      const loop = lines(doc)[3]!;
      expect([loop.getAttribute("data-from"), loop.getAttribute("data-to")]).toEqual(["risen", "rest"]);
      const { arrowTip, arrowBase } = lineGeometry(loop);
      const [tip, base] = direction === "down" ? [arrowTip.y, arrowBase.y] : [arrowTip.x, arrowBase.x];
      expect(tip).toBeLessThan(base);
    },
  );

  it("doesn't turn lines round when the nodes are listed out of order but nothing loops", async () => {
    const input = proving();
    input.nodes.reverse();
    input.edges = input.edges.filter((edge) => edge.label !== "no");
    const doc = await svgDoc(input);

    const tops = ["mix", "knead", "rest", "risen", "shape", "bake"].map((id) => outlineBox(cardById(doc, id)).y);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it("labels the lines out of a decision", async () => {
    const doc = await svgDoc(proving());

    const labelled = lines(doc).filter((line) => line.getAttribute("data-from") === "risen");
    expect(labelled.map((line) => line.getAttribute("data-to"))).toEqual(["rest", "shape"]);
    const pills = Array.from(doc.getElementsByTagName("g")).filter((g) => g.getAttribute("class") === "line-label");
    expect(pills.map((pill) => [pill.getAttribute("data-line"), textLines(pill)])).toEqual([
      ["edges[3]", ["no"]],
      ["edges[4]", ["yes"]],
    ]);
  });
});
