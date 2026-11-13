import { readdirSync, readFileSync } from "node:fs";
import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import {
  allElements,
  alongRuns,
  badgeBox,
  byClassIn,
  cardById,
  cardExtent,
  cards,
  connectorEnds,
  connectors,
  depthInShape,
  depthInTag,
  distanceToDrawn,
  drawnTextBoxes,
  lineEnds,
  lineGeometry,
  lines,
  outlineBox,
  overlaps,
  parseSvg,
  rectBox,
  svgDoc,
  tagBox,
  tagOf,
  textLines,
  titleOf,
} from "./helpers/svg";
import { pngSize } from "./helpers/png";

type Obj = Record<string, unknown>;
type Diagram = Obj & { areas: Obj[]; nodes: Obj[]; edges: Obj[] };

/**
 * A bakery taking a cake order: the shop with its counter inside it, and the
 * bakehouse. Tests change one thing at a time.
 */
function bakery(): Diagram {
  return {
    type: "flow",
    areas: [
      { id: "shop", label: "Shop" },
      { id: "counter", label: "Counter", parent: "shop" },
      { id: "bakehouse", label: "Bakehouse" },
    ],
    nodes: [
      { id: "order", label: "Take the cake order", shape: "start", area: "counter" },
      { id: "bake", label: "Bake the sponge", shape: "step", area: "bakehouse" },
      { id: "ice", label: "Ice and decorate", shape: "step", area: "bakehouse" },
      { id: "box", label: "Box it for collection", shape: "end", area: "shop" },
    ],
    edges: [
      { from: "order", to: "bake" },
      { from: "bake", to: "ice" },
      { from: "ice", to: "box" },
    ],
  };
}

function bakeryWith(change: (input: Diagram) => void): Diagram {
  const input = bakery();
  change(input);
  return input;
}

async function problems(input: object): Promise<readonly Problem[]> {
  const error = await render(input, opts).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("INVALID_INPUT");
  return (error as StructaError).problems;
}

const opts = { embedFonts: false } as const;
const AREA_HINT = 'use the id of one of the areas in "areas"';

describe("checking areas", () => {
  it("accepts areas, cards in them and groupAreas either way", async () => {
    for (const groupAreas of [undefined, false, true]) {
      const input = groupAreas === undefined ? bakery() : { ...bakery(), groupAreas };
      const doc = await svgDoc(input);

      expect(cards(doc).map((card) => card.getAttribute("data-area"))).toEqual(["counter", "bakehouse", "bakehouse", "shop"]);
    }
  });

  it("lets a card have no area", async () => {
    const doc = await svgDoc(bakeryWith((d) => d.nodes.push({ id: "rest", label: "Rest the sponge", shape: "step" })));

    expect(cardById(doc, "rest").hasAttribute("data-area")).toBe(false);
  });

  it("requires a card's area to name one of the areas", async () => {
    expect(await problems(bakeryWith((d) => (d.nodes[1]!.area = "oven")))).toEqual([
      { path: "nodes[1].area", message: 'no area with id "oven"', hint: AREA_HINT },
    ]);
  });

  it("knows no areas when none are listed", async () => {
    const input = bakeryWith((d) => {
      delete (d as Obj).areas;
      d.nodes.forEach((node, i) => i > 0 && delete node.area);
    });

    expect(await problems(input)).toEqual([{ path: "nodes[0].area", message: 'no area with id "counter"', hint: AREA_HINT }]);
  });

  it("requires an area's parent to name another area", async () => {
    expect(await problems(bakeryWith((d) => (d.areas[1]!.parent = "shop-floor")))).toEqual([
      { path: "areas[1].parent", message: 'no area with id "shop-floor"', hint: AREA_HINT },
    ]);
  });

  it("doesn't let a card's area or a parent be a card", async () => {
    expect(await problems(bakeryWith((d) => (d.nodes[1]!.area = "order")))).toEqual([
      { path: "nodes[1].area", message: 'no area with id "order"', hint: AREA_HINT },
    ]);
  });

  it.each(["from", "to"])("rejects a line whose %s is an area: lines connect cards only", async (end) => {
    expect(await problems(bakeryWith((d) => (d.edges[1]![end] = "bakehouse")))).toEqual([
      { path: `edges[1].${end}`, message: '"bakehouse" is an area, and lines connect cards only', hint: "point the line at a card in the area" },
    ]);
  });

  it("rejects areas whose parents loop", async () => {
    const input = bakeryWith((d) => {
      d.areas[0]!.parent = "bakehouse";
      d.areas[2]!.parent = "counter";
    });

    expect(await problems(input)).toEqual([
      {
        path: "areas[0].parent",
        message: 'the areas\' parents go round in a loop: "shop" → "bakehouse" → "counter" → "shop"',
        hint: "give one of them no parent, or a parent outside the loop",
      },
    ]);
  });

  it("rejects an area that is its own parent", async () => {
    expect(await problems(bakeryWith((d) => (d.areas[2]!.parent = "bakehouse")))).toEqual([
      {
        path: "areas[2].parent",
        message: 'the areas\' parents go round in a loop: "bakehouse" → "bakehouse"',
        hint: "give one of them no parent, or a parent outside the loop",
      },
    ]);
  });

  /** The bakery with its counter nested inside `levels` areas in all, the shop outermost. */
  function nested(levels: number): Diagram {
    return bakeryWith((d) => {
      const extra = Array.from({ length: levels - 2 }, (_, i) => ({ id: `wing-${i}`, label: `Wing ${i}`, parent: i === 0 ? "shop" : `wing-${i - 1}` }));
      d.areas.splice(1, 1, ...extra, { id: "counter", label: "Counter", parent: extra.at(-1)?.id ?? "shop" });
    });
  }

  it("allows areas nested 4 levels deep", async () => {
    const doc = await svgDoc({ ...nested(4), groupAreas: true });

    expect(cardById(doc, "order").getAttribute("data-area")).toBe("counter");
  });

  it("rejects areas nested 5 levels deep, once, at the first area too deep", async () => {
    const input = nested(6);

    expect(await problems(input)).toEqual([
      {
        path: "areas[4].parent",
        message: 'puts "wing-3" 5 levels deep; areas nest at most 4 levels',
        hint: "give it a parent higher up, or no parent",
      },
    ]);
  });

  it("rejects an area with no cards in it or in its child areas", async () => {
    const input = bakeryWith((d) => {
      d.areas.push({ id: "cellar", label: "Cellar" }, { id: "racks", label: "Cooling racks", parent: "cellar" });
    });

    expect(await problems(input)).toEqual([
      { path: "areas[3]", message: '"cellar" has no cards, in it or in the areas inside it', hint: 'put a card in it with "area": "cellar", or remove it' },
      { path: "areas[4]", message: '"racks" has no cards, in it or in the areas inside it', hint: 'put a card in it with "area": "racks", or remove it' },
    ]);
  });

  it("counts an area's cards through its child areas", async () => {
    // The shop holds a card directly; with that gone, it still holds the counter's.
    const input = bakeryWith((d) => delete d.nodes[3]!.area);

    await expect(render(input, opts)).resolves.toHaveProperty("svg");
  });

  it("requires area ids to be unique among the areas, but lets a card share one", async () => {
    expect(await problems(bakeryWith((d) => d.areas.push({ id: "shop", label: "Shop again" })))).toEqual([
      { path: "areas[3].id", message: 'the id "shop" is already used by areas[0]', hint: "give every area its own id" },
    ]);
    const shared = bakeryWith((d) => {
      d.nodes[0]!.id = "counter";
      d.edges[0]!.from = "counter";
    });
    await expect(render(shared, opts)).resolves.toHaveProperty("svg");
  });

  it.each([
    ["id", 'add "id": a unique id among the areas, made of letters, digits and - _ . :'],
    ["label", "add \"label\": the area's name, shown on its cards' tags or at the top-left of its box"],
  ])("requires an area's %s", async (field, hint) => {
    const input = bakeryWith((d) => {
      delete d.areas[2]![field];
      // Without an id nothing can name the bakehouse, so take its cards out of it.
      if (field === "id") d.nodes.forEach((node) => node.area === "bakehouse" && delete node.area);
    });

    expect(await problems(input)).toEqual([{ path: `areas[2].${field}`, message: `missing required field "${field}"`, hint }]);
  });

  it("rejects an unknown field on an area", async () => {
    expect(await problems(bakeryWith((d) => (d.areas[0]!.colour = "pink")))).toEqual([
      { path: "areas[0].colour", message: 'unknown field "colour"', hint: "allowed fields: id, label, parent" },
    ]);
  });

  it.each([
    ["shop floor", '"shop floor" is not a valid id'],
    ["", "must not be empty"],
  ])("rejects the area id %j, and only that", async (id, message) => {
    const input = bakeryWith((d) => {
      d.areas[0]!.id = id;
      d.areas[1]!.parent = id;
      d.nodes[3]!.area = id;
    });

    expect(await problems(input)).toEqual([{ path: "areas[0].id", message, hint: "use only letters, digits and - _ . :" }]);
  });

  it("requires an area id to be a string", async () => {
    expect(await problems(bakeryWith((d) => (d.areas[2]!.id = 7)))).toEqual([
      { path: "areas[2].id", message: "must be a string", hint: "use only letters, digits and - _ . :" },
      { path: "nodes[1].area", message: 'no area with id "bakehouse"', hint: AREA_HINT },
      { path: "nodes[2].area", message: 'no area with id "bakehouse"', hint: AREA_HINT },
    ]);
  });

  it("checks an area's label like any other text, up to 40 characters", async () => {
    await expect(render(bakeryWith((d) => (d.areas[2]!.label = "B".repeat(40))), opts)).resolves.toHaveProperty("svg");
    expect(await problems(bakeryWith((d) => (d.areas[2]!.label = "B".repeat(41))))).toEqual([
      { path: "areas[2].label", message: "is 41 characters long; the limit is 40", hint: "shorten it" },
    ]);
    expect(await problems(bakeryWith((d) => (d.areas[2]!.label = "  ")))).toEqual([
      { path: "areas[2].label", message: "must not be empty", hint: "write the text to show" },
    ]);
    expect(await problems(bakeryWith((d) => (d.areas[2]!.label = "Bake\thouse")))).toEqual([
      { path: "areas[2].label", message: "contains a tab (U+0009)", hint: "use a space instead" },
    ]);
    expect(await problems(bakeryWith((d) => (d.areas[2]!.label = "Bakehouse 🍰")))).toEqual([
      { path: "areas[2].label", message: 'contains "🍰" (U+1F370), which Structa\'s fonts can\'t draw', hint: "use Latin letters, digits and common symbols" },
    ]);
  });

  it.each([
    ["yes", '"yes" is not true or false'],
    [1, "1 is not true or false"],
  ])("rejects groupAreas %j", async (groupAreas, message) => {
    expect(await problems({ ...bakery(), groupAreas })).toEqual([
      { path: "groupAreas", message, hint: "write true or false, without quotes" },
    ]);
  });

  it("allows 100 areas and rejects 101 as INVALID_INPUT", async () => {
    /** n areas, each with a card in it. An unknown field stops the render before layout, so it stays quick. */
    const stalls = (n: number) => ({
      type: "flow",
      areas: Array.from({ length: n }, (_, i) => ({ id: `stall-${i}`, label: `Stall ${i}` })),
      nodes: Array.from({ length: n }, (_, i) => ({ id: `sell-${i}`, label: `Sell at stall ${i}`, shape: "step", area: `stall-${i}` })),
      colour: "red",
    });

    expect(await problems(stalls(100))).toEqual([expect.objectContaining({ path: "colour" })]);
    expect(await problems(stalls(101))).toEqual([
      expect.objectContaining({ path: "colour" }),
      { path: "areas", message: "has 101 areas; the limit is 100", hint: "split the diagram into smaller ones" },
    ]);
  });

  it("requires areas to be a list", async () => {
    expect(await problems({ ...bakery(), areas: { shop: "Shop" } })).toEqual([
      { path: "areas", message: "must be a list of areas", hint: "write it as [...]" },
    ]);
  });

  it("with groupAreas, puts a note about a shape in that shape's area, and rejects another one", async () => {
    const note = { id: "tip", label: "Ask about allergies", shape: "note", about: "order" };
    const boxed = (change: (input: Diagram) => void) => ({ ...bakeryWith(change), groupAreas: true });
    const doc = await svgDoc(boxed((d) => d.nodes.push(note)));
    expect(cardById(doc, "tip").getAttribute("data-area")).toBe("counter");
    await expect(render(boxed((d) => d.nodes.push({ ...note, area: "counter" })), opts)).resolves.toHaveProperty("svg");

    expect(await problems(boxed((d) => d.nodes.push({ ...note, area: "bakehouse" })))).toEqual([
      {
        path: "nodes[4].area",
        message: 'with groupAreas, a note is in the area of the shape it\'s about, and "order" is in "counter"',
        hint: 'leave "area" out, or make it "counter"',
      },
    ]);
    const outside = boxed((d) => {
      delete d.nodes[0]!.area;
      d.nodes.push({ ...note, area: "counter" });
    });
    expect(await problems(outside)).toEqual([
      {
        path: "nodes[4].area",
        message: 'with groupAreas, a note is in the area of the shape it\'s about, and "order" is in no area',
        hint: 'leave "area" out, or put "order" in "counter" too',
      },
    ]);
  });

  it("without groupAreas, gives a note only the area it names, whatever its shape's", async () => {
    const note = { id: "tip", label: "Ask about allergies", shape: "note", about: "order" };
    const untagged = await svgDoc(bakeryWith((d) => d.nodes.push(note)));
    expect(cardById(untagged, "tip").hasAttribute("data-area")).toBe(false);
    expect(tagOf(cardById(untagged, "tip"))).toBeUndefined();

    const elsewhere = await svgDoc(bakeryWith((d) => d.nodes.push({ ...note, area: "bakehouse" })));
    expect(cardById(elsewhere, "tip").getAttribute("data-area")).toBe("bakehouse");
    expect(textLines(tagOf(cardById(elsewhere, "tip"))!.tag)).toEqual(["Bakehouse"]);
  });

  it("lets a note about nothing be in any area", async () => {
    const doc = await svgDoc(bakeryWith((d) => d.nodes.push({ id: "tip", label: "Closed on Mondays", shape: "note", area: "shop" })));

    expect(cardById(doc, "tip").getAttribute("data-area")).toBe("shop");
  });

  it("reports area problems together, after the others, in order", async () => {
    const input = bakeryWith((d) => {
      d.areas.push({ id: "cellar", label: "Cellar", parent: "cellar" }, { id: "yard", label: "Yard", parent: "loft" });
      d.nodes[1]!.area = "oven";
      d.edges[2]!.to = "shop";
    });

    expect(await problems(input)).toEqual([
      { path: "areas[4].parent", message: 'no area with id "loft"', hint: AREA_HINT },
      { path: "nodes[1].area", message: 'no area with id "oven"', hint: AREA_HINT },
      { path: "edges[2].to", message: '"shop" is an area, and lines connect cards only', hint: "point the line at a card in the area" },
      {
        path: "areas[3].parent",
        message: 'the areas\' parents go round in a loop: "cellar" → "cellar"',
        hint: "give one of them no parent, or a parent outside the loop",
      },
      { path: "areas[3]", message: '"cellar" has no cards, in it or in the areas inside it', hint: 'put a card in it with "area": "cellar", or remove it' },
      { path: "areas[4]", message: '"yard" has no cards, in it or in the areas inside it', hint: 'put a card in it with "area": "yard", or remove it' },
    ]);
  });

  it("checks areas in class diagrams too", async () => {
    const shed = {
      type: "class",
      areas: [{ id: "tools", label: "Tools" }],
      nodes: [
        { id: "rake", label: "Rake", area: "tools" },
        { id: "hoe", label: "Hoe", area: "garden" },
      ],
    };

    expect(await problems(shed)).toEqual([{ path: "nodes[1].area", message: 'no area with id "garden"', hint: AREA_HINT }]);
  });
});

/** Every flowchart shape, each in the bakery's areas, with some statuses. */
function everyShape(extra: Obj = {}) {
  return {
    type: "flow",
    ...extra,
    areas: [
      { id: "shop", label: "Shop" },
      { id: "counter", label: "Counter", parent: "shop" },
      { id: "bakehouse", label: "Bakehouse" },
    ],
    nodes: [
      { id: "order", label: "Cake ordered", shape: "start", area: "counter", status: "new" },
      { id: "recipe", label: "Read the recipe card", shape: "io", area: "bakehouse" },
      { id: "bake", label: "Bake the sponge", shape: "subprocess", area: "bakehouse", status: "changed" },
      { id: "risen", label: "Risen?", shape: "decision", area: "bakehouse", status: "unchanged" },
      { id: "ice", label: "Ice it", shape: "step", area: "bakehouse" },
      { id: "collect", label: "Collected", shape: "end", area: "shop", status: "removed" },
      { id: "tip", label: "Butter the tins first", shape: "note", about: "bake", area: "bakehouse" },
    ],
    edges: [
      { from: "order", to: "recipe" },
      { from: "recipe", to: "bake" },
      { from: "bake", to: "risen" },
      { from: "risen", to: "ice", label: "yes" },
      { from: "risen", to: "bake", label: "no" },
      { from: "ice", to: "collect" },
    ],
  };
}

describe("area tags", () => {
  it("shows each card's innermost area name in a tag on its top-left border", async () => {
    const doc = await svgDoc(bakery());

    // The order is at the counter, inside the shop: its tag names only the counter.
    for (const [id, name] of [["order", "Counter"], ["bake", "Bakehouse"], ["box", "Shop"]] as const) {
      const card = cardById(doc, id);
      const { tag, box } = tagOf(card)!;
      const outline = outlineBox(card);
      expect(tag.getAttribute("data-area")).toBe(card.getAttribute("data-area"));
      expect(textLines(tag)).toEqual([name]);
      // Centred on the top border, inside the card's width and nearer its left-hand end.
      expect(box.y + box.height / 2).toBeCloseTo(outline.y, 5);
      const gapLeft = box.x - outline.x;
      const gapRight = outline.x + outline.width - (box.x + box.width);
      expect(gapLeft).toBeGreaterThan(0);
      expect(gapRight).toBeGreaterThan(gapLeft);
    }
  });

  it("gives a card with no area no tag", async () => {
    const doc = await svgDoc(bakeryWith((d) => d.nodes.push({ id: "rest", label: "Rest the sponge", shape: "step" })));

    expect(tagOf(cardById(doc, "rest"))).toBeUndefined();
    expect(textLines(cardById(doc, "rest"))).toEqual(["Rest the sponge"]);
  });

  it("hides the tags when the area boxes are drawn", async () => {
    const doc = await svgDoc({ ...bakery(), groupAreas: true });

    for (const card of cards(doc)) expect(tagOf(card)).toBeUndefined();
  });

  it.each(["start", "io", "subprocess", "step", "end", "note"])(
    "puts a %s's tag on its visible top border, clear of its badge",
    async (shape) => {
      const doc = await svgDoc(everyShape());
      const node = everyShape().nodes.find((n) => n.shape === shape)!;
      const card = cardById(doc, node.id);
      const { box } = tagOf(card)!;
      const outline = outlineBox(card);

      expect(box.y + box.height / 2).toBeCloseTo(outline.y, 5);
      expect(box.x).toBeGreaterThanOrEqual(outline.x);
      expect(box.x + box.width).toBeLessThanOrEqual(outline.x + outline.width);
      // Its lower half covers the border: the middle of its bottom edge is inside the shape.
      expect(depthInShape({ x: box.x + box.width / 2, y: box.y + box.height }, card)).toBeGreaterThan(0);
      const badge = badgeBox(card);
      if (badge) expect(box.x + box.width).toBeLessThan(badge.x);
    },
  );

  it("centres a decision's tag and badge together on its top corner, or its tag alone", async () => {
    const doc = await svgDoc(everyShape());
    const card = cardById(doc, "risen");
    const tag = tagBox(card)!;
    const badge = badgeBox(card)!;
    const outline = outlineBox(card);
    expect(tag.y + tag.height / 2).toBeCloseTo(outline.y, 5);
    expect(tag.x + tag.width).toBeLessThan(badge.x);
    expect((tag.x + badge.x + badge.width) / 2).toBeCloseTo(outline.x + outline.width / 2, 5);

    const plain = everyShape();
    delete (plain.nodes[3] as Obj).status;
    const alone = cardById(await svgDoc(plain), "risen");
    const only = tagBox(alone)!;
    expect(only.x + only.width / 2).toBeCloseTo(outlineBox(alone).x + outlineBox(alone).width / 2, 5);
    expect(depthInShape({ x: only.x + only.width / 2, y: only.y + only.height }, alone)).toBeGreaterThan(0);
  });

  it("puts a class card's tag on its top-left border too, keeping the standard width", async () => {
    const shed = {
      type: "class",
      areas: [{ id: "tools", label: "Garden tools" }],
      nodes: [
        { id: "rake", label: "Rake", area: "tools", status: "new" },
        { id: "hoe", label: "Hoe" },
      ],
    };
    const doc = await svgDoc(shed);
    const card = cardById(doc, "rake");
    const tag = tagBox(card)!;
    const outline = outlineBox(card);

    expect(textLines(tagOf(card)!.tag)).toEqual(["Garden tools"]);
    expect(tag.y + tag.height / 2).toBeCloseTo(outline.y, 5);
    expect(tag.x).toBeGreaterThan(outline.x);
    expect(tag.x + tag.width).toBeLessThan(badgeBox(card)!.x);
    expect(cards(doc).map((c) => outlineBox(c).width)).toEqual([360, 360]);
  });

  it("widens a card to hold a long area name and its badge, never cutting the name", async () => {
    const name = "Wedding and celebration cake decorating";
    const input = bakeryWith((d) => {
      d.areas[2]!.label = name;
      d.nodes[2]!.status = "unchanged";
    });
    const doc = await svgDoc(input);
    const card = cardById(doc, "ice");
    const tag = tagBox(card)!;
    const badge = badgeBox(card)!;
    const outline = outlineBox(card);

    expect(textLines(tagOf(card)!.tag)).toEqual([name]);
    expect(outline.width).toBeGreaterThan(240);
    expect(tag.x).toBeGreaterThan(outline.x);
    expect(tag.x + tag.width).toBeLessThan(badge.x);
    expect(badge.x + badge.width).toBeLessThan(outline.x + outline.width);
  });

  it.each(["down", "right"] as const)("keeps cards, their badges and their tags apart, direction %s", async (direction) => {
    const doc = await svgDoc(everyShape({ direction }));

    const extents = cards(doc).map((card) => ({ id: card.getAttribute("data-id"), box: cardExtent(card) }));
    for (const a of extents) {
      for (const b of extents) if (a !== b) expect(overlaps(a.box, b.box), `${a.id} and ${b.id}`).toBe(false);
    }
  });

  it.each(["down", "right"] as const)("ends every line on what's drawn of a card, tags included, direction %s", async (direction) => {
    const input = everyShape({ direction });
    const doc = await svgDoc(input);

    for (const [i, line] of lines(doc).entries()) {
      const [start, end] = lineEnds(line);
      const edge = input.edges[i]!;
      expect(distanceToDrawn(start, cardById(doc, edge.from)), `edges[${i}] start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(end, cardById(doc, edge.to)), `edges[${i}] end`).toBeLessThanOrEqual(1);
    }
  });

  it("stops a line that comes down onto a tag on top of it, never across it", async () => {
    // Lines from three cards into one narrow card with a wide tag: some must land where the tag is.
    const input = {
      type: "flow",
      areas: [{ id: "oven", label: "Oven and proving cupboard" }],
      nodes: [
        { id: "knead", label: "Knead", shape: "step" },
        { id: "shape", label: "Shape", shape: "step" },
        { id: "score", label: "Score", shape: "step" },
        { id: "prove", label: "Prove", shape: "step", area: "oven" },
      ],
      edges: [
        { from: "knead", to: "prove" },
        { from: "shape", to: "prove" },
        { from: "score", to: "prove" },
      ],
    };
    const doc = await svgDoc(input);
    const target = cardById(doc, "prove");

    let onTag = 0;
    for (const line of lines(doc)) {
      const { route, arrowTip } = lineGeometry(line);
      const deepest = Math.max(...alongRuns([...route.flatMap((c) => c.points), arrowTip]).map((p) => depthInTag(p, target)));
      expect(deepest).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(arrowTip, target)).toBeLessThanOrEqual(1);
      if (Math.abs(depthInTag(arrowTip, target)) <= 1) onTag++;
    }
    expect(onTag).toBeGreaterThan(0);
  });

  it("lines up the outlines of cards side by side, with or without a tag", async () => {
    const input = {
      type: "flow",
      areas: [{ id: "shop", label: "Shop" }],
      nodes: [
        { id: "open", label: "Open up", shape: "start" },
        { id: "lights", label: "Lights on", shape: "step", area: "shop" },
        { id: "till", label: "Count the till", shape: "step" },
      ],
      edges: [
        { from: "open", to: "lights" },
        { from: "open", to: "till" },
      ],
    };
    const doc = await svgDoc(input);

    expect(outlineBox(cardById(doc, "lights")).y).toBe(outlineBox(cardById(doc, "till")).y);
  });

  it.each([
    ["light", "#f6f8fa", "#d1d9e0", "#59636e"],
    ["dark", "#21262d", "#3d444d", "#8b949e"],
  ] as const)("draws a %s-theme tag in neutral colours, at full strength on a removed card", async (theme, fill, border, text) => {
    const doc = await svgDoc(everyShape(), theme);

    for (const id of ["ice", "collect"]) {
      const { tag } = tagOf(cardById(doc, id))!;
      const rect = tag.getElementsByTagName("rect")[0]!;
      expect([rect.getAttribute("fill"), rect.getAttribute("stroke")]).toEqual([fill, border]);
      expect(tag.getElementsByTagName("text")[0]!.getAttribute("fill")).toBe(text);
      expect((tag.parentNode as Element).getAttribute("class")).toBe("card");
    }
  });

  it("draws tags in Inter SemiBold, smaller than the card's label", async () => {
    const doc = await svgDoc(bakery());
    const card = cardById(doc, "bake");
    const tagText = tagOf(card)!.tag.getElementsByTagName("text")[0]!;
    const label = Array.from(card.getElementsByTagName("text")).find((t) => t.textContent === "Bake the sponge")!;

    expect(tagText.getAttribute("font-weight")).toBe("600");
    expect(Number(tagText.getAttribute("font-size"))).toBeLessThan(Number(label.getAttribute("font-size")));
  });
});

/** Each area box drawn, in drawing order: its area's id and parent, its box, and its name with what's behind it. */
function areaBoxes(doc: Document) {
  const names = allElements(doc).filter((el) => el.getAttribute("class") === "area-name");
  return allElements(doc)
    .filter((el) => el.getAttribute("class") === "area")
    .map((area) => {
      const id = area.getAttribute("data-area")!;
      const name = names.find((el) => el.getAttribute("data-area") === id)!;
      return {
        area,
        id,
        parent: area.getAttribute("data-parent") ?? undefined,
        rect: byClassIn(area, "area-box")[0]!,
        box: rectBox(byClassIn(area, "area-box")[0]!),
        name: name.getElementsByTagName("text")[0]!,
        backing: name.getElementsByTagName("rect")[0]!,
      };
    });
}

/** Whether `inner` lies inside `outer`, `margin` px clear of its edges. */
function inside(inner: { x: number; y: number; width: number; height: number }, outer: typeof inner, margin = 0): boolean {
  return (
    inner.x >= outer.x + margin &&
    inner.y >= outer.y + margin &&
    inner.x + inner.width <= outer.x + outer.width - margin &&
    inner.y + inner.height <= outer.y + outer.height - margin
  );
}

/** The ids of an area and of every area inside it, at any depth. */
function within(input: { areas: readonly Obj[] }, id: string): string[] {
  const children = input.areas.filter((a) => a.parent === id).map((a) => a.id as string);
  return [id, ...children.flatMap((child) => within(input, child))];
}

/** A shop that runs three ways at once, its areas nested four deep, with a note in an area of its own. */
function market(direction: "down" | "right" = "down") {
  return {
    type: "flow",
    direction,
    groupAreas: true,
    areas: [
      { id: "market", label: "Market" },
      { id: "hall", label: "Covered hall", parent: "market" },
      { id: "stall", label: "Cheese stall", parent: "hall" },
      { id: "fridge", label: "Fridge", parent: "stall" },
      { id: "yard", label: "Loading yard" },
    ],
    nodes: [
      { id: "unload", label: "Unload the van", shape: "start", area: "yard" },
      { id: "check", label: "Check the temperature", shape: "step", area: "fridge", status: "new" },
      { id: "cold", label: "Cold enough?", shape: "decision", area: "fridge" },
      { id: "cut", label: "Cut and wrap", shape: "step", area: "stall" },
      { id: "price", label: "Price it up", shape: "io", area: "stall", status: "changed" },
      { id: "sell", label: "Sell to customers", shape: "step", area: "hall" },
      { id: "bin", label: "Throw it out", shape: "end", area: "yard", status: "removed" },
      { id: "count", label: "Count the takings", shape: "end", area: "market" },
      { id: "tip", label: "Under five degrees", shape: "note", about: "cold" },
      { id: "rule", label: "Gloves on in the hall", shape: "note", area: "hall" },
    ],
    edges: [
      { from: "unload", to: "check" },
      { from: "check", to: "cold" },
      { from: "cold", to: "cut", label: "yes" },
      { from: "cold", to: "bin", label: "no" },
      { from: "cut", to: "price" },
      { from: "price", to: "sell", emphasis: true },
      { from: "sell", to: "count" },
      { from: "sell", to: "cut", label: "more" },
    ],
  };
}

describe("area boxes", () => {
  it("draws a box for each area, each parent before the areas inside it, named at its top-left", async () => {
    const doc = await svgDoc(market());

    expect(areaBoxes(doc).map(({ id, parent }) => [id, parent])).toEqual([
      ["market", undefined],
      ["hall", "market"],
      ["stall", "hall"],
      ["fridge", "stall"],
      ["yard", undefined],
    ]);
    for (const { area, box, name } of areaBoxes(doc)) {
      const label = market().areas.find((a) => a.id === area.getAttribute("data-area"))!.label;
      expect(name.textContent).toBe(label);
      expect(titleOf(area)).toBe(label);
      expect(name.hasAttribute("text-anchor")).toBe(false);
      const x = Number(name.getAttribute("x"));
      const baseline = Number(name.getAttribute("y"));
      expect(x).toBeGreaterThan(box.x);
      expect(x).toBeLessThan(box.x + 24);
      expect(baseline).toBeGreaterThan(box.y);
      expect(baseline).toBeLessThan(box.y + 32);
    }
  });

  it.each(["down", "right"] as const)("puts every card and every area inside it inside its box, direction %s", async (direction) => {
    const input = market(direction);
    const doc = await svgDoc(input);
    const boxes = new Map(areaBoxes(doc).map(({ id, box }) => [id, box]));

    for (const { id, box } of areaBoxes(doc)) {
      const areas = within(input, id);
      for (const card of cards(doc).filter((c) => areas.includes(c.getAttribute("data-area")!))) {
        expect(inside(cardExtent(card), box, 1), `${card.getAttribute("data-id")} in ${id}`).toBe(true);
      }
      for (const child of areas.slice(1)) expect(inside(boxes.get(child)!, box, 1), `${child} in ${id}`).toBe(true);
      // And nothing else: cards outside it are outside its box.
      for (const card of cards(doc).filter((c) => !areas.includes(c.getAttribute("data-area") ?? ""))) {
        expect(overlaps(cardExtent(card), box), `${card.getAttribute("data-id")} outside ${id}`).toBe(false);
      }
    }
  });

  it.each(["down", "right"] as const)("keeps areas side by side apart, and cards apart, direction %s", async (direction) => {
    const doc = await svgDoc(market(direction));
    const [market_, , , , yard] = areaBoxes(doc);

    expect(overlaps(market_!.box, yard!.box)).toBe(false);
    const extents = cards(doc).map((card) => ({ id: card.getAttribute("data-id"), box: cardExtent(card) }));
    for (const a of extents) {
      for (const b of extents) if (a !== b) expect(overlaps(a.box, b.box), `${a.id} and ${b.id}`).toBe(false);
    }
  });

  it.each(["down", "right"] as const)("keeps every area's name clear of the cards, and inside its box, direction %s", async (direction) => {
    // Rendered with its fonts, so each name's drawn width can be measured. One area's name is far wider than its one card.
    const input = market(direction);
    input.areas[4]!.label = "Loading yard behind the market building";
    const doc = parseSvg((await render(input)).svg);
    const drawn = drawnTextBoxes(doc);

    for (const { id, box, name } of areaBoxes(doc)) {
      const named = drawn.get(name)!;
      expect(inside(named, box, 1), `${id}'s name`).toBe(true);
      for (const card of cards(doc)) expect(overlaps(named, cardExtent(card)), `${card.getAttribute("data-id")} on ${id}'s name`).toBe(false);
    }
  });

  it.each([
    ["light", "#818b98", "0.08", "#d1d9e0", "#59636e"],
    ["dark", "#8b949e", "0.07", "#30363d", "#8b949e"],
  ] as const)("draws every %s-theme box in one see-through neutral fill with a thin border, so nested ones come out darker", async (theme, fill, strength, border, name) => {
    const doc = await svgDoc(market(), theme);

    for (const { rect, name: text } of areaBoxes(doc)) {
      expect([rect.getAttribute("fill"), rect.getAttribute("fill-opacity"), rect.getAttribute("stroke")]).toEqual([fill, strength, border]);
      expect(Number(rect.getAttribute("stroke-width"))).toBeLessThanOrEqual(1);
      expect(Number(rect.getAttribute("rx"))).toBeGreaterThan(0);
      expect(text.getAttribute("fill")).toBe(name);
      expect(text.getAttribute("font-weight")).toBe("600");
    }
  });

  it("draws the boxes under the cards and lines, and their names over the lines", async () => {
    const doc = await svgDoc(market());
    const order = allElements(doc)
      .map((el) => el.getAttribute("class"))
      .filter((kind) => ["area", "card", "line", "area-name", "line-label"].includes(kind!));

    expect(order.lastIndexOf("area")).toBeLessThan(order.indexOf("card"));
    expect(order.lastIndexOf("line")).toBeLessThan(order.indexOf("area-name"));
    // Line labels still go on top of everything.
    expect(order.lastIndexOf("area-name")).toBeLessThan(order.indexOf("line-label"));
  });

  it.each([
    // The background with the see-through fill laid over it once, then twice, then three times, then four.
    ["light", ["#ebedef", "#e2e5e8", "#dbdee2", "#d3d7dc", "#ebedef"]],
    ["dark", ["#161a20", "#1e2329", "#262b31", "#2d3239", "#161a20"]],
  ] as const)("backs each %s-theme name in exactly the colour its box shows, so a line under it doesn't cut through it", async (theme, colours) => {
    // Rendered with its fonts, so each name's drawn width can be measured.
    const doc = parseSvg((await render(market(), { theme })).svg);
    const drawn = drawnTextBoxes(doc);

    expect(areaBoxes(doc).map(({ backing }) => backing.getAttribute("fill"))).toEqual(colours);
    for (const { id, name, backing, box } of areaBoxes(doc)) {
      expect(backing.hasAttribute("fill-opacity"), id).toBe(false);
      expect(inside(drawn.get(name)!, rectBox(backing)), id).toBe(true);
      expect(inside(rectBox(backing), box, 1), id).toBe(true);
    }
  });

  it.each(["down", "right"] as const)("ends every line on its cards, across the boxes, direction %s", async (direction) => {
    const input = market(direction);
    const doc = await svgDoc(input);

    for (const [i, line] of lines(doc).entries()) {
      const [start, end] = lineEnds(line);
      const edge = input.edges[i]!;
      expect(distanceToDrawn(start, cardById(doc, edge.from)), `edges[${i}] start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(end, cardById(doc, edge.to)), `edges[${i}] end`).toBeLessThanOrEqual(1);
    }
    const [start, end] = connectorEnds(connectors(doc)[0]!);
    expect(distanceToDrawn(start, cardById(doc, "tip"))).toBeLessThanOrEqual(1);
    expect(distanceToDrawn(end, cardById(doc, "cold"))).toBeLessThanOrEqual(1);
  });

  it("puts a note about a shape in that shape's box, and a note in an area in its box", async () => {
    const doc = await svgDoc(market());
    const boxes = new Map(areaBoxes(doc).map(({ id, box }) => [id, box]));

    expect(inside(cardExtent(cardById(doc, "tip")), boxes.get("fridge")!, 1)).toBe(true);
    expect(inside(cardExtent(cardById(doc, "rule")), boxes.get("hall")!, 1)).toBe(true);
    expect(inside(cardExtent(cardById(doc, "rule")), boxes.get("stall")!)).toBe(false);
  });

  /** Three ways to sell, in the given order, from one shared step, all in one area. */
  function sales(order: readonly string[], areas: readonly string[] = ["shop"]) {
    return {
      type: "flow",
      groupAreas: true,
      areas: areas.map((id) => ({ id, label: id.toUpperCase() })),
      nodes: [
        { id: "bake", label: "Bake the loaves", shape: "start" },
        ...order.map((id, i) => ({ id, label: `Sell ${id}`, shape: "step", area: areas[i % areas.length] })),
      ],
      edges: order.map((id) => ({ from: "bake", to: id })),
    };
  }

  it.each([[["whole", "sliced", "rolls"]], [["rolls", "whole", "sliced"]], [["sliced", "rolls", "whole"]]])(
    "keeps the listed order of the cards in an area, as a gentle hint: %j",
    async (order) => {
      const doc = await svgDoc(sales(order));
      const across = order.map((id) => outlineBox(cardById(doc, id)).x);

      expect([...across].sort((a, b) => a - b)).toEqual(across);
    },
  );

  it.each([[["front", "back"]], [["back", "front"]]])("keeps the listed order of the areas: %j", async (areas) => {
    const doc = await svgDoc(sales(["whole", "sliced"], areas));
    const across = areaBoxes(doc).map(({ box }) => box.x);

    expect(areaBoxes(doc).map(({ id }) => id)).toEqual(areas);
    expect([...across].sort((a, b) => a - b)).toEqual(across);
  });

  it.each(["down", "right"] as const)("gives each line out of an area its own way out of the box, direction %s", async (direction) => {
    // Two lines of different statuses from one card in the kitchen to two cards outside it.
    const input = {
      type: "flow",
      direction,
      groupAreas: true,
      areas: [{ id: "kitchen", label: "Kitchen" }],
      nodes: [
        { id: "brew", label: "Brew the tea", shape: "step", area: "kitchen" },
        { id: "pour", label: "Pour for the table", shape: "step" },
        { id: "flask", label: "Fill the flask", shape: "step" },
      ],
      edges: [
        { from: "brew", to: "pour", status: "new" },
        { from: "brew", to: "flask", status: "removed" },
      ],
    };
    const doc = await svgDoc(input);
    const { box } = areaBoxes(doc)[0]!;
    const onBorder = (p: { x: number; y: number }) =>
      Math.min(Math.abs(p.x - box.x), Math.abs(p.x - (box.x + box.width)), Math.abs(p.y - box.y), Math.abs(p.y - (box.y + box.height))) < 0.5;
    const exits = lines(doc).map((line) => {
      const route = lineGeometry(line).route.flatMap((c) => c.points);
      return alongRuns(route).find(onBorder)!;
    });

    expect(exits).toHaveLength(2);
    expect(Math.hypot(exits[0]!.x - exits[1]!.x, exits[0]!.y - exits[1]!.y)).toBeGreaterThan(4);
  });

  it("draws nothing different with groupAreas but no areas", async () => {
    const plain = { type: "flow", nodes: [{ id: "bake", label: "Bake", shape: "step" }] };

    expect((await render({ ...plain, groupAreas: true }, opts)).svg).toBe((await render(plain, opts)).svg);
  });

  it("keeps the layout as it is without groupAreas, however the areas are arranged", async () => {
    // The same names on the same cards, but other ids, no nesting and another order.
    const nested = { ...bakery(), legend: false };
    const flat = {
      ...nested,
      areas: [
        { id: "b", label: "Bakehouse" },
        { id: "s", label: "Shop" },
        { id: "c", label: "Counter" },
      ],
      nodes: nested.nodes.map((node) => ({ ...node, area: (node.area as string)[0] === "b" ? "b" : node.area === "shop" ? "s" : "c" })),
    };

    const a = await svgDoc(nested);
    const b = await svgDoc(flat);
    expect(areaBoxes(a)).toEqual([]);
    expect(cards(b).map(outlineBox)).toEqual(cards(a).map(outlineBox));
    expect(lines(b).map((l) => lineEnds(l))).toEqual(lines(a).map((l) => lineEnds(l)));
  });

  it("lays out class cards in area boxes too", async () => {
    const shed = {
      type: "class",
      groupAreas: true,
      areas: [
        { id: "tools", label: "Garden tools" },
        { id: "blades", label: "Blades", parent: "tools" },
      ],
      nodes: [
        { id: "rake", label: "Rake", area: "tools", status: "new", properties: [{ text: "tines: int" }] },
        { id: "shears", label: "Shears", area: "blades", methods: [{ text: "sharpen(): void" }] },
        { id: "shed", label: "Shed" },
      ],
      edges: [
        { from: "shed", to: "rake", kind: "association" },
        { from: "shed", to: "shears", kind: "association" },
      ],
    };
    const doc = await svgDoc(shed);
    const [tools, blades] = areaBoxes(doc);

    expect(inside(cardExtent(cardById(doc, "rake")), tools!.box, 1)).toBe(true);
    expect(inside(cardExtent(cardById(doc, "shears")), blades!.box, 1)).toBe(true);
    expect(inside(blades!.box, tools!.box, 1)).toBe(true);
    expect(overlaps(cardExtent(cardById(doc, "shed")), tools!.box)).toBe(false);
  });

  it("gives the same bytes every time", async () => {
    const first = await render(market(), opts);
    await render(bakery(), opts);

    expect((await render(market(), opts)).svg).toBe(first.svg);
  });
});

describe("every example with areas", () => {
  const examplesDir = new URL("../examples/", import.meta.url);
  const examples = readdirSync(examplesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, input: JSON.parse(readFileSync(new URL(file, examplesDir), "utf8")) as Diagram & { groupAreas?: boolean } }))
    .filter(({ input }) => (input.areas ?? []).length > 0);

  it("has some", () => {
    expect(examples.map(({ input }) => input.groupAreas === true)).toEqual(expect.arrayContaining([true, false]));
  });

  it.each(examples)("keeps the cards, their badges and tags, the area boxes and their names apart as they should be: $file", async ({ input }) => {
    // Rendered with its fonts, so each area's name can be measured.
    const doc = parseSvg((await render(input)).svg);
    const drawn = drawnTextBoxes(doc);
    const extents = cards(doc).map((card) => ({ id: card.getAttribute("data-id"), area: card.getAttribute("data-area"), box: cardExtent(card) }));

    for (const a of extents) {
      for (const b of extents) if (a !== b) expect(overlaps(a.box, b.box), `${a.id} and ${b.id}`).toBe(false);
    }
    for (const { id, box, name } of areaBoxes(doc)) {
      const areas = within(input, id);
      for (const card of extents.filter((c) => areas.includes(c.area ?? ""))) expect(inside(card.box, box, 1), `${card.id} in ${id}`).toBe(true);
      for (const card of extents) expect(overlaps(drawn.get(name)!, card.box), `${card.id} on ${id}'s name`).toBe(false);
    }
    expect(areaBoxes(doc)).toHaveLength(input.groupAreas ? input.areas.length : 0);
  });
});

describe("the legend's areas", () => {
  function legendItems(doc: Document): Element[] {
    const legend = allElements(doc).find((el) => el.getAttribute("class") === "legend");
    return legend ? byClassIn(legend, "legend-item") : [];
  }

  it.each([false, true])("lists every area as a tag, in the order of the areas, after the statuses (groupAreas %s)", async (groupAreas) => {
    // The cards use the areas in another order than they're listed in.
    const input = { ...bakery(), groupAreas, nodes: [...bakery().nodes].reverse() };
    input.nodes[0] = { ...input.nodes[0]!, status: "new" };
    const doc = await svgDoc(input);

    expect(legendItems(doc).map((item) => [item.getAttribute("data-status"), item.getAttribute("data-area")])).toEqual([
      ["new", null],
      [null, "shop"],
      [null, "counter"],
      [null, "bakehouse"],
    ]);
    expect(legendItems(doc).slice(1).map((item) => textLines(tagOf(item)!.tag))).toEqual([["Shop"], ["Counter"], ["Bakehouse"]]);
  });

  it("lists an area with no cards of its own only when its box is drawn", async () => {
    // Nothing is in the shop itself, only at its counter, so no tag says "Shop".
    const input = bakeryWith((d) => delete d.nodes[3]!.area);
    const listed = async (groupAreas: boolean) =>
      legendItems(await svgDoc({ ...input, groupAreas })).map((item) => item.getAttribute("data-area"));

    expect(await listed(false)).toEqual(["counter", "bakehouse"]);
    expect(await listed(true)).toEqual(["shop", "counter", "bakehouse"]);
  });

  it("draws an area's legend tag just like the tags on its cards", async () => {
    const doc = await svgDoc(bakery());
    const onCard = tagOf(cardById(doc, "bake"))!;
    const inLegend = tagOf(legendItems(doc).find((item) => item.getAttribute("data-area") === "bakehouse")!)!;
    const look = (el: Element) => {
      const rect = el.getElementsByTagName("rect")[0]!;
      const text = el.getElementsByTagName("text")[0]!;
      return [rect.getAttribute("fill"), rect.getAttribute("stroke"), rect.getAttribute("rx"), text.getAttribute("fill"), text.getAttribute("font-size")];
    };

    expect(look(inLegend.tag)).toEqual(look(onCard.tag));
    expect([inLegend.box.width, inLegend.box.height]).toEqual([onCard.box.width, onCard.box.height]);
  });

  it("puts the legend's items in a row at the bottom, apart, with only areas when nothing has a status", async () => {
    const doc = await svgDoc(bakery());
    const boxes = legendItems(doc).map((item) => tagBox(item)!);
    const lowest = Math.max(...cards(doc).map((card) => cardExtent(card).y + cardExtent(card).height));

    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
    boxes.slice(1).forEach((b, i) => expect(b.x).toBeGreaterThan(boxes[i]!.x + boxes[i]!.width));
    expect(boxes[0]!.y).toBeGreaterThan(lowest);
  });

  it("is left out with legend: false", async () => {
    const doc = await svgDoc({ ...bakery(), legend: false });

    expect(legendItems(doc)).toEqual([]);
    expect(allElements(doc).some((el) => el.getAttribute("class") === "legend")).toBe(false);
  });

  /** A market of `n` stalls, each selling in an area of its own, in runs of ten, with a new first stall. */
  function stalls(n: number, label: (i: number) => string, direction: "down" | "right" = "right") {
    return {
      type: "flow",
      direction,
      areas: Array.from({ length: n }, (_, i) => ({ id: `stall-${i}`, label: label(i) })),
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `sell-${i}`,
        label: `Sell at ${i}`,
        shape: "step",
        area: `stall-${i}`,
        ...(i === 0 ? { status: "new" } : {}),
      })),
      edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `sell-${i}`, to: `sell-${i + 1}` })).filter((_, i) => i % 10 !== 9),
    };
  }

  /** A legend item's box: an area's tag, or a status's swatch and badge together. */
  function itemBox(item: Element) {
    const tag = tagBox(item);
    if (tag) return tag;
    const swatch = byClassIn(item, "swatch")[0]!;
    const badge = badgeBox(item)!;
    const x = Number(swatch.getAttribute("x1"));
    return { x, y: badge.y, width: badge.x + badge.width - x, height: badge.height };
  }

  const width = (doc: Document) => Number(doc.documentElement!.getAttribute("width"));
  const height = (doc: Document) => Number(doc.documentElement!.getAttribute("height"));
  /** The canvas padding round the drawing, and the widest the title wraps to. */
  const PAD = 32;
  const TITLE_WIDTH = 640;

  it.each([
    [3, (i: number) => `Stall ${i}`, "right", 1],
    // A narrow diagram: the legend wraps to the widest a title can be.
    [12, (i: number) => `The cheese and pickle stall ${i}`, "down", 4],
    [40, (i: number) => `Stall number ${i}`, "right", 3],
    [100, (i: number) => `Stall number ${i}`, "right", 7],
  ] as const)("wraps %i areas into rows no wider than the diagram, or than a title can be", async (n, label, direction, rows) => {
    const input = stalls(n, label, direction);
    const doc = await svgDoc(input);
    const plain = await svgDoc({ ...input, legend: false });
    const items = legendItems(doc);
    const boxes = items.map(itemBox);
    const widest = Math.max(width(plain) - 2 * PAD, TITLE_WIDTH);

    // Everything is there, in order: the status, then the areas.
    expect(items.map((item) => item.getAttribute("data-status") ?? item.getAttribute("data-area"))).toEqual([
      "new",
      ...input.areas.map((area) => area.id),
    ]);
    // The legend never widens the drawing past the diagram, or past the widest a title can be.
    expect(width(doc)).toBeLessThanOrEqual(Math.max(width(plain), TITLE_WIDTH + 2 * PAD));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(PAD);
      expect(box.x + box.width).toBeLessThanOrEqual(PAD + widest);
    }
    // Read left to right, row by row: each item follows the one before on its row, or starts the next row.
    const lowest = Math.max(...cards(doc).map((card) => cardExtent(card).y + cardExtent(card).height));
    expect(boxes[0]!.y).toBeGreaterThan(lowest);
    boxes.slice(1).forEach((b, i) => {
      const before = boxes[i]!;
      if (b.y === before.y) expect(b.x).toBeGreaterThan(before.x + before.width);
      else expect([b.x, b.y > before.y + before.height]).toEqual([PAD, true]);
    });
    // A longer legend makes the drawing taller instead.
    expect(new Set(boxes.map((b) => b.y)).size).toBe(rows);
    expect(height(doc)).toBeGreaterThan(height(plain));
  });

  it("draws 100 areas as a PNG at the default scale", async () => {
    const { svg, png } = await render(stalls(100, (i) => `Stall number ${i}`), { formats: ["svg", "png"], embedFonts: false });
    const doc = parseSvg(svg);

    expect(pngSize(png)).toEqual({ width: 2 * width(doc), height: 2 * height(doc) });
  });
});
