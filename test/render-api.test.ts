import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { rejection } from "./helpers/errors";

const tidyShed = {
  type: "flow",
  nodes: [
    { id: "sort", label: "Sort the tools", shape: "step" },
    { id: "hang", label: "Hang them on hooks", shape: "step" },
  ],
  edges: [{ from: "sort", to: "hang" }],
};

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

  it("returns the svg and png keys, in that order, when both are asked for in either order", async () => {
    expect(Object.keys(await render(tidyShed, { formats: ["png", "svg"] }))).toEqual(["svg", "png"]);
  });

  it.each([
    [{ formats: ["svg", "pdf"] }, "options.formats[1]", '"pdf" is not a valid format'],
    [{ formats: ["PNG"] }, "options.formats[0]", '"PNG" is not a valid format'],
    [{ formats: [] }, "options.formats", "must list at least one format"],
    [{ formats: "svg" }, "options.formats", "must be a list of formats"],
  ])("rejects %j with INVALID_OPTIONS", async (options, path, message) => {
    const error = await rejection(render(tidyShed, options as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([{ path, message, hint: 'use "svg", "png" or both' }]);
    expect(error.message).toBe(`${path}: ${message} (use "svg", "png" or both)`);
  });

  it.each([[0], [5], [2.5], [-1], ["2"], [null], [true], [Number.NaN]])(
    "rejects scale: %j with INVALID_OPTIONS, whatever the formats",
    async (scale) => {
      for (const formats of [["png"], ["svg"]] as const) {
        const error = await rejection(render(tidyShed, { formats, scale } as never));

        expect(error.code).toBe("INVALID_OPTIONS");
        expect(error.problems).toEqual([{ path: "options.scale", message: "must be a whole number from 1 to 4", hint: "leave it out for 2" }]);
      }
    },
  );

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

  it.each([["dark"], [null], [["svg"]], [2], [true]])("rejects options of %j, which aren't an object, with INVALID_OPTIONS", async (options) => {
    const error = await rejection(render(tidyShed, options as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([{ path: "options", message: "must be an object", hint: 'write them as {"theme": "dark"}, for example' }]);
  });

  it.each([
    [{ format: ["png"] }, "options.format"],
    [{ Theme: "dark" }, "options.Theme"],
    [{ embedfonts: false }, "options.embedfonts"],
    [{ size: 3 }, "options.size"],
  ])("rejects the unknown option in %j with INVALID_OPTIONS, rather than drawing an SVG", async (options, path) => {
    const error = await rejection(render(tidyShed, options as never));

    const name = path.slice("options.".length);
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([
      { path, message: `unknown option "${name}"`, hint: "allowed options: formats, theme, embedFonts, scale" },
    ]);
    expect(error.message).toBe(`${path}: unknown option "${name}" (allowed options: formats, theme, embedFonts, scale)`);
  });

  it("reports unknown options first, in code-unit order, then the problems with known ones", async () => {
    const error = await rejection(render(tidyShed, { theme: "sepia", zoom: 2, Zoom: 3, format: "png", formats: [] } as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems.map((problem) => [problem.path, problem.message])).toEqual([
      ["options.Zoom", 'unknown option "Zoom"'],
      ["options.format", 'unknown option "format"'],
      ["options.zoom", 'unknown option "zoom"'],
      ["options.formats", "must list at least one format"],
      ["options.theme", '"sepia" is not a valid theme'],
    ]);
  });

  it("names an unknown option that isn't a plain word in brackets, as the input's paths do", async () => {
    const error = await rejection(render(tidyShed, { "embed-fonts": false } as never));

    expect(error.problems.map((problem) => problem.path)).toEqual(['options["embed-fonts"]']);
  });

  it("lets every option be left out by giving it as undefined, and ignores an unknown one given so", async () => {
    const plain = await render(tidyShed);
    const options = { formats: undefined, theme: undefined, embedFonts: undefined, scale: undefined, format: undefined };

    expect(await render(tidyShed, options as never)).toEqual(plain);
  });

  it("reports every problem with the options at once", async () => {
    const error = await rejection(render(tidyShed, { formats: ["pdf", "svg", "gif"], theme: "sepia", scale: 8 } as never));

    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.problems).toEqual([
      { path: "options.formats[0]", message: '"pdf" is not a valid format', hint: 'use "svg", "png" or both' },
      { path: "options.formats[2]", message: '"gif" is not a valid format', hint: 'use "svg", "png" or both' },
      { path: "options.theme", message: '"sepia" is not a valid theme', hint: 'use "light" or "dark"' },
      { path: "options.scale", message: "must be a whole number from 1 to 4", hint: "leave it out for 2" },
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
