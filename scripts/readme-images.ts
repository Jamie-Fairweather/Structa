// Draws the README's pictures with the built structa.mjs, in light and dark.
// Run `bun run readme-images` after a change to how diagrams look.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const cli = join(root, "dist", "structa", "structa.mjs");
const out = join(root, "docs", "images");

/** Each picture: the JSON it is drawn from, and the file name it is saved under. */
const PICTURES = [
  { source: "docs/readme/quick-start.json", name: "quick-start" },
  { source: "examples/class-status.json", name: "class-status" },
  { source: "examples/architecture-change-map.json", name: "architecture-change-map" },
  { source: "examples/er-status.json", name: "er-status" },
  { source: "examples/flow-status.json", name: "flow-status" },
  { source: "examples/class-hierarchy.json", name: "class-hierarchy" },
] as const;

mkdirSync(out, { recursive: true });
for (const { source, name } of PICTURES) {
  for (const theme of ["light", "dark"] as const) {
    const file = join(out, `${name}-${theme}.svg`);
    // Plain Node, as agents run it: elkjs hangs under Bun.
    execFileSync("node", [cli, join(root, source), "--theme", theme, "-o", file], { stdio: "inherit" });
    console.log(`wrote ${file}`);
  }
}
