/**
 * Builds the skill folder: our code bundled into one ES module, elkjs's own
 * file copied beside it untouched, and a one-line package.json that makes the
 * folder CommonJS so elkjs's UMD file loads even inside an ESM project.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromRoot = createRequire(join(root, "package.json"));

const MODULE_FILE = "structa.mjs";
const ELK_FILE = "elk.bundled.js";
const PACKAGE_JSON = '{"type":"commonjs"}\n';

/**
 * The pinned elkjs package's own copy of the file we ship, as installed from
 * the lockfile (CI installs with --frozen-lockfile, which checks integrity).
 */
export function installedElkFile(): string {
  return requireFromRoot.resolve(`elkjs/lib/${ELK_FILE}`);
}

/** Builds the skill folder into `outDir`, replacing whatever was there. */
export async function buildSkill(outDir: string): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    absWorkingDir: root,
    entryPoints: ["src/structa.ts"],
    outfile: join(outDir, MODULE_FILE),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Our code only imports elkjs types. Keep it external anyway, so a stray
    // value import can't pull ELK into the bundle (the checks would catch it).
    external: ["elkjs", "elkjs/*"],
    // The loader's path to the sibling elkjs file, and no source-only fallback.
    define: { STRUCTA_ELK_FILE: JSON.stringify(`./${ELK_FILE}`) },
    dropLabels: ["source"],
    logLevel: "warning",
  });
  copyFileSync(installedElkFile(), join(outDir, ELK_FILE));
  writeFileSync(join(outDir, "package.json"), PACKAGE_JSON);

  const problems = checkSkill(outDir);
  if (problems.length > 0) throw new Error(`the skill folder failed its checks:\n${problems.join("\n")}`);
}

/** Text that only ELK's compiled code contains: its Java package names and GWT's runtime markers. */
const ELK_MARKERS = ["org.eclipse.elk.", "$clinit_", "gwtOnLoad", "$wnd.", "com.google.gwt."];
/** A string literal naming the elkjs package or a file in it. */
const ELK_SPECIFIER = /(["'`])elkjs(?:\/[^"'`\s]*)?\1/;
/** A run of this many characters shared with elk.bundled.js counts as copied ELK code. */
const COPIED_RUN = 100;

/**
 * The release-blocking packaging checks on a built skill folder. Returns
 * every problem found; empty means it passes.
 */
export function checkSkill(dir: string): string[] {
  const problems: string[] = [];
  const read = (name: string): Buffer | undefined => {
    const file = join(dir, name);
    if (existsSync(file)) return readFileSync(file);
    problems.push(`${name} is missing`);
    return undefined;
  };
  const module = read(MODULE_FILE)?.toString("utf8");
  const elk = read(ELK_FILE);
  const packageJson = read("package.json")?.toString("utf8");

  if (packageJson !== undefined && packageJson !== PACKAGE_JSON) {
    problems.push(`package.json must be the one line ${PACKAGE_JSON.trim()}`);
  }

  const installed = readFileSync(installedElkFile());
  const { version } = requireFromRoot("elkjs/package.json") as { version: string };
  const pinned = (requireFromRoot("./package.json") as { dependencies: { elkjs: string } }).dependencies.elkjs;
  if (version !== pinned) {
    problems.push(`node_modules has elkjs ${version}, but package.json pins ${pinned}: run bun install --frozen-lockfile`);
  }
  if (elk !== undefined && !elk.equals(installed)) {
    problems.push(`${ELK_FILE} is not byte-for-byte the same as lib/${ELK_FILE} in elkjs ${version}`);
  }

  if (module !== undefined) {
    for (const marker of ELK_MARKERS) {
      if (module.includes(marker)) problems.push(`${MODULE_FILE} contains elkjs code: ${JSON.stringify(marker)}`);
    }
    const specifier = ELK_SPECIFIER.exec(module);
    if (specifier) problems.push(`${MODULE_FILE} names the elkjs package: ${specifier[0]}`);
    const copied = longestSharedRun(module, installed.toString("utf8"));
    if (copied.length >= COPIED_RUN) {
      const start = JSON.stringify(module.slice(copied.at, copied.at + 40));
      problems.push(`${MODULE_FILE} contains ${copied.length} characters copied from ${ELK_FILE}, starting ${start}`);
    }
  }
  return problems;
}

/**
 * The longest run of `text` that also appears in `source`, among runs of at
 * least 2 * WINDOW - 1 characters (shorter ones may be missed). It indexes
 * `source` in windows at every WINDOW-th position: any longer shared run
 * contains one of them whole.
 */
function longestSharedRun(text: string, source: string): { at: number; length: number } {
  const WINDOW = Math.ceil((COPIED_RUN + 1) / 2);
  const windows = new Map<string, number[]>();
  for (let start = 0; start + WINDOW <= source.length; start += WINDOW) {
    const key = source.slice(start, start + WINDOW);
    const starts = windows.get(key);
    if (starts) starts.push(start);
    else windows.set(key, [start]);
  }
  let best = { at: 0, length: 0 };
  for (let i = 0; i + WINDOW <= text.length; i++) {
    for (const start of windows.get(text.slice(i, i + WINDOW)) ?? []) {
      let before = 0;
      while (i > before && start > before && text[i - before - 1] === source[start - before - 1]) before++;
      let after = WINDOW;
      while (i + after < text.length && text[i + after] === source[start + after]) after++;
      if (before + after > best.length) best = { at: i - before, length: before + after };
    }
  }
  return best;
}
