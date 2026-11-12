import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { cardById, outlineBox, parseSvg, type Box } from "./helpers/svg";

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
  return ids.map((id) => outlineBox(cardById(doc, id)));
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

describe("node order", () => {
  /** One step followed by three, with the three listed in the given order. */
  function harvest(order: readonly string[]) {
    const steps = new Map([
      ["wash", "Wash the carrots"],
      ["dry", "Dry them on a rack"],
      ["store", "Store them in sand"],
    ]);
    return {
      type: "flow",
      nodes: [
        { id: "pull", label: "Pull the carrots", shape: "step" },
        ...order.map((id) => ({ id, label: steps.get(id)!, shape: "step" })),
      ],
      edges: [
        { from: "pull", to: "wash" },
        { from: "pull", to: "dry" },
        { from: "pull", to: "store" },
      ],
    };
  }

  it.each([[["wash", "dry", "store"]], [["store", "dry", "wash"]], [["dry", "store", "wash"]]])(
    "places side-by-side cards in the order the nodes are listed: %j",
    async (order) => {
      const placed = await boxes(harvest(order), order);

      expect(placed[1]!.x).toBeGreaterThan(placed[0]!.x);
      expect(placed[2]!.x).toBeGreaterThan(placed[1]!.x);
    },
  );

  it("is only a hint: connections still win over the listed order", async () => {
    // Listing "tie" before "net" asks for tie on the left, but that would cross
    // the two lines, so tie stays under its own parent on the right.
    const [net, tie] = await boxes(
      {
        type: "flow",
        nodes: [
          { id: "hoops", label: "Bend the hoops", shape: "step" },
          { id: "stakes", label: "Drive in the stakes", shape: "step" },
          { id: "tie", label: "Tie the canes", shape: "step" },
          { id: "net", label: "Pin the netting", shape: "step" },
        ],
        edges: [
          { from: "hoops", to: "net" },
          { from: "stakes", to: "tie" },
        ],
      },
      ["net", "tie"],
    );

    expect(tie!.x).toBeGreaterThan(net!.x);
  });
});
