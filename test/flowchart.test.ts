import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { cards, parseSvg, textLines, titleOf } from "./helpers/svg";

const opts = { embedFonts: false } as const;

describe("step-only flowcharts", () => {
  it("draws a one-step flowchart as an SVG with one card", async () => {
    const { svg } = await render(
      { type: "flow", nodes: [{ id: "water", label: "Water the seedlings", shape: "step" }] },
      opts,
    );

    const doc = parseSvg(svg);
    const found = cards(doc);
    expect(found).toHaveLength(1);
    const card = found[0]!;
    expect(card.getAttribute("data-id")).toBe("water");
    expect(card.getAttribute("data-kind")).toBe("step");
    expect(titleOf(card)).toBe("Water the seedlings");
    expect(textLines(card)).toEqual(["Water the seedlings"]);
  });
});
