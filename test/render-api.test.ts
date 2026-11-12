import { describe, expect, it } from "vitest";
import { render, StructaError } from "../src/index";

const tidyShed = {
  type: "flow",
  nodes: [
    { id: "sort", label: "Sort the tools", shape: "step" },
    { id: "hang", label: "Hang them on hooks", shape: "step" },
  ],
  edges: [{ from: "sort", to: "hang" }],
};

async function rejection(promise: Promise<unknown>): Promise<StructaError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  return error as StructaError;
}

describe("render()", () => {
  it("accepts a JSON string or an already-parsed object, with the same result", async () => {
    const fromObject = await render(tidyShed, { embedFonts: false });
    const fromString = await render(JSON.stringify(tidyShed, null, 2), { embedFonts: false });

    expect(fromString.svg).toBe(fromObject.svg);
    expect(fromObject.svg.startsWith("<svg ")).toBe(true);
  });

  it("returns only the svg key, by default and when svg is asked for", async () => {
    expect(Object.keys(await render(tidyShed))).toEqual(["svg"]);
    expect(Object.keys(await render(tidyShed, { formats: ["svg"] }))).toEqual(["svg"]);
  });

  it.each([
    [{ formats: ["png"] }, "options.formats[0]", 'format "png" is not supported yet'],
    [{ formats: ["svg", "pdf"] }, "options.formats[1]", 'format "pdf" is not supported yet'],
    [{ formats: [] }, "options.formats", "must list at least one format"],
    [{ formats: "svg" }, "options.formats", "must be a list of formats"],
  ])("rejects %j with INVALID_OPTIONS", async (options, path, message) => {
    const error = await rejection(render(tidyShed, options as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([{ path, message, hint: 'use ["svg"]' }]);
    expect(error.message).toBe(`${path}: ${message} (use ["svg"])`);
  });

  it("reports a JSON syntax error at $ as INVALID_INPUT", async () => {
    const error = await rejection(render('{ "type": "flow", "nodes": [ }'));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]!.path).toBe("$");
    expect(error.problems[0]!.message).toMatch(/^invalid JSON: /);
  });

  it("reports every problem at once, each with its path, and joins them one per line", async () => {
    const error = await rejection(
      render({
        type: "flow",
        nodes: [
          { id: "sort", label: "Sort the tools", shape: "step" },
          { id: "sort", label: "Sweep the floor", shape: "step" },
        ],
        edges: [
          { from: "sort", to: "hang" },
          { from: "rake", to: "sort" },
        ],
      }),
    );

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.problems).toEqual([
      { path: "nodes[1].id", message: 'another node already has the id "sort"', hint: "give every node its own id" },
      { path: "edges[0].to", message: 'no node with id "hang"', hint: "use the id of one of the nodes" },
      { path: "edges[1].from", message: 'no node with id "rake"', hint: "use the id of one of the nodes" },
    ]);
    expect(error.message.split("\n")).toEqual([
      'nodes[1].id: another node already has the id "sort" (give every node its own id)',
      'edges[0].to: no node with id "hang" (use the id of one of the nodes)',
      'edges[1].from: no node with id "rake" (use the id of one of the nodes)',
    ]);
  });

  it.each([
    ["a list", [], "$", "must be an object describing one diagram"],
    ["another type", { type: "class", nodes: [] }, "type", 'only "flow" is supported so far'],
    ["no nodes", { type: "flow" }, "nodes", "must be a list of nodes"],
    ["a node that isn't an object", { type: "flow", nodes: [3] }, "nodes[0]", "must be an object"],
    ["a node with no id", { type: "flow", nodes: [{ label: "Dig", shape: "step" }] }, "nodes[0].id", "must be a non-empty string"],
    ["a node with no label", { type: "flow", nodes: [{ id: "dig", shape: "step" }] }, "nodes[0].label", "must be a string"],
    ["another shape", { type: "flow", nodes: [{ id: "dig", label: "Dig", shape: "decision" }] }, "nodes[0].shape", 'only "step" is supported so far'],
    ["edges that aren't a list", { type: "flow", nodes: [], edges: {} }, "edges", "must be a list of edges"],
    ["an edge with no from", { type: "flow", nodes: [], edges: [{ to: "dig" }] }, "edges[0].from", "must be a node id"],
    ["an edge id that isn't a string", { type: "flow", nodes: [], edges: [{ id: 7 }] }, "edges[0].id", "must be a non-empty string"],
  ])("rejects %s as INVALID_INPUT", async (_name, input, path, message) => {
    const error = await rejection(render(input as object));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.problems[0]).toMatchObject({ path, message });
  });
});
