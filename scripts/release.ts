/**
 * Makes the release in dist/: builds the skill folder into dist/structa,
 * failing on any release-blocking check, then zips it into dist/structa.zip
 * and writes the notes the release job publishes it with,
 * dist/release-notes.md.
 *
 * Run with: bun run release
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseSkill } from "./lib/skill";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const { folder, zip, notes } = await releaseSkill(join(root, "dist"));
  console.log(`built ${relative(root, folder)}, zipped it into ${relative(root, zip)} and wrote ${relative(root, notes)}`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
