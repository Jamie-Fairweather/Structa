import type { Document } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { problems } from "./helpers/errors";
import {
  allElements,
  badgeBox,
  byClassIn,
  cardById,
  cards,
  connectorEnds,
  connectors,
  distanceOutside,
  distanceToShape,
  lineEnds,
  lines,
  nearestBadgeOrTag,
  outlineBox,
  overlaps,
  svgDoc,
  tagBox,
  titleOf,
  type Box,
} from "./helpers/svg";

type Obj = Record<string, unknown>;

/** Planting garlic, with a note about one step and a note about nothing in particular. */
function garlic(direction: "down" | "right" = "down", extra: { nodes?: Obj[]; edges?: Obj[] } = {}) {
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "split", label: "Split the bulbs", shape: "start" },
      { id: "plant", label: "Plant the cloves", shape: "step" },
      { id: "deep", label: "Deep enough?", shape: "decision" },
      { id: "mulch", label: "Mulch the bed", shape: "end" },
      { id: "pointy", label: "Pointy end up", shape: "note", about: "plant" },
      { id: "when", label: "Best in late autumn", shape: "note" },
      ...(extra.nodes ?? []),
    ],
    edges: [
      { from: "split", to: "plant" },
      { from: "plant", to: "deep" },
      { from: "deep", to: "mulch", label: "yes" },
      { from: "deep", to: "plant", label: "no" },
      ...(extra.edges ?? []),
    ],
  };
}

/**
 * Checks each connector runs from its note's outline to the outline of the
 * shape it's about, both ends within 1px of them and the whole way clear of
 * every badge and tag, and that no two cards overlap.
 */
function expectJoinedAndClear(doc: Document) {
  for (const connector of connectors(doc)) {
    const [note, about] = [connector.getAttribute("data-from")!, connector.getAttribute("data-to")!];
    const [start, end] = connectorEnds(connector);
    expect(distanceToShape(start, cardById(doc, note)), `${note} start`).toBeLessThanOrEqual(1);
    expect(distanceToShape(end, cardById(doc, about)), `${note} end`).toBeLessThanOrEqual(1);
    // Half the theme's 12px clearance, which a connector keeps from every badge and tag, or a little less.
    expect(nearestBadgeOrTag(doc, connector), note).toBeGreaterThan(5);
  }
  const boxes = cards(doc).map((c) => outlineBox(c));
  for (const a of boxes) for (const b of boxes) if (a !== b) expect(overlaps(a, b)).toBe(false);
}

describe("notes", () => {
  it.each(["down", "right"] as const)(
    "joins a note to the shape it's about with a thin dotted connector, outline to outline, direction %s",
    async (direction) => {
      const doc = await svgDoc(garlic(direction));

      const [connector, ...others] = connectors(doc);
      expect(others).toEqual([]);
      expect([connector!.getAttribute("data-from"), connector!.getAttribute("data-to")]).toEqual(["pointy", "plant"]);
      expect(titleOf(connector!)).toBe("Pointy end up (about Plant the cloves)");
      // Not one of the diagram's lines.
      expect(lines(doc).map((l) => l.getAttribute("data-from"))).not.toContain("pointy");

      const paths = Array.from(connector!.getElementsByTagName("path"));
      expect(paths).toHaveLength(1);
      const [path] = paths;
      expect(path!.getAttribute("fill")).toBe("none");
      expect(path!.getAttribute("stroke-dasharray")).toMatch(/^[\d.]+ [\d.]+$/);
      const lineWidth = Number(lines(doc)[0]!.getElementsByTagName("path")[0]!.getAttribute("stroke-width"));
      expect(Number(path!.getAttribute("stroke-width"))).toBeLessThan(lineWidth);

      const [start, end] = connectorEnds(connector!);
      expect(distanceToShape(start, cardById(doc, "pointy"))).toBeLessThanOrEqual(1);
      expect(distanceToShape(end, cardById(doc, "plant"))).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    ["light", "#8c959f"],
    ["dark", "#6e7681"],
  ] as const)("draws the %s connector in the neutral line colour", async (theme, colour) => {
    const doc = await svgDoc(garlic(), theme);

    expect(connectors(doc)[0]!.getElementsByTagName("path")[0]!.getAttribute("stroke")).toBe(colour);
  });

  it.each(["down", "right"] as const)("puts a note beside the shape it's about, direction %s", async (direction) => {
    const doc = await svgDoc(garlic(direction));

    const note = outlineBox(cardById(doc, "pointy"));
    const plant = outlineBox(cardById(doc, "plant"));
    // Level with it across the flow: the two share some of their span along it.
    const span = (b: Box): [number, number] => (direction === "down" ? [b.y, b.y + b.height] : [b.x, b.x + b.width]);
    const [noteFrom, noteTo] = span(note);
    const [plantFrom, plantTo] = span(plant);
    expect(noteFrom).toBeLessThan(plantTo);
    expect(plantFrom).toBeLessThan(noteTo);
  });

  it("floats a note that isn't about anything near the chart, clear of the other cards", async () => {
    const doc = await svgDoc(garlic());

    const when = cardById(doc, "when");
    expect(connectors(doc).map((c) => c.getAttribute("data-from"))).not.toContain("when");
    const box = outlineBox(when);
    const svg = doc.documentElement!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(Number(svg.getAttribute("width")));
    expect(box.y + box.height).toBeLessThan(Number(svg.getAttribute("height")));
    for (const other of cards(doc).filter((c) => c !== when)) expect(overlaps(box, outlineBox(other))).toBe(false);
  });

  it("fades a removed note's connector with it, and leaves the others at full strength", async () => {
    const input = garlic("down", { nodes: [{ id: "label", label: "Label the row", shape: "note", about: "mulch" }] });
    input.nodes[4] = { ...input.nodes[4]!, status: "removed" };
    const doc = await svgDoc(input);

    const [removed, kept] = connectors(doc);
    expect(removed!.getAttribute("data-from")).toBe("pointy");
    expect(byClassIn(removed!, "faded")).toHaveLength(1);
    expect(kept!.getAttribute("data-from")).toBe("label");
    expect(byClassIn(kept!, "faded")).toEqual([]);
  });

  it("lets several notes be about one shape, and notes be about any shape that isn't a note", async () => {
    const input = garlic("down", {
      nodes: [
        { id: "spacing", label: "15 cm apart", shape: "note", about: "plant" },
        { id: "test", label: "Push a finger in", shape: "note", about: "deep", description: "Up to the second knuckle" },
        { id: "first", label: "Pick the biggest bulbs", shape: "note", about: "split", status: "new" },
      ],
    });
    const doc = await svgDoc(input);

    expect(connectors(doc).map((c) => [c.getAttribute("data-from"), c.getAttribute("data-to")])).toEqual([
      ["pointy", "plant"],
      ["spacing", "plant"],
      ["test", "deep"],
      ["first", "split"],
    ]);
    expectJoinedAndClear(doc);
  });

  it.each([
    ["a shape with no lines", { nodes: [{ id: "a", label: "Sweep the path", shape: "step" }], edges: [] }],
    [
      "a shape with a loop on itself",
      { nodes: [{ id: "a", label: "Rake the gravel", shape: "step", status: "new" }], edges: [{ from: "a", to: "a", label: "again" }] },
    ],
  ])("joins notes to %s, outline to outline, clear of everything else", async (_name, { nodes, edges }) => {
    const input = { type: "flow", nodes: [...nodes, { id: "note", label: "Mind the edging", shape: "note", about: "a" }], edges };
    const doc = await svgDoc(input);

    expect(connectors(doc).map((c) => [c.getAttribute("data-from"), c.getAttribute("data-to")])).toEqual([["note", "a"]]);
    expectJoinedAndClear(doc);
  });

  // Crowded notes get slanted connectors, and one can run nearly along a
  // slanted side of the shape, passing just outside its corner.
  const crowded = (["start", "end", "step", "decision", "io", "subprocess"] as const).flatMap((shape) =>
    (["down", "right"] as const).flatMap((direction) => [5, 6].map((count) => [count, shape, direction] as const)),
  );
  /**
   * A note about a small shape with a badge and a tag, both in an area, and,
   * when `looped`, a line from the shape back to itself. The note comes level
   * with its shape, or above it, where the badge and the tag leave little of
   * its top free, and the loop meets the same side.
   */
  function shed(shape: string, direction: "down" | "right", looped: boolean) {
    return {
      type: "flow",
      direction,
      areas: [{ id: "shed", label: "Potting shed" }],
      nodes: [
        { id: "fill", label: "Fill the trays", shape: "start" },
        { id: "sow", label: "Sow", shape, area: "shed", status: "changed" },
        { id: "label", label: "Label the rows", shape: "end" },
        { id: "thin", label: "Sow thinly", shape: "note", about: "sow", area: "shed", status: "new" },
      ],
      edges: [
        { from: "fill", to: "sow" },
        { from: "sow", to: "label" },
        ...(looped ? [{ from: "sow", to: "sow", label: "again" }] : []),
      ],
    };
  }
  const shedCases = (["start", "step", "decision", "io", "subprocess"] as const).flatMap((shape) =>
    (["down", "right"] as const).flatMap((direction) => [false, true].map((looped) => [shape, direction, looped] as const)),
  );

  it.each(shedCases)(
    "runs a note's connector clear of the badge and tag of the %s it's about and of its own, direction %s, with a loop %s",
    async (shape, direction, looped) => {
      const doc = await svgDoc(shed(shape, direction, looped));

      expect(connectors(doc)).toHaveLength(1);
      expectJoinedAndClear(doc);
    },
  );

  it.each(shedCases)(
    "makes room on the %s a note is about for the connector's end, the theme's clearance from its badge and tag and apart from its lines' ends, direction %s, with a loop %s",
    async (shape, direction, looped) => {
      const doc = await svgDoc(shed(shape, direction, looped));

      const sow = cardById(doc, "sow");
      const [start, end] = connectorEnds(connectors(doc)[0]!);
      // The theme keeps line ends 12px from a badge or a tag; a little less for rounding.
      for (const box of [badgeBox(sow)!, tagBox(sow)!]) expect(distanceOutside(end, box)).toBeGreaterThan(11);
      // The ends of the shape's own lines, the loop's both of them: half the theme's 16px pitch from the connector's, but for rounding.
      const ends = lines(doc).flatMap((line) => {
        const [from, to] = lineEnds(line);
        return [...(line.getAttribute("data-from") === "sow" ? [from] : []), ...(line.getAttribute("data-to") === "sow" ? [to] : [])];
      });
      expect(ends).toHaveLength(looped ? 4 : 2);
      for (const p of ends) expect(Math.hypot(p.x - end.x, p.y - end.y)).toBeGreaterThan(7.9);
      // Going right, the note sits over its shape, which leaves room on its top for the connector to come straight down.
      if (direction === "right" && !looped) expect(Math.abs(start.x - end.x)).toBeLessThanOrEqual(1);
    },
  );

  it.each(crowded)("joins %i notes crowding one %s to its outline, clear of everything else, direction %s", async (count, shape, direction) => {
    const input = {
      type: "flow",
      direction,
      nodes: [
        { id: "sow", label: "Sow the seeds", shape: "start" },
        { id: "thin", label: "Thin the seedlings", shape, status: "changed" },
        { id: "water", label: "Water them", shape: "end" },
        ...Array.from({ length: count }, (_, i) => ({
          id: `tip${i}`,
          label: `Thinning tip number ${i} of several`,
          shape: "note",
          about: "thin",
          ...(i === 1 || i === 3 ? { status: "new" } : {}),
        })),
      ],
      edges: [
        { from: "sow", to: "thin" },
        { from: "thin", to: "water" },
        { from: "thin", to: "sow" },
      ],
    };
    const doc = await svgDoc(input);

    expect(connectors(doc).map((c) => c.getAttribute("data-to"))).toEqual(Array(count).fill("thin"));
    expectJoinedAndClear(doc);
  });

  it("draws connectors after the cards and before the lines", async () => {
    const doc = await svgDoc(garlic());

    const order = allElements(doc)
      .map((el) => el.getAttribute("class"))
      .filter((kind) => kind === "card" || kind === "line" || kind === "connector");
    expect(order.indexOf("connector")).toBeGreaterThan(order.lastIndexOf("card"));
    expect(order.indexOf("connector")).toBeLessThan(order.indexOf("line"));
  });
});

describe("checking notes", () => {
  it("rejects lines to or from a note, wherever they are", async () => {
    const input = garlic("down", {
      edges: [
        { from: "mulch", to: "pointy" },
        { id: "aside", from: "when", to: "split" },
        { from: "when", to: "when" },
      ],
    });

    const hint = 'point the note at a shape with "about" instead';
    expect(await problems(input)).toEqual([
      { path: "edges[4].to", message: '"pointy" is a note, and lines can\'t start or end at a note', hint },
      { path: "edges[5].from", message: '"when" is a note, and lines can\'t start or end at a note', hint },
      { path: "edges[6].from", message: '"when" is a note, and lines can\'t start or end at a note', hint },
      { path: "edges[6].to", message: '"when" is a note, and lines can\'t start or end at a note', hint },
    ]);
  });

  it("lets only a note be about another node", async () => {
    const input = garlic();
    input.nodes[1] = { ...input.nodes[1]!, about: "split" };

    expect(await problems(input)).toEqual([
      { path: "nodes[1].about", message: 'only a node with "shape": "note" can have "about"', hint: 'remove "about", or make this node a note' },
    ]);
  });

  it("reports about on a shape once, whatever it names", async () => {
    const input = garlic();
    input.nodes[1] = { ...input.nodes[1]!, about: 3 };

    expect((await problems(input)).map((p) => p.path)).toEqual(["nodes[1].about"]);
  });

  it.each([
    ["left out", undefined, 'missing required field "shape"'],
    ["not a shape", "blob", '"blob" is not a valid shape'],
  ])("doesn't judge about by a shape that's %s, which is reported on its own", async (_name, shape, message) => {
    const input = garlic();
    input.nodes[4] = { ...input.nodes[4]!, shape };

    expect(await problems(input)).toEqual([expect.objectContaining({ path: "nodes[4].shape", message })]);
  });

  it("requires about to name a node", async () => {
    const input = garlic();
    input.nodes[4] = { ...input.nodes[4]!, about: "harvest" };

    expect(await problems(input)).toEqual([
      { path: "nodes[4].about", message: 'no node with id "harvest"', hint: "use the id of one of the nodes" },
    ]);
  });

  it.each([
    ["another note", "when"],
    ["itself", "pointy"],
  ])("doesn't let a note be about %s", async (_name, about) => {
    const input = garlic();
    input.nodes[4] = { ...input.nodes[4]!, about };

    expect(await problems(input)).toEqual([
      {
        path: "nodes[4].about",
        message: `"${about}" is a note, and a note can only be about a shape that isn't a note`,
        hint: "use the id of a shape that isn't a note",
      },
    ]);
  });

  it.each([
    ["a number", 3, "must be a node id"],
    ["a list", ["plant"], "must be a node id"],
  ])("requires about to be a node id, not %s", async (_name, about, message) => {
    const input = garlic();
    input.nodes[4] = { ...input.nodes[4]!, about };

    expect(await problems(input)).toEqual([{ path: "nodes[4].about", message, hint: "use the id of one of the nodes" }]);
  });

  it("reports note problems in their place among the others", async () => {
    const input = garlic("down", { edges: [{ from: "pointy", to: "mulch", colour: "red" }] });
    input.nodes[1] = { ...input.nodes[1]!, about: "split" };
    input.nodes[5] = { ...input.nodes[5]!, about: "pointy" };

    expect((await problems(input)).map((p) => p.path)).toEqual(["nodes[1].about", "nodes[5].about", "edges[4].colour", "edges[4].from"]);
  });
});
