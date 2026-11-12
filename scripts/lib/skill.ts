/**
 * Builds the skill folder: our code bundled into one ES module, elkjs's own
 * file copied beside it untouched, and a one-line package.json that makes the
 * folder CommonJS so elkjs's UMD file loads even inside an ESM project.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MODULE_FILE = "structa.mjs";
export const ELK_FILE = "elk.bundled.js";
export const PACKAGE_JSON = '{"type":"commonjs"}\n';

/** The pinned elkjs package's own copy of the file we ship. */
export function installedElkFile(): string {
  return createRequire(join(root, "package.json")).resolve(`elkjs/lib/${ELK_FILE}`);
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
}
