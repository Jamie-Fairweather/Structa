import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  allElements,
  alongRuns,
  byClassIn,
  cards,
  distanceToRoute,
  lineGeometry,
  lines,
  outlineBox,
  overlaps,
  rectBox,
  svgDoc,
  titleOf,
  type Box,
  type Point,
} from "./helpers/svg";

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

/**
 * Kneading dough, with two labelled loops on one step. ELK nests the loops
 * and puts each label beside its own loop, so the outer loop runs under the
 * inner loop's pill.
 */
function dough(direction: "down" | "right") {
  return {
    type: "flow",
    direction,
    nodes: [
      { id: "knead", label: "Knead the dough", shape: "step" },
      { id: "shape", label: "Shape the loaf", shape: "step" },
    ],
    edges: [
      { from: "knead", to: "knead", label: "until it is smooth and springy all over" },
      { from: "knead", to: "knead", label: "rest it for ten minutes, then knead again" },
      { from: "knead", to: "shape" },
    ],
  };
}

interface Pill {
  readonly group: Element;
  /** The data-id of the line it labels. */
  readonly line: string | null;
  readonly box: Box;
  readonly rect: Element;
  readonly texts: Element[];
  readonly strikes: Element[];
}

/** Every line label pill, in drawing order. */
function pills(doc: Document): Pill[] {
  return allElements(doc)
    .filter((el) => el.getAttribute("class") === "line-label")
    .map((group) => {
      const rect = Array.from(group.getElementsByTagName("rect")).find((r) => r.hasAttribute("stroke"))!;
      return {
        group,
        line: group.getAttribute("data-line"),
        box: rectBox(rect),
        rect,
        texts: Array.from(group.getElementsByTagName("text")),
        strikes: byClassIn(group, "strike"),
      };
    });
}

function pillOf(doc: Document, line: Element): Pill | undefined {
  return pills(doc).find((p) => p.line === line.getAttribute("data-id"));
}

/** The route as straight runs: the rounded corners' control points are the bends ELK gave. */
function corners(line: Element): Point[] {
  return lineGeometry(line).route.flatMap((c) => c.points);
}

/** Whether a point is inside a box by more than `margin`. */
function inside(p: Point, box: Box, margin: number): boolean {
  return p.x > box.x + margin && p.x < box.x + box.width - margin && p.y > box.y + margin && p.y < box.y + box.height - margin;
}

describe("line labels", () => {
  it("draws a label as text in a rounded pill, and only on lines that have one", async () => {
    const doc = await svgDoc(tea());

    const found = lines(doc).map((l) => pillOf(doc, l)?.texts.map((t) => t.textContent).join(" "));
    expect(found).toEqual(["a splash", "the rest", undefined, "after four minutes"]);
    expect(pills(doc)).toHaveLength(3);
    const { box, rect } = pillOf(doc, lines(doc)[0]!)!;
    expect(Number(rect.getAttribute("rx"))).toBeCloseTo(box.height / 2, 5);
  });

  it.each(["down", "right"] as const)("lets ELK place each pill on its own line, clear of the cards, direction %s", async (direction) => {
    const doc = await svgDoc(tea(direction));

    const boxes = cards(doc).map(outlineBox);
    for (const line of lines(doc)) {
      const label = pillOf(doc, line);
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

  it.each(["down", "right"] as const)("places each pill on its own line in area boxes too, inside and across them, direction %s", async (direction) => {
    // The kettle in the kitchen, the pot on a tray inside the dining room: the labelled lines cross into and out of the boxes.
    const input = {
      ...tea(direction),
      groupAreas: true,
      areas: [
        { id: "kitchen", label: "Kitchen" },
        { id: "dining", label: "Dining room" },
        { id: "tray", label: "Tray", parent: "dining" },
      ],
    };
    const inAreas = ["kitchen", "kitchen", "tray", "dining"];
    input.nodes = input.nodes.map((node, i) => ({ ...node, area: inAreas[i]! }));
    const doc = await svgDoc(input);

    expect(pills(doc)).toHaveLength(3);
    for (const line of lines(doc)) {
      const label = pillOf(doc, line);
      if (!label) continue;
      const centre = { x: label.box.x + label.box.width / 2, y: label.box.y + label.box.height / 2 };
      expect(distanceToRoute(centre, corners(line)), line.getAttribute("data-id")!).toBeLessThanOrEqual(1);
      for (const card of cards(doc)) expect(overlaps(label.box, outlineBox(card))).toBe(false);
    }
  });

  it.each(["down", "right"] as const)(
    "never draws a line across another line's pill, even with two labelled loops on one card, direction %s",
    async (direction) => {
      let under = 0;
      for (const input of [tea(direction), dough(direction)]) {
        const doc = await svgDoc(input);
        const order = allElements(doc);

        for (const label of pills(doc)) {
          for (const line of lines(doc)) {
            if (line.getAttribute("data-id") === label.line) continue;
            const { arrowTip } = lineGeometry(line);
            if (!alongRuns([...corners(line), arrowTip]).some((p) => inside(p, label.box, 1))) continue;
            under++;
            // Drawn before the pill, so the pill covers it.
            for (const part of Array.from(line.getElementsByTagName("path"))) {
              const what = `${line.getAttribute("data-id")} drawn over ${label.line}'s pill`;
              expect(order.indexOf(part), what).toBeLessThan(order.indexOf(label.group));
            }
          }
        }
      }
      // The loops do run a line under another line's pill, so the check above has something to check.
      expect(under).toBeGreaterThan(0);
    },
  );

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
    const { rect, texts } = pillOf(doc, line)!;
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
    const label = pillOf(doc, removed!)!;
    expect(label.strikes).toHaveLength(label.texts.length);
    const strike = label.strikes[0]!;
    expect(Number(strike.getAttribute("x2")) - Number(strike.getAttribute("x1"))).toBeGreaterThan(0);
    expect(Number(strike.getAttribute("x2")) - Number(strike.getAttribute("x1"))).toBeLessThan(label.box.width);
    // The whole pill is faded, as much as its line.
    const [faded] = byClassIn(label.group, "faded");
    expect(faded!.getAttribute("opacity")).toBe(byClassIn(removed!, "faded")[0]!.getAttribute("opacity"));
    expect(Array.from(faded!.getElementsByTagName("rect"))).toEqual([label.rect]);
    expect(byClassIn(faded!, "strike")).toHaveLength(label.strikes.length);
    // Over an opaque backing in the canvas colour, so no line shows through it.
    const [backing] = Array.from(label.group.getElementsByTagName("rect"));
    expect(backing!.parentNode).toBe(label.group);
    expect(backing!.getAttribute("fill")).toBe("#f4f5f7");
    expect(backing!.hasAttribute("fill-opacity")).toBe(false);
    expect(rectBox(backing!)).toEqual(label.box);
    expect(backing!.getAttribute("rx")).toBe(label.rect.getAttribute("rx"));
    const plain = pillOf(doc, changed!)!;
    expect(plain.strikes).toEqual([]);
    expect(byClassIn(plain.group, "faded")).toEqual([]);
    expect(plain.group.getElementsByTagName("rect")).toHaveLength(1);
  });

  it("wraps a long label inside a taller pill without losing any of it", async () => {
    const input = tea();
    const label = "once the water has stopped rolling and cooled a minute";
    input.edges[3]!.label = label;
    const doc = await svgDoc(input);

    const long = pillOf(doc, lines(doc)[3]!)!;
    const short = pillOf(doc, lines(doc)[0]!)!;
    expect(long.texts.length).toBeGreaterThan(1);
    expect(long.texts.map((t) => t.textContent).join(" ")).toBe(label);
    expect(long.box.height).toBeGreaterThan(short.box.height);
  });

  it("adds the label to the line's tooltip, which its pill shows too", async () => {
    const doc = await svgDoc(tea());

    expect(lines(doc).map((l) => titleOf(l))).toEqual([
      "Boil the kettle → Warm the pot: a splash",
      "Boil the kettle → Steep the leaves: the rest",
      "Warm the pot → Steep the leaves",
      "Steep the leaves → Pour through a strainer: after four minutes",
    ]);
    for (const line of lines(doc)) {
      const label = pillOf(doc, line);
      if (label) expect(titleOf(label.group)).toBe(titleOf(line));
    }
  });
});
