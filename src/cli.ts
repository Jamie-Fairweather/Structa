import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAM_TYPES, jsonSchema } from "./input";
import { render } from "./render";
import { THEME_NAMES, type ThemeName } from "./theme";

type Command =
  | {
      readonly kind: "render";
      /** A file path, or "-" for standard input. */
      readonly input: string;
      /** Where to write the SVG; standard output when absent. */
      readonly output?: string;
      /** Wins over the JSON's theme when given. */
      readonly theme?: ThemeName;
      /** False with --no-embed-fonts. */
      readonly embedFonts: boolean;
    }
  | { readonly kind: "schema" }
  | { readonly kind: "example"; readonly type: string }
  | { readonly kind: "help" };

const THEMES = THEME_NAMES.join(" or ");
const USAGE =
  `usage: node structa.mjs <diagram.json | -> [-o <diagram.svg>] [--theme ${THEME_NAMES.join("|")}] [--no-embed-fonts]` +
  " | schema | example <type> | --help";

/** Short, for agents: the commands, every flag and the exit codes. Update it with every new flag or output. */
const HELP = `Structa draws one diagram, described in JSON, as an SVG image.

Usage:
  node structa.mjs <diagram.json> [options]  draw the diagram
  node structa.mjs - [options]               read the JSON from stdin
  node structa.mjs schema                    print the input's JSON Schema
  node structa.mjs example <type>            print a working example

Diagram types: ${DIAGRAM_TYPES.join(", ")}

Options:
  -o <file.svg>       write the SVG to this file, not stdout (.svg in any case)
  --theme ${THEME_NAMES.join("|")}  draw in this theme; wins over the JSON's "theme"
  --no-embed-fonts    leave the fonts out of the SVG, for a smaller file
  -h, --help          print this help

Start from an example, and check your JSON against the schema.
Commands win over file names: draw a file named schema as ./schema.
Input is UTF-8; a byte-order mark is fine, UTF-16 is refused.

Exit codes:
  0  success
  1  bad input or a failed render; each problem is one line on stderr
  2  bad usage
`;

/** Set by the build (esbuild `define`) to "./examples/", the folder next to structa.mjs; undeclared in source runs. */
declare const STRUCTA_EXAMPLES_DIR: string | undefined;
const EXAMPLES_DIR = new URL(typeof STRUCTA_EXAMPLES_DIR === "undefined" ? "../examples/" : STRUCTA_EXAMPLES_DIR, import.meta.url);

/** Runs the command line. Returns the exit code: 0 success, 1 bad input or a failed render, 2 bad usage. */
export async function runCli(args: readonly string[]): Promise<number> {
  const command = parseArgs(args);
  if (typeof command === "string") {
    process.stderr.write(`${command}\n${USAGE}\n`);
    return 2;
  }
  switch (command.kind) {
    case "help":
      process.stdout.write(HELP);
      return 0;
    case "schema":
      process.stdout.write(`${JSON.stringify(jsonSchema(), null, 2)}\n`);
      return 0;
    case "example":
      return printExample(command.type);
    case "render":
      return renderDiagram(command);
  }
}

/** Prints examples/<type>.json from the examples folder that ships with the tool. */
async function printExample(type: string): Promise<number> {
  const file = fileURLToPath(new URL(`${type}.json`, EXAMPLES_DIR));
  let example: string;
  try {
    example = await readFile(file, "utf8");
  } catch {
    return fail(`can't find the ${type} example: expected ${file} (keep the examples folder that came with structa.mjs next to it)`);
  }
  process.stdout.write(example);
  return 0;
}

async function renderDiagram(command: Extract<Command, { kind: "render" }>): Promise<number> {
  const name = command.input === "-" ? "standard input" : command.input;
  let bytes: Buffer;
  try {
    bytes = command.input === "-" ? await readStdin() : await readFile(command.input);
  } catch (error) {
    return fail(`can't read ${name}: ${(error as Error).message}`);
  }
  const json = decodeUtf8(bytes);
  if (json === undefined) return fail(`can't read ${name}: it is UTF-16 text (save it as UTF-8; in PowerShell, use -Encoding utf8)`);
  let svg: string;
  try {
    ({ svg } = await render(json, { theme: command.theme, embedFonts: command.embedFonts }));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (command.output === undefined) {
    process.stdout.write(svg);
    return 0;
  }
  try {
    await writeFile(command.output, svg);
  } catch (error) {
    return fail(`can't write ${command.output}: ${(error as Error).message}`);
  }
  return 0;
}

/**
 * The command the arguments describe, or what's wrong with them. --help wins
 * over everything, and the commands win over file names.
 */
function parseArgs(args: readonly string[]): Command | string {
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  let output: string | undefined;
  let theme: ThemeName | undefined;
  let embedFonts = true;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--no-embed-fonts") {
      embedFonts = false;
    } else if (arg === "-o") {
      const file = args[++i];
      if (file === undefined) return "-o needs a file name";
      if (output !== undefined) return "give -o only once";
      if (extname(file).toLowerCase() !== ".svg") {
        // extname() of a bare ".svg" is empty: the name is all extension.
        const fix = basename(file).toLowerCase() === ".svg" ? "give it a name before .svg" : "the output file must end in .svg";
        return `-o ${JSON.stringify(file)}: ${fix}`;
      }
      output = file;
    } else if (arg === "--theme") {
      const name = args[++i];
      if (name === undefined) return `--theme needs ${THEMES}`;
      if (theme !== undefined) return "give --theme only once";
      if (!THEME_NAMES.includes(name as ThemeName)) return `--theme ${JSON.stringify(name)}: the theme must be ${THEMES}`;
      theme = name as ThemeName;
    } else if (arg.startsWith("-") && arg !== "-") {
      return `unknown option ${JSON.stringify(arg)}`;
    } else {
      words.push(arg);
    }
  }

  const [input, ...rest] = words;
  // The flags that only drawing takes.
  const drawFlags = output !== undefined || theme !== undefined || !embedFonts;
  if (input === "schema") {
    return !drawFlags && rest.length === 0 ? { kind: "schema" } : "schema takes no other arguments";
  }
  if (input === "example") {
    const [type, ...more] = rest;
    const types = `valid types: ${DIAGRAM_TYPES.join(", ")}`;
    if (drawFlags) return "example takes no other arguments";
    if (type === undefined) return `example needs a diagram type (${types})`;
    if (more.length > 0) return `give one diagram type, not two (${JSON.stringify(type)} and ${JSON.stringify(more[0])})`;
    if (!DIAGRAM_TYPES.includes(type)) return `unknown diagram type ${JSON.stringify(type)} (${types})`;
    return { kind: "example", type };
  }
  if (input === undefined) return "give the diagram's JSON file, or - to read it from standard input";
  if (rest.length > 0) return `give one input, not two (${JSON.stringify(input)} and ${JSON.stringify(rest[0])})`;
  return { kind: "render", input, output, theme, embedFonts };
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * The input as UTF-8 text, without a leading byte-order mark, or undefined
 * when it is UTF-16. UTF-16 starts with the byte-order mark FF FE or FE FF,
 * or, without one, has a zero in its first two bytes: JSON starts with an
 * ASCII character, and a zero byte is never valid JSON in UTF-8.
 */
function decodeUtf8(bytes: Buffer): string | undefined {
  const [first, second] = bytes;
  const utf16Mark = (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
  if (utf16Mark || first === 0 || second === 0) return undefined;
  const text = bytes.toString("utf8");
  return text.startsWith("﻿") ? text.slice(1) : text;
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}
