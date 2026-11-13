import { readdirSync, readFileSync } from "node:fs";
import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  badgeBox,
  cardById,
  connectorEnds,
  connectors,
  depthInShape,
  distanceToShape,
  lineEnds,
  lineGeometry,
  lineParts,
  lines,
  nearestBadgeOrTag,
  svgDoc,
  tagBox,
  type Point,
} from "./helpers/svg";

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

/**
 * Lines into one small card whose wide badge and long tag leave little of
 * its top border free, from cards that come before it, and lines out: five
 * in and one out unless asked. The card is a flowchart shape, or an
 * architecture diagram's component or class.
 */
function stack(direction: "down" | "right", shape: string, into = 5, out = 1) {
  const type = ["component", "class"].includes(shape) ? "architecture" : "flow";
  const as = (kind: string): Record<string, string> =>
    type === "flow" ? { shape: kind === "component" ? "step" : kind } : { kind: kind === "component" ? "service" : kind };
  const trees = ["oak", "ash", "elm", "birch", "larch", "beech", "maple", "pine", "yew", "alder"].slice(0, into);
  const uses = ["planks", "posts", "beams", "boards", "shingles", "fences", "sheds", "gates"].slice(0, out);
  return {
    type,
    direction,
    areas: [{ id: "yard", label: "Timber yard and saw mill" }],
    nodes: [
      ...trees.map((id) => ({ id, label: `Fell the ${id}`, ...as("component") })),
      { id: "stack", label: "Stack", area: "yard", status: "unchanged", ...as(shape) },
      ...uses.map((id) => ({ id, label: `Cut ${id}`, ...as("component") })),
    ],
    edges: [...trees.map((id) => ({ from: id, to: "stack" })), ...uses.map((id) => ({ from: "stack", to: id }))],
  };
}

/** Points at least this far apart don't touch: arrowheads side by side. */
const CLEAR = 4;

/**
 * How far every line and the marks at its ends stay from every badge and
 * tag: the theme keeps line ends 12px from them, and the widest end mark, a
 * hollow triangle, reaches 7px either side of its line.
 */
const CLEAR_OF_BADGES = 5;

/** How far apart two points are. */
function apart(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The widest of the lines' arrowheads, across their backs. */
function widestArrowhead(found: readonly Element[]): number {
  return Math.max(
    ...found.map((line) => {
      const [, left, right] = lineParts(line).end!.corners;
      return apart(left!, right!);
    }),
  );
}

/** Checks that each line starts and ends on its cards' outlines, and that it and its marks keep clear of every badge and tag. */
function expectOnOutlinesClearOfBadges(doc: Document) {
  for (const line of lines(doc)) {
    const [from, to] = [line.getAttribute("data-from")!, line.getAttribute("data-to")!];
    const [start, end] = lineEnds(line);
    expect(distanceToShape(start, cardById(doc, from)), `${from} -> ${to} start`).toBeLessThanOrEqual(1);
    expect(distanceToShape(end, cardById(doc, to)), `${from} -> ${to} end`).toBeLessThanOrEqual(1);
    expect(nearestBadgeOrTag(doc, line), `${from} -> ${to}`).toBeGreaterThan(CLEAR_OF_BADGES);
  }
}

describe("line ends", () => {
  it.each([
    ["down", false],
    ["right", false],
    ["down", true],
    ["right", true],
  ] as const)("meet the visible outline of every shape within 1px, clear of badges, direction %s, statuses %s", async (direction, statuses) => {
    const input = returns(direction, statuses);
    const doc = await svgDoc(input);

    for (const { what, start, arrowTip, edge } of ends(doc, input)) {
      expect(distanceToShape(start, cardById(doc, edge.from)), `${what} start`).toBeLessThanOrEqual(1);
      expect(distanceToShape(arrowTip, cardById(doc, edge.to)), `${what} end`).toBeLessThanOrEqual(1);
    }
    for (const [i, line] of lines(doc).entries()) expect(nearestBadgeOrTag(doc, line), `edges[${i}]`).toBeGreaterThan(CLEAR_OF_BADGES);
  });

  const shapes = ["step", "io", "subprocess", "start", "end", "decision", "component", "class"];
  it.each(shapes.flatMap((shape) => (["down", "right"] as const).map((direction) => [shape, direction] as const)))(
    "end on a %s's outline when its wide badge and long tag crowd its top border, clear of them, direction %s",
    async (shape, direction) => {
      const doc = await svgDoc(stack(direction, shape));
      const card = cardById(doc, "stack");
      expect(badgeBox(card)!.width + tagBox(card)!.width).toBeGreaterThan(200);

      expect(lines(doc).filter((line) => line.getAttribute("data-to") === "stack")).toHaveLength(5);
      expectOnOutlinesClearOfBadges(doc);
    },
  );

  // A pill's ends curve in under its tag and badge, so lines meeting its sides high up would run on close to them.
  it.each(
    (["start", "end"] as const).flatMap((shape) =>
      (["right", "down"] as const).flatMap((direction) =>
        [
          [8, 1],
          [10, 1],
          [1, 8],
        ].map(([into, out]) => [shape, into!, out!, direction] as const),
      ),
    ),
  )("end on a %s's outline clear of its wide badge and long tag with %i lines in and %i out, direction %s", async (shape, into, out, direction) => {
    const doc = await svgDoc(stack(direction, shape, into, out));

    expect(lines(doc)).toHaveLength(into + out);
    expectOnOutlinesClearOfBadges(doc);
  });

  // Going down, lines come onto a card's top, which is widened for them; going right, onto its side, and a
  // flowchart shape or a component is made taller for them. A class keeps the height its rows need.
  it.each(
    shapes.flatMap((shape) =>
      (["down", "right"] as const).flatMap((direction) => (direction === "right" && shape === "class" ? [] : [[shape, direction] as const])),
    ),
  )("leaves room on a %s for every line that comes into it past its wide badge and long tag, arrowheads side by side, direction %s", async (shape, direction) => {
    const doc = await svgDoc(stack(direction, shape));

    const into = lines(doc).filter((line) => line.getAttribute("data-to") === "stack");
    const tips = into.map((line) => lineParts(line).end!.tip);
    const widest = widestArrowhead(into);
    expect(tips).toHaveLength(5);
    for (const [i, a] of tips.entries()) {
      for (const b of tips.slice(i + 1)) expect(apart(a, b)).toBeGreaterThan(widest + CLEAR);
    }
  });

  /**
   * A shape with a badge and a tag, a line from it back to itself, and lines
   * in, `into` of them, and out: going down, the loop runs off one of its
   * sides, and going right, over its top.
   */
  function loop(direction: "down" | "right", shape: string, into: number, tagged: boolean) {
    const posts = ["letters", "parcels", "postcards"].slice(0, into);
    return {
      type: "flow",
      direction,
      areas: tagged ? [{ id: "desk", label: "Front desk" }] : [],
      nodes: [
        ...posts.map((id) => ({ id, label: `Open the ${id}`, shape: "start" })),
        { id: "sort", label: "Sorted?", shape, status: "new", ...(tagged ? { area: "desk" } : {}) },
        { id: "file", label: "File it away", shape: "end" },
      ],
      edges: [...posts.map((id) => ({ from: id, to: "sort" })), { from: "sort", to: "sort", label: "not yet" }, { from: "sort", to: "file" }],
    };
  }

  it.each(
    ["step", "io", "subprocess", "start", "end", "decision"].flatMap((shape) =>
      (["down", "right"] as const).flatMap((direction) =>
        [
          [1, true],
          [3, false],
        ].map(([into, tagged]) => [shape, direction, into as number, tagged as boolean] as const),
      ),
    ),
  )("keeps the two ends of a line from a %s back to itself at least an arrowhead apart, direction %s, %i in, tagged %s", async (shape, direction, into, tagged) => {
    const doc = await svgDoc(loop(direction, shape, into, tagged));

    const back = lines(doc).find((line) => line.getAttribute("data-from") === "sort" && line.getAttribute("data-to") === "sort")!;
    const [start, end] = lineEnds(back);
    expect(apart(start, end)).toBeGreaterThan(widestArrowhead([back]) + CLEAR);
    expectOnOutlinesClearOfBadges(doc);
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

  it.each(examples.flatMap((file) => (["down", "right"] as const).map((direction) => [file, direction] as const)))(
    "meet the visible outline of every shape in examples/%s, clear of badges and tags, direction %s, notes' connectors too",
    async (file, direction) => {
      const doc = await svgDoc({ ...JSON.parse(readFileSync(new URL(file, examplesDir), "utf8")), direction });

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
        expect(distanceToShape(start, cardById(doc, from)), `${from} -> ${to} start`).toBeLessThanOrEqual(1);
        expect(distanceToShape(end, cardById(doc, to)), `${from} -> ${to} end`).toBeLessThanOrEqual(1);
        expect(nearestBadgeOrTag(doc, el), `${from} -> ${to}`).toBeGreaterThan(CLEAR_OF_BADGES);
      }
    },
  );
});
