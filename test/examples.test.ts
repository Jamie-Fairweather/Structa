import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { decodePng, pixel, svgSize } from "./helpers/png";
import { badlyFormattedNumbers, passiveSvgViolations } from "./helpers/svg";

// Every file in examples/ is a snapshot fixture. Snapshots are real .svg files,
// so a reviewer can open them; update them only for output changes you intend.
const examplesDir = new URL("../examples/", import.meta.url);
const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({ name: file.slice(0, -".json".length), json: readFileSync(new URL(file, examplesDir), "utf8") }));

describe("examples", () => {
  it("has at least one example", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it("includes one that uses every status on cards and lines, with labels, emphasis and a title", () => {
    const used = examples.map(({ json }) => JSON.parse(json) as { title?: string; nodes: object[]; edges?: object[] });
    const statuses = (items: readonly object[]) => new Set(items.map((item) => (item as { status?: string }).status));
    const all = ["new", "changed", "removed", "unchanged"];

    expect(
      used.some(
        (d) =>
          d.title !== undefined &&
          all.every((s) => statuses(d.nodes).has(s)) &&
          statuses(d.edges ?? []).size > 2 &&
          (d.edges ?? []).some((e) => "label" in e) &&
          (d.edges ?? []).some((e) => "emphasis" in e),
      ),
    ).toBe(true);
  });

  it("includes a class diagram whose rows use every status, some taking their card's", () => {
    type Row = { status?: string };
    type ClassNode = { status?: string; properties?: Row[]; methods?: Row[] };
    const used = examples.map(({ json }) => JSON.parse(json) as { type: string; nodes: ClassNode[] });
    const rows = (node: ClassNode) => [...(node.properties ?? []), ...(node.methods ?? [])];
    const all = ["new", "changed", "removed", "unchanged"];

    expect(
      used.some(
        (d) =>
          d.type === "class" &&
          all.every((s) => d.nodes.some((node) => rows(node).some((row) => row.status === s))) &&
          d.nodes.some((node) => (node.status === "new" || node.status === "removed") && rows(node).some((row) => !row.status)),
      ),
    ).toBe(true);
  });

  type Flow = {
    type: string;
    nodes: { id: string; shape: string; about?: string; description?: string }[];
    edges?: { from: string; to: string; label?: string }[];
  };
  const flows = () => examples.map(({ json }) => JSON.parse(json) as Flow).filter((d) => d.type === "flow");

  it("includes a flowchart with a decision whose lines are labelled, and a loop back to an earlier step", () => {
    const fits = (d: Flow) => {
      const order = new Map(d.nodes.map((node, i) => [node.id, i]));
      const decisions = d.nodes.filter((node) => node.shape === "decision").map((node) => node.id);
      const out = (d.edges ?? []).filter((edge) => decisions.includes(edge.from));
      const loops = (d.edges ?? []).filter((edge) => order.get(edge.to)! < order.get(edge.from)!);
      return out.length >= 2 && out.every((edge) => edge.label !== undefined) && loops.length > 0;
    };

    expect(flows().some(fits)).toBe(true);
  });

  it("includes a flowchart with a note about a shape, a note about nothing, and descriptions", () => {
    const fits = (d: Flow) =>
      d.nodes.some((node) => node.shape === "note" && node.about !== undefined) &&
      d.nodes.some((node) => node.shape === "note" && node.about === undefined) &&
      d.nodes.some((node) => node.description !== undefined);

    expect(flows().some(fits)).toBe(true);
  });

  type WithAreas = { type: string; groupAreas?: boolean; areas?: { parent?: string }[]; nodes: { area?: string }[] };
  const withAreas = () => examples.map(({ json }) => JSON.parse(json) as WithAreas).filter((d) => (d.areas ?? []).length > 0);

  it("includes a flowchart with nested area boxes as swimlanes", () => {
    const fits = (d: WithAreas) =>
      d.type === "flow" && d.groupAreas === true && d.areas!.length >= 3 && d.areas!.some((area) => area.parent !== undefined);

    expect(withAreas().some(fits)).toBe(true);
  });

  it("includes a diagram with area tags only, some cards without an area", () => {
    const fits = (d: WithAreas) => d.groupAreas !== true && d.nodes.some((node) => node.area === undefined);

    expect(withAreas().some(fits)).toBe(true);
  });

  it("uses every flowchart shape somewhere", () => {
    const used = new Set(flows().flatMap((d) => d.nodes.map((node) => node.shape)));

    expect([...used].sort()).toEqual(["decision", "end", "io", "note", "start", "step", "subprocess"]);
  });

  it("includes a class diagram with an interface, an abstract class and an enum, and static and abstract rows", () => {
    type Row = { static?: boolean; abstract?: boolean };
    type ClassNode = { stereotype?: string; abstract?: boolean; properties?: Row[]; methods?: Row[]; values?: Row[] };
    const used = examples.map(({ json }) => JSON.parse(json) as { type: string; nodes: ClassNode[] });
    const members = (node: ClassNode) => [...(node.properties ?? []), ...(node.methods ?? [])];

    expect(
      used.some(
        (d) =>
          d.type === "class" &&
          d.nodes.some((node) => node.stereotype === "interface") &&
          d.nodes.some((node) => node.abstract === true || node.stereotype === "abstract") &&
          d.nodes.some((node) => node.stereotype === "enum" && (node.values ?? []).length > 0) &&
          d.nodes.some((node) => members(node).some((row) => row.static === true)) &&
          d.nodes.some((node) => members(node).some((row) => row.abstract === true)),
      ),
    ).toBe(true);
  });

  type Architecture = { type: string; nodes: { kind: string; description?: string }[]; edges?: { kind?: string; label?: string }[] };
  const architectures = () => examples.map(({ json }) => JSON.parse(json) as Architecture).filter((d) => d.type === "architecture");

  it("includes an architecture diagram of components only, using every kind but class, both line kinds, labels and descriptions", () => {
    const kinds = ["actor", "api", "cache", "database", "external", "job", "library", "queue", "service", "ui"];
    const fits = (d: Architecture) =>
      d.nodes.every((node) => node.kind !== "class") &&
      kinds.every((kind) => d.nodes.some((node) => node.kind === kind)) &&
      d.nodes.some((node) => node.description !== undefined) &&
      (d.edges ?? []).some((edge) => edge.kind === undefined) &&
      (d.edges ?? []).some((edge) => edge.kind === "async") &&
      (d.edges ?? []).some((edge) => edge.label !== undefined);

    expect(architectures().some(fits)).toBe(true);
  });

  it("includes an architecture diagram mixing component cards and class cards, an enum among them", () => {
    const fits = (d: Architecture) =>
      d.nodes.some((node) => node.kind === "class") &&
      d.nodes.some((node) => node.kind !== "class") &&
      d.nodes.some((node) => node.kind === "class" && "values" in node);

    expect(architectures().some(fits)).toBe(true);
  });

  type ChangeMap = {
    type: string;
    groupAreas?: boolean;
    areas?: { id: string; label: string; parent?: string }[];
    nodes: { id: string; kind?: string; area?: string; methods?: { status?: string }[] }[];
    edges?: { from: string; to: string; label?: string; status?: string; emphasis?: boolean }[];
  };
  const parsed = () => examples.map(({ name, json }) => ({ name, d: JSON.parse(json) as ChangeMap }));

  /**
   * What `d` lacks of the acceptance example, in which an admin portal calls
   * an API, the API calls services and the services use a database: each
   * criterion it misses, by name. None for the change map.
   */
  function changeMapGaps(d: ChangeMap): string[] {
    const areas = d.areas ?? [];
    const edges = d.edges ?? [];
    // An area and every area inside it, at any depth.
    const within = (id: string): string[] => [id, ...areas.filter((a) => a.parent === id).flatMap((a) => within(a.id))];
    const cardsIn = (label: string) => {
      const top = areas.find((a) => a.label === label && a.parent === undefined);
      return top ? new Set(d.nodes.filter((n) => within(top.id).includes(n.area ?? "")).map((n) => n.id)) : new Set<string>();
    };
    const tiers = ["Admin portal", "API", "Services", "Database"].map(cardsIn);
    const calls = (from: Set<string>, to: Set<string>) => edges.some((e) => from.has(e.from) && to.has(e.to));
    const kinds = new Set(d.nodes.map((n) => n.kind));
    const methodStatuses = new Set(d.nodes.filter((n) => n.kind === "class").flatMap((n) => (n.methods ?? []).map((m) => m.status)));
    const labelled = edges.filter((e) => e.label !== undefined);

    const criteria: [string, boolean][] = [
      ["an architecture diagram", d.type === "architecture"],
      ["an area inside another", areas.some((a) => a.parent !== undefined)],
      ["cards in top-level areas Admin portal, API, Services and Database", tiers.every((tier) => tier.size > 0)],
      ["a line from each of those areas into the next", tiers.slice(1).every((tier, i) => calls(tiers[i]!, tier))],
      ["ui, api, service, database and queue cards", ["ui", "api", "service", "database", "queue"].every((kind) => kinds.has(kind))],
      ["class methods of every status", ["new", "changed", "removed", "unchanged"].every((s) => methodStatuses.has(s))],
      ["labelled lines of at least three statuses", new Set(labelled.map((e) => e.status ?? "none")).size >= 3],
      ["a removed labelled line", labelled.some((e) => e.status === "removed")],
      ["an emphasised line", edges.some((e) => e.emphasis === true)],
    ];
    return criteria.filter(([, met]) => !met).map(([criterion]) => criterion);
  }
  const isChangeMap = (d: ChangeMap) => changeMapGaps(d).length === 0;

  it("includes the change map: an admin portal calling an API, calling services, using a database, in nested area boxes", () => {
    // On failure, this lists what each example with area boxes lacks.
    const boxed = parsed().filter(({ d }) => d.groupAreas === true);

    expect(boxed.map(({ name, d }) => [name, changeMapGaps(d)])).toContainEqual([expect.any(String), []]);
  });

  it("includes the same change map with area tags only: the same areas, cards and lines, without the boxes", () => {
    const boxed = parsed().filter(({ d }) => isChangeMap(d) && d.groupAreas === true);
    const tagged = parsed().filter(({ d }) => isChangeMap(d) && d.groupAreas !== true);
    const same = (a: ChangeMap, b: ChangeMap) => JSON.stringify([a.areas, a.nodes, a.edges]) === JSON.stringify([b.areas, b.nodes, b.edges]);

    expect(boxed.some(({ d }) => tagged.some((t) => same(d, t.d)))).toBe(true);
  });

  describe("the change maps as PNGs", () => {
    const changeMaps = parsed().filter(({ d }) => isChangeMap(d));
    const pages = [
      { theme: "light", page: "#f4f5f7" },
      { theme: "dark", page: "#0d1117" },
    ] as const;

    it("has both", () => {
      expect(changeMaps.map(({ d }) => d.groupAreas === true).sort()).toEqual([false, true]);
    });

    // At scale 1, which keeps each picture small enough to decode quickly. png.test.ts covers the default scale.
    it.each(changeMaps.flatMap(({ name, d }) => pages.map((look) => ({ name, d, ...look }))))(
      "draws $name in the $theme theme as a PNG its SVG's size at scale 1, on that theme's page colour",
      { timeout: 60_000 },
      async ({ d, theme, page }) => {
        const { svg, png } = await render(d, { formats: ["svg", "png"], embedFonts: false, theme, scale: 1 });
        const picture = decodePng(png);

        expect({ width: picture.width, height: picture.height }).toEqual(svgSize(svg));
        expect(pixel(picture, 0, 0)).toEqual({ color: page, alpha: 255 });
      },
    );
  });

  // Every example in both themes. The theme option wins over any theme in the example's JSON.
  describe.each(examples)("$name", ({ name, json }) => {
    describe.each(["light", "dark"] as const)("in %s", (theme) => {
      it("matches its snapshot", async () => {
        const { svg } = await render(json, { embedFonts: false, theme });

        await expect(svg).toMatchFileSnapshot(`__snapshots__/examples/${name}.${theme}.svg`);
      });

      it("passes the SVG rules", async () => {
        const { svg } = await render(json, { embedFonts: false, theme });

        expect(passiveSvgViolations(svg)).toEqual([]);
        expect(badlyFormattedNumbers(svg)).toEqual([]);
      });
    });
  });
});

describe("determinism", () => {
  // An example picked by name, so adding examples doesn't change what these tests draw.
  const a = examples.find(({ name }) => name === "architecture-classes")!.json;
  const seedTray = {
    type: "flow",
    nodes: [
      { id: "fill", label: "Fill the tray with compost", shape: "step" },
      { id: "sow", label: "Sow two seeds per cell", shape: "step" },
      { id: "cover", label: "Cover with a clear lid", shape: "step" },
    ],
    edges: [
      { from: "fill", to: "sow" },
      { from: "sow", to: "cover" },
    ],
  };

  it("gives identical bytes for A, then B, then A again in one process", async () => {
    const first = await render(a, { embedFonts: false });
    const other = await render(seedTray, { embedFonts: false });
    const again = await render(a, { embedFonts: false });

    expect(other.svg).not.toBe(first.svg);
    expect(again.svg).toBe(first.svg);
  });

  it("gives the same bytes when renders run at the same time", async () => {
    const alone = await render(a, { embedFonts: false });

    const together = await Promise.all([
      render(a, { embedFonts: false }),
      render(seedTray, { embedFonts: false }),
      render(a, { embedFonts: false }),
    ]);

    expect(together[0].svg).toBe(alone.svg);
    expect(together[2].svg).toBe(alone.svg);
  });
});
