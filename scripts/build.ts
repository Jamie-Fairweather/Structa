/**
 * Builds the skill folder into dist/structa: structa.mjs, elkjs's untouched
 * elk.bundled.js and a one-line CommonJS package.json.
 *
 * Run with: bun run build
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkill } from "./lib/skill";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "structa");

await buildSkill(outDir);
console.log(`built ${relative(root, outDir)}`);
