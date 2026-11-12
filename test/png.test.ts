import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { decodePng, svgSize } from "./helpers/png";

const pottingOn = {
  type: "flow",
  nodes: [
    { id: "water", label: "Water the seedlings", shape: "step" },
    { id: "lift", label: "Lift each one by a leaf", shape: "step" },
    { id: "pot", label: "Pot it on into a bigger pot", shape: "step" },
  ],
  edges: [
    { from: "water", to: "lift" },
    { from: "lift", to: "pot" },
  ],
};

describe("PNG output", () => {
  it("returns a PNG that decodes, twice the SVG's size by default", async () => {
    const { svg, png } = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false });

    const picture = decodePng(png);
    const size = svgSize(svg);
    expect([picture.width, picture.height]).toEqual([size.width * 2, size.height * 2]);
  });

  it("returns only the png key, as a plain Uint8Array, when only png is asked for", async () => {
    const result = await render(pottingOn, { formats: ["png"] });

    expect(Object.keys(result)).toEqual(["png"]);
    expect(Object.getPrototypeOf(result.png)).toBe(Uint8Array.prototype);
  });

  it.each([1, 2, 3, 4])("makes the PNG exactly %i times the SVG's whole-pixel size", async (scale) => {
    const { svg, png } = await render(pottingOn, { formats: ["svg", "png"], embedFonts: false, scale });

    const picture = decodePng(png);
    const size = svgSize(svg);
    expect([picture.width, picture.height]).toEqual([size.width * scale, size.height * scale]);
  });
});
