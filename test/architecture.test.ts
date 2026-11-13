import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { problems } from "./helpers/errors";
import { decodePng, pixel } from "./helpers/png";
import {
  allElements,
  boundsOf,
  byClassIn,
  cardById,
  depthInShape,
  distanceToDrawn,
  drawnTextBoxes,
  fontFaceRules,
  lineEnds,
  lineGeometry,
  lines,
  outlineBox,
  parsePath,
  parseSvg,
  svgDoc,
  textLines,
  titleOf,
  type Point,
} from "./helpers/svg";

const KINDS = '"service", "api", "ui", "job", "queue", "database", "cache", "external", "library", "actor" or "class"';

/** A public library: its app calling a loan service, with whatever extra node fields a test gives the service. */
function library(fields: object = {}) {
  return {
    type: "architecture",
    nodes: [
      { id: "app", label: "Library app", kind: "ui" },
      { id: "loans", label: "Loan service", kind: "service", ...fields },
    ],
    edges: [{ from: "app", to: "loans" }],
  };
}

describe("component cards", () => {
  it("draws each node as a card of its kind, with its kind word and its label", async () => {
    const doc = await svgDoc(library());

    const card = cardById(doc, "loans");
    expect(card.getAttribute("data-kind")).toBe("service");
    expect(textLines(card)).toEqual(["service", "Loan service"]);
    expect(titleOf(card)).toBe("Loan service (service)");
  });

  /** One card of `kind` with this label and any other fields. */
  async function componentCard(kind: string, label: string, extra: object = {}) {
    const doc = await svgDoc({ type: "architecture", nodes: [{ id: "c", label, kind, ...extra }] });
    const card = cardById(doc, "c");
    return { card, box: outlineBox(card), lines: textLines(card) };
  }

  const LONG = "Works out which branches will run short of picture books before half term, and sends more to them";

  it.each(COMPONENTS)("sizes a %s card to its text, between a minimum and a maximum width", async (kind) => {
    const tiny = await componentCard(kind, "Go");
    const alsoTiny = await componentCard(kind, "Up");
    const medium = await componentCard(kind, "Loan status service");
    const longer = await componentCard(kind, "Loan status service gateway");
    const huge = await componentCard(kind, LONG);
    // Runs of W fill every wrapped line to the same width, so both reach the maximum.
    const widest = await componentCard(kind, "W".repeat(90));
    const alsoWidest = await componentCard(kind, "W".repeat(100));

    expect(alsoTiny.box).toEqual(tiny.box);
    expect(medium.box.width).toBeGreaterThan(tiny.box.width);
    expect(longer.box.width).toBeGreaterThan(medium.box.width);
    // Past the maximum, text wraps onto more lines and the card grows taller, not wider.
    expect(huge.lines.length).toBeGreaterThan(3);
    expect(huge.lines.slice(1).join(" ")).toBe(LONG);
    expect(huge.box.height).toBeGreaterThan(longer.box.height);
    expect(alsoWidest.box.width).toBe(widest.box.width);
    expect(alsoWidest.box.height).toBeGreaterThan(widest.box.height);
    expect(widest.box.width).toBeGreaterThan(longer.box.width);
  });

  it("gives every kind the same card: a box with gently rounded corners, the same size for the same text", async () => {
    const boxes = await Promise.all(COMPONENTS.map((kind) => componentCard(kind, "Branch catalogue service")));

    for (const { card, box } of boxes) {
      const outline = byClassIn(card, "outline")[0]!;
      expect(outline.localName).toBe("rect");
      expect(Number(outline.getAttribute("rx"))).toBe(10);
      expect(box).toEqual(boxes[0]!.box);
    }
  });

  describe("descriptions", () => {
    it.each([
      ["light", "#1f2328", "#59636e"],
      ["dark", "#e6edf3", "#8b949e"],
    ] as const)("draws a %s description under the label, wrapped, smaller and muted", async (theme, text, muted) => {
      const description = "Knows which books are on the shelf and which are out, and tells the app within a second";
      const card = cardById(await svgDoc(library({ description }), theme), "loans");

      const [, label, ...under] = Array.from(card.getElementsByTagName("text"));
      expect(label!.textContent).toBe("Loan service");
      expect(under.length).toBeGreaterThan(1);
      expect(under.map((t) => t.textContent).join(" ")).toBe(description);
      expect(label!.getAttribute("fill")).toBe(text);
      for (const t of under) {
        expect(t.getAttribute("fill")).toBe(muted);
        expect(t.getAttribute("font-weight")).toBe("400");
        expect(Number(t.getAttribute("font-size"))).toBeLessThan(Number(label!.getAttribute("font-size")));
        expect(t.getAttribute("x")).toBe(label!.getAttribute("x"));
        expect(t.getAttribute("text-anchor")).toBe("middle");
      }
      const baselines = [label!, ...under].map((t) => Number(t.getAttribute("y")));
      expect([...baselines].sort((a, b) => a - b)).toEqual(baselines);
    });

    it("puts the description in the tooltip, after the label and kind", async () => {
      const card = cardById(await svgDoc(library({ description: "Tracks books on loan" })), "loans");

      expect(titleOf(card)).toBe("Loan service (service): Tracks books on loan");
    });

    it("makes the card bigger to hold it", async () => {
      const bare = await componentCard("queue", "Go");
      const short = await componentCard("queue", "Go", { description: "Now" });
      const wide = await componentCard("queue", "Go", { description: "Every loan event, in the order it happened" });

      expect(short.box.height).toBeGreaterThan(bare.box.height);
      expect(wide.box.width).toBeGreaterThan(short.box.width);
    });

    it("doesn't strike through a removed card's description, only its label", async () => {
      const card = cardById(await svgDoc(library({ status: "removed", description: "Tracks books on loan" })), "loans");

      const struck = byClassIn(card, "strike");
      expect(struck).toHaveLength(1);
      // Through the label's letters: above its baseline, by less than its size.
      const label = Array.from(card.getElementsByTagName("text")).find((t) => t.textContent === "Loan service")!;
      const rise = Number(label.getAttribute("y")) - Number(struck[0]!.getAttribute("y1"));
      expect(rise).toBeGreaterThan(0);
      expect(rise).toBeLessThan(Number(label.getAttribute("font-size")));
    });
  });

  it("keeps every line of text inside the card, however long", async () => {
    for (const [label, description] of [["Go"], [LONG, LONG], ["W".repeat(100), "W".repeat(300)]]) {
      const node = { id: "c", label, kind: "external", ...(description ? { description } : {}) };
      const doc = parseSvg((await render({ type: "architecture", nodes: [node] })).svg);
      const card = cardById(doc, "c");
      const box = outlineBox(card);
      for (const t of Array.from(card.getElementsByTagName("text"))) {
        const drawn = drawnTextBoxes(doc).get(t)!;
        expect(drawn.x, t.textContent!).toBeGreaterThan(box.x);
        expect(drawn.x + drawn.width, t.textContent!).toBeLessThan(box.x + box.width);
        expect(drawn.y + drawn.height, t.textContent!).toBeLessThan(box.y + box.height);
      }
    }
  });
});

/** Every kind of component, each drawn once. */
const COMPONENTS = ["service", "api", "ui", "job", "queue", "database", "cache", "external", "library", "actor"] as const;

function everyKind(extra: object = {}) {
  return { type: "architecture", nodes: COMPONENTS.map((kind) => ({ id: kind, label: `Loans ${kind}`, kind, ...extra })) };
}

/**
 * The points a path's commands run through: the end points of M, L and A
 * commands, and every point of Q and C, in order. Arcs' radii and flags are skipped.
 */
function pathPoints(d: string): Point[] {
  const points: Point[] = [];
  for (const [, command, args] of d.matchAll(/([MLQCAZ])([^MLQCAZ]*)/g)) {
    const n = (args!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const step = command === "A" ? 7 : 2;
    for (let i = 0; i + step <= n.length; i += step) {
      if (command === "A") points.push({ x: n[i + 5]!, y: n[i + 6]! });
      else points.push({ x: n[i]!, y: n[i + 1]! });
    }
  }
  return points;
}

/** A path's commands with every point made relative to its first, so the same drawing anywhere reads the same. */
function drawing(d: string): string {
  const [first] = pathPoints(d);
  let i = 0;
  return d.replace(/([MLQCA])([^MLQCAZ]*)/g, (_, command: string, args: string) => {
    const n = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const step = command === "A" ? 7 : 2;
    const out: number[] = [];
    for (let j = 0; j + step <= n.length; j += step) {
      const group = n.slice(j, j + step);
      group[step - 2]! -= first!.x;
      group[step - 1]! -= first!.y;
      out.push(...group.map((v) => Math.round(v * 100) / 100));
      i++;
    }
    return `${command}${out.join(" ")}`;
  });
}

function iconOf(card: Element): Element {
  const icons = byClassIn(card, "icon");
  expect(icons).toHaveLength(1);
  return icons[0]!;
}

describe("icons", () => {
  it.each([
    ["light", "#59636e"],
    ["dark", "#8b949e"],
  ] as const)("gives every kind its own small icon, drawn in %s's icon colour", async (theme, colour) => {
    const doc = await svgDoc(everyKind(), theme);

    const drawings = COMPONENTS.map((kind) => {
      const icon = iconOf(cardById(doc, kind));
      expect(icon.localName).toBe("path");
      expect([icon.getAttribute("fill"), icon.getAttribute("stroke")]).toEqual(["none", colour]);
      const box = boundsOf(pathPoints(icon.getAttribute("d")!));
      expect(Math.max(box.width, box.height), kind).toBeGreaterThan(6);
      expect(Math.max(box.width, box.height), kind).toBeLessThanOrEqual(16);
      return drawing(icon.getAttribute("d")!);
    });
    expect(new Set(drawings).size).toBe(COMPONENTS.length);
  });

  it("puts the icon just before the kind word, the two together centred at the top of the card", async () => {
    // Rendered with its fonts, so the kind word's drawn width can be measured.
    const doc = parseSvg((await render(everyKind())).svg);
    const drawn = drawnTextBoxes(doc);

    for (const kind of COMPONENTS) {
      const card = cardById(doc, kind);
      const box = outlineBox(card);
      const icon = boundsOf(pathPoints(iconOf(card).getAttribute("d")!));
      const [word, label] = Array.from(card.getElementsByTagName("text"));
      expect(word!.textContent).toBe(kind);
      const text = drawn.get(word!)!;
      // Just before the word, and level with it.
      expect(text.x - (icon.x + icon.width), kind).toBeGreaterThan(2);
      expect(text.x - (icon.x + icon.width), kind).toBeLessThan(10);
      expect(Math.abs(icon.y + icon.height / 2 - (text.y + text.height / 2)), kind).toBeLessThan(3);
      // Centred together, inside the card and above the label. Some icons, like the bolt, are narrower than the others.
      expect(Math.abs((icon.x + text.x + text.width) / 2 - (box.x + box.width / 2)), kind).toBeLessThan(2.5);
      expect(icon.y, kind).toBeGreaterThan(box.y);
      expect(icon.y + icon.height, kind).toBeLessThan(drawn.get(label!)!.y);
    }
  });

  it("draws every icon in a PNG too, its curves included", async () => {
    const scale = 2;
    const { svg, png } = await render(everyKind(), { formats: ["svg", "png"], embedFonts: false, scale });
    const doc = parseSvg(svg);
    const picture = decodePng(png);

    for (const kind of COMPONENTS) {
      const points = boundsOf(pathPoints(iconOf(cardById(doc, kind)).getAttribute("d")!));
      // The icon's square, 14 px, is centred on its points' middle; the kind word starts beyond it.
      const middle = points.y + points.height / 2;
      const [left, right, top, bottom] = [points.x - 1, points.x + points.width + 1, middle - 9, middle + 9].map((v) => Math.round(v * scale));
      const inked: number[] = [];
      for (let y = top!; y < bottom!; y++) {
        let darkness = 0;
        for (let x = left!; x < right!; x++) darkness += 1 - parseInt(pixel(picture, x, y).color.slice(1, 3), 16) / 255;
        if (darkness > 0.5) inked.push(y);
      }
      // The globe and the clock are drawn with arcs only, up and down: without them they'd be a flat line.
      expect((Math.max(...inked) - Math.min(...inked)) / scale, kind).toBeGreaterThan(6);
    }
  });

  it("fades the icon with a removed card", async () => {
    const doc = await svgDoc(everyKind({ status: "removed" }));

    for (const kind of COMPONENTS) {
      expect((iconOf(cardById(doc, kind)).parentNode as Element).getAttribute("class"), kind).toBe("faded");
    }
  });
});

/** A loan flow with one line of each kind: the app calls the API, and the API puts an event on the queue. */
function loanFlow(call: object = {}, async: object = {}) {
  return {
    type: "architecture",
    nodes: [
      { id: "app", label: "Library app", kind: "ui" },
      { id: "api", label: "Loans API", kind: "api" },
      { id: "events", label: "Loan events", kind: "queue" },
    ],
    edges: [
      { id: "borrow", from: "app", to: "api", ...call },
      { id: "publish", from: "api", to: "events", kind: "async", ...async },
    ],
  };
}

function lineById(doc: Document, id: string): Element {
  const line = lines(doc).find((l) => l.getAttribute("data-id") === id);
  if (!line) throw new Error(`no line ${id}`);
  return line;
}

/** A line's two paths: the stroked route, then what's drawn at its end. */
function routeAndHead(line: Element): [Element, Element] {
  const paths = Array.from(line.getElementsByTagName("path"));
  expect(paths).toHaveLength(2);
  return [paths[0]!, paths[1]!];
}

describe("architecture lines", () => {
  it("draws a call, the default, as a solid line with a filled arrowhead at its outline", async () => {
    const doc = await svgDoc(loanFlow());

    const line = lineById(doc, "borrow");
    expect(line.getAttribute("data-kind")).toBe("call");
    const [route, head] = routeAndHead(line);
    expect(route.hasAttribute("stroke-dasharray")).toBe(false);
    expect(head.getAttribute("fill")).toBe(route.getAttribute("stroke"));
    const { arrowTip, arrowBase } = lineGeometry(line);
    expect(Math.abs(depthInShape(arrowTip, cardById(doc, "api")))).toBeLessThanOrEqual(1);
    expect(depthInShape(arrowBase, cardById(doc, "api"))).toBeLessThan(0);
  });

  it('draws "kind": "call" just as it draws a line with no kind', async () => {
    expect((await render(loanFlow({ kind: "call" }), { embedFonts: false })).svg).toBe((await render(loanFlow(), { embedFonts: false })).svg);
  });

  it.each(["light", "dark"] as const)("draws an async line dashed, with an open arrowhead at its outline, in %s", async (theme) => {
    const doc = await svgDoc(loanFlow(), theme);

    const line = lineById(doc, "publish");
    expect(line.getAttribute("data-kind")).toBe("async");
    const [route, head] = routeAndHead(line);
    expect(route.getAttribute("stroke-dasharray")).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?$/);
    // Two strokes meeting at the tip, in the line's colour and width, not filled.
    expect(head.getAttribute("fill")).toBe("none");
    expect(head.getAttribute("stroke")).toBe(route.getAttribute("stroke"));
    expect(head.getAttribute("stroke-width")).toBe(route.getAttribute("stroke-width"));
    expect(head.hasAttribute("stroke-dasharray")).toBe(false);
    const [left, tip, right] = parsePath(head.getAttribute("d")!).map((c) => c.points[0]!);
    const target = cardById(doc, "events");
    expect(Math.abs(depthInShape(tip!, target))).toBeLessThanOrEqual(1);
    expect(depthInShape(left!, target)).toBeLessThan(0);
    expect(depthInShape(right!, target)).toBeLessThan(0);
    // The line itself runs right up to the tip.
    const end = parsePath(route.getAttribute("d")!).at(-1)!.points.at(-1)!;
    expect(Math.hypot(end.x - tip!.x, end.y - tip!.y)).toBeLessThan(0.5);
  });

  it("draws a call's and an async line's status by colour, their arrowheads too", async () => {
    const doc = await svgDoc(loanFlow({ status: "new" }, { status: "removed" }));

    const [callRoute, callHead] = routeAndHead(lineById(doc, "borrow"));
    expect([callRoute.getAttribute("stroke"), callHead.getAttribute("fill")]).toEqual(["#1f883d", "#1f883d"]);
    const [asyncRoute, asyncHead] = routeAndHead(lineById(doc, "publish"));
    expect([asyncRoute.getAttribute("stroke"), asyncHead.getAttribute("stroke")]).toEqual(["#cf222e", "#cf222e"]);
    expect((asyncHead.parentNode as Element).getAttribute("class")).toBe("faded");
  });

  it("draws an emphasised async line's arrowhead as thick as the line", async () => {
    const doc = await svgDoc(loanFlow({}, { emphasis: true }));

    const [route, head] = routeAndHead(lineById(doc, "publish"));
    expect(Number(route.getAttribute("stroke-width"))).toBe(3);
    expect(head.getAttribute("stroke-width")).toBe("3");
  });

  it("gives both kinds label pills, and names the ends, the kind and the label in the tooltip", async () => {
    const doc = await svgDoc(loanFlow({ label: "borrow a book" }, { label: "book borrowed" }));

    const pills = lines(doc).map((l) => l.getAttribute("data-id"));
    expect(pills).toEqual(["borrow", "publish"]);
    const labels = allElements(doc).filter((el) => el.getAttribute("class") === "line-label");
    expect(labels.map((pill) => [pill.getAttribute("data-line"), textLines(pill)])).toEqual([
      ["borrow", ["borrow a book"]],
      ["publish", ["book borrowed"]],
    ]);
    expect(titleOf(lineById(doc, "borrow"))).toBe("Library app → Loans API: borrow a book");
    expect(titleOf(lineById(doc, "publish"))).toBe("Loans API → Loan events (async): book borrowed");
  });

  it.each(["sync", "event", "Call", true])("rejects the line kind %j", async (kind) => {
    expect(await problems(loanFlow({ kind }))).toEqual([
      { path: "edges[0].kind", message: `${JSON.stringify(kind)} is not a valid kind`, hint: 'use "call" or "async"' },
    ]);
  });

  it("allows a line from a card to itself", async () => {
    const doc = await svgDoc({ ...loanFlow(), edges: [{ from: "events", to: "events", kind: "async", label: "retry" }] });

    const [start, end] = lineEnds(lines(doc)[0]!);
    expect(distanceToDrawn(start, cardById(doc, "events"))).toBeLessThanOrEqual(1);
    expect(distanceToDrawn(end, cardById(doc, "events"))).toBeLessThanOrEqual(1);
  });
});

/** A class with every class-card field, as a class diagram would give it. */
const LEDGER = {
  id: "ledger",
  label: "LoanLedger",
  description: "Every loan, start to finish.",
  status: "changed",
  stereotype: "abstract",
  properties: [{ text: "loans: Loan[]", visibility: "private" }, { text: "VERSION: int", static: true }],
  methods: [
    { text: "open(book: BookId): Loan", visibility: "public", status: "new" },
    { text: "close(loan: Loan): Fine", visibility: "public", abstract: true, status: "changed" },
  ],
  more: 4,
};

describe("class cards in architecture diagrams", () => {
  it("draws a class node exactly as a class diagram draws the class", async () => {
    const asClass = await render({ type: "class", nodes: [LEDGER] }, { embedFonts: false });
    const asArchitecture = await render({ type: "architecture", nodes: [{ ...LEDGER, kind: "class" }] }, { embedFonts: false });

    expect(asArchitecture.svg).toBe(asClass.svg);
    const card = cardById(parseSvg(asArchitecture.svg), "ledger");
    expect(card.getAttribute("data-kind")).toBe("class");
    expect(byClassIn(card, "icon")).toEqual([]);
    expect(byClassIn(card, "row")).toHaveLength(4);
  });

  it("draws an enum's values", async () => {
    const node = { id: "state", label: "LoanState", kind: "class", stereotype: "enum", values: [{ text: "OPEN" }, { text: "CLOSED" }] };

    const card = cardById(await svgDoc({ type: "architecture", nodes: [node] }), "state");
    expect(textLines(card)).toEqual(["«enum»", "LoanState", "OPEN", "CLOSED"]);
  });

  it("sets class cards beside component cards, with lines between them", async () => {
    const doc = await svgDoc({
      type: "architecture",
      nodes: [
        { id: "api", label: "Loans API", kind: "api" },
        { ...LEDGER, kind: "class" },
        { id: "db", label: "Loan records", kind: "database" },
      ],
      edges: [
        { from: "api", to: "ledger", label: "open loan" },
        { from: "ledger", to: "db", kind: "async" },
      ],
    });

    expect(["api", "ledger", "db"].map((id) => cardById(doc, id).getAttribute("data-kind"))).toEqual(["api", "class", "database"]);
    expect(outlineBox(cardById(doc, "ledger")).width).toBe(360);
    for (const line of lines(doc)) {
      const [start, end] = lineEnds(line);
      expect(distanceToDrawn(start, cardById(doc, line.getAttribute("data-from")!))).toBeLessThanOrEqual(1);
      expect(distanceToDrawn(end, cardById(doc, line.getAttribute("data-to")!))).toBeLessThanOrEqual(1);
    }
  });

  it.each(["stereotype", "abstract", "properties", "methods", "more"])("allows %s only on a class", async (field) => {
    const value = { stereotype: "record", abstract: true, properties: [], methods: [{ text: "renew(): void" }], more: 3 }[field];

    expect(await problems(library({ [field]: value }))).toEqual([
      {
        path: `nodes[1].${field}`,
        message: `only a node with "kind": "class" can have "${field}"`,
        hint: `remove "${field}", or make this node "kind": "class"`,
      },
    ]);
  });

  it("allows values only on a class that's an enum", async () => {
    const values = [{ text: "OPEN" }];

    expect(await problems(library({ values }))).toEqual([
      {
        path: "nodes[1].values",
        message: 'only a node with "kind": "class" can have "values"',
        hint: 'remove "values", or make this node "kind": "class"',
      },
    ]);
    expect(await problems(library({ kind: "class", values }))).toEqual([
      {
        path: "nodes[1].values",
        message: 'only a node with "stereotype": "enum" can have "values"',
        hint: 'add "stereotype": "enum", or list the rows in properties and methods',
      },
    ]);
    expect(await problems(library({ kind: "class", stereotype: "enum", values, methods: [] }))).toEqual([
      {
        path: "nodes[1].methods",
        message: 'a node with "stereotype": "enum" can\'t have "methods"',
        hint: "list an enum's rows in values",
      },
    ]);
  });

  it("checks a class's rows against its status, as a class diagram does", async () => {
    const node = { ...LEDGER, kind: "class", status: "new" };

    expect(await problems({ type: "architecture", nodes: [node] })).toEqual([
      expect.objectContaining({ path: "nodes[0].methods[1].status", message: 'a row in a new card can\'t be "changed"' }),
    ]);
  });

  it("doesn't judge class-only fields when the kind itself is wrong", async () => {
    expect(await problems(library({ kind: "classes", properties: [] }))).toEqual([
      expect.objectContaining({ path: "nodes[1].kind", message: '"classes" is not a valid kind' }),
    ]);
  });
});

describe("architecture nodes", () => {
  it("require a kind, and say which there are", async () => {
    const input = library();
    delete (input.nodes[1] as { kind?: string }).kind;

    expect(await problems(input)).toEqual([
      {
        path: "nodes[1].kind",
        message: 'missing required field "kind"',
        hint: `add "kind": what the card is, shown by its icon and kind word; "class" draws a class card, ${KINDS}`,
      },
    ]);
  });

  it.each(["server", "Service", "step", 3])("reject the kind %j, alongside other problems", async (kind) => {
    const input = library({ kind });
    input.edges.push({ from: "app", to: "branch" });

    expect(await problems(input)).toEqual([
      { path: "nodes[1].kind", message: `${JSON.stringify(kind)} is not a valid kind`, hint: `use ${KINDS}` },
      { path: "edges[1].to", message: 'no node with id "branch"', hint: "use the id of one of the nodes" },
    ]);
  });

  it("check labels and descriptions against the Inter faces they're drawn in", async () => {
    // Inter draws →; only JetBrains Mono draws ⇑.
    expect(await render(library({ label: "Shelves → loans", description: "Books → shelves" }), { embedFonts: false })).toHaveProperty("svg");
    expect(await problems(library({ label: "Loans ⇑", description: "Up ⇑" }))).toEqual([
      expect.objectContaining({ path: "nodes[1].label", message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw' }),
      expect.objectContaining({ path: "nodes[1].description", message: 'contains "⇑" (U+21D1), which Structa\'s fonts can\'t draw' }),
    ]);
  });

  it("embed the faces their kind words, labels and descriptions are drawn in", async () => {
    const doc = parseSvg((await render(library({ description: "Tracks books on loan" }))).svg);

    expect(fontFaceRules(doc).map((rule) => rule.face)).toEqual(["Structa Inter 400 normal", "Structa Inter 600 normal"]);
  });

  it("reject a field no architecture node has, listing the ones they do", async () => {
    expect(await problems(library({ shape: "step" }))).toEqual([
      expect.objectContaining({ path: "nodes[1].shape", message: 'unknown field "shape"' }),
    ]);
  });
});
