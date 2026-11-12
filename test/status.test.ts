import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { badgeBox, byClassIn, cardBox, cardById, cards, parseSvg, textLines } from "./helpers/svg";

const opts = { embedFonts: false } as const;

/** A short flowchart for planting a hedge; tests give its steps and lines statuses. */
function hedge(statuses: readonly (string | undefined)[] = []) {
  const steps = [
    { id: "mark", label: "Mark out the line" },
    { id: "trench", label: "Dig a trench" },
    { id: "plant", label: "Plant the whips" },
    { id: "mulch", label: "Mulch around the roots" },
  ];
  return {
    type: "flow",
    nodes: steps.map((step, i) => ({ ...step, shape: "step", ...(statuses[i] ? { status: statuses[i] } : {}) })),
    edges: [
      { from: "mark", to: "trench" },
      { from: "trench", to: "plant" },
      { from: "plant", to: "mulch" },
    ],
  };
}

async function svgDoc(input: object, theme?: "light" | "dark") {
  return parseSvg((await render(input, { ...opts, ...(theme ? { theme } : {}) })).svg);
}

describe("card status", () => {
  it.each([
    ["new", "NEW"],
    ["changed", "CHANGED"],
    ["removed", "REMOVED"],
    ["unchanged", "UNCHANGED"],
  ])("puts a %s card's badge on its top-right border", async (status, word) => {
    const doc = await svgDoc(hedge([undefined, status]));

    const card = cardById(doc, "trench");
    expect(card.getAttribute("data-status")).toBe(status);
    const outline = cardBox(card);
    const badge = badgeBox(card)!;
    expect(textLines(card)).toContain(word);
    // Centred on the top border, inside the card's width and nearer its right-hand end.
    expect(badge.y + badge.height / 2).toBeCloseTo(outline.y, 5);
    const gapLeft = badge.x - outline.x;
    const gapRight = outline.x + outline.width - (badge.x + badge.width);
    expect(gapRight).toBeGreaterThan(0);
    expect(gapLeft).toBeGreaterThan(gapRight);
  });

  it("gives a card without a status no badge and no status attribute", async () => {
    const doc = await svgDoc(hedge([undefined, "new"]));

    const card = cardById(doc, "mark");
    expect(card.hasAttribute("data-status")).toBe(false);
    expect(badgeBox(card)).toBeUndefined();
    expect(textLines(card)).toEqual(["Mark out the line"]);
  });

  // The spec's GitHub Primer table: stroke, badge fill (and its strength), badge text.
  it.each([
    ["light", "new", "#1f883d", "#b9f0c4", null, "#116329"],
    ["light", "changed", "#bf8700", "#fae17d", null, "#7d4e00"],
    ["light", "removed", "#cf222e", "#ffcecb", null, "#a40e26"],
    ["light", "unchanged", "#8c959f", "#eaeef2", null, "#59636e"],
    ["dark", "new", "#3fb950", "#3fb950", "0.25", "#56d364"],
    ["dark", "changed", "#d29922", "#d29922", "0.25", "#e3b341"],
    ["dark", "removed", "#f85149", "#f85149", "0.25", "#ff7b72"],
    ["dark", "unchanged", "#6e7681", "#6e7681", "0.25", "#8b949e"],
  ] as const)("colours a %s-theme %s card's border and badge", async (theme, status, stroke, fill, strength, word) => {
    const doc = await svgDoc(hedge([status]), theme);

    const card = cardById(doc, "mark");
    expect(card.getElementsByTagName("rect")[0]!.getAttribute("stroke")).toBe(stroke);
    const badge = byClassIn(card, "badge")[0]!;
    const [backing, pill] = Array.from(badge.getElementsByTagName("rect"));
    // An opaque backing in the card colour, so the border doesn't show through the badge.
    expect(backing!.getAttribute("fill")).toBe(theme === "light" ? "#ffffff" : "#161b22");
    expect([pill!.getAttribute("fill"), pill!.getAttribute("fill-opacity"), pill!.getAttribute("stroke")]).toEqual([
      fill,
      strength,
      stroke,
    ]);
    expect(badge.getElementsByTagName("text")[0]!.getAttribute("fill")).toBe(word);
  });

  it("keeps the plain border on a card without a status, in both themes", async () => {
    for (const [theme, border] of [["light", "#d1d9e0"], ["dark", "#30363d"]] as const) {
      const doc = await svgDoc(hedge(["new"]), theme);

      expect(cardById(doc, "trench").getElementsByTagName("rect")[0]!.getAttribute("stroke")).toBe(border);
    }
  });

  it("draws every card exactly once with its own status", async () => {
    const statuses = ["unchanged", "changed", "new", undefined];
    const doc = await svgDoc(hedge(statuses));

    expect(cards(doc).map((c) => [c.getAttribute("data-id"), c.getAttribute("data-status")])).toEqual([
      ["mark", "unchanged"],
      ["trench", "changed"],
      ["plant", "new"],
      ["mulch", null],
    ]);
  });
});
