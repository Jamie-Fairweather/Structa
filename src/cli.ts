import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { render } from "./render";

interface Command {
  /** A file path, or "-" for standard input. */
  readonly input: string;
  /** Where to write the SVG; standard output when absent. */
  readonly output?: string;
}

const USAGE = "usage: node structa.mjs <diagram.json | -> [-o <diagram.svg>]";

/** Runs the command line. Returns the exit code: 0 success, 1 bad input or a failed render, 2 bad usage. */
export async function runCli(args: readonly string[]): Promise<number> {
  const command = parseArgs(args);
  if (typeof command === "string") {
    process.stderr.write(`${command}\n${USAGE}\n`);
    return 2;
  }
  let json: string;
  try {
    json = command.input === "-" ? await readStdin() : await readFile(command.input, "utf8");
  } catch (error) {
    return fail(`can't read ${command.input}: ${(error as Error).message}`);
  }
  let svg: string;
  try {
    ({ svg } = await render(json));
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

/** The command the arguments describe, or what's wrong with them. */
function parseArgs(args: readonly string[]): Command | string {
  let input: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-o") {
      const file = args[++i];
      if (file === undefined) return "-o needs a file name";
      if (output !== undefined) return "give -o only once";
      if (extname(file).toLowerCase() !== ".svg") return `-o ${JSON.stringify(file)}: the output file must end in .svg`;
      output = file;
    } else if (arg.startsWith("-") && arg !== "-") {
      return `unknown option ${JSON.stringify(arg)}`;
    } else if (input !== undefined) {
      return `give one input, not two (${JSON.stringify(input)} and ${JSON.stringify(arg)})`;
    } else {
      input = arg;
    }
  }
  if (input === undefined) return "give the diagram's JSON file, or - to read it from standard input";
  return output === undefined ? { input } : { input, output };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}
