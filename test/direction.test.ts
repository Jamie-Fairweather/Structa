import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { cardBox, cardById, parseSvg, type Box } from "./helpers/svg";

const opts = { embedFonts: false } as const;

/** A three-step chain: soak, then sow, then cover. */
function chain(direction?: string) {
  return {
    type: "flow",
    ...(direction === undefined ? {} : { direction }),
    nodes: [
      { id: "soak", label: "Soak the beans overnight", shape: "step" },
      { id: "sow", label: "Sow them in pots", shape: "step" },
      { id: "cover", label: "Cover with fleece", shape: "step" },
    ],
    edges: [
      { from: "soak", to: "sow" },
      { from: "sow", to: "cover" },
    ],
  };
}

async function boxes(input: object, ids: readonly string[]): Promise<Box[]> {
  const doc = parseSvg((await render(input, opts)).svg);
  return ids.map((id) => cardBox(cardById(doc, id)));
}

describe("direction", () => {
  it("runs top to bottom by default", async () => {
    const [soak, sow, cover] = await boxes(chain(), ["soak", "sow", "cover"]);

    expect(sow!.y).toBeGreaterThanOrEqual(soak!.y + soak!.height);
    expect(cover!.y).toBeGreaterThanOrEqual(sow!.y + sow!.height);
  });

  it("runs top to bottom with direction down", async () => {
    const [soak, sow, cover] = await boxes(chain("down"), ["soak", "sow", "cover"]);

    expect(sow!.y).toBeGreaterThanOrEqual(soak!.y + soak!.height);
    expect(cover!.y).toBeGreaterThanOrEqual(sow!.y + sow!.height);
  });

  it("runs left to right with direction right", async () => {
    const [soak, sow, cover] = await boxes(chain("right"), ["soak", "sow", "cover"]);

    expect(sow!.x).toBeGreaterThanOrEqual(soak!.x + soak!.width);
    expect(cover!.x).toBeGreaterThanOrEqual(sow!.x + sow!.width);
  });
});
