import { readdirSync, readFileSync } from "node:fs";
import type { Document } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { cardById, connectorEnds, connectors, depthInShape, distanceToDrawn, lineEnds, lineGeometry, lines, svgDoc } from "./helpers/svg";

const examplesDir = new URL("../examples/", import.meta.url);
const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

/**
 * Sorting the library returns, with lines into and out of every shape from every side:
 * a decision with three ways out, two loops back, a line from a shape to
 * itself, and lines crowding into the slanted box and the pills.
 */
function returns(direction: "down" | "right", statuses: boolean) {
  const status = (s: string) => (statuses ? { status: s } : {});
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "empty", label: "Empty the returns box", shape: "start" },
      { id: "scan", label: "Scan each book", shape: "io", ...status("new") },
      { id: "kind", label: "Damaged, late or fine?", shape: "decision", ...status("changed") },
      { id: "mend", label: "Mend the spine", shape: "subprocess" },
      { id: "late", label: "Note the late fee", shape: "step", ...status("unchanged") },
      { id: "log", label: "Log it in the catalogue", shape: "io" },
      { id: "shelve", label: "Back on the shelf", shape: "end", ...status("removed") },
      { id: "lock", label: "Lock the returns box", shape: "end" },
    ],
    edges: [
      { from: "empty", to: "scan" },
      { from: "scan", to: "kind" },
      { from: "kind", to: "mend", label: "damaged" },
      { from: "kind", to: "late", label: "late" },
      { from: "kind", to: "shelve", label: "fine" },
      { from: "mend", to: "log" },
      { from: "late", to: "log" },
      { from: "log", to: "scan", label: "more books" },
      { from: "late", to: "kind", label: "unsure" },
      { from: "kind", to: "kind", label: "ask" },
      { from: "log", to: "lock" },
      { from: "mend", to: "lock" },
      { from: "empty", to: "lock" },
      { from: "scan", to: "log" },
    ],
  };
}

function ends(doc: Document, input: ReturnType<typeof returns>) {
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
    const input = returns(direction, statuses);
    const doc = await svgDoc(input);

    for (const { what, start, arrowTip, edge } of ends(doc, input)) {
      expect(distanceToDrawn(start, cardById(doc, edge.from)), `${what} start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(arrowTip, cardById(doc, edge.to)), `${what} end`).toBeLessThanOrEqual(1);
    }
  });

  it.each(["down", "right"] as const)(
    "draw the arrowhead at the outline, pointing into the shape from outside it, direction %s",
    async (direction) => {
      const input = returns(direction, false);
      const doc = await svgDoc(input);

      let slanted = 0;
      for (const { what, arrowTip, arrowBase, edge } of ends(doc, input)) {
        const target = cardById(doc, edge.to);
        expect(Math.abs(depthInShape(arrowTip, target)), what).toBeLessThanOrEqual(1);
        expect(depthInShape(arrowBase, target), what).toBeLessThan(0);
        // Ends on a diamond's or slanted box's slanted edge, well inside the box ELK was given.
        if (["kind", "scan", "log"].includes(edge.to)) slanted++;
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
