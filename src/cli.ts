import { constants, type Stats } from "node:fs";
import { access, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAM_TYPES, jsonSchema } from "./input";
import { DEFAULT_SCALE, SCALES, type Scale } from "./raster";
import { render, type Format } from "./render";
import { THEME_NAMES, type ThemeName } from "./theme";

interface Output {
  readonly file: string;
  /** The format the file's extension names. */
  readonly format: Format;
}

type Command =
  | {
      readonly kind: "render";
      /** A file path, or "-" for standard input. */
      readonly input: string;
      /** The files to write. None: the SVG goes to standard output. */
      readonly outputs: readonly Output[];
      /** Wins over the JSON's theme when given. */
      readonly theme?: ThemeName;
      /** False with --no-embed-fonts. Only SVGs embed fonts. */
      readonly embedFonts: boolean;
      /** Only PNGs have a scale. */
      readonly scale?: Scale;
    }
  | { readonly kind: "schema" }
  | { readonly kind: "example"; readonly type: string }
  | { readonly kind: "help" };

const THEMES = THEME_NAMES.join(" or ");
const SCALE_RANGE = `${SCALES[0]}-${SCALES.at(-1)}`;
const SCALE_WORDS = `a whole number from ${SCALES[0]} to ${SCALES.at(-1)}`;
const USAGE =
  `usage: node structa.mjs <diagram.json | -> [-o <file.svg | file.png>]... [--theme ${THEME_NAMES.join("|")}] ` +
  `[--scale ${SCALE_RANGE}] [--no-embed-fonts] | schema | example <type> | --help`;

/** The format each output file extension names, matched in any letter case. */
const EXTENSIONS = new Map<string, Format>([
  [".svg", "svg"],
  [".png", "png"],
]);

/** Short, for agents: the commands, every flag and the exit codes. Update it with every new flag or output. */
const HELP = `Structa draws one diagram, described in JSON, as an SVG or PNG image.

Usage:
  node structa.mjs <diagram.json> [options]  draw the diagram
  node structa.mjs - [options]               read the JSON from stdin
  node structa.mjs schema                    print the input's JSON Schema
  node structa.mjs example <type>            print a working example

Diagram types: ${DIAGRAM_TYPES.join(", ")}

Options:
  -o <file>           write a .svg or .png file, not stdout; repeat for more
  --theme ${THEME_NAMES.join("|")}  draw in this theme; wins over the JSON's "theme"
  --scale ${SCALE_RANGE}         PNG pixels per SVG pixel (default ${DEFAULT_SCALE})
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
  const { outputs, theme, embedFonts, scale } = command;
  const formats: Format[] = outputs.length === 0 ? ["svg"] : [...new Set(outputs.map((output) => output.format))];
  let result: { svg?: string; png?: Uint8Array };
  try {
    // One layout pass draws every output, before any file is written.
    result = await render(json, { formats, theme, embedFonts, scale });
  } catch (error) {
    return fail((error as Error).message);
  }
  if (outputs.length === 0) {
    process.stdout.write(result.svg!);
    return 0;
  }
  return writeAll(outputs.map(({ file, format }) => ({ file, data: result[format]! })));
}

/**
 * Writes every file, in three steps. First each is checked: a folder, or a
 * file that can't be replaced (a read-only one, say), stops the run before
 * anything is written. Then each goes to a temporary file beside it, and only
 * once all of those are written do they take their real names, so a missing
 * folder or a full disk also leaves every file as it was. Only a rename that
 * fails partway, which the checks make rare (another program locking the
 * file, say), leaves the files renamed before it already replaced.
 */
async function writeAll(files: readonly { file: string; data: string | Uint8Array }[]): Promise<number> {
  for (const { file } of files) {
    const problem = await cannotReplace(file);
    if (problem !== undefined) return fail(`can't write ${file}: ${problem}`);
  }
  const temporary = (file: string) => `${file}.${process.pid}.tmp`;
  // The temporary files that may exist, removed on the way out.
  const pending = new Set<string>();
  try {
    for (const { file, data } of files) {
      pending.add(temporary(file));
      try {
        await writeFile(temporary(file), data);
      } catch (error) {
        return fail(`can't write ${file}: ${reason(error)}`);
      }
    }
    for (const { file } of files) {
      try {
        await rename(temporary(file), file);
      } catch (error) {
        return fail(`can't write ${file}: ${reason(error)}`);
      }
      pending.delete(temporary(file));
    }
    return 0;
  } finally {
    await Promise.all([...pending].map((file) => rm(file, { force: true })));
  }
}

/** Why `file` can't be replaced, or undefined when it can or isn't there yet. */
async function cannotReplace(file: string): Promise<string | undefined> {
  let stats: Stats;
  try {
    stats = await stat(file);
  } catch (error) {
    // Nothing there yet. A missing folder shows up when the temporary file is written.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return reason(error);
  }
  if (stats.isDirectory()) return "it is a folder";
  if (!stats.isFile()) return "it isn't a regular file";
  try {
    await access(file, constants.W_OK);
  } catch (error) {
    return reason(error);
  }
  return undefined;
}

/**
 * A file error's reason, such as "EPERM: operation not permitted", without
 * the paths Node adds after it: they would show the temporary file's name.
 */
function reason(error: unknown): string {
  const { message, syscall } = error as NodeJS.ErrnoException;
  return syscall === undefined ? message : message.split(`, ${syscall}`)[0]!;
}

/**
 * The command the arguments describe, or what's wrong with them. --help wins
 * over everything (except as the file name after -o), and the commands win
 * over file names.
 */
function parseArgs(args: readonly string[]): Command | string {
  if (args.some((arg, i) => (arg === "--help" || arg === "-h") && args[i - 1] !== "-o")) return { kind: "help" };
  const outputs: Output[] = [];
  let theme: ThemeName | undefined;
  let embedFonts = true;
  let scale: Scale | undefined;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--no-embed-fonts") {
      embedFonts = false;
    } else if (arg === "-o") {
      const file = args[++i];
      if (file === undefined) return "-o needs a file name";
      const output = readOutput(file, outputs);
      if (typeof output === "string") return output;
      outputs.push(output);
    } else if (arg === "--theme") {
      const name = args[++i];
      if (name === undefined) return `--theme needs ${THEMES}`;
      if (theme !== undefined) return "give --theme only once";
      if (!THEME_NAMES.includes(name as ThemeName)) return `--theme ${JSON.stringify(name)}: the theme must be ${THEMES}`;
      theme = name as ThemeName;
    } else if (arg === "--scale") {
      const value = args[++i];
      if (value === undefined) return `--scale needs ${SCALE_WORDS}`;
      if (scale !== undefined) return "give --scale only once";
      scale = SCALES.find((s) => String(s) === value);
      if (scale === undefined) return `--scale ${JSON.stringify(value)}: the scale must be ${SCALE_WORDS}`;
    } else if (arg.startsWith("-") && arg !== "-") {
      return `unknown option ${JSON.stringify(arg)}`;
    } else {
      words.push(arg);
    }
  }

  const [input, ...rest] = words;
  // The flags that only drawing takes.
  const drawFlags = outputs.length > 0 || theme !== undefined || scale !== undefined || !embedFonts;
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
  return { kind: "render", input, outputs, theme, embedFonts, scale };
}

/** One -o file and its format, or what's wrong with it, given the -o files before it. */
function readOutput(file: string, before: readonly Output[]): Output | string {
  const format = EXTENSIONS.get(extname(file).toLowerCase());
  if (format === undefined) {
    // extname() of a bare ".svg" is empty: the name is all extension.
    const bare = basename(file).toLowerCase();
    if (EXTENSIONS.has(bare)) return `-o ${JSON.stringify(file)}: give it a name before ${bare}`;
    return `-o ${JSON.stringify(file)}: the output file must end in ${[...EXTENSIONS.keys()].join(" or ")}`;
  }
  // Compared in any letter case everywhere, so a run that works on Linux also works on Windows and macOS.
  const same = before.find((output) => resolve(output.file).toLowerCase() === resolve(file).toLowerCase());
  if (same === undefined) return { file, format };
  const pair = `${JSON.stringify(same.file)} and ${JSON.stringify(file)}`;
  if (same.file === file) return `give each -o its own file (${JSON.stringify(file)} is given twice)`;
  if (resolve(same.file) === resolve(file)) return `give each -o its own file (${pair} are the same file)`;
  return `give each -o its own file (${pair} are the same file on Windows and macOS)`;
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
