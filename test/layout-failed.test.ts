import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, type StructaError } from "../src/index";
import { rejection } from "./helpers/errors";

// ELK is the one outside library in the pipeline. These tests wrap the real
// engine at its loader and damage what it returns, to check that render()
// notices instead of drawing a broken picture.
const engine = vi.hoisted(() => ({
  damage: undefined as ((graph: ElkNode) => void) | undefined,
  failure: undefined as Error | undefined,
}));

vi.mock("../src/layout/elk", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/layout/elk")>();
  return {
    createElk: (): ELK => {
      const elk = real.createElk();
      return {
        ...elk,
        layout: async (graph, args) => {
          if (engine.failure) throw engine.failure;
          const result = await elk.layout(graph, args);
          engine.damage?.(result);
          return result;
        },
      } as ELK;
    },
  };
});

afterEach(() => {
  engine.damage = undefined;
  engine.failure = undefined;
});

const compost = {
  type: "flow",
  nodes: [
    { id: "collect", label: "Collect peelings", shape: "step" },
    { id: "layer", label: "Layer with cardboard", shape: "step" },
  ],
  edges: [{ from: "collect", to: "layer", label: "weekly" }],
};

const hint = "this is a bug in Structa: please report it with the input JSON";

async function layoutFailure(): Promise<StructaError> {
  const error = await rejection(render(compost));
  expect(error.code).toBe("LAYOUT_FAILED");
  return error;
}

describe("render() when the layout engine misbehaves", () => {
  it("draws normally when nothing is damaged", async () => {
    await expect(render(compost)).resolves.toHaveProperty("svg");
  });

  it.each<[string, (graph: ElkNode) => void, string, string]>([
    ["drops a card", (g) => g.children!.splice(1, 1), "nodes[1]", "the layout engine dropped this card"],
    ["resizes a card", (g) => void (g.children![0]!.width! += 5), "nodes[0]", "the layout engine changed this card's size"],
    ["loses a card's position", (g) => void (g.children![0]!.y = Number.NaN), "nodes[0]", "the layout engine gave this card no position"],
    ["drops a line", (g) => g.edges!.splice(0, 1), "edges[0]", "the layout engine dropped this line"],
    ["loses a line's route", (g) => delete g.edges![0]!.sections, "edges[0]", "the layout engine gave this line no usable route"],
    [
      "breaks a bend point",
      (g) => void (g.edges![0]!.sections![0]!.bendPoints = [{ x: Number.POSITIVE_INFINITY, y: 0 }]),
      "edges[0]",
      "the layout engine gave this line no usable route",
    ],
    ["drops a label", (g) => void (g.edges![0]!.labels = []), "edges[0].label", "the layout engine dropped this label"],
    ["resizes a label", (g) => void (g.edges![0]!.labels![0]!.height! += 2), "edges[0].label", "the layout engine changed this label's size"],
    [
      "loses a label's position",
      (g) => delete g.edges![0]!.labels![0]!.x,
      "edges[0].label",
      "the layout engine gave this label no position",
    ],
    ["repeats a card", (g) => void g.children!.push({ ...g.children![0]! }), "$", 'the layout engine repeated "n0"'],
    [
      "adds a card nobody asked for",
      (g) => void g.children!.push({ id: "n9", x: 0, y: 0, width: 10, height: 10 }),
      "$",
      'the layout engine returned an unexpected element "n9"',
    ],
  ])("fails with LAYOUT_FAILED when ELK %s", async (_name, damage, path, message) => {
    engine.damage = damage;

    const error = await layoutFailure();

    expect(error.problems).toEqual([{ path, message, hint }]);
  });

  describe("with area boxes", () => {
    // The heap is an area box holding both cards, so they come back inside it.
    const boxed = {
      ...compost,
      groupAreas: true,
      areas: [{ id: "heap", label: "Compost heap at the end of the garden" }],
      nodes: compost.nodes.map((node) => ({ ...node, area: "heap" })),
    };

    it("draws normally when nothing is damaged", async () => {
      await expect(render(boxed)).resolves.toHaveProperty("svg");
    });

    it.each<[string, (graph: ElkNode) => void, string, string]>([
      [
        "drops an area, keeping what was in it",
        (g) => {
          const [area] = g.children!.splice(0, 1);
          g.children!.push(...area!.children!);
          g.edges = [...(g.edges ?? []), ...area!.edges!];
        },
        "areas[0]",
        "the layout engine dropped this area",
      ],
      ["loses an area's position", (g) => delete g.children![0]!.x, "areas[0]", "the layout engine gave this area no position or size"],
      ["makes an area too narrow for its name", (g) => void (g.children![0]!.width = 40), "areas[0]", "the layout engine made this area too narrow for its name"],
      ["drops a card inside an area", (g) => g.children![0]!.children!.splice(1, 1), "nodes[1]", "the layout engine dropped this card"],
      ["drops a line inside an area", (g) => g.children![0]!.edges!.splice(0, 1), "edges[0]", "the layout engine dropped this line"],
    ])("fails with LAYOUT_FAILED when ELK %s", async (_name, damage, path, message) => {
      engine.damage = damage;

      const error = await rejection(render(boxed));

      expect(error.code).toBe("LAYOUT_FAILED");
      expect(error.problems).toEqual([{ path, message, hint }]);
    });
  });

  describe("with counts at a class line's ends", () => {
    /** A compost bin holds worms, with a count at each end. */
    const bin = (kind: string, edges: object[] = []) => ({
      type: "class",
      nodes: [
        { id: "bin", label: "CompostBin" },
        { id: "worm", label: "Worm" },
        { id: "lid", label: "Lid" },
      ],
      edges: [{ from: "bin", to: "worm", kind, fromLabel: "1", toLabel: "0..*" }, ...edges],
    });
    /** Line `i`'s label with this generated id, as ELK returned it. */
    const label = (g: ElkNode, i: number, id: string) => g.edges![i]!.labels!.find((l) => l.id === id)!;

    it.each(["aggregation", "inherits"])("draws normally when nothing is damaged: %s", async (kind) => {
      await expect(render(bin(kind))).resolves.toHaveProperty("svg");
    });

    // An inherits line goes to ELK the other way round, its counts swapped end for end: each still names its own field.
    it.each<[string, string, (graph: ElkNode) => void, string, string]>([
      ["aggregation", "drops the fromLabel's label", (g) => void (g.edges![0]!.labels = [label(g, 0, "t0")]), "edges[0].fromLabel", "the layout engine dropped this label"],
      ["inherits", "drops the toLabel's label", (g) => void (g.edges![0]!.labels = [label(g, 0, "s0")]), "edges[0].toLabel", "the layout engine dropped this label"],
      ["aggregation", "resizes the toLabel's label", (g) => void (label(g, 0, "t0").width! += 3), "edges[0].toLabel", "the layout engine changed this label's size"],
      ["inherits", "resizes the fromLabel's label", (g) => void (label(g, 0, "s0").height! += 3), "edges[0].fromLabel", "the layout engine changed this label's size"],
      ["aggregation", "loses the fromLabel's position", (g) => delete label(g, 0, "s0").x, "edges[0].fromLabel", "the layout engine gave this label no position"],
      ["inherits", "loses the toLabel's position", (g) => void (label(g, 0, "t0").y = Number.NaN), "edges[0].toLabel", "the layout engine gave this label no position"],
      [
        "aggregation",
        "returns a label nobody asked for",
        (g) => void g.edges![0]!.labels!.push({ ...label(g, 0, "s0"), id: "x0" }),
        "edges[0]",
        'the layout engine returned an unexpected label "x0"',
      ],
    ])("fails with LAYOUT_FAILED when ELK, on a %s line, %s", async (kind, _name, damage, path, message) => {
      engine.damage = damage;

      const error = await rejection(render(bin(kind)));

      expect(error.code).toBe("LAYOUT_FAILED");
      expect(error.problems).toEqual([{ path, message, hint }]);
    });

    it("fails with LAYOUT_FAILED when ELK returns a count at a shared end that only the first line there gave it", async () => {
      // Both lines from the bin share its diamond and its count, so ELK is given that count once, by the first.
      const input = bin("aggregation", [{ from: "bin", to: "lid", kind: "aggregation", fromLabel: "1" }]);
      await expect(render(input)).resolves.toHaveProperty("svg");
      engine.damage = (g) => void (g.edges![1]!.labels = [{ ...label(g, 0, "s0"), id: "s1" }]);

      const error = await rejection(render(input));

      expect(error.code).toBe("LAYOUT_FAILED");
      expect(error.problems).toEqual([{ path: "edges[1]", message: 'the layout engine returned an unexpected label "s1"', hint }]);
    });
  });

  it.each<[string, (graph: ElkNode) => void]>([
    ["start", (g) => void (g.edges![0]!.sections![0]!.startPoint.y += 5)],
    ["end", (g) => void (g.edges![0]!.sections![0]!.endPoint.x -= 5)],
  ])("fails with LAYOUT_FAILED when ELK moves the %s of a line off its fixed port", async (_end, damage) => {
    const swap = {
      type: "er",
      nodes: [
        { id: "seeds", label: "seeds" },
        { id: "swaps", label: "swaps" },
      ],
      edges: [{ from: "swaps", to: "seeds", fromCardinality: "zero-or-many", toCardinality: "one" }],
    };
    await expect(render(swap)).resolves.toHaveProperty("svg");
    engine.damage = damage;

    const error = await rejection(render(swap));

    expect(error.code).toBe("LAYOUT_FAILED");
    expect(error.problems).toEqual([{ path: "edges[0]", message: "the layout engine moved this line's ends off its ports", hint }]);
  });

  it("fails with LAYOUT_FAILED when ELK throws", async () => {
    engine.failure = new Error("out of cheese");

    const error = await layoutFailure();

    expect(error.problems).toEqual([{ path: "$", message: "the layout engine failed: out of cheese", hint }]);
  });
});
