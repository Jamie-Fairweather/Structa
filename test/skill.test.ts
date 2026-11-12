import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "../src/index";
import { buildSkillForTest, type BuiltSkill } from "./helpers/skill";

// Seam 2: the built skill folder, run with `node structa.mjs` in a separate
// process, from a different working folder, inside someone else's ESM project.
let skill: BuiltSkill;
beforeAll(async () => {
  skill = await buildSkillForTest();
}, 60_000);
afterAll(() => skill?.remove());

const flowPath = fileURLToPath(new URL("../examples/flow.json", import.meta.url));
const flowJson = readFileSync(flowPath, "utf8");

describe("node structa.mjs", () => {
  it("prints exactly render()'s SVG on standard output when there's no -o", async () => {
    const { svg } = await render(flowJson);

    const result = skill.run([flowPath]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(svg);
  });

  it.each(["lower.svg", "UPPER.SVG", "Mixed.Svg"])("writes the SVG to -o %s, relative to the working folder", async (name) => {
    const { svg } = await render(flowJson);

    const result = skill.run([flowPath, "-o", name]);

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, name), "utf8")).toBe(svg);
  });

  it("reads the JSON from standard input when the input is -", async () => {
    const { svg } = await render(flowJson);

    const result = skill.run(["-"], { stdin: flowJson });

    expect(result).toEqual({ status: 0, stdout: svg, stderr: "" });
  });

  it("reads a relative input path from the working folder", async () => {
    const { svg } = await render(flowJson);
    writeFileSync(join(skill.elsewhere, "library-returns.json"), flowJson);

    const result = skill.run(["library-returns.json"]);

    expect(result).toEqual({ status: 0, stdout: svg, stderr: "" });
  });
});

describe("exit code 1: bad input or a failed render", () => {
  const twoMistakes = JSON.stringify({
    type: "flow",
    nodes: [{ id: "knead", label: "Knead the dough", shape: "step" }],
    edges: [
      { from: "knead", to: "prove" },
      { from: "shape", to: "knead" },
    ],
  });

  it("lists every problem on standard error, prints nothing and writes no file", () => {
    const result = skill.run(["-", "-o", "bread.svg"], { stdin: twoMistakes });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        'edges[0].to: no node with id "prove" (use the id of one of the nodes)',
        'edges[1].from: no node with id "shape" (use the id of one of the nodes)',
        "",
      ].join("\n"),
    );
    expect(existsSync(join(skill.elsewhere, "bread.svg"))).toBe(false);
  });

  it("reports a JSON syntax error", () => {
    const result = skill.run(["-"], { stdin: '{ "type": "flow", ' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^\$: invalid JSON: .+\n$/);
  });

  it("names an input file it can't read", () => {
    const result = skill.run(["no-such-diagram.json"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^can't read no-such-diagram\.json: .+\n$/);
  });

  it("names the missing elk.bundled.js, and doesn't fall back to an elkjs in node_modules", () => {
    // The project around the skill folder has an elkjs in node_modules that throws if it's loaded.
    const noElk = join(dirname(skill.dir), "structa-without-elk");
    cpSync(skill.dir, noElk, { recursive: true });
    rmSync(join(noElk, "elk.bundled.js"));

    const result = skill.run([flowPath, "-o", "returns.svg"], { dir: noElk });

    expect(result).toEqual({
      status: 1,
      stdout: "",
      stderr: `can't find the layout engine: expected ${join(noElk, "elk.bundled.js")} next to structa.mjs\n`,
    });
    expect(existsSync(join(skill.elsewhere, "returns.svg"))).toBe(false);
  });
});

describe("exit code 2: bad usage", () => {
  it.each([
    ["no input", [], "give the diagram's JSON file, or - to read it from standard input"],
    ["two inputs", ["a.json", "b.json"], 'give one input, not two ("a.json" and "b.json")'],
    ["-o with no file", ["IN", "-o"], "-o needs a file name"],
    ["two -o", ["IN", "-o", "a.svg", "-o", "b.svg"], "give -o only once"],
    ["a .png output", ["IN", "-o", "chart.png"], '-o "chart.png": the output file must end in .svg'],
    ["a .txt output", ["IN", "-o", "chart.txt"], '-o "chart.txt": the output file must end in .svg'],
    ["an output with no extension", ["IN", "-o", "chart"], '-o "chart": the output file must end in .svg'],
    ["an unknown option", ["IN", "--sparkle"], 'unknown option "--sparkle"'],
  ])("rejects %s, prints the usage line and writes nothing", (_name, args, message) => {
    const input = join(skill.elsewhere, "usage-input.json");
    writeFileSync(input, flowJson);

    const result = skill.run(args.map((arg) => (arg === "IN" ? input : arg)));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const [first, usage, ...rest] = result.stderr.split("\n");
    expect(first).toBe(message);
    expect(usage).toMatch(/^usage: node structa\.mjs /);
    expect(rest).toEqual([""]);
    for (const name of ["a.svg", "b.svg", "chart.png", "chart.txt", "chart"]) {
      expect(existsSync(join(skill.elsewhere, name))).toBe(false);
    }
  });
});
