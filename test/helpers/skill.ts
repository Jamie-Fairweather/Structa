import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkill } from "../../scripts/lib/skill";

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly stdin?: string;
  readonly cwd?: string;
}

export interface BuiltSkill {
  /** The built skill folder, inside a project whose package.json says "type": "module". */
  readonly dir: string;
  /** A folder outside the skill folder, where every run starts. */
  readonly elsewhere: string;
  /** Runs `node <dir>/structa.mjs ...args` from `elsewhere` (or `cwd`) with this Node. */
  run(args: readonly string[], options?: RunOptions & { readonly dir?: string }): RunResult;
  /** Runs `node ...args` from `elsewhere` (or `cwd`) with this Node. */
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
      cwd: options.cwd ?? elsewhere,
      input: options.stdin ?? "",
      encoding: "utf8",
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
