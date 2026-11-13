import { describe, expect, it } from "vitest";
import { readTtf } from "../scripts/lib/ttf";
import { render, StructaError } from "../src/index";
import { badlyFormattedNumbers, fontFaceRules, parseSvg, passiveSvgViolations, textFaces } from "./helpers/svg";

// The one dedicated embedding test. Every other test renders with embedFonts: false.
const rakeLeaves = {
  type: "flow",
  nodes: [
    { id: "rake", label: "Rake the leaves into a pile", shape: "step" },
    { id: "bag", label: "Bag them up", shape: "step" },
    { id: "compost", label: "Tip the bags on the leaf-mould heap", shape: "step" },
  ],
  edges: [
    { from: "rake", to: "bag" },
    { from: "bag", to: "compost" },
  ],
};

const DATA_URL = /^url\("data:font\/ttf;base64,([A-Za-z0-9+/]+={0,2})"\)$/;

describe("fonts embedded in SVGs", () => {
  it("embeds each face the text is drawn in, once, as an @font-face rule with a TTF data URL", async () => {
    const doc = parseSvg((await render(rakeLeaves)).svg);

    // Step labels are drawn in Inter SemiBold, and that's the only face this diagram uses.
    expect(textFaces(doc)).toEqual(["Structa Inter 600 normal"]);
    const rules = fontFaceRules(doc);
    expect(rules.map((rule) => rule.face)).toEqual(["Structa Inter 600 normal"]);

    const base64 = DATA_URL.exec(rules[0]!.src)?.[1];
    expect(base64).toBeDefined();
    const bytes = Buffer.from(base64!, "base64");
    expect(bytes.toString("base64")).toBe(base64);
    // A TrueType font starts with version 1.0.
    expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  });

  it("embeds the trimmed face: the shared characters only, and no OpenType layout data", async () => {
    const [rule] = fontFaceRules(parseSvg((await render(rakeLeaves)).svg));
    const font = readTtf(Buffer.from(DATA_URL.exec(rule!.src)![1]!, "base64"));

    // Latin letters, punctuation and the common symbols stay; Cyrillic and Greek, which Inter also draws, go.
    for (const kept of "Aéł…→≠") expect(font.advance(kept.codePointAt(0)!), kept).toBeDefined();
    for (const dropped of "ЖΩ") expect(font.advance(dropped.codePointAt(0)!), dropped).toBeUndefined();
    expect(font.tables.filter((table) => ["GDEF", "GPOS", "GSUB", "kern"].includes(table))).toEqual([]);
  });

  it("names the embedded faces for Structa only, so an SVG inlined into a web page leaves the page's own Inter alone", async () => {
    const doc = parseSvg((await render(rakeLeaves)).svg);
    const fontFamilies = new Set(Array.from(doc.getElementsByTagName("text"), (text) => text.getAttribute("font-family")));

    // An inlined SVG's <style> applies to the whole page, so its rules use a family no page has.
    expect(fontFaceRules(doc).map((rule) => rule.face)).toEqual(["Structa Inter 600 normal"]);
    // The text falls back to an installed Inter, then any sans-serif, when the fonts aren't embedded.
    expect([...fontFamilies]).toEqual(["Structa Inter, Inter, sans-serif"]);
    // The font file still names itself Inter SemiBold: that's how the rasteriser finds it.
    const font = readTtf(Buffer.from(DATA_URL.exec(fontFaceRules(doc)[0]!.src)![1]!, "base64"));
    expect([font.family, font.weight, font.style]).toEqual(["Inter", 600, "normal"]);
  });

  it("embeds the faces of badges, line labels, the title and the legend too, and only those used", async () => {
    const changed = {
      ...rakeLeaves,
      title: "Autumn leaves",
      nodes: rakeLeaves.nodes.map((node, i) => (i === 1 ? { ...node, status: "new" } : node)),
      edges: [{ ...rakeLeaves.edges[0]!, label: "when dry" }, rakeLeaves.edges[1]!],
    };
    const doc = parseSvg((await render(changed)).svg);

    // Badges and the title are Inter Bold, line labels Inter Regular, step labels Inter SemiBold.
    const used = ["Structa Inter 400 normal", "Structa Inter 600 normal", "Structa Inter 700 normal"];
    expect([...textFaces(doc)].sort()).toEqual(used);
    expect(fontFaceRules(doc).map((rule) => rule.face)).toEqual(used);
  });

  it("embeds the regular face for a note's label and a shape's description", async () => {
    for (const extra of [
      { nodes: [...rakeLeaves.nodes, { id: "tip", label: "Leave some for the hedgehogs", shape: "note", about: "rake" }] },
      { nodes: rakeLeaves.nodes.map((node, i) => (i === 0 ? { ...node, description: "Before the rain" } : node)) },
    ]) {
      const doc = parseSvg((await render({ ...rakeLeaves, ...extra })).svg);

      const used = ["Structa Inter 400 normal", "Structa Inter 600 normal"];
      expect([...textFaces(doc)].sort()).toEqual(used);
      expect(fontFaceRules(doc).map((rule) => rule.face)).toEqual(used);
    }
  });

  it("embeds the semibold face for an area's name, on a tag or an area box", async () => {
    // Notes are drawn in Inter Regular, so only the area's name needs Inter SemiBold.
    const notes = {
      type: "flow",
      areas: [{ id: "heap", label: "Compost heap" }],
      nodes: [{ id: "tip", label: "Turn it every month", shape: "note", area: "heap" }],
      legend: false,
    };
    for (const groupAreas of [false, true]) {
      const doc = parseSvg((await render({ ...notes, groupAreas })).svg);

      const used = ["Structa Inter 400 normal", "Structa Inter 600 normal"];
      expect([...textFaces(doc)].sort()).toEqual(used);
      expect(fontFaceRules(doc).map((rule) => rule.face)).toEqual(used);
    }
  });

  it("embeds no font, and writes no <style>, when no text is drawn", async () => {
    const { svg } = await render({ type: "flow", nodes: [] });

    expect(textFaces(parseSvg(svg))).toEqual([]);
    expect(svg).not.toContain("<style");
  });

  it("keeps the SVG passive with the fonts in it", async () => {
    const { svg } = await render(rakeLeaves);

    expect(passiveSvgViolations(svg)).toEqual([]);
    expect(badlyFormattedNumbers(svg)).toEqual([]);
  });

  it("leaves the fonts out with embedFonts: false, and changes nothing else", async () => {
    const embedded = (await render(rakeLeaves)).svg;
    const plain = (await render(rakeLeaves, { embedFonts: false })).svg;

    expect(fontFaceRules(parseSvg(plain))).toEqual([]);
    expect(plain).not.toContain("<style");
    expect(plain).not.toContain("data:");
    expect(embedded.replace(/<style>[^<]*<\/style>\n?/, "")).toBe(plain);
    expect(await render(rakeLeaves, { embedFonts: true })).toEqual({ svg: embedded });
  });

  it.each([["yes"], ["false"], [0], [1], [null], [{}]])("rejects embedFonts: %j with INVALID_OPTIONS", async (value) => {
    const error = await render(rakeLeaves, { embedFonts: value as never }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(StructaError);
    expect((error as StructaError).code).toBe("INVALID_OPTIONS");
    expect((error as StructaError).problems).toEqual([
      { path: "options.embedFonts", message: "must be true or false", hint: "leave it out to embed the fonts" },
    ]);
  });

  it("reports a bad embedFonts together with bad formats", async () => {
    const error = await render(rakeLeaves, { formats: ["gif"] as never, embedFonts: "no" as never }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect((error as StructaError).code).toBe("INVALID_OPTIONS");
    expect((error as StructaError).problems.map((p) => p.path)).toEqual(["options.formats[0]", "options.embedFonts"]);
  });
});
