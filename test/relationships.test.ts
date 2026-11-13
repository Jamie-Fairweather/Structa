import { readdirSync, readFileSync } from "node:fs";
import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { problems } from "./helpers/errors";
import {
  allElements,
  alongRuns,
  boundsOf,
  byClassIn,
  cardById,
  cardExtent,
  cards,
  depthInShape,
  distanceOutside,
  distanceToShape,
  drawnTextBoxes,
  lineEnds,
  lineParts,
  lines,
  outlineBox,
  overlaps,
  parseSvg,
  pathLength,
  rectBox,
  svgDoc,
  titleOf,
  type Box,
  type EndMark,
  type Point,
} from "./helpers/svg";

const KINDS = ["inherits", "implements", "composition", "aggregation", "association", "dependency"] as const;
type Kind = (typeof KINDS)[number];

/** Two classes in a potting shed, joined by one line with whatever fields a test adds. */
function shed(edge: object = {}) {
  return {
    type: "class",
    nodes: [
      { id: "bench", label: "PottingBench" },
      { id: "tray", label: "SeedTray" },
    ],
    edges: [{ from: "bench", to: "tray", kind: "association", ...edge }],
  };
}

describe("class lines", () => {
  it("draws an association as a plain line between the cards, with no arrowhead", async () => {
    const doc = await svgDoc(shed());

    const [line] = lines(doc);
    expect(line!.getAttribute("data-kind")).toBe("association");
    expect([line!.getAttribute("data-from"), line!.getAttribute("data-to")]).toEqual(["bench", "tray"]);
    const { route, routeElement, dashed, start, end } = lineParts(line!);
    expect(line!.getElementsByTagName("path")).toHaveLength(1);
    expect(routeElement.getAttribute("fill")).toBe("none");
    expect([dashed, start, end]).toEqual([false, undefined, undefined]);
    // The line runs all the way from one card's outline to the other's.
    expect(distanceToShape(route[0]!, cardById(doc, "bench"))).toBeLessThanOrEqual(1);
    expect(distanceToShape(route.at(-1)!, cardById(doc, "tray"))).toBeLessThanOrEqual(1);
  });

  it("names both classes in the line's tooltip, with its label", async () => {
    const doc = await svgDoc(shed({ label: "holds" }));

    expect(titleOf(lines(doc)[0]!)).toBe("PottingBench – SeedTray: holds");
  });

  it.each<[object, string]>([
    [{ kind: "inherits" }, "PottingBench inherits from SeedTray"],
    [{ kind: "implements" }, "PottingBench implements SeedTray"],
    [{ kind: "composition" }, "PottingBench owns SeedTray"],
    [{ kind: "aggregation", fromLabel: "1", toLabel: "0..*" }, "PottingBench (1) has SeedTray (0..*)"],
    [{ kind: "association" }, "PottingBench – SeedTray"],
    [{ kind: "association", directed: true }, "PottingBench → SeedTray"],
    [{ kind: "dependency", label: "waters" }, "PottingBench depends on SeedTray: waters"],
  ])("names the relationship in the line's tooltip, as a reader would say it: %j", async (edge, tooltip) => {
    const doc = await svgDoc(shed(edge));

    expect(titleOf(lines(doc)[0]!)).toBe(tooltip);
  });

  it("requires a kind", async () => {
    const input = shed();
    delete (input.edges[0] as { kind?: string }).kind;

    expect(await problems(input)).toEqual([
      {
        path: "edges[0].kind",
        message: 'missing required field "kind"',
        hint: 'add "kind": the relationship the line shows, "inherits", "implements", "composition", "aggregation", "association" or "dependency"',
      },
    ]);
  });

  it("rejects an unknown field, listing the fields a class line can have", async () => {
    expect(await problems(shed({ fromCount: "1", toLabel: "*" }))).toEqual([
      {
        path: "edges[0].fromCount",
        message: 'unknown field "fromCount"',
        hint: "allowed fields: id, from, to, label, status, emphasis, kind, fromLabel, toLabel, directed",
      },
    ]);
  });

  it.each(["extends", "Inherits", "uses", 3])("rejects the kind %j", async (kind) => {
    expect(await problems(shed({ kind }))).toEqual([
      {
        path: "edges[0].kind",
        message: `${JSON.stringify(kind)} is not a valid kind`,
        hint: 'use "inherits", "implements", "composition", "aggregation", "association" or "dependency"',
      },
    ]);
  });

  it.each(KINDS)("draws a %s line, its kind in its data attributes", async (kind) => {
    const doc = await svgDoc(shed({ kind }));

    const [line] = lines(doc);
    expect([line!.getAttribute("data-kind"), line!.getAttribute("data-from"), line!.getAttribute("data-to")]).toEqual([kind, "bench", "tray"]);
  });

  it.each<[Kind, boolean]>([
    ["inherits", false],
    ["implements", true],
    ["composition", false],
    ["aggregation", false],
    ["association", false],
    ["dependency", true],
  ])("draws a %s line dashed: %s", async (kind, dashed) => {
    const doc = await svgDoc(shed({ kind }));

    const parts = lineParts(lines(doc)[0]!);
    expect(parts.dashed).toBe(dashed);
    // The marks at its ends are drawn whole, never dashed.
    for (const mark of [parts.start, parts.end]) if (mark) expect(mark.dashed).toBe(false);
  });
});

/**
 * Garden tools, listed children first: spades, forks and loppers are tools,
 * loppers can be sharpened, and a border spade is a spade. Every child also
 * has lines of its own to its parent, pulling the other way.
 */
type Edge = { from: string; to: string; kind: string; directed?: boolean };

function tools(direction?: "down" | "right", pulls: readonly Edge[] = []) {
  return {
    type: "class",
    ...(direction ? { direction } : {}),
    nodes: [
      { id: "border", label: "BorderSpade" },
      { id: "spade", label: "Spade" },
      { id: "fork", label: "DiggingFork" },
      { id: "loppers", label: "Loppers" },
      { id: "tool", label: "Tool", abstract: true },
      { id: "sharpenable", label: "Sharpenable", stereotype: "interface" },
    ],
    edges: [
      { from: "border", to: "spade", kind: "inherits" },
      { from: "spade", to: "tool", kind: "inherits" },
      { from: "fork", to: "tool", kind: "inherits" },
      { from: "loppers", to: "tool", kind: "inherits" },
      { from: "loppers", to: "sharpenable", kind: "implements" },
      ...pulls,
    ] as Edge[],
  };
}

/** Lines from children to their parents that aren't inherits or implements: on their own, they'd put each child first. */
const PULLS: readonly Edge[] = [
  { from: "spade", to: "tool", kind: "dependency" },
  { from: "spade", to: "tool", kind: "association", directed: true },
  { from: "fork", to: "tool", kind: "dependency" },
  { from: "fork", to: "tool", kind: "association", directed: true },
  { from: "loppers", to: "sharpenable", kind: "dependency" },
  { from: "loppers", to: "sharpenable", kind: "association", directed: true },
  { from: "border", to: "spade", kind: "dependency" },
  { from: "border", to: "spade", kind: "association", directed: true },
];

describe("parents before children", () => {
  it.each<["down" | "right", boolean]>([
    ["down", false],
    ["right", false],
    ["down", true],
    ["right", true],
  ])("places every parent in an earlier layer than its children, direction %s, other lines pulling the other way: %s", async (direction, pulled) => {
    const input = tools(direction, pulled ? PULLS : []);
    const doc = await svgDoc(input);

    for (const edge of input.edges.filter((e) => e.kind === "inherits" || e.kind === "implements")) {
      const child = outlineBox(cardById(doc, edge.from));
      const parent = outlineBox(cardById(doc, edge.to));
      const what = `${edge.to} before ${edge.from}`;
      if (direction === "down") expect(parent.y + parent.height, what).toBeLessThanOrEqual(child.y);
      else expect(parent.x + parent.width, what).toBeLessThanOrEqual(child.x);
    }
  });

  it("does so by default, which is direction down", async () => {
    expect((await render(tools(), { embedFonts: false })).svg).toBe((await render(tools("down"), { embedFonts: false })).svg);
  });

  it.each(["down", "right"] as const)("points each triangle into its parent: up with direction down, left with direction right", async (direction) => {
    const input = tools(direction, PULLS);
    const doc = await svgDoc(input);

    const hierarchy = lines(doc).filter((line) => ["inherits", "implements"].includes(line.getAttribute("data-kind")!));
    expect(hierarchy).toHaveLength(5);
    for (const line of hierarchy) {
      const { route, end } = lineParts(line);
      expect(distanceToShape(end!.tip, cardById(doc, line.getAttribute("data-to")!))).toBeLessThanOrEqual(1);
      expect(distanceToShape(route[0]!, cardById(doc, line.getAttribute("data-from")!))).toBeLessThanOrEqual(1);
      // The triangle's tip is past its base the way the parents lie.
      const base = route.at(-1)!;
      if (direction === "down") expect(end!.tip.y).toBeLessThan(base.y);
      else expect(end!.tip.x).toBeLessThan(base.x);
    }
  });

  /** Parent before child for every inherits and implements line in the drawing, along the flow. */
  function expectParentsFirst(doc: Document, direction: "down" | "right") {
    const hierarchy = lines(doc).filter((line) => ["inherits", "implements"].includes(line.getAttribute("data-kind")!));
    expect(hierarchy.length).toBeGreaterThan(0);
    for (const line of hierarchy) {
      const [from, to] = [line.getAttribute("data-from")!, line.getAttribute("data-to")!];
      const child = outlineBox(cardById(doc, from));
      const parent = outlineBox(cardById(doc, to));
      if (direction === "down") expect(parent.y + parent.height, `${to} before ${from}`).toBeLessThanOrEqual(child.y);
      else expect(parent.x + parent.width, `${to} before ${from}`).toBeLessThanOrEqual(child.x);
    }
  }

  /**
   * A shrub's family: Shrub is a Plant, and each kind of shrub is a Shrub,
   * with a line of its own back to Plant. Weighed up on their own, those
   * lines rank Shrub, with its children, ahead of Plant.
   */
  function shrubs(direction: "down" | "right", count: number, back: Partial<Edge>, via?: Partial<Edge>) {
    const kinds = ["rose", "lavender", "hebe", "box", "holly"].slice(0, count);
    return {
      type: "class",
      direction,
      nodes: [
        { id: "plant", label: "Plant", abstract: true },
        { id: "shrub", label: "Shrub" },
        ...kinds.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
        ...(via ? [{ id: "trellis", label: "Trellis" }] : []),
      ],
      edges: [
        { from: "shrub", to: "plant", kind: "inherits" },
        ...kinds.map((id) => ({ from: id, to: "shrub", kind: "inherits" })),
        // Straight back to Plant, or round through the trellis.
        ...kinds.map((id) => ({ from: id, to: via ? "trellis" : "plant", kind: "association", ...back })),
        ...(via ? [{ from: "trellis", to: "plant", kind: "association", ...via }] : []),
      ] as Edge[],
    };
  }

  it.each(
    (["down", "right"] as const).flatMap((direction) =>
      [{ kind: "composition" }, { kind: "dependency" }, { kind: "association", directed: true }].flatMap((back) =>
        [2, 3, 5].map((count) => [direction, back, count] as const),
      ),
    ),
  )("keeps a parent first when its child has children of its own with lines back to it, direction %s, lines back %j, %i children", async (direction, back, count) => {
    expectParentsFirst(await svgDoc(shrubs(direction, count, back)), direction);
  });

  it.each(["down", "right"] as const)("keeps a parent first when the lines back to it go round through a class that's neither, direction %s", async (direction) => {
    expectParentsFirst(await svgDoc(shrubs(direction, 4, { kind: "aggregation" }, { kind: "dependency" })), direction);
  });
});

describe("lines into one parent, or from one owner", () => {
  /** A watering can, a hose, a sprinkler and a drip line: each can water, and some are new. */
  function waterers(direction: "down" | "right", edits: Partial<Edge & { status: string; toLabel: string; fromLabel: string }>[] = []) {
    const ids = ["can", "hose", "sprinkler", "drip"];
    return {
      type: "class",
      direction,
      nodes: [
        { id: "waters", label: "Waters", stereotype: "interface" },
        ...ids.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
      ],
      edges: ids.map((id, i) => ({ from: id, to: "waters", kind: "implements", ...edits[i] })),
    };
  }

  /** Each distinct mark drawn on lines of this kind: lines that share an end draw the same mark there, once over another. */
  function marksOf(doc: Document, kind: string): string[] {
    const drawn = lines(doc)
      .filter((line) => line.getAttribute("data-kind") === kind)
      .flatMap((line) => [lineParts(line).start, lineParts(line).end])
      .flatMap((mark) => (mark ? [mark.element.getAttribute("d")!] : []));
    return [...new Set(drawn)];
  }

  it.each(["down", "right"] as const)("meet the parent at one point under one triangle, as UML draws them, direction %s", async (direction) => {
    const doc = await svgDoc(waterers(direction));

    const hierarchy = lines(doc);
    expect(hierarchy).toHaveLength(4);
    expect(marksOf(doc, "implements")).toHaveLength(1);
    for (const line of hierarchy) {
      const { route, end } = lineParts(line);
      expect(distanceToShape(end!.tip, cardById(doc, "waters"))).toBeLessThanOrEqual(1);
      expect(distanceToShape(route[0]!, cardById(doc, line.getAttribute("data-from")!))).toBeLessThanOrEqual(1);
    }
  });

  it.each(["down", "right"] as const)("dash alike where they meet: each ends in a whole dash at the shared triangle, direction %s", async (direction) => {
    const doc = await svgDoc(waterers(direction));

    for (const line of lines(doc)) {
      const { routeElement } = lineParts(line);
      const [dash, gap] = routeElement.getAttribute("stroke-dasharray")!.split(" ").map(Number);
      const offset = Number(routeElement.getAttribute("stroke-dashoffset"));
      // Where the pattern is at the route's end, counted from the start of a dash: right at the end of one.
      const phase = (pathLength(routeElement.getAttribute("d")!) + offset) % (dash! + gap!);
      expect(Math.abs(phase - dash!)).toBeLessThan(0.25);
    }
  });

  it("keep their own ends where they're drawn differently: in another status, or with another count", async () => {
    const doc = await svgDoc(waterers("right", [{}, { status: "new" }, { toLabel: "1" }, {}]));

    // The can and the drip line share a triangle; the new hose and the counted sprinkler have their own.
    expect(marksOf(doc, "implements")).toHaveLength(3);
  });

  it.each(["down", "right"] as const)(
    "share an owner's diamond, its count shown once, and keep every count and mark clear of the others, direction %s",
    async (direction) => {
      // A herb bed holds five herbs, each with a count of its own, and each herb is a Plant.
      const herbs = ["basil", "chives", "mint", "sage", "thyme"];
      const input = {
        type: "class",
        direction,
        nodes: [{ id: "bed", label: "HerbBed" }, { id: "plant", label: "Plant" }, ...herbs.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }))],
        edges: [
          ...herbs.map((id) => ({ from: "bed", to: id, kind: "aggregation", fromLabel: "1", toLabel: "0..*" })),
          ...herbs.map((id) => ({ from: id, to: "plant", kind: "inherits" })),
        ],
      };
      const doc = await fontsDoc(input);

      expect(marksOf(doc, "aggregation")).toHaveLength(1);
      expect(marksOf(doc, "inherits")).toHaveLength(1);
      const drawn = lines(doc).flatMap((line) => [...endLabels(doc, line)].map(([end, label]) => ({ line, end, ...label })));
      expect(drawn.filter(({ end }) => end === "from").map(({ texts }) => texts[0]!.textContent)).toEqual(["1"]);
      expect(drawn.filter(({ end }) => end === "to").map(({ texts }) => texts[0]!.textContent)).toEqual(Array(5).fill("0..*"));
      const marks = lines(doc).flatMap((line) => [lineParts(line).start, lineParts(line).end].filter((mark) => mark !== undefined));
      for (const [i, { line, end, box }] of drawn.entries()) {
        const what = `${line.getAttribute("data-to")} ${end}`;
        for (const card of cards(doc)) expect(overlaps(box, outlineBox(card)), `${what} clear of ${card.getAttribute("data-id")}`).toBe(false);
        for (const mark of marks) expect(overlaps(box, boundsOf(mark.corners)), `${what} clear of the marks`).toBe(false);
        for (const other of drawn.slice(i + 1)) expect(overlaps(box, other.box), `${what} clear of the other counts`).toBe(false);
      }
    },
  );
});

describe("loops of parents", () => {
  const LOOP_HINT = "a class can't be its own parent, even through others: remove one of the lines in the loop";
  const loop = (path: string, ids: readonly string[]) => ({
    path,
    message: `the classes' parents go round in a loop: ${ids.map((id) => JSON.stringify(id)).join(" → ")}`,
    hint: LOOP_HINT,
  });

  it("rejects two classes that inherit from each other, at the line listed later, which closes the loop", async () => {
    const input = tools(undefined, [{ from: "tool", to: "spade", kind: "inherits" }]);

    expect(await problems(input)).toEqual([loop("edges[5].to", ["tool", "spade", "tool"])]);
  });

  it("rejects a class that inherits from itself", async () => {
    const input = tools(undefined, [{ from: "fork", to: "fork", kind: "inherits" }]);

    expect(await problems(input)).toEqual([loop("edges[5].to", ["fork", "fork"])]);
  });

  it("rejects a loop of inherits and implements lines, however long", async () => {
    // border → spade → tool, then tool → sharpenable → border.
    const input = tools(undefined, [
      { from: "tool", to: "sharpenable", kind: "implements" },
      { from: "sharpenable", to: "border", kind: "inherits" },
    ]);

    expect(await problems(input)).toEqual([loop("edges[6].to", ["sharpenable", "border", "spade", "tool", "sharpenable"])]);
  });

  it("reports each loop once, at the line that closes it, so removing the lines reported leaves none", async () => {
    // Two loops through tool, tool → spade → tool and tool → fork → tool, and one with both: border → spade → tool → fork → border.
    const input = tools(undefined, [
      { from: "tool", to: "spade", kind: "implements" },
      { from: "tool", to: "fork", kind: "inherits" },
      { from: "fork", to: "border", kind: "inherits" },
    ]);

    expect(await problems(input)).toEqual([
      loop("edges[5].to", ["tool", "spade", "tool"]),
      loop("edges[6].to", ["tool", "fork", "tool"]),
    ]);
    // The last line is only in a loop through a line reported already, so it isn't reported: without those, no loop is left.
    const fixed = { ...input, edges: input.edges.filter((_, i) => i !== 5 && i !== 6) };
    await expect(render(fixed)).resolves.toHaveProperty("svg");
  });

  it("allows other kinds of line to go round in a loop", async () => {
    const input = tools(undefined, [
      { from: "tool", to: "spade", kind: "association" },
      { from: "tool", to: "border", kind: "dependency" },
      { from: "tool", to: "fork", kind: "composition" },
      { from: "tool", to: "loppers", kind: "aggregation" },
      { from: "sharpenable", to: "loppers", kind: "association", directed: true },
    ]);

    await expect(render(input)).resolves.toHaveProperty("svg");
  });

  it("reports a loop together with the diagram's other problems, after them as for areas, and leaves lines to no node out of it", async () => {
    const input = tools(undefined, [
      { from: "tool", to: "spade", kind: "inherits" },
      { from: "tool", to: "shovel", kind: "inherits" },
      { from: "shovel", to: "tool", kind: "inherits" },
    ]);
    input.nodes[1] = { ...input.nodes[1]!, label: "" };

    expect(await problems(input)).toEqual([
      { path: "nodes[1].label", message: "must not be empty", hint: "write the text to show" },
      { path: "edges[6].to", message: 'no node with id "shovel"', hint: "use the id of one of the nodes" },
      { path: "edges[7].from", message: 'no node with id "shovel"', hint: "use the id of one of the nodes" },
      loop("edges[5].to", ["tool", "spade", "tool"]),
    ]);
  });
});

/** A line's end labels: each one's group, its texts and the box its text is drawn in. The SVG must embed its fonts, so text can be measured. */
function endLabels(doc: Document, line: Element): Map<string, { group: Element; texts: Element[]; box: Box }> {
  const boxes = drawnTextBoxes(doc);
  return new Map(
    byClassIn(line, "end-label").map((group) => {
      const texts = Array.from(group.getElementsByTagName("text"));
      return [group.getAttribute("data-end")!, { group, texts, box: boundsOf(texts.flatMap((t) => corners(boxes.get(t)!))) }];
    }),
  );
}

function corners(box: Box): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
  ];
}

/**
 * How far from its end of the line a count may be: 16px, and past the mark
 * at that end when there is one, and past the band a badge overhangs when
 * the cards have one.
 */
function reach(mark: EndMark | undefined, band = 0): number {
  const length = mark ? Math.max(...mark.corners.map((c) => Math.hypot(c.x - mark.tip.x, c.y - mark.tip.y))) : 0;
  return 16 + length + band;
}

async function fontsDoc(input: object, theme: "light" | "dark" = "light"): Promise<Document> {
  return parseSvg((await render(input, { theme })).svg);
}

describe("end labels", () => {
  /** Every kind of line, between classes stacked down or side by side. */
  const CASES = KINDS.flatMap((kind) => (["down", "right"] as const).map((direction) => [kind, direction] as const));

  it.each(CASES)("draw a %s line's fromLabel beside its start and toLabel beside its end, clear of the cards and marks, direction %s", async (kind, direction) => {
    const input = { ...shed({ kind, fromLabel: "1", toLabel: "0..*" }), direction };
    const doc = await fontsDoc(input);

    const line = lines(doc)[0]!;
    const labels = endLabels(doc, line);
    expect([...labels.keys()]).toEqual(["from", "to"]);
    expect([labels.get("from")!.texts.map((t) => t.textContent), labels.get("to")!.texts.map((t) => t.textContent)]).toEqual([["1"], ["0..*"]]);
    const [start, end] = lineEnds(line);
    const { route, start: startMark, end: endMark } = lineParts(line);
    for (const [name, own, other, mark] of [["from", start, end, startMark], ["to", end, start, endMark]] as const) {
      const { box } = labels.get(name)!;
      expect(distanceOutside(own!, box), `${name} near its end`).toBeLessThanOrEqual(reach(mark));
      expect(distanceOutside(own!, box)).toBeLessThan(distanceOutside(other!, box));
      for (const card of cards(doc)) expect(overlaps(box, outlineBox(card)), `${name} clear of the cards`).toBe(false);
      for (const mark of [startMark, endMark]) if (mark) expect(overlaps(box, boundsOf(mark.corners)), `${name} clear of the marks`).toBe(false);
      expect(alongRuns(route).some((p) => distanceOutside(p, box) === 0), `${name} clear of the line`).toBe(false);
    }
  });

  it.each(["down", "right"] as const)("stay at their own ends on lines laid out parent first, direction %s", async (direction) => {
    const input = tools(direction);
    input.edges[1] = { ...input.edges[1]!, fromLabel: "many", toLabel: "one" } as Edge;
    const doc = await fontsDoc(input);

    const line = lines(doc)[1]!;
    const labels = endLabels(doc, line);
    const [start, end] = lineEnds(line);
    expect(labels.get("from")!.texts[0]!.textContent).toBe("many");
    expect(distanceOutside(start, labels.get("from")!.box)).toBeLessThanOrEqual(reach(undefined));
    // The parent's end has the triangle.
    expect(distanceOutside(end, labels.get("to")!.box)).toBeLessThanOrEqual(reach(lineParts(line).end));
    expect(overlaps(labels.get("from")!.box, outlineBox(cardById(doc, "spade")))).toBe(false);
  });

  it.each(
    (["down", "right"] as const).flatMap((direction) =>
      [{ kind: "composition", label: "split into" }, { kind: "association", directed: true }, { kind: "dependency" }].map((edge) => [direction, edge] as const),
    ),
  )("sit beside their own ends of a line from a class to itself, clear of the card and of the line, direction %s: %j", async (direction, edge) => {
    const input = beds(direction);
    input.edges = [{ ...input.edges[0]!, ...edge }];
    const doc = await fontsDoc(input);

    const bed = cardById(doc, "bed");
    const [line] = lines(doc);
    const labels = endLabels(doc, line!);
    expect([...labels.keys()]).toEqual(["from", "to"]);
    const [start, end] = lineEnds(line!);
    const { route, start: startMark, end: endMark } = lineParts(line!);
    expect([distanceToShape(start, bed), distanceToShape(end, bed)].every((d) => d <= 1)).toBe(true);
    for (const [name, own, other, mark] of [["from", start, end, startMark], ["to", end, start, endMark]] as const) {
      const { box } = labels.get(name)!;
      expect(distanceOutside(own, box), `${name} near its end`).toBeLessThanOrEqual(reach(mark));
      expect(distanceOutside(own, box)).toBeLessThan(distanceOutside(other, box));
      expect(overlaps(box, outlineBox(bed))).toBe(false);
      expect(alongRuns(route).some((p) => distanceOutside(p, box) === 0), `${name} clear of the line`).toBe(false);
      for (const mark of [startMark, endMark]) if (mark) expect(overlaps(box, boundsOf(mark.corners)), `${name} clear of the marks`).toBe(false);
    }
  });

  it("draw just the one label a line has", async () => {
    const doc = await fontsDoc(shed({ toLabel: "*" }));

    expect([...endLabels(doc, lines(doc)[0]!).keys()]).toEqual(["to"]);
  });

  it("are drawn in Inter Regular, in the theme's text colour, smaller than a middle label", async () => {
    for (const [theme, colour] of [["light", "#1f2328"], ["dark", "#e6edf3"]] as const) {
      const doc = await fontsDoc(shed({ fromLabel: "1", toLabel: "1..*", label: "holds" }), theme);
      const line = lines(doc)[0]!;
      const pill = allElements(doc).find((el) => el.getAttribute("class") === "line-label")!.getElementsByTagName("text")[0]!;
      for (const { texts } of endLabels(doc, line).values()) {
        const [text] = texts;
        expect([text!.getAttribute("font-family")!.split(",")[0], text!.getAttribute("font-weight"), text!.getAttribute("fill")]).toEqual([
          "Structa Inter",
          "400",
          colour,
        ]);
        expect(Number(text!.getAttribute("font-size"))).toBeLessThan(Number(pill.getAttribute("font-size")));
      }
    }
  });

  it("are faded and struck through on a removed line", async () => {
    const doc = await fontsDoc(shed({ fromLabel: "1", toLabel: "0..*", status: "removed" }));

    const line = lines(doc)[0]!;
    const [faded] = byClassIn(line, "faded");
    for (const { group, texts } of endLabels(doc, line).values()) {
      expect(faded!.contains(group)).toBe(true);
      expect(byClassIn(group, "strike")).toHaveLength(texts.length);
    }
    const plain = await fontsDoc(shed({ fromLabel: "1", toLabel: "0..*", status: "changed" }));
    expect(byClassIn(lines(plain)[0]!, "strike")).toEqual([]);
  });

  it("are named in the line's tooltip", async () => {
    const doc = await svgDoc(shed({ fromLabel: "1", toLabel: "0..*", label: "holds" }));

    expect(titleOf(lines(doc)[0]!)).toBe("PottingBench (1) – SeedTray (0..*): holds");
  });

  it.each(["fromLabel", "toLabel"])("check %s like any other text: tidied, never blank, at most 20 characters, and drawable in Inter", async (field) => {
    const tidy = await svgDoc(shed({ [field]: "  0..*  " }));
    expect(titleOf(lines(tidy)[0]!)).toContain("(0..*)");

    expect(await problems(shed({ [field]: "   " }))).toEqual([{ path: `edges[0].${field}`, message: "must not be empty", hint: "write the text to show" }]);
    await expect(render(shed({ [field]: "1".repeat(20) }))).resolves.toHaveProperty("svg");
    expect(await problems(shed({ [field]: "1".repeat(21) }))).toEqual([
      { path: `edges[0].${field}`, message: "is 21 characters long; the limit is 20", hint: "shorten it" },
    ]);
    // JetBrains Mono can draw ⇑, but Inter, which draws end labels, can't.
    expect(await problems(shed({ [field]: "⇑" }))).toEqual([
      expect.objectContaining({ path: `edges[0].${field}`, message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw' }),
    ]);
    expect(await problems(shed({ [field]: 1 }))).toEqual([{ path: `edges[0].${field}`, message: "must be a string", hint: "write the text in double quotes" }]);
  });
});

const examplesDir = new URL("../examples/", import.meta.url);
const classExamples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({ file, input: JSON.parse(readFileSync(new URL(file, examplesDir), "utf8")) as { type: string; direction?: string } }))
  .filter(({ input }) => input.type === "class");

describe("every class example", () => {
  it.each(classExamples)("draws each count clear of every card, line and mark, and beside its own end: $file", async ({ input }) => {
    const doc = await fontsDoc(input);

    const drawn = lines(doc).map((line) => ({ line, parts: lineParts(line), ends: lineEnds(line) }));
    for (const { line, parts, ends } of drawn) {
      for (const [name, { box }] of endLabels(doc, line)) {
        const what = `${line.getAttribute("data-id")} ${name}`;
        const [own, other] = name === "from" ? ends : [ends[1], ends[0]];
        const mark = name === "from" ? parts.start : parts.end;
        // Some examples' cards have the 8px band a badge overhangs.
        expect(distanceOutside(own, box), `${what} near its end`).toBeLessThanOrEqual(reach(mark, 8));
        expect(distanceOutside(own, box)).toBeLessThan(distanceOutside(other, box));
        for (const card of cards(doc)) expect(overlaps(box, cardExtent(card)), `${what} clear of ${card.getAttribute("data-id")}`).toBe(false);
        for (const { line: crossed, parts: route } of drawn) {
          const id = crossed.getAttribute("data-id");
          expect(alongRuns(route.route).some((p) => distanceOutside(p, box) <= 0.75), `${what} clear of ${id}`).toBe(false);
          for (const m of [route.start, route.end]) if (m) expect(overlaps(box, boundsOf(m.corners)), `${what} clear of ${id}'s marks`).toBe(false);
        }
      }
    }
  });

  it.each(classExamples)("places every parent in an earlier layer than its children: $file", async ({ input }) => {
    const doc = await svgDoc(input);

    const hierarchy = lines(doc).filter((line) => ["inherits", "implements"].includes(line.getAttribute("data-kind")!));
    for (const line of hierarchy) {
      const child = outlineBox(cardById(doc, line.getAttribute("data-from")!));
      const parent = outlineBox(cardById(doc, line.getAttribute("data-to")!));
      if (input.direction === "right") expect(parent.x + parent.width).toBeLessThanOrEqual(child.x);
      else expect(parent.y + parent.height).toBeLessThanOrEqual(child.y);
    }
  });

});

describe("every example", () => {
  const examples = readdirSync(examplesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, input: JSON.parse(readFileSync(new URL(file, examplesDir), "utf8")) as object }));

  it.each(examples)("draws every line's pattern and marks as its kind says: $file", async ({ input }) => {
    const doc = await svgDoc(input);

    for (const line of lines(doc)) {
      const { routeElement, dashed, start, end } = lineParts(line);
      const kind = line.getAttribute("data-kind")!;
      // Filled with the line's own colour, or hollow; an open arrow is just strokes.
      const filled = (mark: EndMark) => (mark.fill === routeElement.getAttribute("stroke") ? "filled" : "hollow");
      const shape = (mark: EndMark | undefined) => mark && `${mark.shape} ${mark.shape === "open-arrow" ? "open" : filled(mark)}`;
      const expected = new Map([
        ["flow", [false, undefined, "triangle filled"]],
        ["call", [false, undefined, "triangle filled"]],
        ["async", [true, undefined, "open-arrow open"]],
        ["inherits", [false, undefined, "triangle hollow"]],
        ["implements", [true, undefined, "triangle hollow"]],
        ["composition", [false, "diamond filled", undefined]],
        ["aggregation", [false, "diamond hollow", undefined]],
        ["dependency", [true, undefined, "open-arrow open"]],
        // A relationship's ends are crow's feet, and it's dotted when not enforced: the ER tests check those.
        ["relationship", [dashed, undefined, undefined]],
      ]);
      // An association has an open arrow only when it's directed.
      const association = [false, undefined, end && "open-arrow open"];
      expect([kind, dashed, shape(start), shape(end)]).toEqual([kind, ...(expected.get(kind) ?? association)]);
    }
  });
});

/**
 * An allotment society, its classes in area boxes: plots (greenhouses
 * among them), members and the seed shop. Most lines cross from one area
 * into another, with counts at both ends.
 */
function allotment(direction: "down" | "right") {
  return {
    type: "class",
    direction,
    groupAreas: true,
    areas: [
      { id: "plots", label: "Plots" },
      { id: "glass", label: "Greenhouses", parent: "plots" },
      { id: "people", label: "Members" },
      { id: "shop", label: "Seed shop" },
    ],
    nodes: [
      { id: "plot", label: "Plot", area: "plots", properties: [{ text: "number: int" }] },
      { id: "bed", label: "Bed", area: "plots" },
      { id: "greenhouse", label: "Greenhouse", area: "glass", status: "new" },
      { id: "member", label: "Member", area: "people" },
      { id: "order", label: "SeedOrder", area: "shop" },
    ],
    edges: [
      { from: "member", to: "plot", kind: "association", fromLabel: "1", toLabel: "0..2", label: "tends" },
      { from: "plot", to: "bed", kind: "composition", fromLabel: "1", toLabel: "1..*" },
      { from: "greenhouse", to: "plot", kind: "inherits", status: "new" },
      { from: "order", to: "member", kind: "association", fromLabel: "0..*", toLabel: "1", directed: true },
      { from: "order", to: "bed", kind: "dependency", toLabel: "1..*", label: "sows" },
    ],
  };
}

describe("end labels across area boxes", () => {
  it.each(["down", "right"] as const)("sit beside their own ends, clear of the cards and the area names, direction %s", async (direction) => {
    const input = allotment(direction);
    const doc = await fontsDoc(input);

    const names = byClassIn(doc.documentElement!, "area-name").map((name) => rectBox(name.getElementsByTagName("rect")[0]!));
    expect(names).toHaveLength(4);
    let crossing = 0;
    for (const line of lines(doc)) {
      const [start, end] = lineEnds(line);
      const from = line.getAttribute("data-from")!;
      const to = line.getAttribute("data-to")!;
      const area = (id: string) => input.nodes.find((node) => node.id === id)!.area;
      if (area(from) !== area(to)) crossing++;
      const parts = lineParts(line);
      for (const [name, { box }] of endLabels(doc, line)) {
        const [own, other, mark] = name === "from" ? [start, end, parts.start] : [end, start, parts.end];
        const what = `${line.getAttribute("data-id")} ${name}`;
        // A card has a status, so every card's box has the 8px band its badge overhangs, and ELK keeps counts above it.
        expect(distanceOutside(own, box), `${what} near its end`).toBeLessThanOrEqual(reach(mark, 8));
        expect(distanceOutside(own, box)).toBeLessThan(distanceOutside(other, box));
        for (const card of cards(doc)) expect(overlaps(box, cardExtent(card)), `${what} clear of ${card.getAttribute("data-id")}`).toBe(false);
        for (const nameBox of names) expect(overlaps(box, nameBox), `${what} clear of the area names`).toBe(false);
      }
    }
    expect(crossing).toBeGreaterThanOrEqual(3);
  });
});

/**
 * A raised bed split into smaller beds, and next to another bed: two lines
 * from a class to itself. ELK nests them, the inner one just off the card.
 */
function beds(direction: "down" | "right") {
  return {
    type: "class",
    direction,
    nodes: [{ id: "bed", label: "RaisedBed", properties: [{ text: "length: Metres" }] }],
    edges: [
      { from: "bed", to: "bed", kind: "composition", fromLabel: "1", toLabel: "0..*", label: "split into" },
      { from: "bed", to: "bed", kind: "aggregation", fromLabel: "1", toLabel: "0..1" },
    ],
  };
}

/** What a test expects at one end of a line: a mark's shape and whether it's filled with the line's colour, or nothing. */
type Expected = { shape: EndMark["shape"]; filled: boolean } | undefined;

const HOLLOW_TRIANGLE: Expected = { shape: "triangle", filled: false };
const FILLED_DIAMOND: Expected = { shape: "diamond", filled: true };
const HOLLOW_DIAMOND: Expected = { shape: "diamond", filled: false };
const OPEN_ARROW: Expected = { shape: "open-arrow", filled: false };

/** The page's colours, the theme's hollow fill and its neutral and new line colours. */
const COLOURS = {
  light: { hollow: "#ffffff", line: "#8c959f", new: "#1f883d" },
  dark: { hollow: "#161b22", line: "#6e7681", new: "#3fb950" },
} as const;

describe("class line ends", () => {
  it.each<[string, object, Expected, Expected]>([
    ["inherits", { kind: "inherits" }, undefined, HOLLOW_TRIANGLE],
    ["implements", { kind: "implements" }, undefined, HOLLOW_TRIANGLE],
    ["composition", { kind: "composition" }, FILLED_DIAMOND, undefined],
    ["aggregation", { kind: "aggregation" }, HOLLOW_DIAMOND, undefined],
    ["association", { kind: "association" }, undefined, undefined],
    ["dependency", { kind: "dependency" }, undefined, OPEN_ARROW],
  ])("draw a %s line with the right mark at each end", async (_name, edge, atFrom, atTo) => {
    const doc = await svgDoc(shed(edge));

    const { start, end } = lineParts(lines(doc)[0]!);
    const seen = (mark: EndMark | undefined): Expected =>
      mark && { shape: mark.shape, filled: mark.shape !== "open-arrow" && mark.fill === COLOURS.light.line };
    expect([seen(start), seen(end)]).toEqual([atFrom, atTo]);
  });

  it.each(["light", "dark"] as const)(
    "fill hollow triangles and diamonds with the %s theme's hollow fill, outlined in the line's colour",
    async (theme) => {
      for (const kind of ["inherits", "aggregation", "composition", "dependency"]) {
        for (const status of [undefined, "new"]) {
          const doc = await svgDoc(shed({ kind, ...(status ? { status } : {}) }), theme);

          const { routeElement, start, end } = lineParts(lines(doc)[0]!);
          const mark = (start ?? end)!;
          const colour = status ? COLOURS[theme].new : COLOURS[theme].line;
          expect([kind, status, routeElement.getAttribute("stroke"), mark.stroke]).toEqual([kind, status, colour, colour]);
          const fill = kind === "composition" ? colour : kind === "dependency" ? "none" : COLOURS[theme].hollow;
          expect([kind, status, mark.fill]).toEqual([kind, status, fill]);
        }
      }
    },
  );

  it.each(["inherits", "implements", "dependency"])("put a %s line's mark at to, its tip on the card, the line running into it", async (kind) => {
    const doc = await svgDoc(shed({ kind }));

    const { route, end } = lineParts(lines(doc)[0]!);
    const tray = cardById(doc, "tray");
    expect(distanceToShape(end!.tip, tray)).toBeLessThanOrEqual(1);
    for (const corner of end!.corners) if (corner !== end!.tip) expect(depthInShape(corner, tray)).toBeLessThan(0);
    // A triangle is hollow, so the line stops at its base; an open arrow is just strokes, so the line runs to its tip.
    const [, left, right] = end!.corners;
    const meets = end!.shape === "triangle" ? { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 } : end!.tip;
    expect(Math.hypot(route.at(-1)!.x - meets.x, route.at(-1)!.y - meets.y)).toBeLessThanOrEqual(1);
  });

  it("draw an open arrow at to on a directed association, the line running to its tip", async () => {
    const doc = await svgDoc(shed({ directed: true, label: "holds" }));

    const line = lines(doc)[0]!;
    const { route, dashed, start, end } = lineParts(line);
    expect([dashed, start, end?.shape, end?.fill]).toEqual([false, undefined, "open-arrow", "none"]);
    expect(distanceToShape(end!.tip, cardById(doc, "tray"))).toBeLessThanOrEqual(1);
    expect(Math.hypot(route.at(-1)!.x - end!.tip.x, route.at(-1)!.y - end!.tip.y)).toBeLessThanOrEqual(1);
    expect(titleOf(line)).toBe("PottingBench → SeedTray: holds");
  });

  it("draw an association with directed: false as one with directed left out", async () => {
    expect((await render(shed({ directed: false }), { embedFonts: false })).svg).toBe((await render(shed(), { embedFonts: false })).svg);
  });

  it.each(["inherits", "implements", "composition", "aggregation", "dependency"])("reject directed on a %s line", async (kind) => {
    expect(await problems(shed({ kind, directed: true }))).toEqual([
      {
        path: "edges[0].directed",
        message: 'only an edge with "kind": "association" can have "directed"',
        hint: 'remove "directed", or make the line an association',
      },
    ]);
  });

  it.each(["yes", 1, null])("reject directed: %j", async (directed) => {
    expect(await problems(shed({ directed }))).toEqual([
      { path: "edges[0].directed", message: `${JSON.stringify(directed)} is not true or false`, hint: "write true or false, without quotes" },
    ]);
  });

  it.each(["down", "right"] as const)(
    "never run past the first bend of their line: on a short loop from a class to itself, the diamond shrinks to fit, direction %s",
    async (direction) => {
      const doc = await svgDoc(beds(direction));

      const bed = cardById(doc, "bed");
      const sizes = lines(doc).map((line) => {
        const { route, start } = lineParts(line);
        expect(distanceToShape(start!.tip, bed)).toBeLessThanOrEqual(1);
        // The line starts at the diamond's far corner: had the diamond run past the bend, the line would start at the bend instead.
        const far = start!.corners[2]!;
        expect(Math.hypot(route[0]!.x - far.x, route[0]!.y - far.y)).toBeLessThanOrEqual(1);
        return Math.hypot(far.x - start!.tip.x, far.y - start!.tip.y);
      });
      // ELK puts the inner loop just 10px off the card, so its diamond is shorter than the outer one's.
      expect(Math.min(...sizes)).toBeLessThan(Math.max(...sizes));
    },
  );

  it.each(["composition", "aggregation"])("put a %s line's diamond at from, the owner, its tip on the card, the line starting behind it", async (kind) => {
    const doc = await svgDoc(shed({ kind }));

    const { route, start } = lineParts(lines(doc)[0]!);
    const bench = cardById(doc, "bench");
    expect(distanceToShape(start!.tip, bench)).toBeLessThanOrEqual(1);
    for (const corner of start!.corners.slice(1)) expect(depthInShape(corner, bench)).toBeLessThan(0);
    // The line starts at the diamond's far corner, so it doesn't run through a hollow one.
    const far = start!.corners[2]!;
    expect(Math.hypot(route[0]!.x - far.x, route[0]!.y - far.y)).toBeLessThanOrEqual(1);
  });
});
