import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import {
  allElements,
  badlyFormattedNumbers,
  cardById,
  lines,
  parseSvg,
  passiveSvgViolations,
} from "./helpers/svg";

const bikeRepair = {
  type: "flow",
  nodes: [
    { id: "find", label: "Find the puncture", shape: "step" },
    { id: "patch", label: "Patch & glue the tube <carefully>", shape: "step" },
    { id: "pump", label: 'Pump to "firm"', shape: "step" },
    { id: "ride", label: "Test ride", shape: "step" },
  ],
  edges: [
    { from: "find", to: "patch" },
    { from: "patch", to: "pump" },
    { from: "pump", to: "ride" },
    { from: "find", to: "ride" },
  ],
};

async function svgOf(input: object): Promise<string> {
  return (await render(input, { embedFonts: false })).svg;
}

describe("SVG output", () => {
  it("stays passive and uses only features the rasteriser supports", async () => {
    expect(passiveSvgViolations(await svgOf(bikeRepair))).toEqual([]);
  });

  it("writes every number through one formatter: at most 2 decimals, no -0, no exponent", async () => {
    expect(badlyFormattedNumbers(await svgOf(bikeRepair))).toEqual([]);
  });

  it("escapes label text so it reads exactly as written", async () => {
    const doc = parseSvg(await svgOf(bikeRepair));

    expect(cardById(doc, "patch").getElementsByTagName("text")[0]!.textContent).toBe("Patch & glue the tube");
    expect(cardById(doc, "pump").getElementsByTagName("title")[0]!.textContent).toBe('Pump to "firm"');
  });

  it("has a whole-pixel size matching its viewBox", async () => {
    const root = parseSvg(await svgOf(bikeRepair)).documentElement!;
    const width = root.getAttribute("width")!;
    const height = root.getAttribute("height")!;

    expect(width).toMatch(/^\d+$/);
    expect(height).toMatch(/^\d+$/);
    expect(root.getAttribute("viewBox")).toBe(`0 0 ${width} ${height}`);
  });

  it("draws the light look: grey background, dotted grid, white rounded cards with a soft shadow, grey lines", async () => {
    const doc = parseSvg(await svgOf(bikeRepair));
    const byId = (id: string) => allElements(doc).find((el) => el.getAttribute("id") === id)!;
    const refId = (value: string | null) => /^url\(#(.+)\)$/.exec(value ?? "")![1]!;
    const rects = allElements(doc).filter((el) => el.localName === "rect");

    // Background, then the dot grid over it.
    expect(rects[0]!.getAttribute("fill")).toBe("#f4f5f7");
    const grid = byId(refId(rects[1]!.getAttribute("fill")));
    expect([grid.getAttribute("width"), grid.getAttribute("height")]).toEqual(["18", "18"]);
    const dot = grid.getElementsByTagName("circle")[0]!;
    expect([dot.getAttribute("r"), dot.getAttribute("fill"), dot.getAttribute("fill-opacity")]).toEqual([
      "1",
      "#8c959f",
      "0.5",
    ]);

    // Cards: white, #d1d9e0 border, 10px corners, a drop shadow, #1f2328 text.
    const card = cardById(doc, "find");
    const outline = card.getElementsByTagName("rect")[0]!;
    expect(outline.getAttribute("fill")).toBe("#ffffff");
    expect(outline.getAttribute("stroke")).toBe("#d1d9e0");
    expect(outline.getAttribute("rx")).toBe("10");
    const shadow = byId(refId(outline.getAttribute("filter")));
    expect(shadow.getElementsByTagName("feDropShadow")).toHaveLength(1);
    expect(card.getElementsByTagName("text")[0]!.getAttribute("fill")).toBe("#1f2328");

    // Lines: #8c959f stroke and a filled arrowhead in the same colour.
    for (const line of lines(doc)) {
      const [route, arrow] = Array.from(line.getElementsByTagName("path"));
      expect([route!.getAttribute("fill"), route!.getAttribute("stroke")]).toEqual(["none", "#8c959f"]);
      expect(arrow!.getAttribute("fill")).toBe("#8c959f");
    }
  });
});
