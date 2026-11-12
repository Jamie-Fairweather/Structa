import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSkill, installedElkFile } from "../scripts/lib/skill";
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

describe("import { render } from structa.mjs", () => {
  it("gives the same SVG as render() in this process, and importing doesn't start the command line", async () => {
    const { svg } = await render(flowJson);
    const url = pathToFileURL(join(skill.dir, "structa.mjs")).href;
    const script = [
      `import { render } from ${JSON.stringify(url)};`,
      'let json = "";',
      "for await (const chunk of process.stdin) json += chunk;",
      "process.stdout.write((await render(json)).svg);",
    ].join("\n");

    const result = skill.node(["--input-type=module", "-e", script], { stdin: flowJson });

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

describe("build checks", () => {
  const elk = readFileSync(installedElkFile(), "utf8");
  let copies = 0;

  /** A copy of the built folder with one thing broken. */
  function tampered(change: (dir: string) => void): string {
    const dir = join(dirname(skill.dir), `tampered-${copies++}`);
    cpSync(skill.dir, dir, { recursive: true });
    change(dir);
    return dir;
  }
  const appendTo = (file: string, text: string) => (dir: string) =>
    writeFileSync(join(dir, file), readFileSync(join(dir, file), "utf8") + text);

  it("passes on the built folder", () => {
    expect(checkSkill(skill.dir)).toEqual([]);
  });

  it.each<[string, (dir: string) => void, string]>([
    ["structa.mjs is missing", (dir) => rmSync(join(dir, "structa.mjs")), "structa.mjs is missing"],
    ["elk.bundled.js is missing", (dir) => rmSync(join(dir, "elk.bundled.js")), "elk.bundled.js is missing"],
    ["package.json is missing", (dir) => rmSync(join(dir, "package.json")), "package.json is missing"],
    [
      "elk.bundled.js differs from the pinned package",
      appendTo("elk.bundled.js", "\n"),
      "elk.bundled.js is not byte-for-byte the same as lib/elk.bundled.js in elkjs 0.12.1",
    ],
    [
      "package.json declares ESM",
      (dir) => writeFileSync(join(dir, "package.json"), '{"type":"module"}\n'),
      'package.json must be the one line {"type":"commonjs"}',
    ],
    [
      "package.json takes more than one line",
      (dir) => writeFileSync(join(dir, "package.json"), '{\n  "type": "commonjs"\n}\n'),
      'package.json must be the one line {"type":"commonjs"}',
    ],
    [
      "structa.mjs has an ELK class name",
      appendTo("structa.mjs", '\nconst algorithm = "org.eclipse.elk.layered";\n'),
      'structa.mjs contains elkjs code: "org.eclipse.elk."',
    ],
    ["structa.mjs has a GWT $clinit_", appendTo("structa.mjs", "\nfunction $clinit_Layer() {}\n"), 'structa.mjs contains elkjs code: "$clinit_"'],
    ["structa.mjs has GWT's gwtOnLoad", appendTo("structa.mjs", "\nvar gwtOnLoad = 1;\n"), 'structa.mjs contains elkjs code: "gwtOnLoad"'],
    ["structa.mjs has GWT's $wnd", appendTo("structa.mjs", "\nvar a = $wnd.Math.abs(-1);\n"), 'structa.mjs contains elkjs code: "$wnd."'],
    [
      "structa.mjs requires elkjs",
      appendTo("structa.mjs", '\nconst Elk = createRequire(import.meta.url)("elkjs/lib/elk.bundled.js");\n'),
      'structa.mjs names the elkjs package: "elkjs/lib/elk.bundled.js"',
    ],
    ["structa.mjs imports elkjs", appendTo("structa.mjs", "\nimport 'elkjs';\n"), "structa.mjs names the elkjs package: 'elkjs'"],
  ])("fails when %s", (_name, change, problem) => {
    expect(checkSkill(tampered(change))).toEqual([problem]);
  });

  it("fails when structa.mjs has a long run copied from elk.bundled.js", () => {
    const start = elk.length / 2;
    const copied = elk.slice(start, start + 120);

    const problems = checkSkill(tampered(appendTo("structa.mjs", `\n${copied}\n`)));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^structa\.mjs contains \d+ characters copied from elk\.bundled\.js, starting ".{1,40}"$/);
    expect(Number(/contains (\d+)/.exec(problems[0]!)![1])).toBeGreaterThanOrEqual(120);
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
