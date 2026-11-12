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
  `usage: node structa.mjs <diagram.json | -> [-o <file.svg>] [--theme ${THEME_NAMES.join("|")}] [--no-embed-fonts]` +
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
  -o <file.svg>       write the SVG to this file, not stdout (must end in .svg)
  --theme ${THEME_NAMES.join("|")}  draw in this theme; wins over the JSON's "theme"
  --no-embed-fonts    leave the fonts out of the SVG, for a smaller file
  -h, --help          print this help

Start from an example, and check your JSON against the schema.
Commands win over file names: draw a file named schema as ./schema.
Input must be UTF-8 (a byte-order mark is fine), not UTF-16 or ANSI.

Exit codes:
  0  success
  1  bad input or a failed render; each problem is one line on stderr
  2  bad usage
`;

/** Set by the build (esbuild `define`) to "./examples/", the folder next to structa.mjs; undeclared in source runs. */
declare const STRUCTA_EXAMPLES_DIR: string | undefined;

/**
 * The examples folder. In source runs it is the repository's; the build
 * drops the `source:` statement, so structa.mjs only reads the one next to it.
 */
function examplesDir(): URL {
  source: if (typeof STRUCTA_EXAMPLES_DIR === "undefined") return new URL("../examples/", import.meta.url);
  return new URL(STRUCTA_EXAMPLES_DIR!, import.meta.url);
}

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
  const file = fileURLToPath(new URL(`${type}.json`, examplesDir()));
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
  if (json === undefined) {
    const what = hasUtf16Mark(bytes) ? "it is UTF-16 text" : "it isn't UTF-8 text";
    return fail(`can't read ${name}: ${what} (save it as UTF-8; in PowerShell, use -Encoding utf8)`);
  }
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
 * over everything (except as the file name after -o), and the commands win
 * over file names.
 */
function parseArgs(args: readonly string[]): Command | string {
  if (args.some((arg, i) => (arg === "--help" || arg === "-h") && args[i - 1] !== "-o")) return { kind: "help" };
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
 * when it isn't UTF-8: a Windows ANSI file, say, or anything that starts with
 * a UTF-16 or UTF-32 byte-order mark. A zero in the first two bytes means
 * UTF-16 or UTF-32 without a mark: JSON starts with an ASCII character, and a
 * zero byte is never valid JSON in UTF-8.
 */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0 || bytes[1] === 0) return undefined;
  try {
    // Strips a leading byte-order mark, and throws on any byte sequence that isn't UTF-8.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** True when the input starts with UTF-16's byte-order mark: FE FF, or FF FE but not UTF-32's FF FE 00 00. */
function hasUtf16Mark(bytes: Uint8Array): boolean {
  const [a, b, c, d] = bytes;
  return (a === 0xfe && b === 0xff) || (a === 0xff && b === 0xfe && !(c === 0 && d === 0));
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}
