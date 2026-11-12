/**
 * Builds the skill folder: our code bundled into one ES module, elkjs's own
 * file copied beside it untouched, and a one-line package.json that makes the
 * folder CommonJS so elkjs's UMD file loads even inside an ESM project.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODULE_FILE = "structa.mjs";
const ELK_FILE = "elk.bundled.js";
const PACKAGE_JSON = '{"type":"commonjs"}\n';

/**
 * The elkjs release we ship, and the SHA-256 of lib/elk.bundled.js in its
 * published npm tarball. The build fails unless package.json pins exactly
 * this version and the shipped file has exactly this hash, so upgrading
 * elkjs means changing both here on purpose.
 */
const PUBLISHED_ELK = {
  version: "0.12.1",
  sha256: "b1032b7cfd2a57c54c6f0e8369d7665e19a579954f7cd20a6dae28f1912ea0d7",
};

/**
 * Builds the skill folder from the project at `project` (this repository;
 * tests pass a changed copy) into `outDir`, replacing whatever was there.
 * Throws, listing every problem, if the folder fails the packaging checks.
 */
export async function buildSkill(outDir: string, project: string = repository): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    absWorkingDir: project,
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
  const elkPackage = dirname(createRequire(join(project, "package.json")).resolve("elkjs/package.json"));
  copyFileSync(join(elkPackage, "lib", ELK_FILE), join(outDir, ELK_FILE));
  writeFileSync(join(outDir, "package.json"), PACKAGE_JSON);

  const problems = checkSkill(outDir, project, elkPackage);
  if (problems.length > 0) throw new Error(`the skill folder failed its checks:\n${problems.join("\n")}`);
}

/** Text that only ELK's compiled code contains: its Java package names and GWT's runtime markers. */
const ELK_MARKERS = ["org.eclipse.elk.", "$clinit_", "gwtOnLoad", "$wnd.", "com.google.gwt."];
/** A string literal naming the elkjs package or a file in it. */
const ELK_SPECIFIER = /(["'`])elkjs(?:\/[^"'`\s]*)?\1/;
/** A package.json patchedDependencies, overrides or resolutions key for elkjs, with or without a version or a parent path. */
const ELK_KEY = /(?:^|\/)elkjs(?:@|$)/;
/** A run of this many characters shared with elk.bundled.js counts as copied ELK code. */
const COPIED_RUN = 100;

interface Manifest {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly patchedDependencies?: Readonly<Record<string, unknown>>;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly resolutions?: Readonly<Record<string, unknown>>;
}

/**
 * The release-blocking packaging checks on the skill folder built from
 * `project`, whose installed elkjs is at `elkPackage`. Returns every
 * problem found; empty means it passes.
 */
function checkSkill(dir: string, project: string, elkPackage: string): string[] {
  const problems: string[] = [];
  const readJson = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

  const manifest = readJson(join(project, "package.json"));
  const pinned = manifest.dependencies?.elkjs;
  if (pinned !== PUBLISHED_ELK.version) {
    problems.push(
      `package.json pins elkjs ${pinned}, but the build only knows the published ${ELK_FILE} of elkjs ${PUBLISHED_ELK.version}: ` +
        `to upgrade, update PUBLISHED_ELK in scripts/lib/skill.ts with the new version and its file's SHA-256`,
    );
  }
  for (const field of ["patchedDependencies", "overrides", "resolutions"] as const) {
    for (const key of Object.keys(manifest[field] ?? {})) {
      if (ELK_KEY.test(key)) problems.push(`package.json ${field} changes elkjs (${JSON.stringify(key)}): ship the published elkjs unchanged`);
    }
  }
  const { version } = readJson(join(elkPackage, "package.json"));
  if (version !== pinned) {
    problems.push(`node_modules has elkjs ${version}, but package.json pins ${pinned}: run bun install --frozen-lockfile`);
  }
  const elk = readFileSync(join(dir, ELK_FILE));
  const sha256 = createHash("sha256").update(elk).digest("hex");
  if (sha256 !== PUBLISHED_ELK.sha256) {
    problems.push(
      `${ELK_FILE} is not byte-for-byte lib/${ELK_FILE} from the published elkjs ${PUBLISHED_ELK.version}: ` +
        `its SHA-256 is ${sha256}, not ${PUBLISHED_ELK.sha256}`,
    );
  }

  const module = readFileSync(join(dir, MODULE_FILE), "utf8");
  for (const marker of ELK_MARKERS) {
    if (module.includes(marker)) problems.push(`${MODULE_FILE} contains elkjs code: ${JSON.stringify(marker)}`);
  }
  const specifier = ELK_SPECIFIER.exec(module);
  if (specifier) problems.push(`${MODULE_FILE} names the elkjs package: ${specifier[0]}`);
  const copied = longestSharedRun(module, elk.toString("utf8"));
  if (copied.length >= COPIED_RUN) {
    const start = JSON.stringify(module.slice(copied.at, copied.at + 40));
    problems.push(`${MODULE_FILE} contains ${copied.length} characters copied from ${ELK_FILE}, starting ${start}`);
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
  // 2 * WINDOW - 1 <= COPIED_RUN, so every run of COPIED_RUN characters is found.
  const WINDOW = Math.floor((COPIED_RUN + 1) / 2);
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
