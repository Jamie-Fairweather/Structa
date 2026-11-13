import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import {
  alongRuns,
  badgeBox,
  cardById,
  cardExtent,
  cards,
  depthInShape,
  depthInTag,
  distanceToDrawn,
  lineEnds,
  lineGeometry,
  lines,
  outlineBox,
  overlaps,
  svgDoc,
  tagBox,
  tagOf,
  textLines,
} from "./helpers/svg";

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

  it("puts a note about a shape in that shape's area, and rejects another one", async () => {
    const note = { id: "tip", label: "Ask about allergies", shape: "note", about: "order" };
    const doc = await svgDoc(bakeryWith((d) => d.nodes.push(note)));
    expect(cardById(doc, "tip").getAttribute("data-area")).toBe("counter");
    await expect(render(bakeryWith((d) => d.nodes.push({ ...note, area: "counter" })), opts)).resolves.toHaveProperty("svg");

    expect(await problems(bakeryWith((d) => d.nodes.push({ ...note, area: "bakehouse" })))).toEqual([
      {
        path: "nodes[4].area",
        message: 'a note is in the area of the shape it\'s about, and "order" is in "counter"',
        hint: 'leave "area" out, or make it "counter"',
      },
    ]);
    const outside = bakeryWith((d) => {
      delete d.nodes[0]!.area;
      d.nodes.push({ ...note, area: "counter" });
    });
    expect(await problems(outside)).toEqual([
      {
        path: "nodes[4].area",
        message: 'a note is in the area of the shape it\'s about, and "order" is in no area',
        hint: 'leave "area" out, or put "order" in "counter" too',
      },
    ]);
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
      { id: "tip", label: "Butter the tins first", shape: "note", about: "bake" },
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
