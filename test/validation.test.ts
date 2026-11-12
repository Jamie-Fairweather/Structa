import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import { cardById, lines, parseSvg, textLines, titleOf } from "./helpers/svg";

type Obj = Record<string, unknown>;

/** A small valid flowchart; tests change one thing at a time. */
function pond(): Obj & { nodes: Obj[]; edges: Obj[] } {
  return {
    type: "flow",
    nodes: [
      { id: "dig", label: "Dig the hole", shape: "step" },
      { id: "line", label: "Lay the liner", shape: "step" },
      { id: "fill", label: "Fill with rainwater", shape: "step" },
    ],
    edges: [
      { from: "dig", to: "line" },
      { id: "then-fill", from: "line", to: "fill" },
    ],
  };
}

/** The pond with one change made to it. */
function pondWith(change: (input: ReturnType<typeof pond>) => void): Obj {
  const input = pond();
  change(input);
  return input;
}

async function rejection(input: unknown): Promise<StructaError> {
  const error = await render(input as object).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("INVALID_INPUT");
  return error as StructaError;
}

async function problems(input: unknown): Promise<readonly Problem[]> {
  return (await rejection(input)).problems;
}

const opts = { embedFonts: false } as const;

describe("the top level", () => {
  it.each([
    ["a list", []],
    ["a string", "flow"],
    ["null", null],
  ])("must be an object, not %s", async (_name, input) => {
    expect(await problems(JSON.stringify(input))).toEqual([
      { path: "$", message: "must be an object describing one diagram", hint: 'write it as {"type": ..., "nodes": ...}' },
    ]);
  });

  it("accepts version 1, and a missing version as the current one", async () => {
    const without = await render(pond(), opts);
    const with1 = await render({ version: 1, ...pond() }, opts);

    expect(with1.svg).toBe(without.svg);
  });

  it.each([
    [2, "2 is not supported"],
    ["1", '"1" is not supported'],
  ])("rejects version %j", async (version, message) => {
    expect(await problems({ version, ...pond() })).toEqual([
      { path: "version", message, hint: "use 1, or leave version out" },
    ]);
  });

  it("requires a type", async () => {
    expect(await problems(pondWith((p) => delete p.type))).toEqual([
      { path: "type", message: 'missing required field "type"', hint: 'add "type": the kind of diagram, "flow"' },
    ]);
  });

  it.each([
    ["class", '"class" is not supported yet'],
    ["er", '"er" is not supported yet'],
    ["architecture", '"architecture" is not supported yet'],
    [7, "7 is not a valid type"],
  ])("accepts only implemented types, not %j", async (type, message) => {
    expect(await problems({ ...pond(), type })).toEqual([{ path: "type", message, hint: 'use "flow"' }]);
  });

  it("doesn't guess at the nodes and edges of a type it doesn't support", async () => {
    const tables = { type: "er", nodes: [{ id: "orders", label: "orders", columns: [] }], edges: [{ fromColumn: "id" }] };

    expect(await problems(tables)).toEqual([{ path: "type", message: '"er" is not supported yet', hint: 'use "flow"' }]);
  });

  it("requires nodes", async () => {
    expect(await problems(pondWith((p: Obj) => delete p.nodes))).toEqual([
      {
        path: "nodes",
        message: 'missing required field "nodes"',
        hint: 'add "nodes": the cards, in reading order; the order gently guides the layout',
      },
    ]);
  });

  it("requires nodes to be a list", async () => {
    expect(await problems({ ...pond(), nodes: { dig: "Dig the hole" } })).toEqual([
      { path: "nodes", message: "must be a list of nodes", hint: "write it as [...]" },
    ]);
  });

  it("treats missing edges as no edges", async () => {
    const doc = parseSvg((await render(pondWith((p: Obj) => delete p.edges), opts)).svg);

    expect(lines(doc)).toHaveLength(0);
  });

  it("requires edges, when given, to be a list", async () => {
    expect(await problems({ ...pond(), edges: "dig -> line" })).toEqual([
      { path: "edges", message: "must be a list of edges", hint: "write it as [...]" },
    ]);
  });

  it("rejects a direction other than down or right", async () => {
    expect(await problems({ ...pond(), direction: "up" })).toEqual([
      { path: "direction", message: '"up" is not a valid direction', hint: 'use "down" or "right"' },
    ]);
  });
});

describe("unknown fields", () => {
  it("rejects an unknown top-level field", async () => {
    expect(await problems({ ...pond(), colour: "green" })).toEqual([
      { path: "colour", message: 'unknown field "colour"', hint: "allowed fields: version, type, direction, nodes, edges" },
    ]);
  });

  it("rejects an unknown node field", async () => {
    expect(await problems(pondWith((p) => (p.nodes[1]!.size = "large")))).toEqual([
      { path: "nodes[1].size", message: 'unknown field "size"', hint: "allowed fields: id, label, shape" },
    ]);
  });

  it("rejects an unknown edge field", async () => {
    expect(await problems(pondWith((p) => (p.edges[0]!.colour = "blue")))).toEqual([
      { path: "edges[0].colour", message: 'unknown field "colour"', hint: "allowed fields: id, from, to" },
    ]);
  });

  it("writes a field name that isn't a plain word in brackets", async () => {
    expect(await problems({ ...pond(), "line colour": "red" })).toEqual([
      {
        path: '["line colour"]',
        message: 'unknown field "line colour"',
        hint: "allowed fields: version, type, direction, nodes, edges",
      },
    ]);
  });
});

describe("nodes and edges", () => {
  it("requires each node to be an object", async () => {
    expect(await problems(pondWith((p) => (p.nodes[2] = "Fill with rainwater" as never)))).toEqual([
      {
        path: "nodes[2]",
        message: "must be an object describing one node",
        hint: 'write it as {"id": ..., "label": ..., "shape": ...}',
      },
      // The second edge pointed at that node, which is now gone.
      { path: "edges[1].to", message: 'no node with id "fill"', hint: "use the id of one of the nodes" },
    ]);
  });

  it("requires each edge to be an object", async () => {
    expect(await problems(pondWith((p) => (p.edges[0] = ["dig", "line"] as never)))).toEqual([
      { path: "edges[0]", message: "must be an object describing one edge", hint: 'write it as {"from": ..., "to": ...}' },
    ]);
  });

  it.each([
    ["id", 'add "id": a unique id made of letters, digits and - _ . :'],
    ["label", 'add "label": the text shown in the shape'],
    ["shape", 'add "shape": the shape drawn, "step"'],
  ])("requires a node's %s", async (field, hint) => {
    // Remove it from the last node, so no edge points at a node that lost its id.
    const input = pondWith((p) => p.edges.pop() && delete p.nodes[2]![field]);

    expect(await problems(input)).toEqual([{ path: `nodes[2].${field}`, message: `missing required field "${field}"`, hint }]);
  });

  it.each([
    ["from", 'add "from": the id of the node the line starts at'],
    ["to", 'add "to": the id of the node the line ends at'],
  ])("requires an edge's %s", async (field, hint) => {
    expect(await problems(pondWith((p) => delete p.edges[0]![field]))).toEqual([
      { path: `edges[0].${field}`, message: `missing required field "${field}"`, hint },
    ]);
  });

  it("accepts only the shapes implemented so far", async () => {
    expect(await problems(pondWith((p) => (p.nodes[0]!.shape = "decision")))).toEqual([
      { path: "nodes[0].shape", message: '"decision" is not supported yet', hint: 'use "step"' },
    ]);
  });

  it("requires a label to be a string", async () => {
    expect(await problems(pondWith((p) => (p.nodes[0]!.label = 42)))).toEqual([
      { path: "nodes[0].label", message: "must be a string", hint: "write the text in double quotes" },
    ]);
  });
});

describe("ids", () => {
  it("allows letters, digits and - _ . :", async () => {
    const input = pondWith((p) => {
      p.nodes[0]!.id = "Pond-1_dig.v2:a";
      p.edges[0]!.from = "Pond-1_dig.v2:a";
    });

    const doc = parseSvg((await render(input, opts)).svg);

    expect(cardById(doc, "Pond-1_dig.v2:a")).toBeDefined();
  });

  it.each(["dig hole", "dig/hole", "edges[0]", "dig#1", "étang"])("rejects the id %j", async (id) => {
    expect(await problems(pondWith((p) => (p.edges[1]!.id = id)))).toEqual([
      { path: "edges[1].id", message: `${JSON.stringify(id)} is not a valid id`, hint: "use only letters, digits and - _ . :" },
    ]);
  });

  it("rejects an empty id", async () => {
    expect(await problems(pondWith((p) => (p.edges[1]!.id = "")))).toEqual([
      { path: "edges[1].id", message: "must not be empty", hint: "use only letters, digits and - _ . :" },
    ]);
  });

  it("requires an id to be a string", async () => {
    expect(await problems(pondWith((p) => (p.edges[1]!.id = 7)))).toEqual([
      { path: "edges[1].id", message: "must be a string", hint: "use only letters, digits and - _ . :" },
    ]);
  });

  it("requires node ids to be unique", async () => {
    const input = pondWith((p) => {
      p.nodes[2]!.id = "dig";
      p.edges[1]!.to = "dig";
    });

    expect(await problems(input)).toEqual([
      { path: "nodes[2].id", message: 'the id "dig" is already used by nodes[0]', hint: "give every node and edge its own id" },
    ]);
  });

  it("requires ids to be unique across nodes and edges", async () => {
    expect(await problems(pondWith((p) => (p.edges[1]!.id = "line")))).toEqual([
      { path: "edges[1].id", message: 'the id "line" is already used by nodes[1]', hint: "give every node and edge its own id" },
    ]);
  });

  it("requires edge ids to be unique", async () => {
    expect(await problems(pondWith((p) => (p.edges[0]!.id = "then-fill")))).toEqual([
      {
        path: "edges[1].id",
        message: 'the id "then-fill" is already used by edges[0]',
        hint: "give every node and edge its own id",
      },
    ]);
  });

  it("knows an edge without an id as edges[N]", async () => {
    const doc = parseSvg((await render(pond(), opts)).svg);

    expect(lines(doc).map((l) => l.getAttribute("data-id"))).toEqual(["edges[0]", "then-fill"]);
  });
});

describe("references", () => {
  it.each(["from", "to"])("requires an edge's %s to name a node", async (end) => {
    expect(await problems(pondWith((p) => (p.edges[0]![end] = "pump")))).toEqual([
      { path: `edges[0].${end}`, message: 'no node with id "pump"', hint: "use the id of one of the nodes" },
    ]);
  });

  it("doesn't let an edge point at another edge", async () => {
    expect(await problems(pondWith((p) => (p.edges[0]!.to = "then-fill")))).toEqual([
      { path: "edges[0].to", message: 'no node with id "then-fill"', hint: "use the id of one of the nodes" },
    ]);
  });

  it("requires a reference to be a string", async () => {
    expect(await problems(pondWith((p) => (p.edges[0]!.from = 0)))).toEqual([
      { path: "edges[0].from", message: "must be a node id", hint: "use the id of one of the nodes" },
    ]);
  });

  it("doesn't also report edges to a node whose id has a problem", async () => {
    const input = pondWith((p) => {
      p.nodes[0]!.id = "dig hole";
      p.edges[0]!.from = "dig hole";
    });

    expect(await problems(input)).toEqual([
      { path: "nodes[0].id", message: '"dig hole" is not a valid id', hint: "use only letters, digits and - _ . :" },
    ]);
  });

  it("allows a node to link to itself", async () => {
    const input = pondWith((p) => p.edges.push({ id: "top-up", from: "fill", to: "fill" }));

    const doc = parseSvg((await render(input, opts)).svg);

    const loop = lines(doc).find((l) => l.getAttribute("data-id") === "top-up")!;
    expect([loop.getAttribute("data-from"), loop.getAttribute("data-to")]).toEqual(["fill", "fill"]);
  });
});

describe("limits", () => {
  /** n steps, each linked to the next, plus `extra` top-level fields. */
  function steps(n: number, extra: Obj = {}): Obj {
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `Step ${i}`, shape: "step" }));
    return { type: "flow", nodes, ...extra };
  }

  // An unknown field stops each render before layout, so the big inputs stay quick.
  it("allows 500 nodes", async () => {
    expect(await problems(steps(500, { colour: "red" }))).toEqual([expect.objectContaining({ path: "colour" })]);
  });

  it("rejects 501 nodes as INVALID_INPUT", async () => {
    expect(await problems(steps(501))).toEqual([
      { path: "nodes", message: "has 501 nodes; the limit is 500", hint: "split the diagram into smaller ones" },
    ]);
  });

  function links(n: number): Obj[] {
    return Array.from({ length: n }, (_, i) => ({ from: "s0", to: `s${(i % 9) + 1}` }));
  }

  it("allows 1,000 edges", async () => {
    expect(await problems(steps(10, { edges: links(1000), colour: "red" }))).toEqual([
      expect.objectContaining({ path: "colour" }),
    ]);
  });

  it("rejects 1,001 edges as INVALID_INPUT", async () => {
    expect(await problems(steps(10, { edges: links(1001) }))).toEqual([
      { path: "edges", message: "has 1001 edges; the limit is 1000", hint: "split the diagram into smaller ones" },
    ]);
  });

  it("allows a label of 100 characters, counting characters rather than UTF-16 units", async () => {
    const label = "Dig the hole " + "é".repeat(87);
    expect([...label]).toHaveLength(100);

    await expect(render(pondWith((p) => (p.nodes[0]!.label = label)), opts)).resolves.toHaveProperty("svg");
  });

  it("rejects a label of 101 characters as INVALID_INPUT", async () => {
    expect(await problems(pondWith((p) => (p.nodes[0]!.label = "D".repeat(101))))).toEqual([
      { path: "nodes[0].label", message: "is 101 characters long; the limit is 100", hint: "shorten it" },
    ]);
  });
});

describe("text", () => {
  async function stepText(label: string) {
    const doc = parseSvg((await render(pondWith((p) => (p.nodes[0]!.label = label)), opts)).svg);
    const card = cardById(doc, "dig");
    return { title: titleOf(card), drawn: textLines(card).join(" ") };
  }

  it("draws markdown and markup exactly as written", async () => {
    const label = "**Dig** <b>the</b> &amp; _hole_ #1";

    expect(await stepText(label)).toEqual({ title: label, drawn: label });
  });

  it("collapses runs of spaces and trims the ends", async () => {
    expect(await stepText("   Dig    the  hole ")).toEqual({ title: "Dig the hole", drawn: "Dig the hole" });
  });

  it("keeps no-break spaces as they are", async () => {
    expect((await stepText("Dig  the hole")).title).toBe("Dig  the hole");
  });

  it.each(["", "    "])("rejects a label with nothing to show: %j", async (label) => {
    expect(await problems(pondWith((p) => (p.nodes[0]!.label = label)))).toEqual([
      { path: "nodes[0].label", message: "must not be empty", hint: "write the text to show" },
    ]);
  });

  it.each([
    ["\t", "contains a tab (U+0009)", "use a space instead"],
    ["\n", "contains a line feed (U+000A)", "use a space instead: text wraps by itself"],
    ["\r", "contains a carriage return (U+000D)", "use a space instead: text wraps by itself"],
    ["\u0000", "contains a control character (U+0000)", "remove it"],
    ["\u001b", "contains a control character (U+001B)", "remove it"],
    ["\u007f", "contains a control character (U+007F)", "remove it"],
  ])("rejects the control character %j with a hint", async (ch, message, hint) => {
    expect(await problems(pondWith((p) => (p.nodes[1]!.label = `Lay${ch}the liner`)))).toEqual([
      { path: "nodes[1].label", message, hint },
    ]);
  });

  it.each([
    ["池", 'contains "池" (U+6C60)'],
    ["🌱", 'contains "🌱" (U+1F331)'],
    ["⇑", 'contains "⇑" (U+21D1)'],
    ["​", "contains U+200B"],
    ["­", "contains U+00AD"],
  ])("names a character the label's font can't draw: %j", async (ch, named) => {
    expect(await problems(pondWith((p) => (p.nodes[1]!.label = `Lay the liner ${ch}`)))).toEqual([
      {
        path: "nodes[1].label",
        message: `${named}, which Structa's fonts can't draw`,
        hint: "use Latin letters, digits and common symbols",
      },
    ]);
  });

  it("reports each character it can't draw once", async () => {
    const found = await problems(pondWith((p) => (p.nodes[1]!.label = "池 Lay 🌱 the 池 liner 🌱")));

    expect(found.map((p) => p.message)).toEqual([
      'contains "池" (U+6C60), which Structa\'s fonts can\'t draw',
      'contains "🌱" (U+1F331), which Structa\'s fonts can\'t draw',
    ]);
  });

  it("allows everything the label's font can draw, beyond plain ASCII", async () => {
    const label = "Étang → filtre … 5 € ≤ 10 ⇒ “ok” Ĳ";

    expect((await stepText(label)).title).toBe(label);
  });
});

describe("several problems", () => {
  it("reports them all at once, in input order, each with a path and hint, one per line", async () => {
    const error = await rejection({
      version: 3,
      type: "flow",
      nodes: [
        { id: "dig", label: "Dig the hole", shape: "step" },
        { id: "dig", label: "Lay\tthe liner", shape: "step", size: "large" },
        { id: "fill", shape: "oval" },
      ],
      edges: [
        { from: "dig", to: "pump" },
        { id: "fill", from: "rake", to: "fill" },
      ],
      colour: "green",
    });

    expect(error.problems).toEqual([
      { path: "colour", message: 'unknown field "colour"', hint: "allowed fields: version, type, direction, nodes, edges" },
      { path: "version", message: "3 is not supported", hint: "use 1, or leave version out" },
      { path: "nodes[1].size", message: 'unknown field "size"', hint: "allowed fields: id, label, shape" },
      { path: "nodes[1].id", message: 'the id "dig" is already used by nodes[0]', hint: "give every node and edge its own id" },
      { path: "nodes[1].label", message: "contains a tab (U+0009)", hint: "use a space instead" },
      { path: "nodes[2].label", message: 'missing required field "label"', hint: 'add "label": the text shown in the shape' },
      { path: "nodes[2].shape", message: '"oval" is not supported yet', hint: 'use "step"' },
      { path: "edges[0].to", message: 'no node with id "pump"', hint: "use the id of one of the nodes" },
      { path: "edges[1].id", message: 'the id "fill" is already used by nodes[2]', hint: "give every node and edge its own id" },
      { path: "edges[1].from", message: 'no node with id "rake"', hint: "use the id of one of the nodes" },
    ]);
    expect(error.message.split("\n")).toEqual(error.problems.map((p) => `${p.path}: ${p.message} (${p.hint})`));
  });
});
