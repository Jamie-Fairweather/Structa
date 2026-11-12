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

  it.each([
    ["sepia", '"sepia" is not a valid theme'],
    ["Dark", '"Dark" is not a valid theme'],
    ["", '"" is not a valid theme'],
    [null, "must be a string"],
    [true, "must be a string"],
    [["dark"], "must be a string"],
  ])("rejects the theme option %j with INVALID_OPTIONS", async (theme, message) => {
    const error = await rejection(render(tidyShed, { theme } as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([{ path: "options.theme", message, hint: 'use "light" or "dark"' }]);
    expect(error.message).toBe(`options.theme: ${message} (use "light" or "dark")`);
  });

  it("reports every problem with the options at once", async () => {
    const error = await rejection(render(tidyShed, { formats: ["pdf", "svg", "png"], theme: "sepia" } as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([
      { path: "options.formats[0]", message: 'format "pdf" is not supported yet', hint: 'use ["svg"]' },
      { path: "options.formats[2]", message: 'format "png" is not supported yet', hint: 'use ["svg"]' },
      { path: "options.theme", message: '"sepia" is not a valid theme', hint: 'use "light" or "dark"' },
    ]);
  });

  it("reports a JSON syntax error at $ as INVALID_INPUT", async () => {
    const error = await rejection(render('{ "type": "flow", "nodes": [ }'));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]!.path).toBe("$");
    expect(error.problems[0]!.message).toBe('invalid JSON at line 1, column 30: expected a value but found "}"');
  });
});
