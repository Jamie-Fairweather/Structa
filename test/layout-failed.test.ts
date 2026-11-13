import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, StructaError } from "../src/index";

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
  const error = await render(compost).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("LAYOUT_FAILED");
  return error as StructaError;
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

      const error = await render(boxed).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect((error as StructaError).code).toBe("LAYOUT_FAILED");
      expect((error as StructaError).problems).toEqual([{ path, message, hint }]);
    });
  });

  it("fails with LAYOUT_FAILED when ELK throws", async () => {
    engine.failure = new Error("out of cheese");

    const error = await layoutFailure();

    expect(error.problems).toEqual([{ path: "$", message: "the layout engine failed: out of cheese", hint }]);
  });
});
