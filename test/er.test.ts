import { readFileSync } from "node:fs";
import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import { colourDifference, decodePng, pixel } from "./helpers/png";
import {
  allElements,
  alongRuns,
  badgeBox,
  boundsOf,
  byClassIn,
  cardById,
  distanceOutside,
  lines,
  outlineBox,
  overlaps,
  parsePath,
  parseSvg,
  rectBox,
  svgDoc,
  textLines,
  titleOf,
  type Box,
  type Point,
} from "./helpers/svg";

/** JetBrains Mono draws every character 0.6 em wide. */
const MONO_ADVANCE = 0.6;

async function problems(input: object): Promise<readonly Problem[]> {
  const error = await render(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("INVALID_INPUT");
  return (error as StructaError).problems;
}

/** A plot belongs to one allotment site: the plots table points at the sites table. */
function allotments(fields: object = {}, edge: object = {}) {
  return {
    type: "er",
    nodes: [
      { id: "sites", label: "sites" },
      { id: "plots", label: "plots" },
    ],
    edges: [{ from: "plots", to: "sites", fromCardinality: "zero-or-many", toCardinality: "one", ...edge }],
    ...fields,
  };
}

/** A one-table diagram: a plots table with whatever fields a test gives it. */
function plots(fields: object = {}) {
  return { type: "er", nodes: [{ id: "plots", label: "plots", ...fields }] };
}

/** Columns with every marker, alone and together. */
const COLUMNS = [
  { name: "id", type: "uuid", pk: true },
  { name: "site_id", type: "uuid", fk: true },
  { name: "number", type: "text", unique: true },
  { name: "tenant_id", type: "uuid", fk: true, nullable: true },
  { name: "notes", type: "text", nullable: true },
  { name: "site_and_number", type: "text", pk: true, fk: true, unique: true },
];

function rows(card: Element): Element[] {
  return byClassIn(card, "row");
}

function texts(el: Element): Element[] {
  return Array.from(el.getElementsByTagName("text"));
}

/** A row's own text: its name and type, without its key markers or the word in its badge. */
function columnTexts(row: Element): Element[] {
  const other = new Set([...byClassIn(row, "badge"), ...byClassIn(row, "symbol")].flatMap(texts));
  return texts(row).filter((t) => !other.has(t));
}

function numberAttr(el: Element, name: string): number {
  return Number(el.getAttribute(name));
}

describe("ER tables", () => {
  it("draws each node of an ER diagram as a table card with its name", async () => {
    const doc = await svgDoc(allotments());

    const card = cardById(doc, "sites");
    expect(card.getAttribute("data-kind")).toBe("table");
    expect(textLines(card)).toEqual(["sites"]);
    expect(titleOf(card)).toBe("sites");
  });

  it.each([
    ["light", "#59636e"],
    ["dark", "#8b949e"],
  ] as const)("draws a description under the name, muted in %s, wrapped, and above the columns", async (theme, muted) => {
    const description = "Every plot on every site, with whoever rents it this season and the notes from the last walk round.";
    const doc = await svgDoc(plots({ description, columns: COLUMNS }), theme);

    const card = cardById(doc, "plots");
    const [name, ...rest] = texts(card).filter((t) => !rows(card).some((row) => texts(row).includes(t)));
    expect(rest.length).toBeGreaterThan(1);
    expect(rest.map((t) => t.textContent).join(" ")).toBe(description);
    for (const t of rest) {
      expect([t.getAttribute("font-family")!.split(",")[0], t.getAttribute("font-weight"), t.getAttribute("fill")]).toEqual([
        "Structa Inter",
        "400",
        muted,
      ]);
      expect(numberAttr(t, "font-size")).toBeLessThan(numberAttr(name!, "font-size"));
      expect(numberAttr(t, "y")).toBeGreaterThan(numberAttr(name!, "y"));
      expect(numberAttr(t, "y")).toBeLessThan(numberAttr(byClassIn(card, "divider")[0]!, "y1"));
    }
    expect(titleOf(card)).toBe(`plots: ${description}`);
  });

  it("checks a description against Inter, and allows 300 characters", async () => {
    await expect(render(plots({ description: "d".repeat(300) }), { embedFonts: false })).resolves.toHaveProperty("svg");

    expect(await problems(plots({ description: `${"d".repeat(300)}⇑` }))).toEqual([
      { path: "nodes[0].description", message: "is 301 characters long; the limit is 300", hint: "shorten it" },
      { path: "nodes[0].description", message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw', hint: "use Latin letters, digits and common symbols" },
    ]);
  });

  it("wraps a long name, never cutting it off", async () => {
    const label = "seasonal_plot_tenancy_waiting_list_entries_with_preferred_sites_and_sizes";
    const doc = await svgDoc(plots({ label }));

    const card = cardById(doc, "plots");
    expect(textLines(card).length).toBeGreaterThan(1);
    expect(textLines(card).join("")).toBe(label);
    expect(outlineBox(card).width).toBe(360);
  });

  it("lays tables out left to right by default, and top to bottom with direction down", async () => {
    const right = await svgDoc(allotments());
    const down = await svgDoc(allotments({ direction: "down" }));

    const [plots, sites] = ["plots", "sites"].map((id) => outlineBox(cardById(right, id)));
    expect(sites!.x).toBeGreaterThanOrEqual(plots!.x + plots!.width);
    const [plotsDown, sitesDown] = ["plots", "sites"].map((id) => outlineBox(cardById(down, id)));
    expect(sitesDown!.y).toBeGreaterThanOrEqual(plotsDown!.y + plotsDown!.height);
    expect(lines(right)).toHaveLength(1);
  });
});

describe("ER columns", () => {
  it("draws each column as a row, known by its name, with its name then its type", async () => {
    const doc = await svgDoc(plots({ columns: [{ name: "id", type: "uuid" }, { name: "area_m2", type: "numeric(6,1)" }] }));

    const drawn = rows(cardById(doc, "plots")).map((row) => [
      row.getAttribute("data-id"),
      row.getAttribute("data-kind"),
      columnTexts(row).map((t) => t.textContent),
    ]);
    expect(drawn).toEqual([
      ["id", "column", ["id", "uuid"]],
      ["area_m2", "column", ["area_m2", "numeric(6,1)"]],
    ]);
  });

  it.each([
    ["light", "#1f2328", "#59636e"],
    ["dark", "#e6edf3", "#8b949e"],
  ] as const)("draws the names in JetBrains Mono in the text colour and the types muted, in one column, in %s", async (theme, text, muted) => {
    const columns = [{ name: "id", type: "uuid" }, { name: "planted_on", type: "date" }, { name: "x", type: "int" }];
    const doc = await svgDoc(plots({ columns }), theme);

    const all = rows(cardById(doc, "plots")).map(columnTexts);
    for (const [name, type] of all) {
      expect(name!.getAttribute("font-family")).toMatch(/^Structa JetBrains Mono,/);
      expect(type!.getAttribute("font-family")).toMatch(/^Structa JetBrains Mono,/);
      expect([name!.getAttribute("fill"), type!.getAttribute("fill")]).toEqual([text, muted]);
      expect(numberAttr(type!, "y")).toBe(numberAttr(name!, "y"));
      // The type starts after the longest name, with a gap.
      expect(numberAttr(type!, "x")).toBeGreaterThan(numberAttr(name!, "x") + "planted_on".length * MONO_ADVANCE * numberAttr(name!, "font-size"));
    }
    expect(new Set(all.map(([name]) => numberAttr(name!, "x"))).size).toBe(1);
    expect(new Set(all.map(([, type]) => numberAttr(type!, "x"))).size).toBe(1);
  });

  it("marks keys as PK, FK and UQ in a column before the names, and a nullable column with ? after its type", async () => {
    const doc = await svgDoc(plots({ columns: COLUMNS }));

    const all = rows(cardById(doc, "plots"));
    const drawn = all.map((row) => [byClassIn(row, "symbol").flatMap(textLines)[0], columnTexts(row).map((t) => t.textContent)]);
    expect(drawn).toEqual([
      ["PK", ["id", "uuid"]],
      ["FK", ["site_id", "uuid"]],
      ["UQ", ["number", "text"]],
      ["FK", ["tenant_id", "uuid?"]],
      [undefined, ["notes", "text?"]],
      ["PK FK UQ", ["site_and_number", "text"]],
    ]);
    // The markers are small and muted, on the name's baseline, and every name starts after the widest of them.
    const markers = all.flatMap((row) => byClassIn(row, "symbol").flatMap(texts));
    expect(markers).toHaveLength(5);
    const widest = markers.at(-1)!;
    for (const row of all) {
      const [name] = columnTexts(row);
      const [marker] = byClassIn(row, "symbol").flatMap(texts);
      expect(numberAttr(name!, "x")).toBeGreaterThan(numberAttr(widest, "x") + 30);
      expect(numberAttr(name!, "x")).toBe(numberAttr(columnTexts(all[0]!)[0]!, "x"));
      if (!marker) continue;
      expect(numberAttr(marker, "x")).toBe(numberAttr(widest, "x"));
      expect(numberAttr(marker, "y")).toBe(numberAttr(name!, "y"));
      expect(numberAttr(marker, "font-size")).toBeLessThan(numberAttr(name!, "font-size"));
      expect(marker.getAttribute("font-family")).toMatch(/^Structa Inter,/);
      expect(marker.getAttribute("fill")).toBe("#59636e");
    }
  });

  it("starts the names where the markers would be when no column is a key", async () => {
    const plain = await svgDoc(plots({ columns: [{ name: "notes", type: "text" }] }));
    const keyed = await svgDoc(plots({ columns: COLUMNS }));

    const [name] = columnTexts(rows(cardById(plain, "plots"))[0]!);
    const [marker] = byClassIn(rows(cardById(keyed, "plots"))[0]!, "symbol").flatMap(texts);
    expect(byClassIn(cardById(plain, "plots"), "symbol")).toEqual([]);
    expect(numberAttr(name!, "x")).toBe(numberAttr(marker!, "x"));
  });

  it("gives every row a tooltip with its markers, name and type", async () => {
    const doc = await svgDoc(plots({ columns: COLUMNS }));

    expect(rows(cardById(doc, "plots")).map(titleOf)).toEqual([
      "PK id: uuid",
      "FK site_id: uuid",
      "UQ number: text",
      "FK tenant_id: uuid?",
      "notes: text?",
      "PK FK UQ site_and_number: text",
    ]);
  });

  it("puts the rows under a divider below the name, inside a 360px card", async () => {
    const doc = await svgDoc(plots({ columns: COLUMNS }));

    const card = cardById(doc, "plots");
    const box = outlineBox(card);
    expect(box.width).toBe(360);
    const dividers = byClassIn(card, "divider");
    expect(dividers).toHaveLength(1);
    const [name] = texts(card);
    const divider = numberAttr(dividers[0]!, "y1");
    expect(divider).toBeGreaterThan(numberAttr(name!, "y"));
    const baselines = rows(card).map((row) => numberAttr(columnTexts(row)[0]!, "y"));
    expect(baselines[0]! - 12).toBeGreaterThan(divider);
    baselines.forEach((y, i) => i > 0 && expect(y).toBeGreaterThan(baselines[i - 1]!));
    expect(baselines.at(-1)!).toBeLessThan(box.y + box.height);
  });
});

describe("the more row of a table", () => {
  it("adds a muted '… 7 more' after the last column, lined up with the names", async () => {
    const doc = await svgDoc(plots({ columns: COLUMNS, more: 7 }));

    const card = cardById(doc, "plots");
    const [more] = byClassIn(card, "more");
    expect(textLines(more!)).toEqual(["… 7 more"]);
    const [t] = texts(more!);
    expect(t!.getAttribute("fill")).toBe("#59636e");
    expect(numberAttr(t!, "x")).toBe(numberAttr(columnTexts(rows(card)[0]!)[0]!, "x"));
    expect(numberAttr(t!, "y")).toBeGreaterThan(numberAttr(columnTexts(rows(card).at(-1)!)[0]!, "y"));
    expect(numberAttr(t!, "y")).toBeLessThan(outlineBox(card).y + outlineBox(card).height);
    expect(rows(card)).toHaveLength(COLUMNS.length);
  });

  it("gets a section of its own on a table with no columns", async () => {
    const doc = await svgDoc(plots({ more: 30 }));

    const card = cardById(doc, "plots");
    expect(byClassIn(card, "divider")).toHaveLength(1);
    expect(textLines(byClassIn(card, "more")[0]!)).toEqual(["… 30 more"]);
  });

  it("is left out without more, and a table with no columns has no divider", async () => {
    const doc = await svgDoc(plots());

    expect(byClassIn(cardById(doc, "plots"), "more")).toEqual([]);
    expect(byClassIn(cardById(doc, "plots"), "divider")).toEqual([]);
  });

  it.each([0, 10000, "3"])("rejects more: %j", async (more) => {
    expect(await problems(plots({ more }))).toEqual([
      { path: "nodes[0].more", message: `${JSON.stringify(more)} is not a whole number from 1 to 9999`, hint: "write a whole number without quotes, or leave more out" },
    ]);
  });
});

describe("column status", () => {
  function tint(row: Element): Element | undefined {
    return Array.from(row.getElementsByTagName("rect")).find(
      (rect) => rect.parentNode === row || (rect.parentNode as Element).getAttribute("class") === "faded",
    );
  }

  it("tints a column with a status, puts its badge at the right-hand end, and keeps the type clear of it", async () => {
    // 30 characters: one line on its own, but not beside a badge.
    const type = "numeric(12,4) check (rent > 0)";
    const doc = await svgDoc(plots({ status: "changed", columns: [{ name: "rent", type, status: "changed" }, { name: "deposit", type }] }));

    const card = cardById(doc, "plots");
    const [withBadge, without] = rows(card);
    expect(withBadge!.getAttribute("data-status")).toBe("changed");
    const band = rectBox(tint(withBadge!)!);
    const badge = badgeBox(withBadge!)!;
    expect(textLines(byClassIn(withBadge!, "badge")[0]!)).toEqual(["CHANGED"]);
    expect(badge.x + badge.width).toBeLessThan(band.x + band.width);
    expect(badge.x).toBeGreaterThan(band.x + band.width / 2);
    const types = columnTexts(withBadge!).slice(1);
    for (const t of types) {
      expect(numberAttr(t, "x") + MONO_ADVANCE * numberAttr(t, "font-size") * t.textContent!.length).toBeLessThan(badge.x);
    }
    expect(types.length).toBeGreaterThan(columnTexts(without!).length - 1);
    expect(types.map((t) => t.textContent).join(" ")).toBe(type);
    expect(without!.hasAttribute("data-status")).toBe(false);
    expect(without!.getElementsByTagName("rect")).toHaveLength(0);
  });

  it("keeps a type's words whole beside a badge, wrapping a long name instead", async () => {
    const columns = [
      { name: "id", type: "uuid", pk: true },
      { name: "last_reminder_was_sent_at", type: "timestamptz", nullable: true, status: "unchanged" },
    ];
    const doc = await svgDoc(plots({ status: "changed", columns }));

    const row = rows(cardById(doc, "plots"))[1]!;
    const [name, ...rest] = columnTexts(row);
    const types = rest.filter((t) => numberAttr(t, "x") !== numberAttr(name!, "x"));
    expect(types.map((t) => t.textContent)).toEqual(["timestamptz?"]);
    const [type] = types;
    expect(numberAttr(type!, "x") + MONO_ADVANCE * numberAttr(type!, "font-size") * type!.textContent!.length).toBeLessThan(badgeBox(row)!.x);
    expect(rest.length).toBeGreaterThan(types.length);
  });

  it("fades a removed column and strikes through its name and type, but not its markers or badge", async () => {
    const doc = await svgDoc(plots({ status: "changed", columns: [{ name: "plot_code", type: "text", unique: true, status: "removed" }, { name: "id", type: "uuid", pk: true }] }));

    const [removed, kept] = rows(cardById(doc, "plots"));
    const [faded] = byClassIn(removed!, "faded");
    expect(Number(faded!.getAttribute("opacity"))).toBeLessThan(0.7);
    expect(byClassIn(faded!, "strike")).toHaveLength(2);
    expect(byClassIn(faded!, "symbol").flatMap(textLines)).toEqual(["UQ"]);
    expect(byClassIn(byClassIn(faded!, "symbol")[0]!, "strike")).toEqual([]);
    expect(byClassIn(removed!, "badge")).toHaveLength(1);
    expect(byClassIn(faded!, "badge")).toEqual([]);
    expect(byClassIn(kept!, "strike")).toEqual([]);
  });

  it.each(["new", "removed"])("gives columns without a status in a %s table the table's status, tint and badge", async (status) => {
    const doc = await svgDoc(plots({ status, columns: [{ name: "id", type: "uuid" }, { name: "rent", type: "money", status }] }));

    for (const row of rows(cardById(doc, "plots"))) {
      expect(row.getAttribute("data-status")).toBe(status);
      expect(tint(row)).toBeDefined();
      expect(textLines(byClassIn(row, "badge")[0]!)).toEqual([status.toUpperCase()]);
    }
  });

  it.each(["changed", "unchanged", undefined])("leaves columns without a status in a %s table plain", async (status) => {
    const doc = await svgDoc(plots({ ...(status ? { status } : {}), columns: [{ name: "id", type: "uuid" }] }));

    const [row] = rows(cardById(doc, "plots"));
    expect(row!.hasAttribute("data-status")).toBe(false);
    expect(row!.getElementsByTagName("rect")).toHaveLength(0);
  });

  it("rejects column statuses that contradict their table, at each column, with the class card's rules", async () => {
    const column = (name: string, status?: string) => ({ name, type: "int", ...(status ? { status } : {}) });
    const input = {
      type: "er",
      nodes: [
        { id: "a", label: "a", status: "new", columns: [column("x", "new"), column("y", "changed")] },
        { id: "b", label: "b", status: "removed", columns: [column("x", "unchanged")] },
        { id: "c", label: "c", status: "unchanged", columns: [column("x", "unchanged"), column("y", "removed")] },
        { id: "d", label: "d", columns: [column("x"), column("y", "unchanged")] },
        { id: "e", label: "e", status: "changed", columns: [column("w", "new"), column("x", "changed"), column("y", "removed"), column("z", "unchanged")] },
      ],
    };

    expect(await problems(input)).toEqual([
      {
        path: "nodes[0].columns[1].status",
        message: 'a row in a new card can\'t be "changed"',
        hint: 'leave it out, as rows in a new card are new, or make the card "changed"',
      },
      {
        path: "nodes[1].columns[0].status",
        message: 'a row in a removed card can\'t be "unchanged"',
        hint: 'leave it out, as rows in a removed card are removed, or make the card "changed"',
      },
      {
        path: "nodes[2].columns[1].status",
        message: 'a row in an unchanged card can\'t be "removed"',
        hint: 'make the card "changed", or leave the row\'s status out',
      },
      {
        path: "nodes[3].status",
        message: "missing: a card needs a status when any of its rows has one",
        hint: 'give the card a status, such as "changed", or take the statuses off its rows',
      },
    ]);
  });

  it("draws every column once with its own or its table's status, and lists their statuses in the legend", async () => {
    const input = {
      type: "er",
      nodes: [
        { id: "sheds", label: "sheds", status: "new", columns: [{ name: "id", type: "uuid" }] },
        { id: "plots", label: "plots", status: "changed", columns: [{ name: "id", type: "uuid" }, { name: "rent", type: "money", status: "removed" }] },
      ],
    };
    const doc = await svgDoc(input);

    const drawn = ["sheds", "plots"].flatMap((id) => rows(cardById(doc, id)).map((row) => [id, row.getAttribute("data-id"), row.getAttribute("data-status")]));
    expect(drawn).toEqual([
      ["sheds", "id", "new"],
      ["plots", "id", null],
      ["plots", "rent", "removed"],
    ]);
    const legend = allElements(doc).filter((el) => el.getAttribute("class") === "legend-item");
    expect(legend.map((item) => item.getAttribute("data-status"))).toEqual(["new", "changed", "removed"]);
  });
});

describe("ER input", () => {
  it.each([
    ["name", `add "name": the column's name, unique within its table`],
    ["type", `add "type": the column's type, such as uuid or varchar(200)`],
  ])("requires a column's %s", async (field, hint) => {
    const column: { [key: string]: unknown } = { name: "id", type: "uuid" };
    delete column[field];

    expect(await problems(plots({ columns: [{ name: "site_id", type: "uuid" }, column] }))).toEqual([
      { path: `nodes[0].columns[1].${field}`, message: `missing required field "${field}"`, hint },
    ]);
  });

  it("rejects an unknown field on a column", async () => {
    expect(await problems(plots({ columns: [{ name: "id", type: "uuid", primary: true }] }))).toEqual([
      {
        path: "nodes[0].columns[0].primary",
        message: 'unknown field "primary"',
        hint: "allowed fields: name, type, pk, fk, unique, nullable, status",
      },
    ]);
  });

  it("rejects an unknown field on a table", async () => {
    expect(await problems(plots({ properties: [] }))).toEqual([
      {
        path: "nodes[0].properties",
        message: 'unknown field "properties"',
        hint: "allowed fields: id, label, description, status, columns, more",
      },
    ]);
  });

  it.each(["pk", "fk", "unique", "nullable"])("requires %s to be true or false", async (flag) => {
    expect(await problems(plots({ columns: [{ name: "id", type: "uuid", [flag]: "yes" }] }))).toEqual([
      { path: `nodes[0].columns[0].${flag}`, message: '"yes" is not true or false', hint: "write true or false, without quotes" },
    ]);
  });

  it("requires column names to be unique within a table, as tidied", async () => {
    const columns = [{ name: "id", type: "uuid" }, { name: "site_id", type: "uuid" }, { name: " id ", type: "bigint" }, { name: "site_id", type: "int" }];

    expect(await problems(plots({ columns }))).toEqual([
      {
        path: "nodes[0].columns[2].name",
        message: 'the column name "id" is already used by nodes[0].columns[0]',
        hint: "give every column in a table its own name",
      },
      {
        path: "nodes[0].columns[3].name",
        message: 'the column name "site_id" is already used by nodes[0].columns[1]',
        hint: "give every column in a table its own name",
      },
    ]);
  });

  it("lets columns in different tables share a name", async () => {
    const input = allotments();
    input.nodes = input.nodes.map((node) => ({ ...node, columns: [{ name: "id", type: "uuid", pk: true }] }));

    const doc = await svgDoc(input);

    expect(["sites", "plots"].map((id) => rows(cardById(doc, id)).map((row) => row.getAttribute("data-id")))).toEqual([["id"], ["id"]]);
  });

  it("checks column names and types against JetBrains Mono, the face they're drawn in, and the table's name against Inter", async () => {
    // Inter can draw Ĳ but JetBrains Mono can't; JetBrains Mono can draw ⇑ but Inter can't.
    await expect(render(plots({ label: "Ĳssel", columns: [{ name: "⇑", type: "⇑" }] }), { embedFonts: false })).resolves.toHaveProperty("svg");

    expect(await problems(plots({ label: "plots ⇑", columns: [{ name: "Ĳ", type: "intĲ" }] }))).toEqual([
      { path: "nodes[0].label", message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw', hint: "use Latin letters, digits and common symbols" },
      { path: "nodes[0].columns[0].name", message: 'contains "Ĳ" (U+0132), which Structa\'s fonts can\'t draw', hint: "use Latin letters, digits and common symbols" },
      { path: "nodes[0].columns[0].type", message: 'contains "Ĳ" (U+0132), which Structa\'s fonts can\'t draw', hint: "use Latin letters, digits and common symbols" },
    ]);
  });

  it("allows 100 columns in a table, names and types of 100 characters, and rejects more", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, type: "int" }));
    await expect(render(plots({ columns: [...many(99), { name: "n".repeat(100), type: "t".repeat(100) }] }), { embedFonts: false })).resolves.toHaveProperty("svg");

    expect(await problems(plots({ columns: many(101) }))).toEqual([
      { path: "nodes[0].columns", message: "has 101 columns; the limit is 100", hint: 'split the table, or leave dull columns out and count them with "more"' },
    ]);
    expect(await problems(plots({ columns: [{ name: "n".repeat(101), type: "t".repeat(101) }] }))).toEqual([
      { path: "nodes[0].columns[0].name", message: "is 101 characters long; the limit is 100", hint: "shorten it" },
      { path: "nodes[0].columns[0].type", message: "is 101 characters long; the limit is 100", hint: "shorten it" },
    ]);
  });
});

/** A line's drawn route: its start, where each rounded corner starts and ends (and its control point), and its end. */
function route(line: Element): Point[] {
  const path = Array.from(line.getElementsByTagName("path")).find((p) => p.getAttribute("fill") === "none")!;
  return parsePath(path.getAttribute("d")!).flatMap((c) => c.points);
}

/** A table's header: from the top of its outline to its first divider, or to its bottom without one. */
function headerOf(card: Element): { top: number; bottom: number; middle: number } {
  const box = outlineBox(card);
  const [divider] = byClassIn(card, "divider");
  const bottom = divider ? numberAttr(divider, "y1") : box.y + box.height;
  return { top: box.y, bottom, middle: (box.y + bottom) / 2 };
}

/** Which side of a table's outline a point is on, or undefined when it's on neither. */
function sideOf(p: Point, card: Element): "left" | "right" | undefined {
  const box = outlineBox(card);
  if (p.y < box.y || p.y > box.y + box.height) return undefined;
  if (Math.abs(p.x - box.x) < 0.01) return "left";
  if (Math.abs(p.x - (box.x + box.width)) < 0.01) return "right";
  return undefined;
}

/** For each line, its from and to cards, and the start and end of its route. */
function relationshipEnds(doc: Document) {
  return lines(doc).map((line) => {
    const points = route(line);
    return {
      id: line.getAttribute("data-id")!,
      line,
      from: cardById(doc, line.getAttribute("data-from")!),
      to: cardById(doc, line.getAttribute("data-to")!),
      start: points[0]!,
      end: points.at(-1)!,
    };
  });
}

/**
 * The spec's side rule, checked on the drawing: for each line, how its two
 * tables lie, the sides its ends are on, and the sides the rule wants. With
 * direction right, a line runs from the right of the earlier table to the left
 * of the later one. With direction down, each end faces the other table's
 * centre, or both use one side (either) when the tables overlap across the
 * flow. A table's link to itself uses its right side at both ends.
 */
function sideRule(doc: Document, direction: "right" | "down") {
  return relationshipEnds(doc).map(({ id, from, to, start, end }) => {
    const [a, b] = [outlineBox(from), outlineBox(to)];
    const sides = [sideOf(start, from), sideOf(end, to)];
    const [lo, hi] = direction === "right" ? [a.x, b.x] : [a.y, b.y];
    const [loSize, hiSize] = direction === "right" ? [a.width, b.width] : [a.height, b.height];
    const across = a.x < b.x + b.width && b.x < a.x + a.width;
    let order: string;
    let expected: readonly (string | undefined)[];
    if (from === to) [order, expected] = ["self", ["right", "right"]];
    else if (direction === "down" && across) [order, expected] = ["overlapping", [sides[0] ?? "a side", sides[0] ?? "a side"]];
    else if (direction === "down") {
      const [centreA, centreB] = [a.x + a.width / 2, b.x + b.width / 2];
      [order, expected] = ["apart", [centreB > centreA ? "right" : "left", centreA > centreB ? "right" : "left"]];
    } else if (lo + loSize <= hi) [order, expected] = ["with", ["right", "left"]];
    else if (hi + hiSize <= lo) [order, expected] = ["against", ["left", "right"]];
    else [order, expected] = ["same layer", ["right", "right"]];
    return { id, order, sides, expected };
  });
}

/** Tables whose links go round in a loop, so one link must run against the flow, plus one that links to itself. */
function rota(direction?: string) {
  const table = (id: string) => ({ id, label: id, columns: [{ name: "id", type: "uuid", pk: true }, { name: "next_id", type: "uuid", fk: true }] });
  const link = (from: string, to: string) => ({ from, to, fromCardinality: "zero-or-one", toCardinality: "one" });
  return {
    type: "er",
    ...(direction ? { direction } : {}),
    nodes: ["digging", "weeding", "watering", "harvesting"].map(table),
    edges: [link("digging", "weeding"), link("weeding", "watering"), link("watering", "digging"), link("harvesting", "watering"), link("harvesting", "harvesting")],
  };
}

/** Three tables that point at one depot, top to bottom, and a depot that points at itself. */
function depot() {
  const link = (from: string) => ({ from, to: "depots", fromCardinality: "zero-or-many", toCardinality: "one" });
  return {
    type: "er",
    direction: "down",
    nodes: [
      ...["mowers", "barrows", "hoses"].map((id) => ({ id, label: id, columns: [{ name: "depot_id", type: "uuid", fk: true }] })),
      { id: "depots", label: "depots", columns: [{ name: "id", type: "uuid", pk: true }, { name: "parent_id", type: "uuid", fk: true, nullable: true }] },
    ],
    edges: [link("mowers"), link("barrows"), link("hoses"), { from: "depots", to: "depots", fromCardinality: "zero-or-many", toCardinality: "zero-or-one" }],
  };
}

/** Tables that each point at others, given as [from, to] pairs, each table with just an id. */
function schema(links: readonly (readonly [string, string])[], fields: object = {}) {
  const ids = [...new Set(links.flat())];
  return {
    type: "er",
    nodes: ids.map((id) => ({ id, label: id, columns: [{ name: "id", type: "uuid", pk: true }] })),
    edges: links.map(([from, to]) => ({ from, to, fromCardinality: "zero-or-many", toCardinality: "one" })),
    ...fields,
  };
}

const EXAMPLE = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8")) as object;

/** Every line end on each side of each table, top to bottom. */
function sharedSides(doc: Document): Map<string, { card: Element; side: string; ys: number[] }> {
  const found = new Map<string, { card: Element; side: string; ys: number[] }>();
  for (const { from, to, start, end } of relationshipEnds(doc)) {
    for (const [card, p] of [[from, start], [to, end]] as const) {
      const side = sideOf(p, card) ?? "neither";
      const key = `${card.getAttribute("data-id")} ${side}`;
      const group = found.get(key) ?? { card, side, ys: [] };
      group.ys.push(p.y);
      found.set(key, group);
    }
  }
  for (const group of found.values()) group.ys.sort((a, b) => a - b);
  return found;
}

/** The box round one end's crow's-foot marks. */
function marksBox(line: Element, end: "from" | "to"): Box {
  const group = byClassIn(line, "end").find((g) => g.getAttribute("data-end") === end)!;
  const points = [
    ...Array.from(group.getElementsByTagName("path")).flatMap((path) => parsePath(path.getAttribute("d")!).flatMap((c) => c.points)),
    ...Array.from(group.getElementsByTagName("circle")).flatMap((c) => {
      const [cx, cy, r] = ["cx", "cy", "r"].map((name) => numberAttr(c, name)) as [number, number, number];
      return [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r }];
    }),
  ];
  return boundsOf(points);
}

/** The pill of a line's label. */
function labelBox(doc: Document, id: string): Box {
  const label = allElements(doc).find((el) => el.getAttribute("class") === "line-label" && el.getAttribute("data-line") === id)!;
  return rectBox(label.getElementsByTagName("rect")[0]!);
}

describe("where relationships attach", () => {
  it("attaches a lone end at the middle of its table's header, on its outline", async () => {
    // With no columns, a table is all header; with a description and columns, its header ends at the divider.
    const detailed = allotments();
    detailed.nodes = detailed.nodes.map((node) => ({ ...node, description: "Where the plots are.", columns: COLUMNS }));

    for (const input of [allotments(), detailed, { ...detailed, direction: "down" }]) {
      const [{ from, to, start, end }] = relationshipEnds(await svgDoc(input)) as [ReturnType<typeof relationshipEnds>[number]];
      expect(sideOf(start, from)).toBeDefined();
      expect(sideOf(end, to)).toBeDefined();
      expect(start.y).toBeCloseTo(headerOf(from).middle, 1);
      expect(end.y).toBeCloseTo(headerOf(to).middle, 1);
    }
  });

  it("leaves a table on the right and enters the next on the left when it runs with the flow, direction right", async () => {
    const doc = await svgDoc(allotments());

    const [{ from, to, start, end }] = relationshipEnds(doc) as [ReturnType<typeof relationshipEnds>[number]];
    expect([sideOf(start, from), sideOf(end, to)]).toEqual(["right", "left"]);
  });

  it.each([
    ["a loop of links and a link to itself", rota()],
    ["the tool library example", EXAMPLE("er")],
    ["the loan reminders example", EXAMPLE("er-status")],
  ])("follows the side rule for every line, direction right: %s", async (_name, input) => {
    const rule = sideRule(await svgDoc(input), "right");

    for (const { id, order, sides, expected } of rule) expect([id, order, ...sides]).toEqual([id, order, ...expected]);
    expect(new Set(rule.map(({ order }) => order)).has("with")).toBe(true);
  });

  it("follows the side rule both with and against the flow, and for a table's link to itself, direction right", async () => {
    const rule = sideRule(await svgDoc(rota()), "right");

    expect(new Set(rule.map(({ order }) => order))).toEqual(new Set(["with", "against", "self"]));
  });

  it.each([
    ["a fan into one table, and its link to itself", depot()],
    ["a loop of links and a link to itself", rota("down")],
    ["a tree", schema([["plots", "sites"], ["sheds", "sites"], ["beds", "plots"], ["paths", "plots"]], { direction: "down" })],
    ["a diamond", schema([["plots", "sites"], ["sheds", "sites"], ["keys", "plots"], ["keys", "sheds"]], { direction: "down" })],
    ["a chain with a shortcut", schema([["crops", "beds"], ["beds", "plots"], ["plots", "sites"], ["crops", "sites"], ["sheds", "sites"]], { direction: "down" })],
    ["the tool library example", { ...EXAMPLE("er"), direction: "down" }],
    ["the loan reminders example", { ...EXAMPLE("er-status"), direction: "down" }],
  ])("follows the side rule for every line, direction down: %s", async (_name, input) => {
    const rule = sideRule(await svgDoc(input), "down");

    for (const { id, order, sides, expected } of rule) expect([id, order, ...sides]).toEqual([id, order, ...expected]);
  });

  it("covers tables apart, tables that overlap across the flow, and a table's link to itself, direction down", async () => {
    const rule = sideRule(await svgDoc(depot()), "down");

    expect(new Set(rule.map(({ order }) => order))).toEqual(new Set(["apart", "overlapping", "self"]));
  });

  it.each([
    ["right", EXAMPLE("er")],
    ["down", { ...EXAMPLE("er"), direction: "down" }],
    ["right", rota()],
    ["down", rota("down")],
    ["right", EXAMPLE("er-status")],
  ] as const)("gives every end its own place in its table's header, spread evenly about the middle, direction %s", async (_direction, input) => {
    const doc = await svgDoc(input);

    for (const { card, side, ys } of sharedSides(doc).values()) {
      const id = card.getAttribute("data-id");
      expect([id, side]).toEqual([id, expect.stringMatching(/^(left|right)$/)]);
      const header = headerOf(card);
      // Clear of the rounded corners at the top, and as far above the divider.
      expect([id, side, ys[0]! >= header.top + 10 - 0.01, ys.at(-1)! <= header.bottom - 10 + 0.01]).toEqual([id, side, true, true]);
      expect((ys[0]! + ys.at(-1)!) / 2).toBeCloseTo(header.middle, 1);
      const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
      for (const gap of gaps) {
        expect(gap).toBeCloseTo(gaps[0]!, 1);
        expect(gap).toBeGreaterThan(4);
        expect(gap).toBeLessThanOrEqual(20.01);
      }
    }
  });

  it("orders ends that share a side by where their lines go, so they don't cross as they leave", async () => {
    // A harvest record points at the bed it came from and the crop it was: two tables in the next layer, one above the other.
    const doc = await svgDoc(schema([["harvests", "beds"], ["harvests", "crops"]]));

    const [toBeds, toCrops] = ["beds", "crops"].map((id) => relationshipEnds(doc).find(({ to }) => to.getAttribute("data-id") === id)!);
    expect([sideOf(toBeds!.start, toBeds!.from), sideOf(toCrops!.start, toCrops!.from)]).toEqual(["right", "right"]);
    const bedsAbove = outlineBox(toBeds!.to).y < outlineBox(toCrops!.to).y;
    expect(toBeds!.start.y < toCrops!.start.y).toBe(bedsAbove);
    expect(Math.abs(toBeds!.start.y - toCrops!.start.y)).toBeCloseTo(20, 1);
  });

  it("draws two lines that meet one table on the same side apart, each with its own marks and colour", async () => {
    // A plot belongs to a site; a shed used to belong to one, and might not have.
    const input = {
      type: "er",
      nodes: ["plots", "sheds", "sites"].map((id) => ({ id, label: id })),
      edges: [
        { from: "plots", to: "sites", fromCardinality: "zero-or-many", toCardinality: "one", status: "unchanged" },
        { from: "sheds", to: "sites", fromCardinality: "zero-or-many", toCardinality: "zero-or-one", status: "removed" },
      ],
    };
    const doc = await svgDoc(input);

    const [plots, sheds] = relationshipEnds(doc);
    expect([sideOf(plots!.end, plots!.to), sideOf(sheds!.end, sheds!.to)]).toEqual(["left", "left"]);
    expect(Math.abs(plots!.end.y - sheds!.end.y)).toBeCloseTo(20, 1);
    // Each end's marks stand alone: they don't overlap, and each shows its own cardinality in its own line's colour.
    expect(overlaps(marksBox(plots!.line, "to"), marksBox(sheds!.line, "to"))).toBe(false);
    for (const [line, cardinality, colour] of [
      [plots!.line, "one", "#8c959f"],
      [sheds!.line, "zero-or-one", "#cf222e"],
    ] as const) {
      const [group] = byClassIn(line, "end").filter((g) => g.getAttribute("data-end") === "to");
      expect(group!.getAttribute("data-cardinality")).toBe(cardinality);
      for (const el of [...Array.from(group!.getElementsByTagName("path")), ...Array.from(group!.getElementsByTagName("circle"))]) {
        expect(el.getAttribute("stroke")).toBe(colour);
      }
    }
    // Neither line runs along the other's last stretch.
    const last = (points: Point[]) => points.slice(-2);
    expect(last(route(plots!.line)).some((p) => last(route(sheds!.line)).some((q) => q.x === p.x && q.y === p.y))).toBe(false);
  });

  it("gives two relationships between the same two tables an end each at both tables", async () => {
    // A tool loan has a borrower and, once approved, an approver: two lines from loans to members.
    const input = {
      type: "er",
      nodes: ["members", "loans"].map((id) => ({ id, label: id })),
      edges: [
        { from: "loans", to: "members", fromCardinality: "zero-or-many", toCardinality: "one", label: "borrower" },
        { from: "loans", to: "members", fromCardinality: "zero-or-many", toCardinality: "zero-or-one", label: "approver" },
      ],
    };
    const doc = await svgDoc(input);

    const [borrower, approver] = relationshipEnds(doc);
    expect(Math.abs(borrower!.start.y - approver!.start.y)).toBeCloseTo(20, 1);
    expect(Math.abs(borrower!.end.y - approver!.end.y)).toBeCloseTo(20, 1);
    for (const end of ["from", "to"] as const) expect(overlaps(marksBox(borrower!.line, end), marksBox(approver!.line, end))).toBe(false);
  });

  it.each(["right", "down"])("loops a table's link to itself out of its right side, either side of the header's middle, direction %s", async (direction) => {
    const doc = await svgDoc(schema([["plots", "plots"]], { direction }));

    const [self] = relationshipEnds(doc);
    const card = self!.from;
    expect([sideOf(self!.start, card), sideOf(self!.end, card)]).toEqual(["right", "right"]);
    expect((self!.start.y + self!.end.y) / 2).toBeCloseTo(headerOf(card).middle, 1);
    expect(self!.end.y - self!.start.y).toBeCloseTo(20, 1);
    // The loop goes out far enough to be seen.
    expect(Math.max(...route(self!.line).map((p) => p.x))).toBeGreaterThan(outlineBox(card).x + outlineBox(card).width + 20);
  });

  it.each(["right", "down"])(
    "keeps a table's link to itself clear of another line on the same side, with its label beside its loop, direction %s",
    async (direction) => {
      // Volunteers are mentored by other volunteers, and each works at a site.
      const input = {
        type: "er",
        direction,
        nodes: [
          { id: "volunteers", label: "volunteers", columns: [{ name: "id", type: "uuid", pk: true }, { name: "mentor_id", type: "uuid", fk: true }] },
          { id: "sites", label: "sites", columns: [{ name: "id", type: "uuid", pk: true }] },
        ],
        edges: [
          { from: "volunteers", to: "volunteers", fromCardinality: "zero-or-many", toCardinality: "zero-or-one", label: "mentored by" },
          { from: "volunteers", to: "sites", fromCardinality: "one-or-many", toCardinality: "one" },
        ],
      };
      const doc = await svgDoc(input);

      const [self, other] = relationshipEnds(doc);
      expect([sideOf(self!.start, self!.from), sideOf(self!.end, self!.from), sideOf(other!.start, other!.from)]).toEqual(["right", "right", "right"]);
      // Three ends of their own, the loop's two side by side.
      const ys = [self!.start.y, self!.end.y, other!.start.y];
      expect(new Set(ys).size).toBe(3);
      const [low, high] = [Math.min(self!.start.y, self!.end.y), Math.max(self!.start.y, self!.end.y)];
      expect(other!.start.y < low || other!.start.y > high).toBe(true);
      // The other line never runs through the loop, and no marks overlap.
      const loop = boundsOf(route(self!.line));
      expect(alongRuns(route(other!.line)).filter((p) => p.x > loop.x + 0.5 && p.x < loop.x + loop.width && p.y > loop.y && p.y < loop.y + loop.height)).toEqual([]);
      const marks = [marksBox(self!.line, "from"), marksBox(self!.line, "to"), marksBox(other!.line, "from")];
      for (const [i, a] of marks.entries()) for (const b of marks.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      // The loop's label sits just outside the loop, level with it, nearer it than the other line.
      const label = labelBox(doc, self!.id);
      expect(label.x).toBeGreaterThanOrEqual(loop.x + loop.width);
      expect(label.x).toBeLessThan(loop.x + loop.width + 10);
      expect(label.y + label.height / 2).toBeCloseTo((self!.start.y + self!.end.y) / 2, 1);
      const gap = (line: Element) => Math.min(...alongRuns(route(line)).map((p) => distanceOutside(p, label)));
      expect(gap(self!.line)).toBeLessThan(gap(other!.line));
    },
  );

  it("gives each of a table's links to itself its own loop, with its own label", async () => {
    // A plot can be split from another plot, and later merged into another.
    const input = schema([["plots", "plots"], ["plots", "plots"]]);
    input.edges = input.edges.map((edge, i) => ({ ...edge, label: ["split from", "merged into"][i]! }));
    const doc = await svgDoc(input);

    const [split, merged] = relationshipEnds(doc);
    expect(route(split!.line)).not.toEqual(route(merged!.line));
    const ys = [split!.start.y, split!.end.y, merged!.start.y, merged!.end.y];
    expect(new Set(ys).size).toBe(4);
    // Each loop's two ends sit side by side, so neither loop wraps round the other's ends.
    expect(Math.max(split!.start.y, split!.end.y) < Math.min(merged!.start.y, merged!.end.y)).toBe(true);
    const marks = [split, merged].flatMap((l) => [marksBox(l!.line, "from"), marksBox(l!.line, "to")]);
    for (const [i, a] of marks.entries()) for (const b of marks.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    expect(overlaps(labelBox(doc, split!.id), labelBox(doc, merged!.id))).toBe(false);
  });
});

/**
 * The marks at one end of a relationship, measured from where the line meets
 * its table: `along` the line, outwards, and `across` it. Bars cross the line;
 * prongs run from the table's side out to the line; circles sit on the line.
 */
function endMarks(line: Element, end: "from" | "to") {
  const [group, ...others] = byClassIn(line, "end").filter((g) => g.getAttribute("data-end") === end);
  expect(others).toEqual([]);
  const points = route(line);
  const [tip, next] = end === "from" ? [points[0]!, points[1]!] : [points.at(-1)!, points.at(-2)!];
  const length = Math.hypot(next.x - tip.x, next.y - tip.y);
  const u = { x: (next.x - tip.x) / length, y: (next.y - tip.y) / length };
  const along = (p: Point) => (p.x - tip.x) * u.x + (p.y - tip.y) * u.y;
  const across = (p: Point) => (p.x - tip.x) * -u.y + (p.y - tip.y) * u.x;
  const segments = Array.from(group!.getElementsByTagName("path")).flatMap((path) => {
    const found: [Point, Point][] = [];
    let last: Point | undefined;
    for (const { command, points: [p] } of parsePath(path.getAttribute("d")!)) {
      if (command === "L" && last) found.push([last, p!]);
      last = p;
    }
    return found;
  });
  const bars = segments.filter(([a, b]) => Math.abs(along(a) - along(b)) < 0.01);
  const prongs = segments.filter(([a, b]) => Math.abs(along(a) - along(b)) >= 0.01);
  const circles = Array.from(group!.getElementsByTagName("circle")).map((c) => ({
    along: along({ x: numberAttr(c, "cx"), y: numberAttr(c, "cy") }),
    across: across({ x: numberAttr(c, "cx"), y: numberAttr(c, "cy") }),
    r: numberAttr(c, "r"),
    fill: c.getAttribute("fill"),
    stroke: c.getAttribute("stroke"),
  }));
  return {
    group: group!,
    cardinality: group!.getAttribute("data-cardinality"),
    /** How far out the end's straight run goes before the line starts to turn. */
    run: length,
    bars: bars.map(([a, b]) => ({ along: along(a), from: Math.min(across(a), across(b)), to: Math.max(across(a), across(b)) })),
    prongs: prongs.map(([a, b]) => (along(a) < along(b) ? [a, b] : [b, a])).map(([a, b]) => ({ near: { along: along(a!), across: across(a!) }, far: { along: along(b!), across: across(b!) } })),
    circles,
  };
}

/** Crow's-foot notation: each cardinality's mark nearest the table, then the one beyond it. */
const MARKS = new Map<string, readonly ["bar" | "foot", "bar" | "circle" | "none"]>([
  ["one", ["bar", "bar"]],
  ["zero-or-one", ["bar", "circle"]],
  ["many", ["foot", "none"]],
  ["one-or-many", ["foot", "bar"]],
  ["zero-or-many", ["foot", "circle"]],
]);

describe("crow's-foot ends", () => {
  /** Checks one end's marks against its cardinality, and returns how far out they reach. */
  function expectMarks(marks: ReturnType<typeof endMarks>, cardinality: string): number {
    const { bars, prongs, circles } = marks;
    expect(marks.cardinality).toBe(cardinality);
    // Every bar crosses the line; every circle sits on it.
    for (const bar of bars) expect([bar.from < -3, bar.to > 3]).toEqual([true, true]);
    for (const circle of circles) expect([Math.abs(circle.across) < 0.01, circle.r > 2]).toEqual([true, true]);
    // A foot: two prongs from the table's side, one either side of the line, meeting on it further out.
    const foot = prongs.length > 0 ? Math.max(...prongs.map((p) => p.far.along)) : 0;
    if (cardinality.endsWith("many")) {
      expect(prongs).toHaveLength(2);
      for (const prong of prongs) {
        expect(prong.near.along).toBeCloseTo(0, 5);
        expect(prong.far.across).toBeCloseTo(0, 5);
        expect(prong.far.along).toBeCloseTo(foot, 5);
        expect(Math.abs(prong.near.across)).toBeGreaterThan(4);
      }
      expect(Math.sign(prongs[0]!.near.across)).toBe(-Math.sign(prongs[1]!.near.across));
      expect(foot).toBeGreaterThan(8);
    } else {
      expect(prongs).toEqual([]);
    }
    // Nearest the table, the most there can be: a bar for one, a foot for many. Beyond it, the fewest:
    // a bar for one, a circle for zero, nothing when "many" says nothing about it.
    const [inner, outer] = MARKS.get(cardinality)!;
    expect([bars.length, circles.length]).toEqual([(inner === "bar" ? 1 : 0) + (outer === "bar" ? 1 : 0), outer === "circle" ? 1 : 0]);
    const innerReach = inner === "foot" ? foot : Math.min(...bars.map((b) => b.along));
    expect(innerReach).toBeGreaterThan(3);
    if (outer === "bar") expect(Math.max(...bars.map((b) => b.along))).toBeGreaterThan(innerReach + 3);
    if (outer === "circle") expect(circles[0]!.along - circles[0]!.r).toBeGreaterThan(innerReach + 2);
    return Math.max(foot, ...bars.map((b) => b.along), ...circles.map((c) => c.along + c.r));
  }

  it.each(["one", "zero-or-one", "many", "one-or-many", "zero-or-many"])("draws %s as its crow's-foot marks at either end", async (cardinality) => {
    const fromEnd = await svgDoc(allotments({}, { fromCardinality: cardinality, toCardinality: "one" }));
    const toEnd = await svgDoc(allotments({}, { fromCardinality: "many", toCardinality: cardinality }));

    for (const [doc, end] of [[fromEnd, "from"], [toEnd, "to"]] as const) {
      const marks = endMarks(lines(doc)[0]!, end);
      const reach = expectMarks(marks, cardinality);
      // The marks stay small, and sit on the straight run out of the table.
      expect(reach).toBeLessThan(30);
      expect(reach).toBeLessThanOrEqual(marks.run);
    }
  });

  it("names both ends' cardinalities on the line", async () => {
    const doc = await svgDoc(allotments());

    const [line] = lines(doc);
    expect(line!.getAttribute("data-kind")).toBe("relationship");
    expect([line!.getAttribute("data-from"), line!.getAttribute("data-to")]).toEqual(["plots", "sites"]);
    expect(titleOf(line!)).toBe("plots (zero-or-many) – sites (one)");
    expect(titleOf(lines(await svgDoc(allotments({}, { label: "on" })))[0]!)).toBe("plots (zero-or-many) – sites (one): on");
  });

  it.each([
    ["light", "#8c959f", "#f4f5f7", "#1f883d"],
    ["dark", "#6e7681", "#0d1117", "#3fb950"],
  ] as const)("draws the marks in the line's colour, solid, with hollow circles, in %s", async (theme, line, background, added) => {
    for (const [status, colour] of [[undefined, line], ["new", added]] as const) {
      const doc = await svgDoc(allotments({}, { fromCardinality: "zero-or-many", toCardinality: "zero-or-one", ...(status ? { status } : {}) }), theme);

      for (const end of ["from", "to"] as const) {
        const marks = endMarks(lines(doc)[0]!, end);
        for (const path of Array.from(marks.group.getElementsByTagName("path"))) {
          expect([path.getAttribute("stroke"), path.getAttribute("fill"), path.hasAttribute("stroke-dasharray")]).toEqual([colour, "none", false]);
        }
        expect(marks.circles.map((c) => [c.stroke, c.fill])).toEqual([[colour, background]]);
      }
    }
  });

  it.each(["right", "down"])("puts marks at both ends of every line, clear of their corners, direction %s", async (direction) => {
    const input = rota(direction);
    input.edges = input.edges.map((edge) => ({ ...edge, fromCardinality: "zero-or-many", toCardinality: "zero-or-one" }));
    const doc = await svgDoc(input);

    for (const line of lines(doc)) {
      for (const end of ["from", "to"] as const) {
        const marks = endMarks(line, end);
        const reach = expectMarks(marks, end === "from" ? "zero-or-many" : "zero-or-one");
        expect([line.getAttribute("data-id"), end, reach <= marks.run]).toEqual([line.getAttribute("data-id"), end, true]);
      }
    }
  });

  it("draws a relationship the database doesn't enforce as a dotted line, with solid ends", async () => {
    const enforced = await svgDoc(allotments());
    const unenforced = await svgDoc(allotments({}, { enforced: false, fromCardinality: "zero-or-many", toCardinality: "zero-or-one" }));

    const stroke = (doc: Document) => Array.from(lines(doc)[0]!.getElementsByTagName("path")).find((p) => p.getAttribute("fill") === "none")!;
    expect(stroke(enforced).hasAttribute("stroke-dasharray")).toBe(false);
    // Dots: dashes no longer than the line is wide, with wider gaps; dashed lines use long dashes.
    const [dash, gap, ...rest] = stroke(unenforced).getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(rest).toEqual([]);
    expect(dash).toBeLessThanOrEqual(2);
    expect(gap).toBeGreaterThan(dash!);
    for (const end of ["from", "to"] as const) {
      const marks = endMarks(lines(unenforced)[0]!, end);
      for (const el of [...Array.from(marks.group.getElementsByTagName("path")), ...Array.from(marks.group.getElementsByTagName("circle"))]) {
        expect(el.hasAttribute("stroke-dasharray")).toBe(false);
      }
    }
    expect(titleOf(lines(unenforced)[0]!)).toBe("plots (zero-or-many) – sites (zero-or-one), not enforced");
  });

  it("treats enforced: true as the default, and wants true or false", async () => {
    const { svg } = await render(allotments(), { embedFonts: false });
    expect((await render(allotments({}, { enforced: true }), { embedFonts: false })).svg).toBe(svg);

    expect(await problems(allotments({}, { enforced: "no" }))).toEqual([
      { path: "edges[0].enforced", message: '"no" is not true or false', hint: "write true or false, without quotes" },
    ]);
  });

  it.each(["fromCardinality", "toCardinality"])("requires %s", async (field) => {
    const input = allotments();
    delete (input.edges[0] as { [key: string]: unknown })[field];

    expect(await problems(input)).toEqual([
      {
        path: `edges[0].${field}`,
        message: `missing required field "${field}"`,
        hint: expect.stringMatching(new RegExp(`^add "${field}": .*, "one", "zero-or-one", "many", "one-or-many" or "zero-or-many"$`)),
      },
    ]);
  });

  it.each(["1", "one-to-many", "zero-or-more"])("rejects the cardinality %j", async (cardinality) => {
    expect(await problems(allotments({}, { toCardinality: cardinality }))).toEqual([
      {
        path: "edges[0].toCardinality",
        message: `"${cardinality}" is not a valid toCardinality`,
        hint: 'use "one", "zero-or-one", "many", "one-or-many" or "zero-or-many"',
      },
    ]);
  });

  it("has no kind: every ER line is a relationship", async () => {
    expect(await problems(allotments({}, { kind: "association" }))).toEqual([
      {
        path: "edges[0].kind",
        message: 'unknown field "kind"',
        hint: "allowed fields: id, from, to, label, status, emphasis, fromCardinality, toCardinality, enforced",
      },
    ]);
  });
});

describe("ER lines in PNG", () => {
  it.each([
    ["light", "#8c959f", "#f4f5f7"],
    ["dark", "#6e7681", "#0d1117"],
  ] as const)("rasterises a zero's circle hollow and an unenforced line as dots, in %s", async (theme, ink, page) => {
    const draw = async (enforced: boolean) => {
      const input = allotments({}, { fromCardinality: "zero-or-many", toCardinality: "zero-or-one", enforced });
      const { svg, png } = await render(input, { formats: ["svg", "png"], embedFonts: false, theme, scale: 2 });
      return { line: lines(parseSvg(svg))[0]!, picture: decodePng(png) };
    };
    /** The colour of each pixel along the middle of the line's straight run, between its ends' marks. */
    const along = ({ line, picture }: Awaited<ReturnType<typeof draw>>) => {
      const [start, end] = [route(line)[0]!, route(line).at(-1)!];
      const [from, to] = [endMarks(line, "from"), endMarks(line, "to")];
      const [first, last] = [start.x + Math.max(...from.circles.map((c) => c.along + c.r)) + 1, end.x - Math.max(...to.circles.map((c) => c.along + c.r)) - 1];
      expect(start.y).toBe(end.y);
      expect(last - first).toBeGreaterThan(15);
      return Array.from({ length: Math.floor(2 * (last - first)) }, (_, i) => pixel(picture, Math.round(2 * first) + i, 2 * start.y).color);
    };
    const near = (a: string, b: string, by: number) => colourDifference(a, b) <= by;

    const dotted = await draw(false);
    const solid = await draw(true);

    const [circle] = Array.from(dotted.line.getElementsByTagName("circle"));
    const [cx, cy, r] = ["cx", "cy", "r"].map((name) => numberAttr(circle!, name));
    expect(near(pixel(dotted.picture, Math.round(2 * cx!), Math.round(2 * cy!)).color, page, 3)).toBe(true);
    expect(near(pixel(dotted.picture, Math.round(2 * (cx! + r!)), Math.round(2 * cy!)).color, ink, 40)).toBe(true);
    const dots = along(dotted);
    expect(dots.filter((c) => near(c, ink, 40)).length).toBeGreaterThan(dots.length / 4);
    expect(dots.filter((c) => near(c, page, 10)).length).toBeGreaterThan(dots.length / 4);
    expect(along(solid).every((c) => near(c, ink, 40))).toBe(true);
  });
});
