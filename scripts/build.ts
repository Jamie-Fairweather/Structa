/**
 * Builds the skill folder into dist/structa: structa.mjs, elkjs's untouched
 * elk.bundled.js and a one-line CommonJS package.json. Fails if the folder
 * doesn't pass the packaging checks.
 *
 * Run with: bun run build
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkill } from "./lib/skill";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "structa");

try {
  await buildSkill(outDir);
  console.log(`built ${relative(root, outDir)}`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
