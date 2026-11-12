import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { allElements, badgeBox, byClassIn, cardBox, cards, lines, svgDoc } from "./helpers/svg";

const opts = { embedFonts: false } as const;

/** Making jam, with whatever top-level fields a test adds. */
function jam(extra: Record<string, unknown> = {}) {
  return {
    type: "flow",
    ...extra,
    nodes: [
      { id: "hull", label: "Hull the strawberries", shape: "step" },
      { id: "boil", label: "Boil with sugar", shape: "step" },
      { id: "jar", label: "Pour into warm jars", shape: "step" },
    ],
    edges: [
      { from: "hull", to: "boil" },
      { from: "boil", to: "jar" },
    ],
  };
}

function group(doc: Document, className: string): Element | undefined {
  return allElements(doc).find((el) => el.getAttribute("class") === className);
}

function texts(el: Element | undefined): Element[] {
  return el ? Array.from(el.getElementsByTagName("text")) : [];
}

describe("title and description", () => {
  const title = "Strawberry jam";
  const description = "A small batch, made the same afternoon the fruit is picked.";

  it("draws the title and then the description at the top-left, above the cards", async () => {
    const doc = await svgDoc(jam({ title, description }));

    const [titleText] = texts(group(doc, "title"));
    const [descriptionText] = texts(group(doc, "description"));
    expect(titleText!.textContent).toBe(title);
    expect(descriptionText!.textContent).toBe(description);

    const boxes = cards(doc).map(cardBox);
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    for (const t of [titleText!, descriptionText!]) {
      expect(t.hasAttribute("text-anchor")).toBe(false);
      expect(Number(t.getAttribute("x"))).toBeLessThanOrEqual(left);
      expect(Number(t.getAttribute("y"))).toBeLessThan(top);
    }
    expect(Number(titleText!.getAttribute("x"))).toBe(Number(descriptionText!.getAttribute("x")));
    expect(Number(descriptionText!.getAttribute("y"))).toBeGreaterThan(Number(titleText!.getAttribute("y")));
  });

  it.each([
    ["light", "#1f2328", "#59636e"],
    ["dark", "#e6edf3", "#8b949e"],
  ] as const)("draws the %s title bold and larger, and the description muted", async (theme, text, muted) => {
    const doc = await svgDoc(jam({ title, description }), theme);

    const [titleText] = texts(group(doc, "title"));
    const [descriptionText] = texts(group(doc, "description"));
    expect([titleText!.getAttribute("font-weight"), titleText!.getAttribute("fill")]).toEqual(["700", text]);
    expect([descriptionText!.getAttribute("font-weight"), descriptionText!.getAttribute("fill")]).toEqual(["400", muted]);
    expect(Number(titleText!.getAttribute("font-size"))).toBeGreaterThan(Number(descriptionText!.getAttribute("font-size")));
  });

  it("draws a title or a description on its own", async () => {
    const titleOnly = await svgDoc(jam({ title }));
    expect(texts(group(titleOnly, "title")).map((t) => t.textContent)).toEqual([title]);
    expect(group(titleOnly, "description")).toBeUndefined();

    const descriptionOnly = await svgDoc(jam({ description }));
    expect(group(descriptionOnly, "title")).toBeUndefined();
    expect(texts(group(descriptionOnly, "description")).map((t) => t.textContent)).toEqual([description]);
  });

  it("draws nothing above the cards without either", async () => {
    const doc = await svgDoc(jam());

    expect(group(doc, "title")).toBeUndefined();
    expect(group(doc, "description")).toBeUndefined();
  });

  it("moves the cards down to make room, and keeps them where they were across", async () => {
    const plain = cards(await svgDoc(jam())).map(cardBox);
    const titled = cards(await svgDoc(jam({ title, description }))).map(cardBox);

    titled.forEach((box, i) => {
      expect(box.x).toBe(plain[i]!.x);
      expect(box.y).toBeGreaterThan(plain[i]!.y);
    });
  });

  it("wraps a long description without losing any of it, and widens a narrow canvas to fit", async () => {
    const long = Array.from({ length: 9 }, () => "Stir often so it never catches.").join(" ");
    const one = { type: "flow", nodes: [{ id: "stir", label: "Stir", shape: "step" }] };

    const plain = await svgDoc(one);
    const doc = await svgDoc({ ...one, description: long });

    const wrapped = texts(group(doc, "description")).map((t) => t.textContent);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join(" ")).toBe(long);
    const width = (d: Document) => Number(d.documentElement!.getAttribute("width"));
    expect(width(doc)).toBeGreaterThan(width(plain) * 2);
  });

  it("draws the title on an empty diagram", async () => {
    const doc = await svgDoc({ type: "flow", title, nodes: [] });

    expect(texts(group(doc, "title")).map((t) => t.textContent)).toEqual([title]);
  });
});

describe("legend", () => {
  /** The jam with these statuses on its three steps and two lines. */
  function jamWith(nodes: readonly (string | undefined)[], edges: readonly (string | undefined)[] = [], extra = {}) {
    const input = jam(extra);
    const withStatus = <T extends object>(item: T, status: string | undefined) => (status ? { ...item, status } : item);
    return {
      ...input,
      nodes: input.nodes.map((node, i) => withStatus(node, nodes[i])),
      edges: input.edges.map((edge, i) => withStatus(edge, edges[i])),
    };
  }

  function items(doc: Document) {
    const legend = group(doc, "legend");
    return legend ? byClassIn(legend, "legend-item") : [];
  }

  it("lists exactly the statuses used, in a fixed order, each as a badge", async () => {
    const doc = await svgDoc(jamWith(["unchanged", "new", "new"], ["removed", undefined]));

    expect(items(doc).map((item) => item.getAttribute("data-status"))).toEqual(["new", "removed", "unchanged"]);
    expect(items(doc).map((item) => texts(byClassIn(item, "badge")[0]).map((t) => t.textContent))).toEqual([
      ["NEW"],
      ["REMOVED"],
      ["UNCHANGED"],
    ]);
  });

  it("counts statuses used only on lines", async () => {
    const doc = await svgDoc(jamWith([], ["changed", "unchanged"]));

    expect(items(doc).map((item) => item.getAttribute("data-status"))).toEqual(["changed", "unchanged"]);
  });

  it.each([
    ["light", { new: "#1f883d", changed: "#bf8700", removed: "#cf222e", unchanged: "#8c959f" }],
    ["dark", { new: "#3fb950", changed: "#d29922", removed: "#f85149", unchanged: "#6e7681" }],
  ] as const)("shows each status's %s line colour beside its badge", async (theme, colours) => {
    const doc = await svgDoc(jamWith(["new", "changed", "removed"], ["unchanged"]), theme);

    expect(items(doc)).toHaveLength(4);
    for (const item of items(doc)) {
      const [swatch] = byClassIn(item, "swatch");
      expect(swatch!.getAttribute("stroke")).toBe(colours[item.getAttribute("data-status") as keyof typeof colours]);
      expect(swatch!.getAttribute("y1")).toBe(swatch!.getAttribute("y2"));
      // The swatch comes first, then the badge, without touching.
      expect(Number(swatch!.getAttribute("x2"))).toBeLessThan(badgeBox(item)!.x);
    }
  });

  it("sits at the bottom-left, below every card and line, with its items in a row", async () => {
    const doc = await svgDoc(jamWith(["new", "changed", "removed"], ["new", "removed"], { title: "Jam" }));

    const boxes = cards(doc).map(cardBox);
    const lowest = Math.max(
      ...boxes.map((b) => b.y + b.height),
      ...lines(doc).flatMap((l) => allElements(l).flatMap((el) => (el.getAttribute("d") ?? "").match(/-?[\d.]+ (-?[\d.]+)/g) ?? []))
        .map((pair) => Number(pair.split(" ")[1])),
    );
    const badges = items(doc).map((item) => badgeBox(item)!);
    for (const badge of badges) expect(badge.y).toBeGreaterThan(lowest);
    expect(new Set(badges.map((b) => b.y)).size).toBe(1);
    badges.slice(1).forEach((b, i) => expect(b.x).toBeGreaterThan(badges[i]!.x + badges[i]!.width));
    const [firstSwatch] = byClassIn(items(doc)[0]!, "swatch");
    const titleX = Number(texts(group(doc, "title"))[0]!.getAttribute("x"));
    expect(Number(firstSwatch!.getAttribute("x1"))).toBe(titleX);
    const height = Number(doc.documentElement!.getAttribute("height"));
    expect(badges[0]!.y + badges[0]!.height).toBeLessThan(height);
  });

  it("is left out when nothing has a status", async () => {
    const doc = await svgDoc(jamWith([]));

    expect(group(doc, "legend")).toBeUndefined();
    expect((await render(jamWith([]), opts)).svg).toBe((await render(jam(), opts)).svg);
  });

  it("is left out with legend: false, and drawn with legend: true", async () => {
    const off = await svgDoc(jamWith(["new"], [], { legend: false }));
    const on = await svgDoc(jamWith(["new"], [], { legend: true }));

    expect(group(off, "legend")).toBeUndefined();
    expect(cards(off).map((c) => c.getAttribute("data-status"))).toEqual(["new", null, null]);
    expect(items(on).map((item) => item.getAttribute("data-status"))).toEqual(["new"]);
    // Without the legend the canvas is shorter.
    const height = (d: Document) => Number(d.documentElement!.getAttribute("height"));
    expect(height(off)).toBeLessThan(height(on));
  });

  it("is drawn by default", async () => {
    const plain = (await render(jamWith(["new"]), opts)).svg;

    expect(plain).toBe((await render(jamWith(["new"], [], { legend: true }), opts)).svg);
  });
});
