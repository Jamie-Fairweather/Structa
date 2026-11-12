import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { badlyFormattedNumbers, passiveSvgViolations } from "./helpers/svg";

// Every file in examples/ is a snapshot fixture. Snapshots are real .svg files,
// so a reviewer can open them; update them only for output changes you intend.
const examplesDir = new URL("../examples/", import.meta.url);
const examples = readdirSync(examplesDir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({ name: file.slice(0, -".json".length), json: readFileSync(new URL(file, examplesDir), "utf8") }));

describe("examples", () => {
  it("has at least one example", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  // Every example in both themes. The theme option wins over any theme in the example's JSON.
  describe.each(examples)("$name", ({ name, json }) => {
    describe.each(["light", "dark"] as const)("in %s", (theme) => {
      it("matches its snapshot", async () => {
        const { svg } = await render(json, { embedFonts: false, theme });

        await expect(svg).toMatchFileSnapshot(`__snapshots__/examples/${name}.${theme}.svg`);
      });

      it("passes the SVG rules", async () => {
        const { svg } = await render(json, { embedFonts: false, theme });

        expect(passiveSvgViolations(svg)).toEqual([]);
        expect(badlyFormattedNumbers(svg)).toEqual([]);
      });
    });
  });
});

describe("determinism", () => {
  const seedTray = {
    type: "flow",
    nodes: [
      { id: "fill", label: "Fill the tray with compost", shape: "step" },
      { id: "sow", label: "Sow two seeds per cell", shape: "step" },
      { id: "cover", label: "Cover with a clear lid", shape: "step" },
    ],
    edges: [
      { from: "fill", to: "sow" },
      { from: "sow", to: "cover" },
    ],
  };

  it("gives identical bytes for A, then B, then A again in one process", async () => {
    const a = examples[0]!.json;

    const first = await render(a, { embedFonts: false });
    const other = await render(seedTray, { embedFonts: false });
    const again = await render(a, { embedFonts: false });

    expect(other.svg).not.toBe(first.svg);
    expect(again.svg).toBe(first.svg);
  });

  it("gives the same bytes when renders run at the same time", async () => {
    const a = examples[0]!.json;
    const alone = await render(a, { embedFonts: false });

    const together = await Promise.all([
      render(a, { embedFonts: false }),
      render(seedTray, { embedFonts: false }),
      render(a, { embedFonts: false }),
    ]);

    expect(together[0].svg).toBe(alone.svg);
    expect(together[2].svg).toBe(alone.svg);
  });
});
