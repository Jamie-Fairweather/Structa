import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { zipSkill } from "../scripts/lib/skill";
import { readTtf, type TtfFont } from "../scripts/lib/ttf";
import { render } from "../src/index";
import { CHARACTER_RANGES } from "../src/text/faces";
import { buildChangedProject, buildSkillForTest, type BuiltSkill } from "./helpers/skill";

// Seam 2: the built skill folder, made by the release and unzipped from its
// zip, run with `node structa.mjs` in a separate process, from a different
// working folder, inside someone else's ESM project.
let skill: BuiltSkill;
beforeAll(async () => {
  skill = await buildSkillForTest();
}, 60_000);
afterAll(() => skill?.remove());

const examplesDir = fileURLToPath(new URL("../examples/", import.meta.url));
const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();
const flowPath = join(examplesDir, "flow.json");
const flowJson = readFileSync(flowPath, "utf8");

describe("node structa.mjs", () => {
  it.each(examples)("prints exactly render()'s SVG for examples/%s on standard output when there's no -o", async (file) => {
    const { svg } = await render(readFileSync(join(examplesDir, file), "utf8"));

    const result = skill.run([join(examplesDir, file)]);

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

  it.each(["lower.png", "UPPER.PNG", "Mixed.Png"])("writes render()'s PNG, at scale 2, to -o %s", async (name) => {
    const { png } = await render(flowJson, { formats: ["png"] });

    const result = skill.run([flowPath, "-o", name]);

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, name)).equals(Buffer.from(png))).toBe(true);
  });

  it("writes every -o from one run, in any mix of formats", async () => {
    const { svg, png } = await render(flowJson, { formats: ["svg", "png"] });

    const result = skill.run([flowPath, "-o", "both.svg", "-o", "both.png", "-o", "copy.SVG"]);

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "both.svg"), "utf8")).toBe(svg);
    expect(readFileSync(join(skill.elsewhere, "copy.SVG"), "utf8")).toBe(svg);
    expect(readFileSync(join(skill.elsewhere, "both.png")).equals(Buffer.from(png))).toBe(true);
  });

  it("draws the PNG at the --scale asked for, wherever the flag goes", async () => {
    const { png } = await render(flowJson, { formats: ["png"], scale: 3 });

    expect(skill.run([flowPath, "--scale", "3", "-o", "big.png"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "big.png")).equals(Buffer.from(png))).toBe(true);
    expect(skill.run(["--scale", "3", "-o", "big-too.png", flowPath])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "big-too.png")).equals(Buffer.from(png))).toBe(true);
  });

  it("ignores --scale with no PNG output, and --no-embed-fonts with no SVG output", async () => {
    const { svg, png } = await render(flowJson, { formats: ["svg", "png"] });

    expect(skill.run([flowPath, "--scale", "4"])).toEqual({ status: 0, stdout: svg, stderr: "" });
    expect(skill.run([flowPath, "--scale", "1", "-o", "scaled.svg"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "scaled.svg"), "utf8")).toBe(svg);
    expect(skill.run([flowPath, "--no-embed-fonts", "-o", "fonts.png"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "fonts.png")).equals(Buffer.from(png))).toBe(true);
  });

  it("embeds the fonts by default, and leaves them out with --no-embed-fonts, wherever the flag goes", async () => {
    const { svg } = await render(flowJson, { embedFonts: false });

    expect(skill.run([flowPath]).stdout).toContain("@font-face");
    expect(skill.run([flowPath, "--no-embed-fonts"])).toEqual({ status: 0, stdout: svg, stderr: "" });
    expect(skill.run(["--no-embed-fonts", flowPath, "-o", "plain.svg"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(skill.elsewhere, "plain.svg"), "utf8")).toBe(svg);
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

  it("draws the theme --theme asks for", async () => {
    const light = await render(flowJson, { theme: "light" });
    const dark = await render(flowJson, { theme: "dark" });

    expect(skill.run([flowPath, "--theme", "dark"])).toEqual({ status: 0, stdout: dark.svg, stderr: "" });
    expect(skill.run(["--theme", "light", flowPath])).toEqual({ status: 0, stdout: light.svg, stderr: "" });
    expect(dark.svg).not.toBe(light.svg);
  });

  it("lets --theme win over the JSON's theme, either way round", async () => {
    const withTheme = (theme: string) => JSON.stringify({ ...JSON.parse(flowJson), theme });
    const light = await render(flowJson, { theme: "light" });
    const dark = await render(flowJson, { theme: "dark" });

    expect(skill.run(["-"], { stdin: withTheme("dark") })).toEqual({ status: 0, stdout: dark.svg, stderr: "" });
    expect(skill.run(["-", "--theme", "light"], { stdin: withTheme("dark") })).toEqual({ status: 0, stdout: light.svg, stderr: "" });
    expect(skill.run(["-", "--theme", "dark"], { stdin: withTheme("light") })).toEqual({ status: 0, stdout: dark.svg, stderr: "" });
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

describe("the fonts inside structa.mjs", () => {
  const fontsDir = fileURLToPath(new URL("../fonts/", import.meta.url));
  const unmodified = [
    "inter/Inter-Regular.ttf",
    "inter/Inter-SemiBold.ttf",
    "inter/Inter-Bold.ttf",
    "inter/Inter-SemiBoldItalic.ttf",
    "jetbrains-mono/JetBrainsMono-Regular.ttf",
    "jetbrains-mono/JetBrainsMono-Italic.ttf",
  ];
  const postScriptName = (font: TtfFont) => font.names.find((n) => n.nameId === 6 && n.platformId === 3)?.value;
  const inSharedRanges = (codePoint: number) => CHARACTER_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);

  function shippedFonts(): TtfFont[] {
    const module = readFileSync(join(skill.dir, "structa.mjs"), "utf8");
    return [...module.matchAll(/data:font\/ttf;base64,([A-Za-z0-9+/]+=*)/g)].map(([, base64]) => readTtf(Buffer.from(base64!, "base64")));
  }

  it("are the six faces, once each", () => {
    const names = shippedFonts().map(postScriptName);

    expect(names.sort()).toEqual(
      ["Inter-Bold", "Inter-Regular", "Inter-SemiBold", "Inter-SemiBoldItalic", "JetBrainsMono-Italic", "JetBrainsMono-Regular"],
    );
  });

  it.each(unmodified)("cut %s to the shared characters, keeping its widths, vertical metrics and name records", (file) => {
    const original = readTtf(readFileSync(join(fontsDir, file)));
    const font = shippedFonts().find((shipped) => postScriptName(shipped) === postScriptName(original))!;
    const widths = (f: TtfFont) => f.characters.map((codePoint) => [codePoint, f.advance(codePoint)]);

    expect(font).toBeDefined();
    expect(font.characters).toEqual(original.characters.filter(inSharedRanges));
    expect(widths(font)).toEqual(widths(original).filter(([codePoint]) => inSharedRanges(codePoint!)));
    expect(font.missingAdvance).toBe(original.missingAdvance);
    expect([font.unitsPerEm, font.ascender, font.descender]).toEqual([original.unitsPerEm, original.ascender, original.descender]);
    expect(font.names).toEqual(original.names);
  });
});

describe("node structa.mjs example <type>", () => {
  /** The diagram types, as the schema lists them. */
  const types = (): string[] => JSON.parse(skill.run(["schema"]).stdout).properties.type.enum;

  it("ships the examples folder, file for file", () => {
    const shipped = join(skill.dir, "examples");
    const files = readdirSync(examplesDir).sort();

    expect(readdirSync(shipped).sort()).toEqual(files);
    for (const file of files) {
      expect([file, readFileSync(join(shipped, file), "utf8")]).toEqual([file, readFileSync(join(examplesDir, file), "utf8")]);
    }
  });

  it("prints each type's example from the examples folder, and every printed example renders", async () => {
    expect(types().length).toBeGreaterThan(0);
    for (const type of types()) {
      const example = skill.run(["example", type]);

      expect(example).toEqual({ status: 0, stdout: readFileSync(join(examplesDir, `${type}.json`), "utf8"), stderr: "" });
      const { svg } = await render(example.stdout);
      expect(skill.run(["-"], { stdin: example.stdout })).toEqual({ status: 0, stdout: svg, stderr: "" });
    }
  });

  it("names the missing example when the examples folder isn't next to structa.mjs", () => {
    const noExamples = join(dirname(skill.dir), "structa-without-examples");
    cpSync(skill.dir, noExamples, { recursive: true });
    rmSync(join(noExamples, "examples"), { recursive: true });

    expect(skill.run(["example", "flow"], { dir: noExamples })).toEqual({
      status: 1,
      stdout: "",
      stderr:
        `can't find the flow example: expected ${join(noExamples, "examples", "flow.json")} ` +
        "(keep the examples folder that came with structa.mjs next to it)\n",
    });
  });
});

describe("node structa.mjs --help", () => {
  // Any new flag or output updates --help and this text.
  const help = [
    "Structa draws one diagram, described in JSON, as an SVG or PNG image.",
    "",
    "Usage:",
    "  node structa.mjs <diagram.json> [options]  draw the diagram",
    "  node structa.mjs - [options]               read the JSON from stdin",
    "  node structa.mjs schema                    print the input's JSON Schema",
    "  node structa.mjs example <type>            print a working example",
    "",
    "Diagram types: flow",
    "",
    "Options:",
    "  -o <file>           write a .svg or .png file, not stdout; repeat for more",
    '  --theme light|dark  draw in this theme; wins over the JSON\'s "theme"',
    "  --scale 1-4         PNG pixels per SVG pixel (default 2)",
    "  --no-embed-fonts    leave the fonts out of the SVG, for a smaller file",
    "  -h, --help          print this help",
    "",
    "Start from an example, and check your JSON against the schema.",
    "Commands win over file names: draw a file named schema as ./schema.",
    "Input must be UTF-8 (a byte-order mark is fine), not UTF-16 or ANSI.",
    "",
    "Exit codes:",
    "  0  success",
    "  1  bad input or a failed render; each problem is one line on stderr",
    "  2  bad usage",
    "",
  ].join("\n");

  it.each([
    [["--help"]],
    [["-h"]],
    [["IN", "-o", "a.svg", "--help"]],
    [["IN", "--theme", "dark", "--no-embed-fonts", "-h"]],
    [["IN", "-o", "a.png", "--scale", "3", "--help"]],
    [["example", "pie", "-h"]],
  ])(
    "prints the short help for %j, and nothing else",
    (args) => {
      const result = skill.run(args.map((arg) => (arg === "IN" ? flowPath : arg)));

      expect(result).toEqual({ status: 0, stdout: help, stderr: "" });
      expect(existsSync(join(skill.elsewhere, "a.svg"))).toBe(false);
      expect(existsSync(join(skill.elsewhere, "a.png"))).toBe(false);
    },
  );

  it("stays short: at most 25 lines, none wider than 80 columns", () => {
    const lines = skill.run(["--help"]).stdout.trimEnd().split("\n");

    expect(lines.length).toBeLessThanOrEqual(25);
    expect(lines.filter((line) => line.length > 80)).toEqual([]);
  });
});

describe("commands win over file names", () => {
  it("prints the schema for schema, even with a file named schema here, and draws that file as ./schema", async () => {
    writeFileSync(join(skill.elsewhere, "schema"), flowJson);
    const { svg } = await render(flowJson);

    expect(skill.run(["schema"])).toEqual({ status: 0, stdout: readFileSync(join(skill.dir, "structa.schema.json"), "utf8"), stderr: "" });
    expect(skill.run(["./schema"])).toEqual({ status: 0, stdout: svg, stderr: "" });
  });

  it("asks for a type for example, even with a file named example here, and draws that file as ./example", async () => {
    writeFileSync(join(skill.elsewhere, "example"), flowJson);
    const { svg } = await render(flowJson);

    expect(skill.run(["example"]).status).toBe(2);
    expect(skill.run(["./example"])).toEqual({ status: 0, stdout: svg, stderr: "" });
  });
});

describe("input encodings", () => {
  const BOM = String.fromCharCode(0xfeff);
  const utf16le = (text: string) => Buffer.from(text, "utf16le");
  const utf16be = (text: string) => Buffer.from(text, "utf16le").swap16();
  const utf32 = (text: string, order: "LE" | "BE") =>
    Buffer.concat(
      [...text].map((char) => {
        const bytes = Buffer.alloc(4);
        if (order === "LE") bytes.writeUInt32LE(char.codePointAt(0)!);
        else bytes.writeUInt32BE(char.codePointAt(0)!);
        return bytes;
      }),
    );
  const fix = "(save it as UTF-8; in PowerShell, use -Encoding utf8)";
  const hint = `it is UTF-16 text ${fix}`;
  const notUtf8 = `it isn't UTF-8 text ${fix}`;
  // Labels with a Latin letter the fonts draw. Windows PowerShell 5.1's
  // Set-Content saves them in the ANSI code page, where é is the lone byte E9.
  const cafe = JSON.stringify({
    type: "flow",
    nodes: [
      { id: "order", label: "Order at the café", shape: "step" },
      { id: "sip", label: "Sip the crème", shape: "step" },
    ],
    edges: [{ from: "order", to: "sip" }],
  });

  it("strips a UTF-8 byte-order mark from a file", async () => {
    const { svg } = await render(flowJson);
    writeFileSync(join(skill.elsewhere, "with-bom.json"), BOM + flowJson);

    expect(skill.run(["with-bom.json"])).toEqual({ status: 0, stdout: svg, stderr: "" });
  });

  it("strips a UTF-8 byte-order mark from standard input", async () => {
    const { svg } = await render(flowJson);

    expect(skill.run(["-"], { stdin: BOM + flowJson })).toEqual({ status: 0, stdout: svg, stderr: "" });
  });

  it.each([
    ["UTF-16LE with a byte-order mark, as Windows PowerShell saves it", utf16le(BOM + flowJson), hint],
    ["UTF-16BE with a byte-order mark", utf16be(BOM + flowJson), hint],
    ["UTF-16LE without a byte-order mark", utf16le(flowJson), notUtf8],
    ["UTF-16BE without a byte-order mark", utf16be(flowJson), notUtf8],
    ["UTF-32LE with a byte-order mark", utf32(BOM + flowJson, "LE"), notUtf8],
    ["UTF-32BE with a byte-order mark", utf32(BOM + flowJson, "BE"), notUtf8],
    ["UTF-32LE without a byte-order mark", utf32(flowJson, "LE"), notUtf8],
    ["UTF-32BE without a byte-order mark", utf32(flowJson, "BE"), notUtf8],
    ["UTF-8 after a zero byte", Buffer.concat([Buffer.from([0]), Buffer.from(flowJson)]), notUtf8],
    ["the Windows ANSI code page, with a lone E9 byte for é", Buffer.from(cafe, "latin1"), notUtf8],
  ])("refuses a file in %s, with one line asking for UTF-8, and writes nothing", (_name, bytes, message) => {
    writeFileSync(join(skill.elsewhere, "wide.json"), bytes);

    const result = skill.run(["wide.json", "-o", "wide.svg"]);

    expect(result).toEqual({ status: 1, stdout: "", stderr: `can't read wide.json: ${message}\n` });
    expect(existsSync(join(skill.elsewhere, "wide.svg"))).toBe(false);
  });

  it("draws the same é label when the file is UTF-8", async () => {
    const { svg } = await render(cafe);
    writeFileSync(join(skill.elsewhere, "cafe.json"), cafe);

    expect(skill.run(["cafe.json"])).toEqual({ status: 0, stdout: svg, stderr: "" });
  });

  it.each([
    ["UTF-16", utf16le(BOM + flowJson), hint],
    ["ANSI", Buffer.from(cafe, "latin1"), notUtf8],
  ])("refuses %s on standard input the same way", (_name, bytes, message) => {
    const result = skill.run(["-"], { stdin: bytes });

    expect(result).toEqual({ status: 1, stdout: "", stderr: `can't read standard input: ${message}\n` });
  });
});

describe("resvg inside structa.mjs", () => {
  const resvgPackage = fileURLToPath(new URL("../node_modules/@resvg/resvg-wasm/", import.meta.url));
  const module = () => readFileSync(join(skill.dir, "structa.mjs"), "utf8");

  it("carries the package's own wasm, unmodified, brotli-compressed and base64-encoded", () => {
    // The one long base64 string literal; the fonts are data: URLs.
    const embedded = [...module().matchAll(/"([A-Za-z0-9+/]{100000,}={0,2})"/g)].map(([, base64]) => base64!);

    expect(embedded).toHaveLength(1);
    const wasm = brotliDecompressSync(Buffer.from(embedded[0]!, "base64"));
    expect(wasm.equals(readFileSync(join(resvgPackage, "index_bg.wasm")))).toBe(true);
  });

  it("bundles the JavaScript glue unminified, straight after a legal comment naming its package, version, licence and source", () => {
    const { version } = JSON.parse(readFileSync(join(resvgPackage, "package.json"), "utf8")) as { version: string };
    const text = module();
    const legal = `/*! @resvg/resvg-wasm ${version} | MPL-2.0 | https://github.com/thx/resvg-js/tree/v${version} */`;

    expect(version).toBe("2.6.2");
    expect(text.split(legal)).toHaveLength(2);
    // The glue's own first lines follow, as the package wrote them.
    const glue = text.slice(text.indexOf(legal) + legal.length).trimStart();
    expect(glue.startsWith("var wasm;\nvar heap = new Array(128).fill(void 0);\nheap.push(void 0, null, true, false);\n")).toBe(true);
  });
});

describe("the licences in the skill folder", () => {
  const licence = (name: string) => readFileSync(join(skill.dir, "licenses", name), "utf8");
  const fromRepository = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

  it("ships elkjs's own EPL-2.0 text, unchanged", () => {
    expect(licence("EPL-2.0.md")).toBe(fromRepository("node_modules/elkjs/LICENSE.md"));
    expect(licence("EPL-2.0.md")).toMatch(/^# Eclipse Public License - v 2\.0\n/);
  });

  it("says where elkjs's source lives: the shipped version, its repository at that tag, and Eclipse ELK", () => {
    const note = licence("elkjs-source.txt");

    expect(note).toContain("elk.bundled.js is lib/elk.bundled.js from the published elkjs 0.12.1, byte for byte");
    expect(note).toContain("https://github.com/kieler/elkjs/tree/0.12.1");
    expect(note).toContain("https://github.com/eclipse-elk/elk");
    expect(note).toContain("EPL-2.0 OR GPL-3.0-or-later");
  });

  it("ships the Apache-2.0 text, as apache.org publishes it, for the Guava and GWT code compiled into elkjs", () => {
    const sha256 = createHash("sha256").update(licence("Apache-2.0.txt")).digest("hex");

    // The SHA-256 of https://www.apache.org/licenses/LICENSE-2.0.txt.
    expect(sha256).toBe("cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30");
    expect(licence("elkjs-source.txt")).toContain(
      [
        "elk.bundled.js also holds Guava and GWT code, compiled into it along with ELK. That code is licensed Apache-2.0, and its text is in Apache-2.0.txt.",
        "- Guava: https://github.com/google/guava",
        "- GWT: https://github.com/gwtproject/gwt",
      ].join("\n"),
    );
  });

  it("ships the MPL-2.0 text, as mozilla.org publishes it, and says where resvg's wasm and glue come from", () => {
    const sha256 = createHash("sha256").update(licence("MPL-2.0.txt")).digest("hex");
    const note = licence("resvg-source.txt");

    // The SHA-256 of https://www.mozilla.org/media/MPL/2.0/index.txt.
    expect(sha256).toBe("3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04");
    expect(note).toContain("structa.mjs carries index_bg.wasm from the published @resvg/resvg-wasm 2.6.2 unmodified");
    expect(note).toContain("and bundles its JavaScript glue, index.mjs, unminified");
    expect(note).toContain("Licence: MPL-2.0. Its text is in MPL-2.0.txt.");
    expect(note).toContain("Source code: https://github.com/thx/resvg-js/tree/v2.6.2");
  });

  it.each([
    ["OFL-1.1-Inter.txt", "fonts/inter/OFL.txt", "Copyright (c) 2016 The Inter Project Authors"],
    ["OFL-1.1-JetBrains-Mono.txt", "fonts/jetbrains-mono/OFL.txt", "Copyright 2020 The JetBrains Mono Project Authors"],
  ])("ships %s, the font's own OFL-1.1 from %s", (name, original, copyright) => {
    expect(licence(name)).toBe(fromRepository(original));
    expect(licence(name).startsWith(`${copyright} (https://github.com/`)).toBe(true);
    expect(licence(name)).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("ships Structa's own MIT licence", () => {
    expect(licence("MIT.txt")).toBe(fromRepository("LICENSE"));
    expect(licence("MIT.txt")).toMatch(/^MIT License\n/);
  });

  it("are named, with each embedded part, in the banner structa.mjs starts with", () => {
    const banner = [
      "/*!",
      " * Structa, under the MIT licence (licenses/MIT.txt). This file also embeds:",
      " * - @resvg/resvg-wasm 2.6.2, its wasm and JavaScript glue: MPL-2.0 (licenses/MPL-2.0.txt, licenses/resvg-source.txt)",
      " * - the Inter fonts, subset: OFL-1.1 (licenses/OFL-1.1-Inter.txt)",
      " * - the JetBrains Mono fonts, subset: OFL-1.1 (licenses/OFL-1.1-JetBrains-Mono.txt)",
      " * elkjs 0.12.1 is not in this file: it ships next to it as elk.bundled.js,",
      " * under EPL-2.0 OR GPL-3.0-or-later, with Apache-2.0 parts (licenses/elkjs-source.txt).",
      " */",
      "",
    ].join("\n");

    expect(readFileSync(join(skill.dir, "structa.mjs"), "utf8").startsWith(banner)).toBe(true);
  });

  it("holds exactly the licence texts and source notes", () => {
    expect(readdirSync(join(skill.dir, "licenses")).sort()).toEqual([
      "Apache-2.0.txt",
      "EPL-2.0.md",
      "MIT.txt",
      "MPL-2.0.txt",
      "OFL-1.1-Inter.txt",
      "OFL-1.1-JetBrains-Mono.txt",
      "elkjs-source.txt",
      "resvg-source.txt",
    ]);
  });
});

// What bun run release wrote. Every test in this file runs the skill folder unzipped from this zip.
describe("the release zip", () => {
  /** Every file under `dir`, as a path with forward slashes, in code-unit order. */
  const filesUnder = (dir: string): string[] => {
    const walk = (prefix: string): string[] =>
      readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory() ? walk(path) : [path];
      });
    return walk("").sort();
  };
  /** The comment at the end of a zip, after its end-of-central-directory record. */
  const zipComment = (zip: Uint8Array): string => {
    const bytes = Buffer.from(zip);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const length = bytes.readUInt16LE(end + 20);
    expect(end + 22 + length).toBe(bytes.length);
    return bytes.toString("utf8", end + 22);
  };

  it("holds the whole built skill folder in a structa folder, file for file", () => {
    const unzipped = unzipSync(readFileSync(skill.release.zip));
    const files = filesUnder(skill.release.folder);

    expect(files).toEqual(expect.arrayContaining(["structa.mjs", "elk.bundled.js", "package.json", "structa.schema.json", "licenses/MIT.txt"]));
    expect(Object.keys(unzipped)).toEqual(files.map((file) => `structa/${file}`));
    for (const file of files) {
      const same = Buffer.from(unzipped[`structa/${file}`]!).equals(readFileSync(join(skill.release.folder, file)));
      expect([file, same]).toEqual([file, true]);
    }
  });

  it("is labelled with the licence of everything in it", () => {
    expect(zipComment(readFileSync(skill.release.zip))).toBe(
      "SPDX-License-Identifier: MIT AND (EPL-2.0 OR GPL-3.0-or-later) AND MPL-2.0 AND OFL-1.1 AND Apache-2.0",
    );
  });

  it("is the same bytes from the same files, whenever they were written or zipped", () => {
    const touched = join(dirname(skill.dir), "structa-touched");
    cpSync(skill.release.folder, touched, { recursive: true });
    for (const file of filesUnder(touched)) utimesSync(join(touched, file), new Date(2031, 5, 7), new Date(2031, 5, 7));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2044, 10, 3, 17, 5));

      expect(Buffer.from(zipSkill(touched)).equals(readFileSync(skill.release.zip))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("comes with release notes that say how to use it and what its licence is", () => {
    expect(readFileSync(skill.release.notes, "utf8")).toBe(
      [
        "Unzip `structa.zip` into your skills folder: it holds a ready-to-use `structa` skill folder.",
        "Agents then run `node structa.mjs diagram.json -o diagram.png` in it, with Node 20 or newer and nothing to install.",
        "",
        "Licence of the zip: `MIT AND (EPL-2.0 OR GPL-3.0-or-later) AND MPL-2.0 AND OFL-1.1 AND Apache-2.0`.",
        "Structa's own code is MIT. The licence texts and source notes for the parts it ships are in `structa/licenses/`.",
        "",
      ].join("\n"),
    );
  });
});

describe("import { render } from structa.mjs", () => {
  it("draws the same PNG as render() in this process", async () => {
    const { png } = await render(flowJson, { formats: ["png"] });
    const url = pathToFileURL(join(skill.dir, "structa.mjs")).href;
    const script = [
      `import { render } from ${JSON.stringify(url)};`,
      'let json = "";',
      "for await (const chunk of process.stdin) json += chunk;",
      'const { png } = await render(json, { formats: ["png"] });',
      'process.stdout.write(Buffer.from(png).toString("base64"));',
    ].join("\n");

    const result = skill.node(["--input-type=module", "-e", script], { stdin: flowJson });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(Buffer.from(result.stdout, "base64").equals(Buffer.from(png))).toBe(true);
  });

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

  it("writes no file at all when one of the outputs fails to draw", () => {
    // A line of 60 steps, left to right: far too wide for a PNG at scale 4.
    const nodes = Array.from({ length: 60 }, (_, i) => ({ id: `stop${i}`, label: `Stop ${i + 1}`, shape: "step" }));
    const edges = nodes.slice(1).map((node, i) => ({ from: `stop${i}`, to: node.id }));
    const wide = JSON.stringify({ type: "flow", direction: "right", nodes, edges });

    const result = skill.run(["-", "-o", "route.svg", "-o", "route.png", "--scale", "4"], { stdin: wide });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^\$: the PNG would be \d+ by \d+ px, but neither side may be over 16384 px \(.+\)\n$/);
    expect(existsSync(join(skill.elsewhere, "route.svg"))).toBe(false);
    expect(existsSync(join(skill.elsewhere, "route.png"))).toBe(false);
  });

  it("writes no file at all when one of the files can't be written, and leaves files already there as they were", () => {
    writeFileSync(join(skill.elsewhere, "kept.svg"), "the old picture");

    const result = skill.run([flowPath, "-o", "kept.svg", "-o", "fresh.png", "-o", join("no-such-folder", "lost.png")]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^can't write no-such-folder[\\/]lost\.png: ENOENT: no such file or directory\n$/);
    expect(result.stderr).not.toMatch(/\.tmp/);
    expect(readFileSync(join(skill.elsewhere, "kept.svg"), "utf8")).toBe("the old picture");
    expect(readdirSync(skill.elsewhere).filter((name) => /kept|fresh|lost/.test(name))).toEqual(["kept.svg"]);
  });

  it("writes nothing when an -o names a folder, and leaves files already there as they were", () => {
    writeFileSync(join(skill.elsewhere, "older.svg"), "the old picture");
    mkdirSync(join(skill.elsewhere, "shelf.png"));

    const result = skill.run([flowPath, "-o", "older.svg", "-o", "shelf.png"]);

    expect(result).toEqual({ status: 1, stdout: "", stderr: "can't write shelf.png: it is a folder\n" });
    expect(readFileSync(join(skill.elsewhere, "older.svg"), "utf8")).toBe("the old picture");
    expect(readdirSync(skill.elsewhere).filter((name) => /older|shelf/.test(name)).sort()).toEqual(["older.svg", "shelf.png"]);
    expect(readdirSync(join(skill.elsewhere, "shelf.png"))).toEqual([]);
  });

  // Root can write any file, so the check has nothing to catch.
  it.skipIf(process.getuid?.() === 0)("writes nothing when an -o names a read-only file, and names only that file", () => {
    const locked = join(skill.elsewhere, "locked.png");
    writeFileSync(locked, "the old picture");
    chmodSync(locked, 0o444);
    try {
      const result = skill.run([flowPath, "-o", "unlocked.svg", "-o", "locked.png"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      // EPERM on Windows, EACCES elsewhere; no paths after it.
      expect(result.stderr).toMatch(/^can't write locked\.png: E(PERM|ACCES): [^,\n]+\n$/);
      expect(readFileSync(locked, "utf8")).toBe("the old picture");
      expect(readdirSync(skill.elsewhere).filter((name) => /locked/.test(name))).toEqual(["locked.png"]);
    } finally {
      chmodSync(locked, 0o644);
    }
  });

  it("reports a JSON syntax error at $ with its line and column", () => {
    const result = skill.run(["-"], { stdin: '{ "type": "flow", ' });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("$: invalid JSON at line 1, column 19: the input ends too soon (close every open list and object)\n");
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

  /** Puts other font bytes in place of one face's font in the copy's generated font data. */
  const replaceFont = (face: string, ttf: (project: string) => Buffer) => (project: string) => {
    const file = join(project, "generated", "font-files.ts");
    const source = readFileSync(file, "utf8");
    const entry = new RegExp(`(\\["${face}", "data:font/ttf;base64,)[A-Za-z0-9+/=]+`);
    expect(source).toMatch(entry);
    writeFileSync(file, source.replace(entry, (_, start: string) => start + ttf(project).toString("base64")));
  };
  const trimmed = (file: string) => (project: string) => readFileSync(join(project, "generated", "fonts", file));

  it("fails when a shipped font still has OpenType layout tables", async () => {
    const untrimmed = () => readFileSync(fileURLToPath(new URL("../fonts/inter/Inter-SemiBold.ttf", import.meta.url)));

    const message = await buildChangedProject(replaceFont("inter-semibold", untrimmed));

    expect(message).toBe(failure('structa.mjs embeds "Inter" 600 normal with OpenType layout tables: GDEF, GPOS, GSUB'));
  }, BUILD_TIMEOUT);

  it.each([
    ["family", "inter-regular", "JetBrainsMono-Regular.ttf", ['structa.mjs embeds no "Inter" 400 normal font', 'structa.mjs embeds 2 "JetBrains Mono" 400 normal fonts']],
    ["weight", "inter-semibold", "Inter-Bold.ttf", ['structa.mjs embeds no "Inter" 600 normal font', 'structa.mjs embeds 2 "Inter" 700 normal fonts']],
    ["style", "mono-italic", "JetBrainsMono-Regular.ttf", ['structa.mjs embeds 2 "JetBrains Mono" 400 normal fonts', 'structa.mjs embeds no "JetBrains Mono" 400 italic font']],
  ])(
    "fails when a shipped font has the wrong %s",
    async (_name, face, file, problems) => {
      const message = await buildChangedProject(replaceFont(face, trimmed(file)));

      expect(message).toBe(failure(...problems));
    },
    BUILD_TIMEOUT,
  );

  it("fails when a shipped font lost its typographic family name, which tells SemiBold from Bold", async () => {
    // Inter SemiBold's own family name is "Inter SemiBold"; only name id 16 says it is "Inter" at weight 600.
    const withoutTypographicFamily = (project: string) => renumberNames(trimmed("Inter-SemiBold.ttf")(project), 16, 255);

    const message = await buildChangedProject(replaceFont("inter-semibold", withoutTypographicFamily));

    expect(message).toBe(
      failure(
        'structa.mjs embeds no "Inter" 600 normal font',
        'structa.mjs embeds a "Inter SemiBold" 600 normal font, which is not one of its faces',
      ),
    );
  }, BUILD_TIMEOUT);

  it.each([
    ["licenses/MIT.txt", "LICENSE"],
    ["licenses/EPL-2.0.md", "node_modules/elkjs/LICENSE.md"],
    ["licenses/Apache-2.0.txt", "licenses/Apache-2.0.txt"],
    ["licenses/MPL-2.0.txt", "licenses/MPL-2.0.txt"],
    ["licenses/OFL-1.1-Inter.txt", "fonts/inter/OFL.txt"],
    ["licenses/OFL-1.1-JetBrains-Mono.txt", "fonts/jetbrains-mono/OFL.txt"],
  ])(
    "fails when %s is missing, because the project has no %s",
    async (shipped, source) => {
      const message = await buildChangedProject((project) => rmSync(join(project, source)));

      expect(message).toBe(failure(`${shipped} is missing (the build copies it from ${source})`));
    },
    BUILD_TIMEOUT,
  );

  it.each([
    [
      "an empty Apache-2.0 text",
      (project: string) => writeFileSync(join(project, "licenses", "Apache-2.0.txt"), ""),
      ['licenses/Apache-2.0.txt is not the Apache-2.0 text: it doesn\'t say "Apache License"', 'licenses/Apache-2.0.txt is not the Apache-2.0 text: it doesn\'t say "Version 2.0, January 2004"'],
    ],
    [
      "JetBrains Mono's OFL in place of Inter's",
      (project: string) => cpSync(join(project, "fonts", "jetbrains-mono", "OFL.txt"), join(project, "fonts", "inter", "OFL.txt")),
      ['licenses/OFL-1.1-Inter.txt is not Inter\'s OFL-1.1: it doesn\'t say "The Inter Project Authors"'],
    ],
  ])(
    "fails when a licence file holds the wrong text: %s",
    async (_name, change, problems) => {
      const message = await buildChangedProject(change);

      expect(message).toBe(failure(...problems));
    },
    BUILD_TIMEOUT,
  );

  it("fails when resvg's glue is bundled without its legal comment, as when it is copied into our source", async () => {
    const message = await buildChangedProject((project) => {
      cpSync(join(project, "node_modules", "@resvg", "resvg-wasm", "index.mjs"), join(project, "src", "raster", "resvg-glue.mjs"));
      const raster = join(project, "src", "raster", "index.ts");
      writeFileSync(raster, readFileSync(raster, "utf8").replace('from "@resvg/resvg-wasm";', 'from "./resvg-glue.mjs";'));
    });

    expect(message).toBe(
      failure("structa.mjs has no legal comment for resvg's glue: /*! @resvg/resvg-wasm 2.6.2 | MPL-2.0 | https://github.com/thx/resvg-js/tree/v2.6.2 */"),
    );
  }, BUILD_TIMEOUT);

  it("fails when structa.mjs doesn't start with its licence banner, as when the source starts with a hashbang", async () => {
    const message = await buildChangedProject((project) => {
      const entry = join(project, "src", "structa.ts");
      writeFileSync(entry, `#!/usr/bin/env node\n${readFileSync(entry, "utf8")}`);
    });

    expect(message).toBe(failure("structa.mjs doesn't start with its licence banner"));
  }, BUILD_TIMEOUT);

  it("fails when structa.mjs bundles code from a package that no licence file covers", async () => {
    const message = await buildChangedProject((project) => {
      for (const [name, colour] of [["a-new-library", "teal"], ["@someone/new-library", "plum"]] as const) {
        const dir = join(project, "node_modules", ...name.split("/"));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }));
        writeFileSync(join(dir, "index.js"), `export const colour = ${JSON.stringify(colour)};\n`);
      }
      appendTo("src/structa.ts", 'export { colour as teal } from "a-new-library";\nexport { colour as plum } from "@someone/new-library";\n')(project);
    });

    const hint =
      "To ship a new library on purpose, add its licence in licenceFiles() in scripts/lib/skill.ts with the package in its packages, " +
      "and add it to the banner and to RELEASE_LICENSE";
    expect(message).toBe(
      failure(
        `structa.mjs bundles @someone/new-library (node_modules/@someone/new-library/index.js), but nothing in licenses/ covers it: it may bundle only @resvg/resvg-wasm. ${hint}`,
        `structa.mjs bundles a-new-library (node_modules/a-new-library/index.js), but nothing in licenses/ covers it: it may bundle only @resvg/resvg-wasm. ${hint}`,
      ),
    );
  }, BUILD_TIMEOUT);

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

/** A copy of a TTF whose name records with id `from` have id `to` instead. */
function renumberNames(ttf: Buffer, from: number, to: number): Buffer {
  const font = Buffer.from(ttf);
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + 16 * i;
    if (font.toString("latin1", record, record + 4) !== "name") continue;
    const name = font.readUInt32BE(record + 8);
    for (let r = 0; r < font.readUInt16BE(name + 2); r++) {
      const nameId = name + 6 + 12 * r + 6;
      if (font.readUInt16BE(nameId) === from) font.writeUInt16BE(to, nameId);
    }
  }
  return font;
}

describe("exit code 2: bad usage", () => {
  it.each([
    ["no input", [], "give the diagram's JSON file, or - to read it from standard input"],
    ["two inputs", ["a.json", "b.json"], 'give one input, not two ("a.json" and "b.json")'],
    ["-o with no file", ["IN", "-o"], "-o needs a file name"],
    ["the same -o twice", ["IN", "-o", "a.png", "-o", "b.svg", "-o", "a.png"], 'give each -o its own file ("a.png" is given twice)'],
    ["two spellings of one -o", ["IN", "-o", "a.svg", "-o", "./a.svg"], 'give each -o its own file ("a.svg" and "./a.svg" are the same file)'],
    [
      "two -o that differ only in letter case",
      ["IN", "-o", "a.png", "-o", "A.PNG"],
      'give each -o its own file ("a.png" and "A.PNG" are the same file on Windows and macOS)',
    ],
    [
      "two spellings of one -o in different letter case",
      ["IN", "-o", "./a.svg", "-o", "A.svg"],
      'give each -o its own file ("./a.svg" and "A.svg" are the same file on Windows and macOS)',
    ],
    ["a .txt output", ["IN", "-o", "chart.txt"], '-o "chart.txt": the output file must end in .svg or .png'],
    ["a .jpg output", ["IN", "-o", "chart.jpg"], '-o "chart.jpg": the output file must end in .svg or .png'],
    ["an output with no extension", ["IN", "-o", "chart"], '-o "chart": the output file must end in .svg or .png'],
    ["an output that is only an extension", ["IN", "-o", ".SVG"], '-o ".SVG": give it a name before .svg'],
    ["a PNG output that is only an extension", ["IN", "-o", ".png"], '-o ".png": give it a name before .png'],
    ["--help as the file after -o", ["IN", "-o", "--help"], '-o "--help": the output file must end in .svg or .png'],
    ["-h as the file after -o", ["IN", "-o", "-h"], '-o "-h": the output file must end in .svg or .png'],
    ["an unknown option", ["IN", "--sparkle"], 'unknown option "--sparkle"'],
    ["--theme with no value", ["IN", "--theme"], "--theme needs light or dark"],
    ["an unknown theme", ["IN", "--theme", "sepia"], '--theme "sepia": the theme must be light or dark'],
    ["a theme in the wrong case", ["IN", "--theme", "Dark"], '--theme "Dark": the theme must be light or dark'],
    ["two --theme", ["IN", "--theme", "dark", "--theme", "light"], "give --theme only once"],
    ["--scale with no value", ["IN", "-o", "a.png", "--scale"], "--scale needs a whole number from 1 to 4"],
    ["a scale of 0", ["IN", "-o", "a.png", "--scale", "0"], '--scale "0": the scale must be a whole number from 1 to 4'],
    ["a scale of 5", ["IN", "-o", "a.png", "--scale", "5"], '--scale "5": the scale must be a whole number from 1 to 4'],
    ["a fractional scale", ["IN", "-o", "a.png", "--scale", "1.5"], '--scale "1.5": the scale must be a whole number from 1 to 4'],
    ["a scale written 02", ["IN", "-o", "a.png", "--scale", "02"], '--scale "02": the scale must be a whole number from 1 to 4'],
    ["a scale in words", ["IN", "-o", "a.png", "--scale", "two"], '--scale "two": the scale must be a whole number from 1 to 4'],
    ["a bad scale with no PNG output", ["IN", "--scale", "8"], '--scale "8": the scale must be a whole number from 1 to 4'],
    ["two --scale", ["IN", "-o", "a.png", "--scale", "2", "--scale", "3"], "give --scale only once"],
    ["schema with an argument", ["schema", "IN"], "schema takes no other arguments"],
    ["schema with -o", ["schema", "-o", "a.svg"], "schema takes no other arguments"],
    ["schema with --theme", ["schema", "--theme", "dark"], "schema takes no other arguments"],
    ["schema with --scale", ["schema", "--scale", "2"], "schema takes no other arguments"],
    ["schema with --no-embed-fonts", ["schema", "--no-embed-fonts"], "schema takes no other arguments"],
    ["example with no type", ["example"], "example needs a diagram type (valid types: flow)"],
    ["an unknown example type", ["example", "pie"], 'unknown diagram type "pie" (valid types: flow)'],
    ["example with two types", ["example", "flow", "flow"], 'give one diagram type, not two ("flow" and "flow")'],
    ["example with -o", ["example", "flow", "-o", "a.png"], "example takes no other arguments"],
    ["example with --theme", ["example", "flow", "--theme", "dark"], "example takes no other arguments"],
    ["example with --scale", ["example", "flow", "--scale", "2"], "example takes no other arguments"],
    ["example with --no-embed-fonts", ["example", "flow", "--no-embed-fonts"], "example takes no other arguments"],
  ])("rejects %s, prints the usage line and writes nothing", (_name, args, message) => {
    const input = join(skill.elsewhere, "usage-input.json");
    writeFileSync(input, flowJson);

    const result = skill.run(args.map((arg) => (arg === "IN" ? input : arg)));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const [first, usage, ...rest] = result.stderr.split("\n");
    expect(first).toBe(message);
    expect(usage).toMatch(/^usage: node structa\.mjs /);
    expect(usage).toContain("[--no-embed-fonts]");
    expect(rest).toEqual([""]);
    for (const name of ["a.svg", "a.png", "b.svg", "chart.txt", "chart.jpg", "chart", ".SVG", ".png"]) {
      expect(existsSync(join(skill.elsewhere, name))).toBe(false);
    }
  });

  it("lists every flag and command in the usage line", () => {
    const [, usage] = skill.run([]).stderr.split("\n");

    expect(usage).toBe(
      "usage: node structa.mjs <diagram.json | -> [-o <file.svg | file.png>]... [--theme light|dark] [--scale 1-4] [--no-embed-fonts]" +
        " | schema | example <type> | --help",
    );
  });
});
