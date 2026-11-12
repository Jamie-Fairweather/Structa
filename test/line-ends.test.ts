import { readdirSync, readFileSync } from "node:fs";
import type { Document } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { cardById, connectorEnds, connectors, depthInShape, distanceToDrawn, lineEnds, lineGeometry, lines, svgDoc } from "./helpers/svg";

const examplesDir = new URL("../examples/", import.meta.url);
const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

/**
 * Sorting the post, with lines into and out of every shape from every side:
 * a decision with three ways out, two loops back, a line from a shape to
 * itself, and lines crowding into the slanted box and the pills.
 */
function post(direction: "down" | "right", statuses: boolean) {
  const status = (s: string) => (statuses ? { status: s } : {});
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "open", label: "Open the post", shape: "start" },
      { id: "scan", label: "Scan each letter", shape: "io", ...status("new") },
      { id: "kind", label: "Bill, letter or advert?", shape: "decision", ...status("changed") },
      { id: "pay", label: "Pay the bill", shape: "subprocess" },
      { id: "reply", label: "Write back", shape: "step", ...status("unchanged") },
      { id: "file", label: "File it away", shape: "io" },
      { id: "recycle", label: "Recycle it", shape: "end", ...status("removed") },
      { id: "shred", label: "Shred the envelopes", shape: "end" },
    ],
    edges: [
      { from: "open", to: "scan" },
      { from: "scan", to: "kind" },
      { from: "kind", to: "pay", label: "bill" },
      { from: "kind", to: "reply", label: "letter" },
      { from: "kind", to: "recycle", label: "advert" },
      { from: "pay", to: "file" },
      { from: "reply", to: "file" },
      { from: "file", to: "scan", label: "more post" },
      { from: "reply", to: "kind", label: "unsure" },
      { from: "kind", to: "kind", label: "ask" },
      { from: "file", to: "shred" },
      { from: "pay", to: "shred" },
      { from: "open", to: "shred" },
      { from: "scan", to: "file" },
    ],
  };
}

function ends(doc: Document, input: ReturnType<typeof post>) {
  return lines(doc).map((line, i) => {
    const { route, arrowTip, arrowBase } = lineGeometry(line);
    const edge = input.edges[i]!;
    return { what: `edges[${i}] ${edge.from} -> ${edge.to}`, start: route[0]!.points[0]!, arrowTip, arrowBase, edge };
  });
}

describe("line ends", () => {
  it.each([
    ["down", false],
    ["right", false],
    ["down", true],
    ["right", true],
  ] as const)("meet the visible outline of every shape within 1px, direction %s, statuses %s", async (direction, statuses) => {
    const input = post(direction, statuses);
    const doc = await svgDoc(input);

    for (const { what, start, arrowTip, edge } of ends(doc, input)) {
      expect(distanceToDrawn(start, cardById(doc, edge.from)), `${what} start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(arrowTip, cardById(doc, edge.to)), `${what} end`).toBeLessThanOrEqual(1);
    }
  });

  it.each(["down", "right"] as const)(
    "draw the arrowhead at the outline, pointing into the shape from outside it, direction %s",
    async (direction) => {
      const input = post(direction, false);
      const doc = await svgDoc(input);

      let slanted = 0;
      for (const { what, arrowTip, arrowBase, edge } of ends(doc, input)) {
        const target = cardById(doc, edge.to);
        expect(Math.abs(depthInShape(arrowTip, target)), what).toBeLessThanOrEqual(1);
        expect(depthInShape(arrowBase, target), what).toBeLessThan(0);
        // Ends on a diamond's or slanted box's slanted edge, well inside the box ELK was given.
        if (["kind", "scan", "file"].includes(edge.to)) slanted++;
      }
      expect(slanted).toBeGreaterThanOrEqual(4);
    },
  );

  it.each(examples)("meet the visible outline of every shape in examples/%s, notes' connectors too", async (file) => {
    const doc = await svgDoc(JSON.parse(readFileSync(new URL(file, examplesDir), "utf8")));

    const found = [
      ...lines(doc).map((line) => {
        const [start, end] = lineEnds(line);
        return { el: line, start, end };
      }),
      ...connectors(doc).map((connector) => {
        const [start, end] = connectorEnds(connector);
        return { el: connector, start, end };
      }),
    ];
    expect(found.length).toBeGreaterThan(0);
    for (const { el, start, end } of found) {
      const [from, to] = [el.getAttribute("data-from")!, el.getAttribute("data-to")!];
      expect(distanceToDrawn(start, cardById(doc, from)), `${from} -> ${to} start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(end, cardById(doc, to)), `${from} -> ${to} end`).toBeLessThanOrEqual(1);
    }
  });
});
