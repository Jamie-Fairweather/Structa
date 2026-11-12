import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkill } from "../../scripts/lib/skill";

const repository = fileURLToPath(new URL("../..", import.meta.url));

/** Everything the build reads from the project. Add to this when the build starts reading something new. */
const BUILD_INPUTS = [
  "src",
  "generated",
  "examples",
  "licenses",
  "LICENSE",
  "fonts/inter/OFL.txt",
  "fonts/jetbrains-mono/OFL.txt",
  "package.json",
  "tsconfig.json",
  "node_modules/elkjs/package.json",
  "node_modules/elkjs/LICENSE.md",
  "node_modules/elkjs/lib/elk.bundled.js",
  "node_modules/@resvg/resvg-wasm",
];

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** Text is sent as UTF-8; bytes are sent as they are. */
  readonly stdin?: string | Uint8Array;
}

export interface BuiltSkill {
  /** The built skill folder, inside a project whose package.json says "type": "module". */
  readonly dir: string;
  /** A folder outside the skill folder, where every run starts. */
  readonly elsewhere: string;
  /** Runs `node <dir>/structa.mjs ...args` from `elsewhere` with this Node. */
  run(args: readonly string[], options?: RunOptions & { readonly dir?: string }): RunResult;
  /** Runs `node ...args` from `elsewhere` with this Node. */
  node(args: readonly string[], options?: RunOptions): RunResult;
  /** Removes everything the build made. */
  remove(): void;
}

/**
 * Builds the skill folder the way a user would drop it in: under a project
 * whose package.json says "type": "module" and whose node_modules holds a
 * decoy elkjs that throws if anything loads it.
 */
export async function buildSkillForTest(): Promise<BuiltSkill> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "structa-skill-")));
  const project = join(root, "project");
  const dir = join(project, "skills", "structa");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  mkdirSync(join(project, "node_modules", "elkjs", "lib"), { recursive: true });
  writeFileSync(join(project, "package.json"), '{ "name": "someone-elses-project", "type": "module" }\n');
  const decoy = 'throw new Error("loaded the decoy elkjs from node_modules");\n';
  writeFileSync(join(project, "node_modules", "elkjs", "package.json"), '{ "name": "elkjs", "version": "0.0.0" }\n');
  writeFileSync(join(project, "node_modules", "elkjs", "index.js"), decoy);
  writeFileSync(join(project, "node_modules", "elkjs", "lib", "elk.bundled.js"), decoy);

  await buildSkill(dir);

  const node = (args: readonly string[], options: RunOptions = {}): RunResult => {
    const result = spawnSync(process.execPath, args, {
      cwd: elsewhere,
      input: options.stdin ?? "",
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  return {
    dir,
    elsewhere,
    node,
    run: (args, options = {}) => node([join(options.dir ?? dir, "structa.mjs"), ...args], options),
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Copies the build's inputs from this repository into a temporary project,
 * lets `change` alter the copy, and builds the skill folder from it, as
 * `bun run build` would. Returns the build's error message, or "" when the
 * build succeeds.
 */
export async function buildChangedProject(change: (project: string) => void): Promise<string> {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "structa-project-")));
  try {
    for (const input of BUILD_INPUTS) cpSync(join(repository, input), join(project, input), { recursive: true });
    change(project);
    try {
      await buildSkill(join(project, "dist", "structa"), project);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
