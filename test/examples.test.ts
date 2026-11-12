import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
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

  it("uses every flowchart shape somewhere", () => {
    const used = new Set(flows().flatMap((d) => d.nodes.map((node) => node.shape)));

    expect([...used].sort()).toEqual(["decision", "end", "io", "note", "start", "step", "subprocess"]);
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
    const a = examples[0]!.json;

    const first = await render(a, { embedFonts: false });
    const other = await render(seedTray, { embedFonts: false });
    const again = await render(a, { embedFonts: false });

    expect(other.svg).not.toBe(first.svg);
    expect(again.svg).toBe(first.svg);
  });

  it("gives the same bytes when renders run at the same time", async () => {
    const a = examples[0]!.json;
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
