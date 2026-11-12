import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { badgeBox, byClassIn, cardBox, cardById, cards, overlaps, parseSvg, textLines } from "./helpers/svg";

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

  it("fades a removed card's outline and text, but not its badge", async () => {
    const doc = await svgDoc(hedge(["removed", "changed"]));

    const removed = cardById(doc, "mark");
    const outline = removed.getElementsByTagName("rect")[0]!;
    const faded = outline.parentNode as Element;
    expect(faded.getAttribute("class")).toBe("faded");
    expect(Number(faded.getAttribute("opacity"))).toBeGreaterThan(0.3);
    expect(Number(faded.getAttribute("opacity"))).toBeLessThan(0.7);
    expect(Array.from(faded.getElementsByTagName("text")).map((t) => t.textContent)).toEqual(["Mark out the line"]);
    expect(byClassIn(faded, "badge")).toEqual([]);
    expect(byClassIn(removed, "badge")).toHaveLength(1);

    expect(byClassIn(cardById(doc, "trench"), "faded")).toEqual([]);
  });

  it("strikes through every line of a removed card's title", async () => {
    const input = hedge(["removed", "removed"]);
    input.nodes[1]!.label = "Dig a trench a spade deep and a spade wide along the whole line";
    const doc = await svgDoc(input);

    for (const id of ["mark", "trench"]) {
      const card = cardById(doc, id);
      const texts = Array.from(byClassIn(card, "faded")[0]!.getElementsByTagName("text"));
      const strikes = byClassIn(card, "strike");
      expect(strikes).toHaveLength(texts.length);
      texts.forEach((t, i) => {
        const strike = strikes[i]!;
        const [x1, x2, y1, y2] = ["x1", "x2", "y1", "y2"].map((name) => Number(strike.getAttribute(name)));
        const x = Number(t.getAttribute("x"));
        const baseline = Number(t.getAttribute("y"));
        const size = Number(t.getAttribute("font-size"));
        // Level, through the middle of the letters, centred on the centred text, in the text's colour.
        expect(y1).toBe(y2);
        expect(y1).toBeLessThan(baseline - size * 0.15);
        expect(y1).toBeGreaterThan(baseline - size * 0.5);
        expect((x1! + x2!) / 2).toBeCloseTo(x, 1);
        expect(x2! - x1!).toBeGreaterThan(size);
        expect(strike.getAttribute("stroke")).toBe(t.getAttribute("fill"));
      });
    }
    // A longer line of text gets a longer strike.
    const length = (s: Element) => Number(s.getAttribute("x2")) - Number(s.getAttribute("x1"));
    const [first] = byClassIn(cardById(doc, "trench"), "strike");
    expect(length(first!)).toBeGreaterThan(length(byClassIn(cardById(doc, "mark"), "strike")[0]!));
  });

  it("strikes through nothing on cards that aren't removed", async () => {
    const doc = await svgDoc(hedge(["new", "changed", "unchanged"]));

    for (const card of cards(doc)) expect(byClassIn(card, "strike")).toEqual([]);
  });

  /** One step that fans out to five, with statuses on some of them. */
  function fanOut(direction: "down" | "right") {
    const crops = ["beans", "peas", "kale", "leeks", "chard"];
    const statuses = ["unchanged", "new", undefined, "removed", "changed"];
    return {
      type: "flow",
      direction,
      nodes: [
        { id: "sow", label: "Sow the spring crops", shape: "step", status: "changed" },
        ...crops.map((crop, i) => ({
          id: crop,
          label: `Sow the ${crop}`,
          shape: "step",
          ...(statuses[i] ? { status: statuses[i] } : {}),
        })),
      ],
      edges: crops.map((crop) => ({ from: "sow", to: crop })),
    };
  }

  it.each(["down", "right"] as const)("keeps cards and their badges apart, direction %s", async (direction) => {
    const doc = await svgDoc(fanOut(direction));

    const extents = cards(doc).map((card) => {
      const parts = [cardBox(card), badgeBox(card)].filter((box) => box !== undefined);
      const x = Math.min(...parts.map((b) => b.x));
      const y = Math.min(...parts.map((b) => b.y));
      const right = Math.max(...parts.map((b) => b.x + b.width));
      const bottom = Math.max(...parts.map((b) => b.y + b.height));
      return { id: card.getAttribute("data-id"), box: { x, y, width: right - x, height: bottom - y } };
    });
    for (const a of extents) {
      for (const b of extents) if (a !== b) expect(overlaps(a.box, b.box), `${a.id} and ${b.id}`).toBe(false);
    }
  });

  it("lines up the outlines of cards side by side, with or without a badge", async () => {
    const doc = await svgDoc(fanOut("down"));

    const tops = new Set(["beans", "peas", "kale", "leeks", "chard"].map((id) => cardBox(cardById(doc, id)).y));
    expect(tops.size).toBe(1);
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
