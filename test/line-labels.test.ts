import type { Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { byClassIn, cardBox, cards, lines, overlaps, parsePath, parseSvg, titleOf, type Box, type Point } from "./helpers/svg";

const opts = { embedFonts: false } as const;

/** Brewing tea, with labels on some of its lines. */
function tea(direction: "down" | "right" = "down") {
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "boil", label: "Boil the kettle", shape: "step" },
      { id: "warm", label: "Warm the pot", shape: "step" },
      { id: "steep", label: "Steep the leaves", shape: "step" },
      { id: "pour", label: "Pour through a strainer", shape: "step" },
    ],
    edges: [
      { from: "boil", to: "warm", label: "a splash" } as Record<string, unknown>,
      { from: "boil", to: "steep", label: "the rest" },
      { from: "warm", to: "steep" },
      { from: "steep", to: "pour", label: "after four minutes" },
    ],
  };
}

async function svgDoc(input: object, theme?: "light" | "dark") {
  return parseSvg((await render(input, { ...opts, ...(theme ? { theme } : {}) })).svg);
}

function pill(line: Element): { box: Box; rect: Element; texts: Element[]; strikes: Element[] } | undefined {
  const label = byClassIn(line, "line-label")[0];
  if (!label) return undefined;
  const rect = label.getElementsByTagName("rect")[0]!;
  const num = (name: string) => Number(rect.getAttribute(name));
  return {
    box: { x: num("x"), y: num("y"), width: num("width"), height: num("height") },
    rect,
    texts: Array.from(label.getElementsByTagName("text")),
    strikes: byClassIn(label, "strike"),
  };
}

/** The route as straight runs: the rounded corners' control points are the bends ELK gave. */
function corners(line: Element): Point[] {
  const route = Array.from(line.getElementsByTagName("path")).find((p) => p.getAttribute("fill") === "none")!;
  return parsePath(route.getAttribute("d")!).flatMap((c) => c.points);
}

function distanceToRoute(p: Point, points: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length ** 2));
    best = Math.min(best, Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y));
  }
  return best;
}

describe("line labels", () => {
  it("draws a label as text in a rounded pill, and only on lines that have one", async () => {
    const doc = await svgDoc(tea());

    const found = lines(doc).map((l) => pill(l)?.texts.map((t) => t.textContent).join(" "));
    expect(found).toEqual(["a splash", "the rest", undefined, "after four minutes"]);
    const { box, rect } = pill(lines(doc)[0]!)!;
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(box.height / 2, 5);
  });

  it.each(["down", "right"] as const)("lets ELK place each pill on its own line, clear of the cards, direction %s", async (direction) => {
    const doc = await svgDoc(tea(direction));

    const boxes = cards(doc).map(cardBox);
    for (const line of lines(doc)) {
      const label = pill(line);
      if (!label) continue;
      const centre = { x: label.box.x + label.box.width / 2, y: label.box.y + label.box.height / 2 };
      expect(distanceToRoute(centre, corners(line))).toBeLessThanOrEqual(1);
      for (const box of boxes) expect(overlaps(label.box, box)).toBe(false);
      // The text sits inside its pill.
      for (const t of label.texts) {
        const baseline = Number(t.getAttribute("y"));
        expect(baseline).toBeGreaterThan(label.box.y);
        expect(baseline).toBeLessThan(label.box.y + label.box.height);
        expect(Number(t.getAttribute("x"))).toBeCloseTo(centre.x, 1);
      }
    }
  });

  it.each([
    ["light", undefined, "#8c959f", "#ffffff"],
    ["light", "unchanged", "#8c959f", "#ffffff"],
    ["light", "new", "#1f883d", "#ffffff"],
    ["light", "changed", "#bf8700", "#ffffff"],
    ["dark", undefined, "#6e7681", "#161b22"],
    ["dark", "removed", "#f85149", "#161b22"],
  ] as const)("borders a %s-theme pill in its line's colour (status %s)", async (theme, status, border, fill) => {
    const input = tea();
    if (status) input.edges[0]!.status = status;
    const doc = await svgDoc(input, theme);

    const line = lines(doc)[0]!;
    const { rect, texts } = pill(line)!;
    const route = line.getElementsByTagName("path")[0]!;
    expect(rect.getAttribute("stroke")).toBe(border);
    expect(rect.getAttribute("stroke")).toBe(route.getAttribute("stroke"));
    expect(rect.getAttribute("fill")).toBe(fill);
    expect(texts[0]!.getAttribute("fill")).toBe(theme === "light" ? "#1f2328" : "#e6edf3");
  });

  it("strikes through the label of a removed line, and fades it with the line", async () => {
    const input = tea();
    input.edges[0]!.status = "removed";
    input.edges[1]!.status = "changed";
    const doc = await svgDoc(input);

    const [removed, changed] = lines(doc);
    const label = pill(removed!)!;
    expect(label.strikes).toHaveLength(label.texts.length);
    const strike = label.strikes[0]!;
    expect(Number(strike.getAttribute("x2")) - Number(strike.getAttribute("x1"))).toBeGreaterThan(0);
    expect(Number(strike.getAttribute("x2")) - Number(strike.getAttribute("x1"))).toBeLessThan(label.box.width);
    expect(byClassIn(byClassIn(removed!, "faded")[0]!, "line-label")).toHaveLength(1);
    expect(pill(changed!)!.strikes).toEqual([]);
  });

  it("wraps a long label inside a taller pill without losing any of it", async () => {
    const input = tea();
    const label = "once the water has stopped rolling and cooled a minute";
    input.edges[3]!.label = label;
    const doc = await svgDoc(input);

    const long = pill(lines(doc)[3]!)!;
    const short = pill(lines(doc)[0]!)!;
    expect(long.texts.length).toBeGreaterThan(1);
    expect(long.texts.map((t) => t.textContent).join(" ")).toBe(label);
    expect(long.box.height).toBeGreaterThan(short.box.height);
  });

  it("adds the label to the line's tooltip", async () => {
    const doc = await svgDoc(tea());

    expect(lines(doc).map((l) => titleOf(l))).toEqual([
      "Boil the kettle → Warm the pot: a splash",
      "Boil the kettle → Steep the leaves: the rest",
      "Warm the pot → Steep the leaves",
      "Steep the leaves → Pour through a strainer: after four minutes",
    ]);
  });
});
