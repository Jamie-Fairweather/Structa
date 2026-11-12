/**
 * Builds the skill folder into dist/structa, failing on any release-blocking
 * check, then zips it into dist/structa.zip and writes the notes the release
 * job publishes it with, dist/release-notes.md.
 *
 * Run with: bun run release
 */
import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkill, RELEASE_LICENSE, zipSkill } from "./lib/skill";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "structa");
const zipFile = join(root, "dist", "structa.zip");
const notesFile = join(root, "dist", "release-notes.md");

const notes = [
  "Unzip `structa.zip` into your skills folder: it holds a ready-to-use `structa` skill folder.",
  "Agents then run `node structa.mjs diagram.json -o diagram.png` in it, with Node 20 or newer and nothing to install.",
  "",
  `Licence of the zip: \`${RELEASE_LICENSE}\`.`,
  "Structa's own code is MIT. The licence texts and source notes for the parts it ships are in `structa/licenses/`.",
  "",
].join("\n");

try {
  await buildSkill(outDir);
  writeFileSync(zipFile, zipSkill(outDir));
  writeFileSync(notesFile, notes);
  console.log(`built ${relative(root, outDir)}, zipped it into ${relative(root, zipFile)} and wrote ${relative(root, notesFile)}`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
