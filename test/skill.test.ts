import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "../src/index";
import { buildChangedProject, buildSkillForTest, type BuiltSkill } from "./helpers/skill";

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

  it("relies on its one-line CommonJS package.json to load elkjs inside an ESM project", () => {
    // The same folder without it: Node then treats elk.bundled.js as an ES module, and it can't load.
    const bare = join(dirname(skill.dir), "structa-without-package-json");
    cpSync(skill.dir, bare, { recursive: true });
    rmSync(join(bare, "package.json"));

    expect(readFileSync(join(skill.dir, "package.json"), "utf8")).toBe('{"type":"commonjs"}\n');
    expect(skill.run([flowPath], { dir: bare })).toEqual({
      status: 1,
      stdout: "",
      stderr:
        `can't load the layout engine: Node didn't load ${join(bare, "elk.bundled.js")} as CommonJS ` +
        "(keep the package.json that came with structa.mjs next to it)\n",
    });
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

describe("bun run build", () => {
  // Each test builds a changed copy of the project, and the build must fail with exactly that problem.
  const BUILD_TIMEOUT = 30_000;
  const failure = (...problems: string[]) => `the skill folder failed its checks:\n${problems.join("\n")}`;
  const appendTo = (file: string, text: string) => (project: string) => appendFileSync(join(project, file), text);
  const editJson = (file: string, edit: (json: Record<string, unknown>) => void) => (project: string) => {
    const json = JSON.parse(readFileSync(join(project, file), "utf8")) as Record<string, unknown>;
    edit(json);
    writeFileSync(join(project, file), JSON.stringify(json));
  };
  const setElkjsVersion = (version: string) => editJson("node_modules/elkjs/package.json", (json) => (json.version = version));

  it("builds an unchanged copy of the project", async () => {
    expect(await buildChangedProject(() => {})).toBe("");
  }, BUILD_TIMEOUT);

  it("fails when elk.bundled.js in node_modules differs from the published elkjs", async () => {
    const message = await buildChangedProject(appendTo("node_modules/elkjs/lib/elk.bundled.js", "\n// patched\n"));

    const sha256 = /its SHA-256 is ([0-9a-f]{64}),/.exec(message)?.[1];
    expect(sha256).toBeDefined();
    expect(message).toBe(
      failure(
        "elk.bundled.js is not byte-for-byte lib/elk.bundled.js from the published elkjs 0.12.1: " +
          `its SHA-256 is ${sha256}, not b1032b7cfd2a57c54c6f0e8369d7665e19a579954f7cd20a6dae28f1912ea0d7`,
      ),
    );
  }, BUILD_TIMEOUT);

  it("fails when node_modules holds a different elkjs version than package.json pins", async () => {
    const message = await buildChangedProject(setElkjsVersion("0.12.0"));

    expect(message).toBe(failure("node_modules has elkjs 0.12.0, but package.json pins 0.12.1: run bun install --frozen-lockfile"));
  }, BUILD_TIMEOUT);

  it("fails when package.json pins an elkjs whose published file the build doesn't know", async () => {
    // An upgrade that changes the pin but not the expected SHA-256.
    const message = await buildChangedProject((project) => {
      editJson("package.json", (json) => ((json.dependencies as Record<string, string>).elkjs = "0.13.0"))(project);
      setElkjsVersion("0.13.0")(project);
    });

    expect(message).toBe(
      failure(
        "package.json pins elkjs 0.13.0, but the build only knows the published elk.bundled.js of elkjs 0.12.1: " +
          "to upgrade, update PUBLISHED_ELK in scripts/lib/skill.ts with the new version and its file's SHA-256",
      ),
    );
  }, BUILD_TIMEOUT);

  it.each<[string, Record<string, string>, string]>([
    ["patchedDependencies", { "elkjs@0.12.1": "patches/elkjs@0.12.1.patch" }, '"elkjs@0.12.1"'],
    ["overrides", { elkjs: "0.12.1" }, '"elkjs"'],
    ["resolutions", { "**/elkjs": "0.12.1" }, '"**/elkjs"'],
  ])(
    "fails when package.json %s changes elkjs",
    async (field, value, key) => {
      const message = await buildChangedProject(editJson("package.json", (json) => (json[field] = value)));

      expect(message).toBe(failure(`package.json ${field} changes elkjs (${key}): ship the published elkjs unchanged`));
    },
    BUILD_TIMEOUT,
  );

  it("fails when structa.mjs would contain ELK's Java package names or GWT markers", async () => {
    const leaked = ["org.eclipse.elk.layered", "$clinit_Layer", "gwtOnLoad", "$wnd.Math", "com.google.gwt.core"];
    const source = leaked.map((text, i) => `export const leaked${i} = ${JSON.stringify(text)};\n`).join("");

    const message = await buildChangedProject(appendTo("src/structa.ts", source));

    expect(message).toBe(
      failure(
        'structa.mjs contains elkjs code: "org.eclipse.elk."',
        'structa.mjs contains elkjs code: "$clinit_"',
        'structa.mjs contains elkjs code: "gwtOnLoad"',
        'structa.mjs contains elkjs code: "$wnd."',
        'structa.mjs contains elkjs code: "com.google.gwt."',
      ),
    );
  }, BUILD_TIMEOUT);

  it.each([
    ["imports", 'import "elkjs";\n', '"elkjs"'],
    [
      "requires",
      'import { createRequire as leak } from "node:module";\nexport const load = () => leak(import.meta.url)("elkjs/lib/elk.bundled.js");\n',
      '"elkjs/lib/elk.bundled.js"',
    ],
  ])(
    "fails when structa.mjs %s elkjs",
    async (_name, source, specifier) => {
      const message = await buildChangedProject(appendTo("src/structa.ts", source));

      expect(message).toBe(failure(`structa.mjs names the elkjs package: ${specifier}`));
    },
    BUILD_TIMEOUT,
  );

  it("fails when structa.mjs would contain 100 characters copied from elk.bundled.js", async () => {
    // A run from the middle of ELK's file with nothing a string literal would escape.
    const elk = readFileSync(fileURLToPath(new URL("../node_modules/elkjs/lib/elk.bundled.js", import.meta.url)), "utf8");
    const copied = /[ !#-;=-[\]-~]{100}/.exec(elk.slice(elk.length / 2))![0];

    const message = await buildChangedProject(appendTo("src/structa.ts", `export const copied = ${JSON.stringify(copied)};\n`));

    const length = Number(/contains (\d+) characters/.exec(message)?.[1]);
    expect(length).toBeGreaterThanOrEqual(100);
    expect(message).toMatch(/^the skill folder failed its checks:\nstructa\.mjs contains \d+ characters copied from elk\.bundled\.js, starting ".{1,40}"$/);
  }, BUILD_TIMEOUT);
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
    ["an output that is only an extension", ["IN", "-o", ".SVG"], '-o ".SVG": give it a name before .svg'],
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
    for (const name of ["a.svg", "b.svg", "chart.png", "chart.txt", "chart", ".SVG"]) {
      expect(existsSync(join(skill.elsewhere, name))).toBe(false);
    }
  });
});
