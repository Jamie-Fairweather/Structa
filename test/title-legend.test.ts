import type { Document, Element } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { allElements, cardBox, cards, parseSvg } from "./helpers/svg";

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

async function svgDoc(input: object, theme?: "light" | "dark") {
  return parseSvg((await render(input, { ...opts, ...(theme ? { theme } : {}) })).svg);
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
