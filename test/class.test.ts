import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import {
  byClassIn,
  cardBox,
  cardById,
  distanceToOutline,
  lines,
  parsePath,
  svgDoc,
  textLines,
  titleOf,
} from "./helpers/svg";

/** JetBrains Mono draws every character 0.6 em wide. */
const MONO_ADVANCE = 0.6;

/** A one-class diagram: a seed packet with whatever fields a test gives it. */
function packet(fields: object = {}) {
  return { type: "class", nodes: [{ id: "packet", label: "SeedPacket", ...fields }] };
}

/** Members of every visibility, with and without ids. */
const MEMBERS = {
  properties: [
    { text: "variety: string", visibility: "public" },
    { id: "sow-by", text: "sowBy: Date", visibility: "private" },
    { text: "count: int", visibility: "protected" },
  ],
  methods: [
    { text: "germinates(days: int): bool", visibility: "package" },
    { id: "split", text: "split(into: int): SeedPacket[]" },
  ],
};

function rows(card: Element): Element[] {
  return byClassIn(card, "row");
}

function texts(el: Element): Element[] {
  return Array.from(el.getElementsByTagName("text"));
}

function numberAttr(el: Element, name: string): number {
  return Number(el.getAttribute(name));
}

async function problems(input: object): Promise<readonly Problem[]> {
  const error = await render(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("INVALID_INPUT");
  return (error as StructaError).problems;
}

/** Two classes in a potting shed, with whatever line fields a test adds. */
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
    const paths = Array.from(line!.getElementsByTagName("path"));
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute("fill")).toBe("none");
    expect(paths[0]!.hasAttribute("stroke-dasharray")).toBe(false);
    // The line runs all the way from one card's outline to the other's.
    const points = parsePath(paths[0]!.getAttribute("d")!).flatMap((c) => c.points);
    expect(distanceToOutline(points[0]!, cardBox(cardById(doc, "bench")))).toBeLessThanOrEqual(1);
    expect(distanceToOutline(points.at(-1)!, cardBox(cardById(doc, "tray")))).toBeLessThanOrEqual(1);
  });

  it("names both classes in the line's tooltip, with its label", async () => {
    const doc = await svgDoc(shed({ label: "holds" }));

    expect(titleOf(lines(doc)[0]!)).toBe("PottingBench – SeedTray: holds");
  });

  it("requires a kind", async () => {
    const input = shed();
    delete (input.edges[0] as { kind?: string }).kind;

    expect(await problems(input)).toEqual([
      {
        path: "edges[0].kind",
        message: 'missing required field "kind"',
        hint: 'add "kind": the relationship the line shows, "association"',
      },
    ]);
  });

  it.each(["inherits", "implements", "composition", "aggregation", "dependency"])(
    "doesn't draw %s lines yet",
    async (kind) => {
      expect(await problems(shed({ kind }))).toEqual([
        { path: "edges[0].kind", message: `"${kind}" is not supported yet`, hint: 'use "association"' },
      ]);
    },
  );
});

describe("class cards", () => {
  it("draws each node of a class diagram as a class card with its name", async () => {
    const doc = await svgDoc({ type: "class", nodes: [{ id: "packet", label: "SeedPacket" }] });

    const card = cardById(doc, "packet");
    expect(card.getAttribute("data-kind")).toBe("class");
    expect(textLines(card)).toEqual(["SeedPacket"]);
    expect(titleOf(card)).toBe("SeedPacket");
  });

  it.each([
    ["light", "#59636e"],
    ["dark", "#8b949e"],
  ] as const)("draws a description under the name, muted in %s, wrapped, and above the rows", async (theme, muted) => {
    const description = "One packet of saved seed, lent to members and returned with seed saved from the crop it grew.";
    const doc = await svgDoc(packet({ description, ...MEMBERS }), theme);

    const card = cardById(doc, "packet");
    const [name, ...rest] = texts(card).filter((t) => !rows(card).some((row) => texts(row).includes(t)));
    const lines = rest.map((t) => t.textContent);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(description);
    for (const t of rest) {
      expect([t.getAttribute("font-weight"), t.getAttribute("fill")]).toEqual(["400", muted]);
      expect(t.getAttribute("font-family")).toMatch(/^Structa Inter,/);
      expect(numberAttr(t, "font-size")).toBeLessThan(numberAttr(name!, "font-size"));
      expect(numberAttr(t, "y")).toBeGreaterThan(numberAttr(name!, "y"));
      expect(numberAttr(t, "y")).toBeLessThan(numberAttr(byClassIn(card, "divider")[0]!, "y1"));
    }
    expect(titleOf(card)).toBe(`SeedPacket: ${description}`);
  });

  it("wraps a long name, never cutting it off", async () => {
    const label = "SeasonalHeirloomVegetableSeedPacketExchangeRegistrationRequestHandlerFactory";
    const doc = await svgDoc(packet({ label }));

    const card = cardById(doc, "packet");
    expect(textLines(card).length).toBeGreaterThan(1);
    expect(textLines(card).join("")).toBe(label);
    expect(cardBox(card).width).toBe(360);
  });
});

describe("the more row", () => {
  it.each([
    ["methods", { ...MEMBERS, more: 12 }],
    ["properties", { properties: MEMBERS.properties, more: 12 }],
  ])("adds a muted '… 12 more' after the last row, in the %s", async (_section, fields) => {
    const doc = await svgDoc(packet(fields));

    const card = cardById(doc, "packet");
    const [more] = byClassIn(card, "more");
    expect(textLines(more!)).toEqual(["… 12 more"]);
    const [t] = texts(more!);
    expect(t!.getAttribute("fill")).toBe("#59636e");
    expect(numberAttr(t!, "y")).toBeGreaterThan(numberAttr(texts(rows(card).at(-1)!)[0]!, "y"));
    expect(numberAttr(t!, "y")).toBeLessThan(cardBox(card).y + cardBox(card).height);
    // It lines up with the rows' text, after the first row's "+ ", and isn't one of the class's rows.
    const firstRow = texts(rows(card)[0]!)[0]!;
    expect(numberAttr(t!, "x") - numberAttr(firstRow, "x")).toBeCloseTo(2 * MONO_ADVANCE * numberAttr(t!, "font-size"), 5);
    expect(rows(card)).toHaveLength(fields.properties.length + ("methods" in fields ? fields.methods.length : 0));
  });

  it("gets a section of its own on a class with no rows", async () => {
    const doc = await svgDoc(packet({ more: 3 }));

    const card = cardById(doc, "packet");
    expect(byClassIn(card, "divider")).toHaveLength(1);
    expect(textLines(byClassIn(card, "more")[0]!)).toEqual(["… 3 more"]);
  });

  it("is left out without more", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    expect(byClassIn(cardById(doc, "packet"), "more")).toEqual([]);
  });

  it.each([1, 9999])("allows more: %i", async (more) => {
    const doc = await svgDoc(packet({ more }));

    expect(textLines(byClassIn(cardById(doc, "packet"), "more")[0]!)).toEqual([`… ${more} more`]);
  });

  it.each([
    [0, "0 is not a whole number from 1 to 9999"],
    [-2, "-2 is not a whole number from 1 to 9999"],
    [2.5, "2.5 is not a whole number from 1 to 9999"],
    [10000, "10000 is not a whole number from 1 to 9999"],
    ["12", '"12" is not a whole number from 1 to 9999'],
    [null, "null is not a whole number from 1 to 9999"],
  ])("rejects more: %j", async (more, message) => {
    expect(await problems(packet({ more }))).toEqual([
      { path: "nodes[0].more", message, hint: "write a whole number without quotes, or leave more out" },
    ]);
  });
});

describe("class card rows", () => {
  it("draws the properties, then the methods, each row with its visibility symbol", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    expect(rows(cardById(doc, "packet")).map((row) => [row.getAttribute("data-kind"), textLines(row)])).toEqual([
      ["property", ["+ variety: string"]],
      ["property", ["- sowBy: Date"]],
      ["property", ["# count: int"]],
      ["method", ["~ germinates(days: int): bool"]],
      ["method", ["split(into: int): SeedPacket[]"]],
    ]);
  });

  it("knows a row by its own id, or else by its section and position", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    expect(rows(cardById(doc, "packet")).map((row) => row.getAttribute("data-id"))).toEqual([
      "properties[0]",
      "sow-by",
      "properties[2]",
      "methods[0]",
      "split",
    ]);
  });

  it("gives every row a tooltip with its full text", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    expect(rows(cardById(doc, "packet")).map(titleOf)).toEqual([
      "+ variety: string",
      "- sowBy: Date",
      "# count: int",
      "~ germinates(days: int): bool",
      "split(into: int): SeedPacket[]",
    ]);
  });

  it("draws row text in JetBrains Mono and the name in Inter", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    const card = cardById(doc, "packet");
    for (const row of rows(card)) {
      for (const t of texts(row)) expect(t.getAttribute("font-family")).toMatch(/^Structa JetBrains Mono,/);
    }
    expect(texts(card)[0]!.getAttribute("font-family")).toMatch(/^Structa Inter,/);
  });

  it("lines up the text of every row after the visibility symbols", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    const [first, ...others] = rows(cardById(doc, "packet")).map((row) => texts(row)[0]!);
    const size = numberAttr(first!, "font-size");
    for (const t of others.slice(0, -1)) expect(numberAttr(t, "x")).toBe(numberAttr(first!, "x"));
    // The row without a visibility starts its text where the others' text starts, after "+ ".
    expect(numberAttr(others.at(-1)!, "x") - numberAttr(first!, "x")).toBeCloseTo(2 * MONO_ADVANCE * size, 5);
  });

  it("starts the text at the edge when no row has a visibility", async () => {
    const plain = { properties: [{ text: "variety: string" }], methods: [{ text: "split(): SeedPacket[]" }] };
    const doc = await svgDoc(packet(plain));
    const withSymbols = await svgDoc(packet(MEMBERS));

    const x = (d: typeof doc) => numberAttr(texts(rows(cardById(d, "packet"))[0]!)[0]!, "x");
    expect(x(doc)).toBe(x(withSymbols));
  });

  it("is 360px wide, with the name, then the properties, then the methods, split by dividers", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    const card = cardById(doc, "packet");
    const box = cardBox(card);
    expect(box.width).toBe(360);
    const dividers = byClassIn(card, "divider");
    expect(dividers).toHaveLength(2);
    const [name] = texts(card);
    const [firstProperty, , lastProperty, firstMethod] = rows(card).map((row) => numberAttr(texts(row)[0]!, "y"));
    const [underName, betweenSections] = dividers.map((d) => numberAttr(d, "y1"));
    expect(underName).toBeGreaterThan(numberAttr(name!, "y"));
    expect(underName).toBeLessThan(firstProperty! - 12);
    expect(betweenSections).toBeGreaterThan(lastProperty!);
    expect(betweenSections).toBeLessThan(firstMethod! - 12);
    // Level, and right across the card, from just inside its border to just inside the other side.
    for (const divider of dividers) {
      expect(numberAttr(divider, "y2")).toBe(numberAttr(divider, "y1"));
      expect(numberAttr(divider, "x1") - box.x).toBeGreaterThanOrEqual(0);
      expect(numberAttr(divider, "x1") - box.x).toBeLessThanOrEqual(1);
      expect(box.x + box.width - numberAttr(divider, "x2")).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width - numberAttr(divider, "x2")).toBeLessThanOrEqual(1);
    }
    // The last row sits inside the card.
    expect(numberAttr(texts(rows(card).at(-1)!)[0]!, "y")).toBeLessThan(box.y + box.height);
  });

  it("draws only the sections a class has", async () => {
    const onlyMethods = await svgDoc(packet({ methods: MEMBERS.methods }));
    const onlyProperties = await svgDoc(packet({ properties: MEMBERS.properties }));
    const neither = await svgDoc(packet());

    expect(byClassIn(cardById(onlyMethods, "packet"), "divider")).toHaveLength(1);
    expect(rows(cardById(onlyMethods, "packet")).map((r) => r.getAttribute("data-kind"))).toEqual(["method", "method"]);
    expect(byClassIn(cardById(onlyProperties, "packet"), "divider")).toHaveLength(1);
    expect(byClassIn(cardById(neither, "packet"), "divider")).toHaveLength(0);
  });

  it("wraps a long row under its own text, without losing any of it", async () => {
    const text = "repot(into: Pot, compost: CompostMix, water: Litres, feed: LiquidFeed, label: string): Plant";
    const doc = await svgDoc(packet({ methods: [{ text, visibility: "public" }, { text: "water(): void", visibility: "public" }] }));

    const [long, short] = rows(cardById(doc, "packet"));
    const wrapped = texts(long!);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.map((t) => t.textContent).join(" ")).toBe(`+ ${text}`);
    expect(titleOf(long!)).toBe(`+ ${text}`);
    // Later lines start under the text, not under the symbol, and the next row comes after the last line.
    const size = numberAttr(wrapped[0]!, "font-size");
    for (const t of wrapped.slice(1)) {
      expect(numberAttr(t, "x") - numberAttr(wrapped[0]!, "x")).toBeCloseTo(2 * MONO_ADVANCE * size, 5);
      expect(numberAttr(t, "y")).toBeGreaterThan(numberAttr(wrapped[0]!, "y"));
    }
    expect(numberAttr(texts(short!)[0]!, "y")).toBeGreaterThan(numberAttr(wrapped.at(-1)!, "y"));
    // Every line fits inside the card.
    const box = cardBox(cardById(doc, "packet"));
    for (const t of wrapped) {
      const right = numberAttr(t, "x") + MONO_ADVANCE * size * t.textContent!.length;
      expect(right).toBeLessThanOrEqual(box.x + box.width);
    }
  });
});

describe("class input", () => {
  /** Two classes, each with a property and a method. */
  function sheds() {
    const members = () => ({
      properties: [{ text: "size: Area" }],
      methods: [{ text: "lock(): void" }],
    });
    return {
      type: "class",
      nodes: [
        { id: "shed", label: "Shed", ...members() },
        { id: "store", label: "Store", ...members() },
      ],
    } as { type: string; nodes: ({ properties: Record<string, unknown>[]; methods: Record<string, unknown>[] } & Record<string, unknown>)[] };
  }

  it("requires a row's text", async () => {
    const input = sheds();
    delete input.nodes[1]!.methods[0]!.text;

    expect(await problems(input)).toEqual([
      {
        path: "nodes[1].methods[0].text",
        message: 'missing required field "text"',
        hint: `add "text": the member as you'd write it, such as a name and type or a signature`,
      },
    ]);
  });

  it.each(["properties", "methods"] as const)("rejects an unknown field on a row in %s", async (section) => {
    const input = sheds();
    input.nodes[0]![section][0]!.colour = "green";

    expect(await problems(input)).toEqual([
      { path: `nodes[0].${section}[0].colour`, message: 'unknown field "colour"', hint: "allowed fields: text, id, visibility, status" },
    ]);
  });

  it("rejects an unknown field on a class node", async () => {
    const input = sheds();
    input.nodes[0]!.shape = "step";

    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].shape",
        message: 'unknown field "shape"',
        hint: "allowed fields: id, label, description, status, properties, methods, more",
      },
    ]);
  });

  it.each([
    ["properties", "must be a list of properties"],
    ["methods", "must be a list of methods"],
  ] as const)("requires %s to be a list", async (section, message) => {
    const input = sheds();
    input.nodes[0]![section] = "lock(): void" as never;

    expect(await problems(input)).toEqual([{ path: `nodes[0].${section}`, message, hint: "write it as [...]" }]);
  });

  it.each([
    ["properties", "property"],
    ["methods", "method"],
  ] as const)("requires each of %s to be an object", async (section, noun) => {
    const input = sheds();
    input.nodes[0]![section][0] = "lock(): void" as never;

    expect(await problems(input)).toEqual([
      { path: `nodes[0].${section}[0]`, message: `must be an object describing one ${noun}`, hint: 'write it as {"text": ...}' },
    ]);
  });

  it("requires row ids to be unique within their card, across both sections", async () => {
    const input = sheds();
    input.nodes[0]!.properties[0]!.id = "lock";
    input.nodes[0]!.methods[0]!.id = "lock";

    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].methods[0].id",
        message: 'the id "lock" is already used by nodes[0].properties[0]',
        hint: "give every row in a card its own id",
      },
    ]);
  });

  it("lets rows in different cards share an id, and a row share a node's id", async () => {
    const input = sheds();
    input.nodes[0]!.methods[0]!.id = "lock";
    input.nodes[1]!.methods[0]!.id = "lock";
    input.nodes[1]!.properties[0]!.id = "shed";

    const doc = await svgDoc(input);

    expect(rows(cardById(doc, "shed")).map((row) => row.getAttribute("data-id"))).toEqual(["properties[0]", "lock"]);
    expect(rows(cardById(doc, "store")).map((row) => row.getAttribute("data-id"))).toEqual(["shed", "lock"]);
  });

  it.each(["lock()", "methods[0]", ""])("rejects the row id %j", async (id) => {
    const input = sheds();
    input.nodes[0]!.methods[0]!.id = id;

    expect(await problems(input)).toEqual([
      expect.objectContaining({ path: "nodes[0].methods[0].id", hint: "use only letters, digits and - _ . :" }),
    ]);
  });

  it.each(["internal", "Public", true])("rejects the visibility %j", async (visibility) => {
    const input = sheds();
    input.nodes[1]!.properties[0]!.visibility = visibility;

    expect(await problems(input)).toEqual([
      {
        path: "nodes[1].properties[0].visibility",
        message: `${JSON.stringify(visibility)} is not a valid visibility`,
        hint: 'use "public", "private", "protected" or "package"',
      },
    ]);
  });

  it("checks row text like any other text: tidied and never blank", async () => {
    const input = sheds();
    input.nodes[0]!.methods[0]!.text = "  lock(key:   Key): void ";
    const doc = await svgDoc(input);
    expect(textLines(rows(cardById(doc, "shed"))[1]!)).toEqual(["lock(key: Key): void"]);

    input.nodes[0]!.methods[0]!.text = "   ";
    expect(await problems(input)).toEqual([
      { path: "nodes[0].methods[0].text", message: "must not be empty", hint: "write the text to show" },
    ]);
  });

  it("checks row text against JetBrains Mono, the face it's drawn in, and the name against Inter", async () => {
    // Inter can draw Ĳ but JetBrains Mono can't; JetBrains Mono can draw ⇑ but Inter can't.
    const input = sheds();
    input.nodes[0]!.methods[0]!.text = "climb(): ⇑";
    input.nodes[1]!.label = "ĲsselStore";
    await expect(render(input, { embedFonts: false })).resolves.toHaveProperty("svg");

    input.nodes[0]!.methods[0]!.text = "ĲsselStore(): void";
    input.nodes[1]!.label = "Store ⇑";
    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].methods[0].text",
        message: 'contains "Ĳ" (U+0132), which Structa\'s fonts can\'t draw',
        hint: "use Latin letters, digits and common symbols",
      },
      {
        path: "nodes[1].label",
        message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw',
        hint: "use Latin letters, digits and common symbols",
      },
    ]);
  });
});
