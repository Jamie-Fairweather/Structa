import type { ELK, ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/index";

// ELK is the one outside library in the pipeline. These tests wrap the real
// engine at its loader and record each graph render() hands it, as given, to
// check what reaches ELK. The picture itself is checked through render().
const engine = vi.hoisted(() => ({ calls: [] as { graph: ElkNode; options: LayoutOptions }[] }));

vi.mock("../src/layout/elk", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/layout/elk")>();
  return {
    createElk: (): ELK => {
      const elk = real.createElk();
      return {
        ...elk,
        layout: async (graph, args) => {
          engine.calls.push(structuredClone({ graph, options: args?.layoutOptions ?? {} }));
          return elk.layout(graph, args);
        },
      } as ELK;
    },
  };
});

afterEach(() => {
  engine.calls = [];
});

/** Fruit trees grow in orchards and hedgerows; an orchard can be grafted from another. Every name is one ELK must never see. */
function orchard(direction: "right" | "down") {
  const table = (id: string, label: string, columns: string[]) => ({
    id,
    label,
    description: `${label} description`,
    columns: columns.map((name) => ({ name, type: `${name}_type` })),
  });
  return {
    type: "er",
    direction,
    nodes: [
      table("tree-table", "fruit_trees", ["tree_serial", "orchard_ref", "hedgerow_ref"]),
      table("orchard-table", "orchards", ["orchard_serial", "grafted_from_ref"]),
      table("hedgerow-table", "hedgerows", ["hedgerow_serial"]),
    ],
    edges: [
      // Ends that name columns get ports just as ends at a header do.
      {
        id: "tree-in-orchard",
        from: "tree-table",
        to: "orchard-table",
        fromColumn: "orchard_ref",
        toColumn: "orchard_serial",
        fromCardinality: "zero-or-many",
        toCardinality: "zero-or-one",
        label: "planted in",
      },
      { id: "tree-by-hedgerow", from: "tree-table", to: "hedgerow-table", fromCardinality: "zero-or-many", toCardinality: "one" },
      {
        id: "orchard-graft",
        from: "orchard-table",
        to: "orchard-table",
        fromColumn: "grafted_from_ref",
        toColumn: "orchard_serial",
        fromCardinality: "zero-or-many",
        toCardinality: "zero-or-one",
        label: "grafted from",
      },
      { id: "orchard-hedge", from: "orchard-table", to: "hedgerow-table", fromCardinality: "one", toCardinality: "one-or-many", enforced: false },
    ],
  };
}

/** Every port of every node, with the node it's on. */
function portsOf(graph: ElkNode): { node: ElkNode; port: ElkPort }[] {
  return (graph.children ?? []).flatMap((node) => (node.ports ?? []).map((port) => ({ node, port })));
}

function edgeEnds(graph: ElkNode): string[] {
  return ((graph.edges ?? []) as ElkExtendedEdge[]).flatMap((edge) => [...edge.sources, ...edge.targets]);
}

describe("the graph ER layout hands ELK", () => {
  it.each(["right", "down"] as const)("gives each line end a provisional, zero-size, free port in pass 1, direction %s", async (direction) => {
    await render(orchard(direction), { embedFonts: false });

    const [first] = engine.calls;
    const ports = portsOf(first!.graph);
    expect(ports).toHaveLength(2 * 4);
    for (const { node, port } of ports) {
      expect(port).toEqual({ id: expect.stringMatching(/^p\d+_\d+$/), width: 0, height: 0 });
      expect(node.layoutOptions?.["elk.portConstraints"]).toBe("FREE");
    }
  });

  it.each(["right", "down"] as const)(
    "rebuilds only the ports used in pass 2: zero-size, at fixed places on a table's left or right side, direction %s",
    async (direction) => {
      await render(orchard(direction), { embedFonts: false });

      const fixedPasses = engine.calls.slice(1);
      expect(fixedPasses.length).toBeGreaterThanOrEqual(1);
      for (const { graph } of fixedPasses) {
        const ports = portsOf(graph);
        for (const { node, port } of ports) {
          expect(node.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_POS");
          expect([port.width, port.height]).toEqual([0, 0]);
          // On the left side (x 0, WEST) or the right side (x the card's width, EAST), within the card's height.
          const side = port.layoutOptions?.["elk.port.side"];
          expect([port.x, side]).toEqual(port.x === 0 ? [0, "WEST"] : [node.width, "EAST"]);
          expect(port.y).toBeGreaterThan(0);
          expect(port.y).toBeLessThan(node.height!);
          // Generated ids, numbered on each card from 0: p<card>_<n>.
          const [, card] = /^p(\d+)_\d+$/.exec(port.id)!;
          expect(`n${card}`).toBe(node.id);
        }
        // Every port is one line end's own: each is used exactly once, and there are none to spare.
        const used = edgeEnds(graph);
        expect(used).toHaveLength(2 * 4);
        expect([...used].sort()).toEqual(ports.map(({ port }) => port.id).sort());
        expect(new Set(used).size).toBe(used.length);
      }
    },
  );

  it.each(["right", "down"] as const)("never shows ELK a user's ids, names or text, only generated ids, direction %s", async (direction) => {
    const input = orchard(direction);
    await render(input, { embedFonts: false });

    const words = [
      ...input.nodes.flatMap((node) => [node.id, node.label, node.description, ...node.columns.flatMap((c) => [c.name, c.type])]),
      ...input.edges.flatMap((edge) => [edge.id, ...(edge.label ? [edge.label] : [])]),
    ];
    for (const call of engine.calls) {
      const sent = JSON.stringify(call);
      expect(words.filter((word) => sent.includes(word))).toEqual([]);
      expect((call.graph.children ?? []).map((node) => node.id)).toEqual(["n0", "n1", "n2"]);
      expect(((call.graph.edges ?? []) as ElkExtendedEdge[]).map((edge) => edge.id)).toEqual(["e0", "e1", "e2", "e3"]);
      // Option keys use the short elk. prefix.
      const keys = [
        ...Object.keys(call.options),
        ...(call.graph.children ?? []).flatMap((node) => [
          ...Object.keys(node.layoutOptions ?? {}),
          ...(node.ports ?? []).flatMap((port) => Object.keys(port.layoutOptions ?? {})),
        ]),
      ];
      expect(keys.filter((key) => !key.startsWith("elk.") || key.startsWith("elk.org."))).toEqual([]);
    }
  });
});

describe("the graph class layout hands ELK", () => {
  /** Planters: two kinds share a parent's triangle, and a patio holds both with counts at each end. */
  const garden = {
    type: "class",
    nodes: [
      { id: "planter-base", label: "Planter", description: "A box of soil on the patio" },
      { id: "trough", label: "TroughPlanter", properties: [{ text: "litres: int" }] },
      { id: "window-box", label: "WindowBox" },
      { id: "patio", label: "Patio" },
    ],
    edges: [
      { id: "troughs-are-planters", from: "trough", to: "planter-base", kind: "inherits", fromLabel: "many" },
      { id: "boxes-are-planters", from: "window-box", to: "planter-base", kind: "inherits" },
      { id: "patio-holds-troughs", from: "patio", to: "trough", kind: "aggregation", fromLabel: "1", toLabel: "0..2", label: "holds" },
      { id: "patio-holds-boxes", from: "patio", to: "window-box", kind: "aggregation", fromLabel: "1", toLabel: "0..2" },
    ],
  };

  it("never shows ELK a user's ids, names or text, only generated ids, on its lines, their labels and the ports they share", async () => {
    await render(garden, { embedFonts: false });

    const [call] = engine.calls;
    const sent = JSON.stringify(call);
    const words = [
      ...garden.nodes.flatMap((node) => [node.id, node.label, ...(node.description ? [node.description] : [])]),
      ...garden.edges.flatMap((edge) => [edge.id, ...(edge.label ? [edge.label] : [])]),
      "litres",
      "0..2",
      "many",
    ];
    expect(words.filter((word) => sent.includes(word))).toEqual([]);
    const edges = (call!.graph.edges ?? []) as ElkExtendedEdge[];
    expect(edges.map((edge) => edge.id)).toEqual(["e0", "e1", "e2", "e3"]);
    // Labels: l for the middle, s and t for the counts at each end, each with its id as its text. The count both diamonds share is given once.
    const labels = edges.flatMap((edge) => edge.labels ?? []);
    expect(labels.map((label) => [label.id, label.text])).toEqual([
      ["s0", "s0"],
      ["l2", "l2"],
      ["s2", "s2"],
      ["t2", "t2"],
      ["t3", "t3"],
    ]);
    // The two lines into the parent share a port on it, and so do the two from the patio.
    const ports = portsOf(call!.graph).map(({ node, port }) => [node.id, port.id]);
    expect(ports).toEqual([
      ["n0", "j0_0"],
      ["n3", "j3_0"],
    ]);
    const keys = [
      ...Object.keys(call!.options),
      ...(call!.graph.children ?? []).flatMap((node) => Object.keys(node.layoutOptions ?? {})),
      ...edges.flatMap((edge) => [...Object.keys(edge.layoutOptions ?? {}), ...(edge.labels ?? []).flatMap((label) => Object.keys(label.layoutOptions ?? {}))]),
    ];
    expect(keys).toContain("elk.layered.priority.direction");
    expect(keys).toContain("elk.edgeLabels.placement");
    expect(keys.filter((key) => !key.startsWith("elk.") || key.startsWith("elk.org."))).toEqual([]);
  });
});
