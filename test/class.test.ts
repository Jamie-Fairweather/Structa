import { describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import { cardBox, cardById, distanceToOutline, lines, parsePath, svgDoc, textLines, titleOf } from "./helpers/svg";

async function problems(input: object): Promise<readonly Problem[]> {
  const error = await render(input).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StructaError);
  expect((error as StructaError).code).toBe("INVALID_INPUT");
  return (error as StructaError).problems;
}

/** Two classes in a potting shed, with whatever line fields a test adds. */
function shed(edge: object = {}) {
  return {
    type: "class",
    nodes: [
      { id: "bench", label: "PottingBench" },
      { id: "tray", label: "SeedTray" },
    ],
    edges: [{ from: "bench", to: "tray", kind: "association", ...edge }],
  };
}

describe("class lines", () => {
  it("draws an association as a plain line between the cards, with no arrowhead", async () => {
    const doc = await svgDoc(shed());

    const [line] = lines(doc);
    expect(line!.getAttribute("data-kind")).toBe("association");
    expect([line!.getAttribute("data-from"), line!.getAttribute("data-to")]).toEqual(["bench", "tray"]);
    const paths = Array.from(line!.getElementsByTagName("path"));
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute("fill")).toBe("none");
    expect(paths[0]!.hasAttribute("stroke-dasharray")).toBe(false);
    // The line runs all the way from one card's outline to the other's.
    const points = parsePath(paths[0]!.getAttribute("d")!).flatMap((c) => c.points);
    expect(distanceToOutline(points[0]!, cardBox(cardById(doc, "bench")))).toBeLessThanOrEqual(1);
    expect(distanceToOutline(points.at(-1)!, cardBox(cardById(doc, "tray")))).toBeLessThanOrEqual(1);
  });

  it("names both classes in the line's tooltip, with its label", async () => {
    const doc = await svgDoc(shed({ label: "holds" }));

    expect(titleOf(lines(doc)[0]!)).toBe("PottingBench – SeedTray: holds");
  });

  it("requires a kind", async () => {
    const input = shed();
    delete (input.edges[0] as { kind?: string }).kind;

    expect(await problems(input)).toEqual([
      {
        path: "edges[0].kind",
        message: 'missing required field "kind"',
        hint: 'add "kind": the relationship the line shows, "association"',
      },
    ]);
  });

  it.each(["inherits", "implements", "composition", "aggregation", "dependency"])(
    "doesn't draw %s lines yet",
    async (kind) => {
      expect(await problems(shed({ kind }))).toEqual([
        { path: "edges[0].kind", message: `"${kind}" is not supported yet`, hint: 'use "association"' },
      ]);
    },
  );
});

describe("class cards", () => {
  it("draws each node of a class diagram as a class card with its name", async () => {
    const doc = await svgDoc({ type: "class", nodes: [{ id: "packet", label: "SeedPacket" }] });

    const card = cardById(doc, "packet");
    expect(card.getAttribute("data-kind")).toBe("class");
    expect(textLines(card)).toEqual(["SeedPacket"]);
    expect(titleOf(card)).toBe("SeedPacket");
  });
});
