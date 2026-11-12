/**
 * Writes dist/gallery/index.html: every example in light and dark, side by
 * side, for checking the look by eye. Each picture is drawn by the built
 * structa.mjs, run with node and --theme, so the page shows exactly what the
 * shipped tool draws. (Rendering here under Bun would also never exit:
 * elkjs leaves a message listener behind when a global `self` exists.)
 *
 * Run with: bun run gallery (it builds the skill folder first)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const structa = join(root, "dist", "structa", "structa.mjs");
const examplesDir = join(root, "examples");
const outDir = join(root, "dist", "gallery");
const THEMES = ["light", "dark"] as const;

interface Picture {
  readonly theme: (typeof THEMES)[number];
  /** The SVG's file name, next to index.html. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sections = examples.map((example) => {
  const name = example.slice(0, -".json".length);
  const pictures = THEMES.map((theme) => draw(example, `${name}.${theme}.svg`, theme));
  return section(example, pictures);
});
const index = join(outDir, "index.html");
writeFileSync(index, page(sections));
console.log(`wrote ${relative(root, index)}: ${examples.length} examples in light and dark`);
console.log(`open it in a browser: ${pathToFileURL(index).href}`);

/** Draws one example in one theme with the built tool, and reads the picture's size back. */
function draw(example: string, file: string, theme: Picture["theme"]): Picture {
  const out = join(outDir, file);
  const result = spawnSync("node", [structa, join(examplesDir, example), "--theme", theme, "-o", out], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    console.error(`can't draw examples/${example} in ${theme}: ${result.error?.message ?? result.stderr.trim()}`);
    process.exit(1);
  }
  const svg = readFileSync(out, "utf8");
  const size = /^<svg [^>]*width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  if (!size) throw new Error(`${file} doesn't start with an <svg> that has a width and height`);
  return { theme, file, width: Number(size[1]), height: Number(size[2]) };
}

function section(example: string, pictures: readonly Picture[]): string {
  const figures = pictures.map(
    ({ theme, file, width, height }) =>
      `<figure><figcaption>${theme}</figcaption>` +
      `<a href="${escape(file)}"><img src="${escape(file)}" width="${width}" height="${height}" alt="examples/${escape(example)} in the ${theme} theme"></a>` +
      "</figure>",
  );
  return `<section>\n<h2>examples/${escape(example)}</h2>\n<div class="pair">\n${figures.join("\n")}\n</div>\n</section>`;
}

function page(sections: readonly string[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Structa gallery</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #e6e8eb; color: #1f2328; font: 15px/1.5 system-ui, sans-serif; }
  h1 { margin: 0; font-size: 22px; }
  header p { margin: 4px 0 32px; color: #59636e; }
  section { margin: 0 0 40px; }
  h2 { margin: 0 0 12px; font: 600 15px/1.4 ui-monospace, Consolas, "SF Mono", monospace; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  figure { margin: 0; }
  figcaption { margin: 0 0 6px; font-size: 13px; color: #59636e; }
  img { display: block; max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2); }
  @media (max-width: 720px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
<h1>Structa gallery</h1>
<p>Every example, drawn by the built structa.mjs in the light and dark themes. Click a picture to open it at full size.</p>
</header>
${sections.join("\n")}
</body>
</html>
`;
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
