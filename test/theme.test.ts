import { describe, expect, it } from "vitest";
import { render } from "../src/index";
import { allElements, cards, parseSvg } from "./helpers/svg";

const opts = { embedFonts: false } as const;

/** A two-step flowchart, with an optional theme in the JSON. */
function compost(theme?: unknown) {
  return {
    type: "flow",
    ...(theme === undefined ? {} : { theme }),
    nodes: [
      { id: "layer", label: "Layer greens and browns", shape: "step" },
      { id: "turn", label: "Turn the heap monthly", shape: "step" },
    ],
    edges: [{ from: "layer", to: "turn" }],
  };
}

/** The page colour and the card colour an SVG is drawn with. */
function colours(svg: string): { background: string | null; card: string | null } {
  const doc = parseSvg(svg);
  const page = allElements(doc).find((el) => el.localName === "rect" && el.parentNode === doc.documentElement);
  const card = cards(doc)[0]!.getElementsByTagName("rect")[0]!;
  return { background: page?.getAttribute("fill") ?? null, card: card.getAttribute("fill") };
}

// The colours are the spec's: a soft grey page with white cards, or GitHub's dark page with dark cards.
const LIGHT = { background: "#f4f5f7", card: "#ffffff" };
const DARK = { background: "#0d1117", card: "#161b22" };

describe("theme", () => {
  it("draws the light theme by default", async () => {
    expect(colours((await render(compost(), opts)).svg)).toEqual(LIGHT);
  });

  it("draws the theme the render() option asks for", async () => {
    expect(colours((await render(compost(), { ...opts, theme: "dark" })).svg)).toEqual(DARK);
    expect(colours((await render(compost(), { ...opts, theme: "light" })).svg)).toEqual(LIGHT);
  });

  it("draws the theme the JSON asks for", async () => {
    expect(colours((await render(compost("dark"), opts)).svg)).toEqual(DARK);
    expect(colours((await render(compost("light"), opts)).svg)).toEqual(LIGHT);
  });

  it("lets the render() option win over the JSON, either way round", async () => {
    const darkOverLight = await render(compost("light"), { ...opts, theme: "dark" });
    const lightOverDark = await render(compost("dark"), { ...opts, theme: "light" });

    expect(darkOverLight.svg).toBe((await render(compost(), { ...opts, theme: "dark" })).svg);
    expect(lightOverDark.svg).toBe((await render(compost(), opts)).svg);
  });
});
