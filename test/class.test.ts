import { readFileSync } from "node:fs";
import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { problems } from "./helpers/errors";
import {
  allElements,
  badgeBox,
  byClassIn,
  cardById,
  cards,
  distanceToDrawn,
  lines,
  outlineBox,
  overlaps,
  parsePath,
  rectBox,
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

/** A row's own text, without its visibility symbol or the word in its badge. */
function memberTexts(row: Element): Element[] {
  const other = new Set([...byClassIn(row, "badge"), ...byClassIn(row, "symbol")].flatMap(texts));
  return texts(row).filter((t) => !other.has(t));
}

/** A row's visibility symbol, when it has one. */
function symbolOf(row: Element): Element | undefined {
  const [symbol, ...others] = byClassIn(row, "symbol").flatMap(texts);
  expect(others).toEqual([]);
  return symbol;
}

function numberAttr(el: Element, name: string): number {
  return Number(el.getAttribute(name));
}

describe("class layout", () => {
  /** A greenhouse linked to three classes, listed in the given order. */
  function greenhouse(order: readonly string[], direction?: string) {
    return {
      type: "class",
      ...(direction ? { direction } : {}),
      nodes: [{ id: "house", label: "Greenhouse" }, ...order.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }))],
      edges: order.map((id) => ({ from: "house", to: id, kind: "association" })),
    };
  }

  it.each([[["bench", "heater", "vent"]], [["vent", "heater", "bench"]], [["heater", "vent", "bench"]]])(
    "places side-by-side class cards in the order the nodes are listed: %j",
    async (order) => {
      const doc = await svgDoc(greenhouse(order));

      const [a, b, c] = order.map((id) => outlineBox(cardById(doc, id)));
      expect(b!.x).toBeGreaterThan(a!.x);
      expect(c!.x).toBeGreaterThan(b!.x);
    },
  );

  it.each(["down", "right"])("keeps cards and badges apart, and ends every line on a card, direction %s", async (direction) => {
    const example = JSON.parse(readFileSync(new URL("../examples/class-status.json", import.meta.url), "utf8")) as {
      edges: { from: string; to: string }[];
    };
    const doc = await svgDoc({ ...example, direction });

    const extents = cards(doc).map((card) => {
      const parts = [outlineBox(card), badgeBox(card)].filter((box) => box !== undefined);
      const x = Math.min(...parts.map((b) => b.x));
      const y = Math.min(...parts.map((b) => b.y));
      const width = Math.max(...parts.map((b) => b.x + b.width)) - x;
      const height = Math.max(...parts.map((b) => b.y + b.height)) - y;
      return { id: card.getAttribute("data-id"), box: { x, y, width, height } };
    });
    for (const a of extents) {
      for (const b of extents) if (a !== b) expect(overlaps(a.box, b.box), `${a.id} and ${b.id}`).toBe(false);
    }
    // A plain line has no arrowhead: both its ends meet what's drawn of a card, its outline or the badge on it.
    lines(doc).forEach((line, i) => {
      const points = parsePath(line.getElementsByTagName("path")[0]!.getAttribute("d")!).flatMap((c) => c.points);
      expect(distanceToDrawn(points[0]!, cardById(doc, example.edges[i]!.from)), `edges[${i}] start`).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(points.at(-1)!, cardById(doc, example.edges[i]!.to)), `edges[${i}] end`).toBeLessThanOrEqual(1);
    });
  });

  it("runs top to bottom by default, and left to right with direction right", async () => {
    const down = await svgDoc(greenhouse(["bench"]));
    const right = await svgDoc(greenhouse(["bench"], "right"));

    const [house, bench] = ["house", "bench"].map((id) => outlineBox(cardById(down, id)));
    expect(bench!.y).toBeGreaterThanOrEqual(house!.y + house!.height);
    const [houseRight, benchRight] = ["house", "bench"].map((id) => outlineBox(cardById(right, id)));
    expect(benchRight!.x).toBeGreaterThanOrEqual(houseRight!.x + houseRight!.width);
  });
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
    expect(outlineBox(card).width).toBe(360);
  });
});

describe("stereotypes", () => {
  it.each([
    ["interface", "light", "#59636e"],
    ["abstract", "light", "#59636e"],
    ["enum", "dark", "#8b949e"],
    ["record", "dark", "#8b949e"],
  ] as const)("draws stereotype %s as a muted «…» line centred above the name, in %s", async (stereotype, theme, muted) => {
    const doc = await svgDoc(packet({ stereotype, description: "Saved seed, lent out." }), theme);

    const card = cardById(doc, "packet");
    const [line, name] = texts(card);
    expect(textLines(card)).toEqual([`«${stereotype}»`, "SeedPacket", "Saved seed, lent out."]);
    expect(line!.getAttribute("font-family")).toMatch(/^Structa Inter,/);
    expect([line!.getAttribute("font-weight"), line!.getAttribute("font-style"), line!.getAttribute("fill")]).toEqual(["400", null, muted]);
    expect(numberAttr(line!, "font-size")).toBeLessThan(numberAttr(name!, "font-size"));
    // Centred on the card, like the name, and a line above it, inside the card.
    expect(line!.getAttribute("text-anchor")).toBe("middle");
    expect(numberAttr(line!, "x")).toBe(numberAttr(name!, "x"));
    expect(numberAttr(line!, "y")).toBeLessThan(numberAttr(name!, "y") - numberAttr(line!, "font-size"));
    expect(numberAttr(line!, "y") - numberAttr(line!, "font-size")).toBeGreaterThan(outlineBox(card).y);
    expect(titleOf(card)).toBe(`«${stereotype}» SeedPacket: Saved seed, lent out.`);
  });

  it("draws no stereotype line without a stereotype", async () => {
    const doc = await svgDoc(packet());

    expect(textLines(cardById(doc, "packet"))).toEqual(["SeedPacket"]);
  });

  it("makes the card taller by the stereotype line", async () => {
    const plain = outlineBox(cardById(await svgDoc(packet(MEMBERS)), "packet"));
    const withLine = outlineBox(cardById(await svgDoc(packet({ ...MEMBERS, stereotype: "record" })), "packet"));

    expect(withLine.height).toBeGreaterThan(plain.height);
    expect(withLine.width).toBe(plain.width);
  });

  it.each(["struct", "Interface", true])("rejects the stereotype %j", async (stereotype) => {
    expect(await problems(packet({ stereotype }))).toEqual([
      {
        path: "nodes[0].stereotype",
        message: `${JSON.stringify(stereotype)} is not a valid stereotype`,
        hint: 'use "interface", "abstract", "enum" or "record"',
      },
    ]);
  });
});

/** The face a text element is drawn in, as "family weight style". */
function faceOf(t: Element): string {
  return `${t.getAttribute("font-family")!.split(",")[0]} ${t.getAttribute("font-weight")} ${t.getAttribute("font-style") ?? "normal"}`;
}

describe("abstract classes", () => {
  /** The faces a card's name is drawn in, as "family weight style". */
  function nameFaces(card: Element): string[] {
    const other = new Set([...rows(card), ...byClassIn(card, "badge")].flatMap(texts));
    return texts(card)
      .filter((t) => !t.textContent!.startsWith("«") && !other.has(t))
      .map(faceOf);
  }

  it.each([
    ["abstract: true", { abstract: true }],
    ["stereotype abstract", { stereotype: "abstract" }],
    ["both", { abstract: true, stereotype: "abstract" }],
    ["abstract: true on an interface", { abstract: true, stereotype: "interface" }],
  ])("draws the name of a class with %s in Inter SemiBold Italic, every wrapped line", async (_name, fields) => {
    const label = "SeasonalHeirloomVegetableSeedPacketExchangeRegistrationRequestHandlerFactory";
    const doc = await svgDoc(packet({ label, ...fields }));

    const faces = nameFaces(cardById(doc, "packet"));
    expect(faces.length).toBeGreaterThan(1);
    expect(new Set(faces)).toEqual(new Set(["Structa Inter 600 italic"]));
  });

  it.each([
    ["no flags", {}],
    ["abstract: false", { abstract: false }],
    ["stereotype interface", { stereotype: "interface" }],
  ])("draws the name of a class with %s upright", async (_name, fields) => {
    const doc = await svgDoc(packet(fields));

    expect(nameFaces(cardById(doc, "packet"))).toEqual(["Structa Inter 600 normal"]);
  });

  it("keeps an abstract class's description and stereotype line upright", async () => {
    const doc = await svgDoc(packet({ stereotype: "abstract", description: "Saved seed, lent out." }));

    const [line, , description] = texts(cardById(doc, "packet"));
    expect(line!.hasAttribute("font-style")).toBe(false);
    expect(description!.hasAttribute("font-style")).toBe(false);
  });

  it("strikes through a removed abstract class's italic name", async () => {
    const doc = await svgDoc(packet({ abstract: true, status: "removed" }));

    const card = cardById(doc, "packet");
    expect(byClassIn(card, "strike")).toHaveLength(1);
    expect(nameFaces(card)).toEqual(["Structa Inter 600 italic"]);
  });

  it.each(["yes", 1, null])("rejects abstract: %j", async (abstract) => {
    expect(await problems(packet({ abstract }))).toEqual([
      { path: "nodes[0].abstract", message: `${JSON.stringify(abstract)} is not true or false`, hint: "write true or false, without quotes" },
    ]);
  });
});

describe("abstract rows", () => {
  const text = "germinate(tray: SeedTray, warmth: Celsius, light: Lux, water: Millilitres): Seedling[]";

  it.each(["properties", "methods"])("draws every line of an abstract row in %s in JetBrains Mono Italic, and the other rows upright", async (section) => {
    const doc = await svgDoc(packet({ [section]: [{ text, visibility: "public", abstract: true }, { text: "count: int", visibility: "public" }] }));

    const [abstract, plain] = rows(cardById(doc, "packet"));
    const wrapped = memberTexts(abstract!);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.map(faceOf)).toEqual(wrapped.map(() => "Structa JetBrains Mono 400 italic"));
    expect(memberTexts(plain!).map(faceOf)).toEqual(["Structa JetBrains Mono 400 normal"]);
    // The symbol is a mark in its own column, not the member's text: it stays upright, and the text still lines up.
    expect(faceOf(symbolOf(abstract!)!)).toBe("Structa JetBrains Mono 400 normal");
    expect(numberAttr(wrapped[0]!, "x")).toBe(numberAttr(memberTexts(plain!)[0]!, "x"));
    expect(titleOf(abstract!)).toBe(`+ ${text}`);
  });

  it("leaves rows with abstract: false upright", async () => {
    const doc = await svgDoc(packet({ methods: [{ text: "sow(): void", abstract: false }] }));

    expect(memberTexts(rows(cardById(doc, "packet"))[0]!).map(faceOf)).toEqual(["Structa JetBrains Mono 400 normal"]);
  });

  it("strikes a removed abstract row through as wide as its italic text", async () => {
    const doc = await svgDoc(packet({ status: "changed", methods: [{ text: "sow(): void", abstract: true, status: "removed" }] }));

    const row = rows(cardById(doc, "packet"))[0]!;
    const [t] = memberTexts(row);
    const [strike] = byClassIn(row, "strike");
    expect(faceOf(t!)).toBe("Structa JetBrains Mono 400 italic");
    expect(numberAttr(strike!, "x2") - numberAttr(strike!, "x1")).toBeCloseTo(MONO_ADVANCE * numberAttr(t!, "font-size") * "sow(): void".length, 1);
  });

  it.each(["yes", 0, null])("rejects abstract: %j on a row", async (abstract) => {
    expect(await problems(packet({ methods: [{ text: "sow(): void", abstract }] }))).toEqual([
      { path: "nodes[0].methods[0].abstract", message: `${JSON.stringify(abstract)} is not true or false`, hint: "write true or false, without quotes" },
    ]);
  });
});

describe("static rows", () => {
  const text = "fromHarvest(crop: Crop, year: int, saver: Member, notes: string): SeedPacket";

  it.each([
    ["light", "#1f2328"],
    ["dark", "#e6edf3"],
  ] as const)("underlines every line of a static row's text in its colour, in %s, but not its symbol", async (theme, colour) => {
    const doc = await svgDoc(packet({ methods: [{ text, visibility: "public", static: true }, { text: "sow(): void", visibility: "public" }] }), theme);

    const [stat, plain] = rows(cardById(doc, "packet"));
    const wrapped = memberTexts(stat!);
    expect(wrapped.length).toBeGreaterThan(1);
    const underlines = byClassIn(stat!, "underline");
    expect(underlines).toHaveLength(wrapped.length);
    wrapped.forEach((t, i) => {
      const line = underlines[i]!;
      const baseline = numberAttr(t, "y");
      const size = numberAttr(t, "font-size");
      // Level, just under the letters' baseline and above the next line, from where the text starts to where it ends.
      expect(numberAttr(line, "y1")).toBe(numberAttr(line, "y2"));
      expect(numberAttr(line, "y1")).toBeGreaterThan(baseline);
      expect(numberAttr(line, "y1")).toBeLessThan(baseline + size * 0.3);
      expect(numberAttr(line, "x1")).toBeCloseTo(numberAttr(t, "x"), 5);
      expect(numberAttr(line, "x2") - numberAttr(line, "x1")).toBeCloseTo(MONO_ADVANCE * size * t.textContent!.length, 1);
      expect([line.getAttribute("stroke"), t.getAttribute("fill")]).toEqual([colour, colour]);
    });
    // The underline starts where the text does, after the symbol's column.
    expect(numberAttr(underlines[0]!, "x1")).toBeGreaterThan(numberAttr(symbolOf(stat!)!, "x"));
    expect(byClassIn(plain!, "underline")).toEqual([]);
    expect(titleOf(stat!)).toBe(`+ ${text}`);
  });

  it("leaves rows with static: false plain", async () => {
    const doc = await svgDoc(packet({ properties: [{ text: "count: int", static: false }] }));

    expect(byClassIn(rows(cardById(doc, "packet"))[0]!, "underline")).toEqual([]);
  });

  it("underlines a static abstract row in italics", async () => {
    const doc = await svgDoc(packet({ methods: [{ text: "sow(): void", static: true, abstract: true }] }));

    const row = rows(cardById(doc, "packet"))[0]!;
    expect(memberTexts(row).map(faceOf)).toEqual(["Structa JetBrains Mono 400 italic"]);
    expect(byClassIn(row, "underline")).toHaveLength(1);
  });

  it("underlines and strikes through a removed static row, faded", async () => {
    const doc = await svgDoc(packet({ status: "changed", methods: [{ text: "sow(): void", static: true, status: "removed" }] }));

    const [faded] = byClassIn(rows(cardById(doc, "packet"))[0]!, "faded");
    const [underline] = byClassIn(faded!, "underline");
    const [strike] = byClassIn(faded!, "strike");
    expect(numberAttr(underline!, "y1")).toBeGreaterThan(numberAttr(strike!, "y1"));
    expect(numberAttr(underline!, "x1")).toBe(numberAttr(strike!, "x1"));
    expect(numberAttr(underline!, "x2")).toBe(numberAttr(strike!, "x2"));
  });

  it.each(["yes", 1, null])("rejects static: %j", async (value) => {
    expect(await problems(packet({ properties: [{ text: "count: int", static: value }] }))).toEqual([
      { path: "nodes[0].properties[0].static", message: `${JSON.stringify(value)} is not true or false`, hint: "write true or false, without quotes" },
    ]);
  });
});

describe("enums", () => {
  /** A season enum with whatever fields a test gives it. */
  function season(fields: object = {}) {
    return {
      type: "class",
      nodes: [{ id: "season", label: "SowingSeason", stereotype: "enum", values: [{ text: "SPRING" }, { id: "summer", text: "SUMMER" }, { text: "AUTUMN" }], ...fields }],
    };
  }

  it("draws an enum's values as rows under one divider, after «enum» and its name", async () => {
    const doc = await svgDoc(season());

    const card = cardById(doc, "season");
    const values = rows(card);
    expect(values.map((row) => [row.getAttribute("data-kind"), row.getAttribute("data-id"), textLines(row)])).toEqual([
      ["value", "values[0]", ["SPRING"]],
      ["value", "summer", ["SUMMER"]],
      ["value", "values[2]", ["AUTUMN"]],
    ]);
    expect(values.map(titleOf)).toEqual(["SPRING", "SUMMER", "AUTUMN"]);
    const [divider, ...others] = byClassIn(card, "divider");
    expect(others).toEqual([]);
    const [line, name] = texts(card);
    expect([line!.textContent, name!.textContent]).toEqual(["«enum»", "SowingSeason"]);
    expect(numberAttr(divider!, "y1")).toBeGreaterThan(numberAttr(name!, "y"));
    for (const row of values) {
      const [t] = texts(row);
      expect(faceOf(t!)).toBe("Structa JetBrains Mono 400 normal");
      expect(numberAttr(t!, "y") - 12).toBeGreaterThan(numberAttr(divider!, "y1"));
    }
    // With no visibility symbols, the values start at the card's padding, as plain rows do.
    const plain = await svgDoc(packet({ properties: [{ text: "SPRING" }] }));
    expect(numberAttr(texts(values[0]!)[0]!, "x")).toBe(numberAttr(texts(rows(cardById(plain, "packet"))[0]!)[0]!, "x"));
  });

  it("draws an enum without values as just its name, and '… N more' in a section of its own", async () => {
    const empty = await svgDoc(season({ values: undefined }));
    const more = await svgDoc(season({ values: undefined, more: 4 }));

    expect(byClassIn(cardById(empty, "season"), "divider")).toEqual([]);
    expect(byClassIn(cardById(more, "season"), "divider")).toHaveLength(1);
    expect(textLines(byClassIn(cardById(more, "season"), "more")[0]!)).toEqual(["… 4 more"]);
  });

  it("ends an enum's values with '… N more'", async () => {
    const doc = await svgDoc(season({ more: 9 }));

    const card = cardById(doc, "season");
    const [more] = byClassIn(card, "more");
    expect(numberAttr(texts(more!)[0]!, "y")).toBeGreaterThan(numberAttr(texts(rows(card).at(-1)!)[0]!, "y"));
  });

  it("gives values their own status, or a new card's, with a tint and badge, and strikes removed ones through", async () => {
    const changed = await svgDoc(season({ status: "changed", values: [{ text: "SPRING", status: "new" }, { text: "WINTER", status: "removed" }, { text: "SUMMER" }] }));
    const added = await svgDoc(season({ status: "new" }));

    const [fresh, gone, plain] = rows(cardById(changed, "season"));
    expect([fresh, gone, plain].map((row) => row!.getAttribute("data-status"))).toEqual(["new", "removed", null]);
    expect(textLines(byClassIn(fresh!, "badge")[0]!)).toEqual(["NEW"]);
    expect(byClassIn(gone!, "strike")).toHaveLength(1);
    expect(rows(cardById(added, "season")).map((row) => row.getAttribute("data-status"))).toEqual(["new", "new", "new"]);
  });

  it("draws a value's visibility symbol, underlines a static value and italicises an abstract one, as on any row", async () => {
    const doc = await svgDoc(season({ values: [{ text: "SPRING", visibility: "public", static: true }, { text: "SUMMER", abstract: true }] }));

    const [spring, summer] = rows(cardById(doc, "season"));
    expect(symbolOf(spring!)!.textContent).toBe("+");
    expect(byClassIn(spring!, "underline")).toHaveLength(1);
    expect(memberTexts(spring!).map(faceOf)).toEqual(["Structa JetBrains Mono 400 normal"]);
    expect(byClassIn(summer!, "underline")).toEqual([]);
    expect(memberTexts(summer!).map(faceOf)).toEqual(["Structa JetBrains Mono 400 italic"]);
    // A value without a symbol still lines up after the symbol's column.
    expect(numberAttr(memberTexts(summer!)[0]!, "x")).toBe(numberAttr(memberTexts(spring!)[0]!, "x"));
    expect(titleOf(spring!)).toBe("+ SPRING");
  });

  it("holds an enum's values to its status like any rows", async () => {
    expect(await problems(season({ status: "new", values: [{ text: "SPRING", status: "removed" }] }))).toEqual([
      {
        path: "nodes[0].values[0].status",
        message: 'a row in a new card can\'t be "removed"',
        hint: 'leave it out, as rows in a new card are new, or make the card "changed"',
      },
    ]);
    expect(await problems(season({ values: [{ text: "SPRING", status: "new" }] }))).toEqual([
      expect.objectContaining({ path: "nodes[0].status", message: "missing: a card needs a status when any of its rows has one" }),
    ]);
  });

  it.each([
    ["no stereotype", {}],
    ["stereotype interface", { stereotype: "interface" }],
    ["stereotype record", { stereotype: "record" }],
  ])("rejects values on a class with %s", async (_name, fields) => {
    expect(await problems(packet({ ...fields, values: [{ text: "SPRING" }] }))).toEqual([
      {
        path: "nodes[0].values",
        message: 'only a node with "stereotype": "enum" can have "values"',
        hint: 'add "stereotype": "enum", or list the rows in properties and methods',
      },
    ]);
  });

  it("reports values on a class once, whatever is in them", async () => {
    expect(await problems(packet({ values: "SPRING" }))).toEqual([
      expect.objectContaining({ path: "nodes[0].values", message: 'only a node with "stereotype": "enum" can have "values"' }),
    ]);
  });

  it("rejects properties and methods on an enum, even empty ones, each at its list", async () => {
    expect(await problems(season({ properties: [], methods: [{ text: "next(): SowingSeason" }] }))).toEqual(
      ["properties", "methods"].map((section) => ({
        path: `nodes[0].${section}`,
        message: `a node with "stereotype": "enum" can't have "${section}"`,
        hint: "list an enum's rows in values",
      })),
    );
  });

  it("doesn't judge values against a stereotype that isn't valid", async () => {
    expect(await problems(season({ stereotype: "enumeration" }))).toEqual([
      expect.objectContaining({ path: "nodes[0].stereotype", message: '"enumeration" is not a valid stereotype' }),
    ]);
  });

  it("checks a value's own fields, and reports it all together with the enum's other problems, in order", async () => {
    const input = season({ methods: [], values: [{ id: "spring", text: "SPRING", ordinal: 1 }, { id: "spring" }] });

    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].methods",
        message: `a node with "stereotype": "enum" can't have "methods"`,
        hint: "list an enum's rows in values",
      },
      {
        path: "nodes[0].values[0].ordinal",
        message: 'unknown field "ordinal"',
        hint: "allowed fields: text, id, visibility, static, abstract, status",
      },
      {
        path: "nodes[0].values[1].text",
        message: 'missing required field "text"',
        hint: 'add "text": the value as you\'d write it, such as a constant\'s name',
      },
      {
        path: "nodes[0].values[1].id",
        message: 'the id "spring" is already used by nodes[0].values[0]',
        hint: "give every row in a card its own id",
      },
    ]);
  });

  it("allows 100 values and rejects 101", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `SEASON_${i}` }));

    await expect(render(season({ values: many(100) }), { embedFonts: false })).resolves.toHaveProperty("svg");
    expect(await problems(season({ values: many(101) }))).toEqual([
      {
        path: "nodes[0].values",
        message: "has 101 values; the limit is 100",
        hint: 'split the class, or leave dull members out and count them with "more"',
      },
    ]);
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
    expect(numberAttr(t!, "y")).toBeLessThan(outlineBox(card).y + outlineBox(card).height);
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

    const drawn = rows(cardById(doc, "packet")).map((row) => [
      row.getAttribute("data-kind"),
      symbolOf(row)?.textContent,
      memberTexts(row).map((t) => t.textContent),
    ]);
    expect(drawn).toEqual([
      ["property", "+", ["variety: string"]],
      ["property", "-", ["sowBy: Date"]],
      ["property", "#", ["count: int"]],
      ["method", "~", ["germinates(days: int): bool"]],
      ["method", undefined, ["split(into: int): SeedPacket[]"]],
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

    const all = rows(cardById(doc, "packet"));
    const [symbol, ...symbols] = all.flatMap((row) => symbolOf(row) ?? []);
    expect(symbols).toHaveLength(3);
    for (const s of symbols) expect(numberAttr(s, "x")).toBe(numberAttr(symbol!, "x"));
    // Every row's text starts in one column after the symbols' "+ ", the row without a visibility too, level with its symbol.
    const size = numberAttr(symbol!, "font-size");
    for (const row of all) {
      const [t] = memberTexts(row);
      expect(numberAttr(t!, "x") - numberAttr(symbol!, "x")).toBeCloseTo(2 * MONO_ADVANCE * size, 5);
      const own = symbolOf(row);
      if (own) expect(numberAttr(own, "y")).toBe(numberAttr(t!, "y"));
    }
  });

  it("starts the text at the edge when no row has a visibility", async () => {
    const plain = { properties: [{ text: "variety: string" }], methods: [{ text: "split(): SeedPacket[]" }] };
    const doc = await svgDoc(packet(plain));
    const withSymbols = await svgDoc(packet(MEMBERS));

    // The text starts where the symbols would be.
    const [plainRow] = rows(cardById(doc, "packet"));
    expect(symbolOf(plainRow!)).toBeUndefined();
    const symbol = symbolOf(rows(cardById(withSymbols, "packet"))[0]!)!;
    expect(numberAttr(memberTexts(plainRow!)[0]!, "x")).toBe(numberAttr(symbol, "x"));
  });

  it("is 360px wide, with the name, then the properties, then the methods, split by dividers", async () => {
    const doc = await svgDoc(packet(MEMBERS));

    const card = cardById(doc, "packet");
    const box = outlineBox(card);
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

  it.each([
    ["no more", {}],
    ["more", { more: 4 }],
  ])("keeps an empty properties section above the methods of a class with no properties, with %s", async (_name, fields) => {
    const doc = await svgDoc(packet({ methods: MEMBERS.methods, ...fields }));

    const card = cardById(doc, "packet");
    const [underName, betweenSections] = byClassIn(card, "divider").map((d) => numberAttr(d, "y1"));
    expect(byClassIn(card, "divider")).toHaveLength(2);
    expect(numberAttr(texts(card)[0]!, "y")).toBeLessThan(underName!);
    expect(betweenSections).toBeGreaterThan(underName!);
    // The methods sit under the second divider, as they do when a class has properties, and "… N more" after them.
    const methods = rows(card);
    expect(methods.map((r) => r.getAttribute("data-kind"))).toEqual(["method", "method"]);
    for (const row of methods) expect(numberAttr(memberTexts(row)[0]!, "y") - 12).toBeGreaterThan(betweenSections!);
    const more = byClassIn(card, "more");
    expect(more).toHaveLength("more" in fields ? 1 : 0);
    for (const m of more) expect(numberAttr(texts(m)[0]!, "y")).toBeGreaterThan(numberAttr(memberTexts(methods.at(-1)!)[0]!, "y"));
  });

  it("leaves the methods section out of a class with no methods, and both out of a class with no rows", async () => {
    const onlyProperties = await svgDoc(packet({ properties: MEMBERS.properties }));
    const neither = await svgDoc(packet());

    expect(byClassIn(cardById(onlyProperties, "packet"), "divider")).toHaveLength(1);
    expect(rows(cardById(onlyProperties, "packet")).map((r) => r.getAttribute("data-kind"))).toEqual(["property", "property", "property"]);
    expect(byClassIn(cardById(neither, "packet"), "divider")).toHaveLength(0);
  });

  it("wraps a long row under its own text, without losing any of it", async () => {
    const text = "repot(into: Pot, compost: CompostMix, water: Litres, feed: LiquidFeed, label: string): Plant";
    const doc = await svgDoc(packet({ methods: [{ text, visibility: "public" }, { text: "water(): void", visibility: "public" }] }));

    const [long, short] = rows(cardById(doc, "packet"));
    const wrapped = memberTexts(long!);
    const symbol = symbolOf(long!)!;
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.map((t) => t.textContent).join(" ")).toBe(text);
    expect(titleOf(long!)).toBe(`+ ${text}`);
    // Every line starts under the text, not under the symbol, each below the one before; the next row comes after the last.
    const size = numberAttr(symbol, "font-size");
    expect(numberAttr(wrapped[0]!, "y")).toBe(numberAttr(symbol, "y"));
    wrapped.forEach((t, i) => {
      expect(numberAttr(t, "x") - numberAttr(symbol, "x")).toBeCloseTo(2 * MONO_ADVANCE * size, 5);
      if (i > 0) expect(numberAttr(t, "y")).toBeGreaterThan(numberAttr(wrapped[i - 1]!, "y"));
    });
    expect(numberAttr(texts(short!)[0]!, "y")).toBeGreaterThan(numberAttr(wrapped.at(-1)!, "y"));
    // Every line fits inside the card.
    const box = outlineBox(cardById(doc, "packet"));
    for (const t of wrapped) {
      const right = numberAttr(t, "x") + MONO_ADVANCE * size * t.textContent!.length;
      expect(right).toBeLessThanOrEqual(box.x + box.width);
    }
  });
});

describe("row status", () => {
  /** A changed seed packet whose four methods have these statuses. */
  function statuses(...given: (string | undefined)[]) {
    const methods = ["sow(): void", "water(): void", "thin(): void", "label(): void"];
    return packet({
      status: "changed",
      methods: methods.map((text, i) => ({ text, visibility: "public", ...(given[i] ? { status: given[i] } : {}) })),
    });
  }

  function tint(row: Element): Element | undefined {
    return Array.from(row.getElementsByTagName("rect")).find((rect) => rect.parentNode === row || (rect.parentNode as Element).getAttribute("class") === "faded");
  }

  it("tints a row with a status and puts its badge at its right-hand end", async () => {
    const doc = await svgDoc(statuses("new"));

    const card = cardById(doc, "packet");
    const row = rows(card)[0]!;
    expect(row.getAttribute("data-status")).toBe("new");
    const band = rectBox(tint(row)!);
    const badge = badgeBox(row)!;
    const [word] = texts(byClassIn(row, "badge")[0]!);
    expect(word!.textContent).toBe("NEW");
    // The tint spans the card inside its border; the badge sits inside it, at the right.
    const box = outlineBox(card);
    expect(band.x).toBeGreaterThan(box.x);
    expect(band.x + band.width).toBeLessThan(box.x + box.width);
    expect(band.width).toBeGreaterThan(box.width * 0.9);
    expect(badge.x + badge.width).toBeLessThan(band.x + band.width);
    expect(badge.x).toBeGreaterThan(band.x + band.width / 2);
    expect(badge.y).toBeGreaterThanOrEqual(band.y);
    expect(badge.y + badge.height).toBeLessThanOrEqual(band.y + band.height);
    // The row's text is inside its band.
    const [t] = texts(row);
    expect(numberAttr(t!, "y")).toBeGreaterThan(band.y);
    expect(numberAttr(t!, "y")).toBeLessThan(band.y + band.height);
  });

  it("gives a row without a status no tint, no badge and no status attribute", async () => {
    const doc = await svgDoc(statuses("new"));

    const row = rows(cardById(doc, "packet"))[1]!;
    expect(row.hasAttribute("data-status")).toBe(false);
    expect(row.getElementsByTagName("rect")).toHaveLength(0);
    expect(byClassIn(row, "badge")).toEqual([]);
  });

  // The spec's GitHub Primer table: the badge's fill, its strength, its border and its word, and the tint is the
  // badge's fill at less than the badge's strength.
  it.each([
    ["light", "new", "#b9f0c4", 1, "#1f883d", "#116329"],
    ["light", "changed", "#fae17d", 1, "#bf8700", "#7d4e00"],
    ["light", "removed", "#ffcecb", 1, "#cf222e", "#a40e26"],
    ["light", "unchanged", "#eaeef2", 1, "#8c959f", "#59636e"],
    ["dark", "new", "#3fb950", 0.25, "#3fb950", "#56d364"],
    ["dark", "changed", "#d29922", 0.25, "#d29922", "#e3b341"],
    ["dark", "removed", "#f85149", 0.25, "#f85149", "#ff7b72"],
    ["dark", "unchanged", "#6e7681", 0.25, "#6e7681", "#8b949e"],
  ] as const)("colours a %s-theme %s row's tint and badge", async (theme, status, fill, strength, stroke, word) => {
    const doc = await svgDoc(statuses(status), theme);

    const row = rows(cardById(doc, "packet"))[0]!;
    const band = tint(row)!;
    expect(band.getAttribute("fill")).toBe(fill);
    expect(Number(band.getAttribute("fill-opacity"))).toBeGreaterThan(0);
    expect(Number(band.getAttribute("fill-opacity"))).toBeLessThan(strength);
    const [, pill] = Array.from(byClassIn(row, "badge")[0]!.getElementsByTagName("rect"));
    expect([pill!.getAttribute("fill"), Number(pill!.getAttribute("fill-opacity") ?? 1), pill!.getAttribute("stroke")]).toEqual([
      fill,
      strength,
      stroke,
    ]);
    expect(texts(byClassIn(row, "badge")[0]!)[0]!.getAttribute("fill")).toBe(word);
  });

  it("keeps a row's text clear of its badge, wrapping it sooner", async () => {
    // 38 characters: one line on its own, but not beside a badge.
    const text = "transplant(seedlings: Seedling[]): Bed";
    const doc = await svgDoc(packet({ status: "changed", methods: [{ text, status: "changed" }, { text }] }));

    const [withBadge, without] = rows(cardById(doc, "packet"));
    const badge = badgeBox(withBadge!)!;
    for (const t of memberTexts(withBadge!)) {
      const right = numberAttr(t, "x") + MONO_ADVANCE * numberAttr(t, "font-size") * t.textContent!.length;
      expect(right).toBeLessThan(badge.x);
    }
    expect(memberTexts(withBadge!).length).toBeGreaterThan(memberTexts(without!).length);
    expect(memberTexts(withBadge!).map((t) => t.textContent).join(" ")).toBe(text);
  });

  it.each([
    ["private", "-"],
    ["package", "~"],
    ["public", "+"],
    ["protected", "#"],
    [undefined, undefined],
  ])("fades a removed row with visibility %s and strikes through every line of its text, but not its symbol or badge", async (visibility, mark) => {
    const text = "transplant(seedlings: Seedling[], bed: RaisedBed, spacing: Centimetres): Planting";
    const removedRow = { text, status: "removed", ...(visibility ? { visibility } : {}) };
    const doc = await svgDoc(packet({ status: "changed", methods: [removedRow, { text: "water(): void", visibility: "public" }] }));

    const [removed, plain] = rows(cardById(doc, "packet"));
    const [faded] = byClassIn(removed!, "faded");
    expect(Number(faded!.getAttribute("opacity"))).toBeLessThan(0.7);
    const drawn = memberTexts(faded!);
    expect(drawn.length).toBeGreaterThan(1);
    const strikes = byClassIn(faded!, "strike");
    expect(strikes).toHaveLength(drawn.length);
    drawn.forEach((t, i) => {
      const strike = strikes[i]!;
      const baseline = numberAttr(t, "y");
      const size = numberAttr(t, "font-size");
      expect(numberAttr(strike, "y1")).toBe(numberAttr(strike, "y2"));
      expect(numberAttr(strike, "y1")).toBeLessThan(baseline - size * 0.15);
      expect(numberAttr(strike, "y1")).toBeGreaterThan(baseline - size * 0.5);
      expect(numberAttr(strike, "x1")).toBeCloseTo(numberAttr(t, "x"), 5);
      expect(numberAttr(strike, "x2") - numberAttr(strike, "x1")).toBeCloseTo(MONO_ADVANCE * size * t.textContent!.length, 1);
    });
    // The symbol is faded with the row but kept clear of the strike, which starts a space after it, where the text does.
    const symbol = symbolOf(faded!);
    expect(symbol?.textContent).toBe(mark);
    const firstStrike = numberAttr(strikes[0]!, "x1");
    const symbolX = numberAttr(symbol ?? symbolOf(plain!)!, "x");
    expect(firstStrike - symbolX).toBeCloseTo(2 * MONO_ADVANCE * numberAttr(drawn[0]!, "font-size"), 5);
    if (symbol) expect(numberAttr(symbol, "y")).toBe(numberAttr(drawn[0]!, "y"));
    expect(byClassIn(faded!, "badge")).toEqual([]);
    expect(byClassIn(removed!, "badge")).toHaveLength(1);
    expect(byClassIn(plain!, "faded")).toEqual([]);
    expect(byClassIn(plain!, "strike")).toEqual([]);
  });

  it.each(["new", "removed"])("gives rows without a status in a %s card the card's status, tint and badge", async (status) => {
    const doc = await svgDoc(packet({ status, properties: [{ text: "variety: string" }], methods: [{ text: "sow(): void", status }] }));

    for (const row of rows(cardById(doc, "packet"))) {
      expect(row.getAttribute("data-status")).toBe(status);
      expect(tint(row)).toBeDefined();
      expect(textLines(byClassIn(row, "badge")[0]!)).toEqual([status.toUpperCase()]);
    }
  });

  it("fades a removed card's rows once, not twice", async () => {
    const doc = await svgDoc(packet({ status: "removed", methods: [{ text: "sow(): void" }] }));

    const card = cardById(doc, "packet");
    const [row] = rows(card);
    const fadedAround = (el: Element): number =>
      el.parentNode && "getAttribute" in el.parentNode
        ? ((el.parentNode as Element).getAttribute("class") === "faded" ? 1 : 0) + fadedAround(el.parentNode as Element)
        : 0;
    expect(fadedAround(texts(row!)[0]!)).toBe(1);
    expect(byClassIn(row!, "strike")).toHaveLength(1);
  });

  it.each(["changed", "unchanged", undefined])("leaves rows without a status in a %s card plain", async (status) => {
    const doc = await svgDoc(packet({ ...(status ? { status } : {}), methods: [{ text: "sow(): void" }] }));

    const [row] = rows(cardById(doc, "packet"));
    expect(row!.hasAttribute("data-status")).toBe(false);
    expect(row!.getElementsByTagName("rect")).toHaveLength(0);
  });

  it("draws every row exactly once, with its own or its card's status", async () => {
    const input = {
      type: "class",
      nodes: [
        { id: "sower", label: "Sower", status: "new", properties: [{ text: "seeds: int" }], methods: [{ id: "sow", text: "sow(): void" }] },
        {
          id: "bed",
          label: "Bed",
          status: "changed",
          properties: [{ text: "length: Metres", status: "unchanged" }, { text: "soil: Soil" }],
          methods: [{ text: "dig(): void", status: "removed" }, { id: "feed", text: "feed(): void", status: "new" }, { text: "rake(): void", status: "changed" }],
        },
        { id: "cloche", label: "Cloche", status: "removed", methods: [{ text: "cover(): void", status: "removed" }, { text: "vent(): void" }] },
        { id: "fork", label: "Fork", status: "unchanged", properties: [{ text: "tines: int", status: "unchanged" }, { text: "handle: Wood" }] },
        { id: "string", label: "String", properties: [{ text: "length: Metres" }] },
      ],
    };
    const doc = await svgDoc(input);

    const drawn = cards(doc).flatMap((card) =>
      rows(card).map((row) => [card.getAttribute("data-id"), row.getAttribute("data-id"), row.getAttribute("data-kind"), row.getAttribute("data-status")]),
    );
    expect(drawn).toEqual([
      ["sower", "properties[0]", "property", "new"],
      ["sower", "sow", "method", "new"],
      ["bed", "properties[0]", "property", "unchanged"],
      ["bed", "properties[1]", "property", null],
      ["bed", "methods[0]", "method", "removed"],
      ["bed", "feed", "method", "new"],
      ["bed", "methods[2]", "method", "changed"],
      ["cloche", "methods[0]", "method", "removed"],
      ["cloche", "methods[1]", "method", "removed"],
      ["fork", "properties[0]", "property", "unchanged"],
      ["fork", "properties[1]", "property", null],
      ["string", "properties[0]", "property", null],
    ]);
    // Every row is drawn once: no row element is inside another.
    expect(allElements(doc).filter((el) => el.getAttribute("class") === "row")).toHaveLength(drawn.length);
  });

  it("lists the statuses rows use in the legend", async () => {
    const input = packet({ status: "changed", methods: [{ text: "sow(): void", status: "new" }, { text: "dig(): void", status: "removed" }] });
    const doc = await svgDoc(input);

    const legend = allElements(doc).filter((el) => el.getAttribute("class") === "legend-item");
    expect(legend.map((item) => item.getAttribute("data-status"))).toEqual(["new", "changed", "removed"]);
  });

  it("lists a status rows only take from their card once in the legend", async () => {
    const doc = await svgDoc(packet({ status: "new", methods: [{ text: "sow(): void" }] }));

    const legend = allElements(doc).filter((el) => el.getAttribute("class") === "legend-item");
    expect(legend.map((item) => item.getAttribute("data-status"))).toEqual(["new"]);
  });
});

describe("status rules", () => {
  /** A card with this status and one property and three methods with these statuses. */
  function card(status: string | undefined, ...rowStatuses: (string | undefined)[]) {
    const texts = ["soil: Soil", "dig(): void", "feed(): void", "rake(): void"];
    const rowsOf = rowStatuses.map((s, i) => ({ text: texts[i]!, ...(s ? { status: s } : {}) }));
    return {
      id: "bed",
      label: "RaisedBed",
      ...(status ? { status } : {}),
      properties: rowsOf.slice(0, 1),
      methods: rowsOf.slice(1),
    };
  }

  const diagram = (...nodes: object[]) => ({ type: "class", nodes });

  it.each([
    ["new", ["new", undefined, "new"]],
    ["removed", ["removed", "removed", undefined]],
    ["unchanged", ["unchanged", undefined, "unchanged"]],
    ["changed", ["new", "changed", "removed", "unchanged"]],
    ["changed", [undefined, undefined]],
    [undefined, [undefined, undefined]],
  ] as const)("lets a %s card hold rows that are %j", async (status, rowStatuses) => {
    await expect(render(diagram(card(status, ...rowStatuses)), { embedFonts: false })).resolves.toHaveProperty("svg");
  });

  it("rejects a new card holding rows that aren't new, each at the row", async () => {
    expect(await problems(diagram(card("new", "changed", "new", "removed", "unchanged")))).toEqual([
      {
        path: "nodes[0].properties[0].status",
        message: 'a row in a new card can\'t be "changed"',
        hint: 'leave it out, as rows in a new card are new, or make the card "changed"',
      },
      {
        path: "nodes[0].methods[1].status",
        message: 'a row in a new card can\'t be "removed"',
        hint: 'leave it out, as rows in a new card are new, or make the card "changed"',
      },
      {
        path: "nodes[0].methods[2].status",
        message: 'a row in a new card can\'t be "unchanged"',
        hint: 'leave it out, as rows in a new card are new, or make the card "changed"',
      },
    ]);
  });

  it("rejects a removed card holding rows that aren't removed", async () => {
    expect(await problems(diagram(card("removed", "removed", "new", undefined, "unchanged")))).toEqual([
      {
        path: "nodes[0].methods[0].status",
        message: 'a row in a removed card can\'t be "new"',
        hint: 'leave it out, as rows in a removed card are removed, or make the card "changed"',
      },
      {
        path: "nodes[0].methods[2].status",
        message: 'a row in a removed card can\'t be "unchanged"',
        hint: 'leave it out, as rows in a removed card are removed, or make the card "changed"',
      },
    ]);
  });

  it("rejects an unchanged card holding new, changed or removed rows", async () => {
    expect(await problems(diagram(card("unchanged", "unchanged", "new", "changed", "removed")))).toEqual(
      ["new", "changed", "removed"].map((status, i) => ({
        path: `nodes[0].methods[${i}].status`,
        message: `a row in an unchanged card can't be "${status}"`,
        hint: 'make the card "changed", or leave the row\'s status out',
      })),
    );
  });

  it.each(["new", "unchanged"])("rejects a card with no status holding a row that's %s, once for the card", async (status) => {
    expect(await problems(diagram(card(undefined, undefined, status, status)))).toEqual([
      {
        path: "nodes[0].status",
        message: "missing: a card needs a status when any of its rows has one",
        hint: 'give the card a status, such as "changed", or take the statuses off its rows',
      },
    ]);
  });

  it("doesn't judge rows against a card status that isn't valid", async () => {
    expect(await problems(diagram(card("deleted", "removed")))).toEqual([
      { path: "nodes[0].status", message: '"deleted" is not a valid status', hint: 'use "new", "changed", "removed" or "unchanged"' },
    ]);
  });

  it("reports every card's contradictions together, in order, with other problems", async () => {
    const input = diagram(
      { ...card("new", "removed"), colour: "green" },
      { ...card(undefined, "new"), id: "path" },
      { ...card("unchanged", undefined, "changed"), id: "shed" },
    );

    expect((await problems(input)).map((p) => p.path)).toEqual([
      "nodes[0].colour",
      "nodes[0].properties[0].status",
      "nodes[1].status",
      "nodes[2].methods[0].status",
    ]);
  });
});

describe("class limits", () => {
  const member = (i: number) => ({ text: `job${i}(): void` });
  const many = (n: number) => Array.from({ length: n }, (_, i) => member(i));

  it("allows 100 rows in a card, properties and methods together", async () => {
    await expect(render(packet({ properties: many(40), methods: many(60) }), { embedFonts: false })).resolves.toHaveProperty("svg");
  });

  it("rejects 101 rows in a card as INVALID_INPUT", async () => {
    expect(await problems(packet({ properties: many(40), methods: many(61) }))).toEqual([
      {
        path: "nodes[0]",
        message: "has 101 rows; the limit is 100 per card",
        hint: 'split the class, or leave dull members out and count them with "more"',
      },
    ]);
  });

  it.each([
    ["an enum's properties", { stereotype: "enum", properties: many(60), values: many(60) }, "properties", 'a node with "stereotype": "enum" can\'t have "properties"'],
    ["a class's values", { methods: many(60), values: many(60) }, "values", 'only a node with "stereotype": "enum" can have "values"'],
  ])("doesn't count %s toward the row limit, as the card can't have them", async (_name, fields, section, message) => {
    expect(await problems(packet(fields))).toEqual([expect.objectContaining({ path: `nodes[0].${section}`, message })]);
  });

  it("reports 101 rows in one section once, at that section", async () => {
    expect(await problems(packet({ properties: many(101), methods: many(5) }))).toEqual([
      {
        path: "nodes[0].properties",
        message: "has 101 properties; the limit is 100",
        hint: 'split the class, or leave dull members out and count them with "more"',
      },
    ]);
  });

  it("allows row text of 200 characters and rejects 201 as INVALID_INPUT", async () => {
    await expect(render(packet({ methods: [{ text: "m".repeat(200) }] }), { embedFonts: false })).resolves.toHaveProperty("svg");
    expect(await problems(packet({ methods: [{ text: "m".repeat(201) }] }))).toEqual([
      { path: "nodes[0].methods[0].text", message: "is 201 characters long; the limit is 200", hint: "shorten it" },
    ]);
  });

  it("allows a class name of 100 characters and a description of 300", async () => {
    await expect(render(packet({ label: "N".repeat(100), description: "d".repeat(300) }), { embedFonts: false })).resolves.toHaveProperty("svg");
    expect((await problems(packet({ label: "N".repeat(101), description: "d".repeat(301) }))).map((p) => p.message)).toEqual([
      "is 101 characters long; the limit is 100",
      "is 301 characters long; the limit is 300",
    ]);
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
      { path: `nodes[0].${section}[0].colour`, message: 'unknown field "colour"', hint: "allowed fields: text, id, visibility, static, abstract, status" },
    ]);
  });

  it("rejects an unknown field on a class node", async () => {
    const input = sheds();
    input.nodes[0]!.shape = "step";

    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].shape",
        message: 'unknown field "shape"',
        hint: "allowed fields: id, label, description, area, status, stereotype, abstract, properties, methods, values, more",
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
