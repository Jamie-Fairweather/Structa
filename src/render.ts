import { StructaError, type Problem } from "./errors";
import { parseDiagram } from "./input";
import { layout, PROFILES } from "./layout";
import { paint } from "./painter";
import { DEFAULT_SCALE, rasterise, SCALES, type Scale } from "./raster";
import { buildAreaBoxes, buildCards, buildConnector, buildHeader, buildLegend, buildLine, linePorts } from "./shapes";
import { getTheme, THEME_NAMES, type ThemeName } from "./theme";

interface Outputs {
  svg: string;
  png: Uint8Array;
}

export type Format = keyof Outputs;

export interface RenderOptions<F extends Format = Format> {
  /** Which outputs to make, from one layout pass. Default: svg only. */
  readonly formats?: readonly F[];
  /** The colour theme. Wins over the diagram's own `theme`. Default: light. */
  readonly theme?: ThemeName;
  /** Embed the font faces the SVG's text is drawn in. Default: true. SVG only. */
  readonly embedFonts?: boolean;
  /** How many PNG pixels to draw per SVG pixel: a whole number from 1 to 4. Default: 2. PNG only. */
  readonly scale?: number;
}

export type RenderResult<F extends Format = "svg"> = Pick<Outputs, F>;

/** Turns one diagram (a JSON string or an already-parsed object) into the requested outputs. */
export async function render<F extends Format = "svg">(
  input: string | object,
  options: RenderOptions<F> = {},
): Promise<RenderResult<F>> {
  const { formats, theme: themeName, embedFonts, scale } = readOptions(options);
  const parsed = parseDiagram(input);
  if (!parsed.ok) throw new StructaError("INVALID_INPUT", parsed.problems);
  const { diagram } = parsed;

  const theme = getTheme(themeName ?? diagram.theme);
  const cards = buildCards(diagram, theme.sizes).map((card, i) => ({ ...card, path: `nodes[${i}]`, note: card.kind === "note" }));
  const nodes: readonly { readonly id: string; readonly label: string }[] = diagram.nodes;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const lines = diagram.edges.map((edge, i) => {
    const source = index.get(edge.from)!;
    const target = index.get(edge.to)!;
    const line = buildLine(edge, nodes[source]!.label, nodes[target]!.label, theme.sizes);
    // Only an ER line's ends can name columns.
    const columns = "fromCardinality" in edge ? { from: edge.fromColumn, to: edge.toColumn } : {};
    const ports = linePorts(cards[source]!, cards[target]!, columns, theme.sizes);
    return { ...line, source, target, path: `edges[${i}]`, ...(ports ? { ports } : {}) };
  });
  // Only flowcharts have notes, each joined by a connector to the shape it's about.
  const flowNodes = diagram.type === "flow" ? diagram.nodes : [];
  const connectors = flowNodes.flatMap((node, i) => {
    if (node.about === undefined) return [];
    const target = index.get(node.about)!;
    return [{ ...buildConnector(node, flowNodes[target]!), source: i, target, path: `nodes[${i}].about` }];
  });
  // Area boxes only when asked for: otherwise the areas don't affect the layout at all.
  const areaIndex = new Map(diagram.areas.map((area, i) => [area.id, i]));
  const areas = diagram.groupAreas
    ? buildAreaBoxes(diagram.areas, theme.sizes).map((box) => ({ ...box, path: `areas[${areaIndex.get(box.id)}]` }))
    : [];
  const scene = await layout({ cards, lines: [...connectors, ...lines], areas }, PROFILES.get(diagram.type)!, diagram.direction);
  const header = buildHeader(diagram.title, diagram.description, theme.sizes);
  // Every card's status, its rows' (taken from the card included) and every line's.
  const statuses = [...cards.flatMap((card) => [card.status, ...card.rows.map((row) => row.status)]), ...lines.map((line) => line.status)];
  // The areas named in the drawing: each box names its area, and each tag only its card's own.
  const tagged = new Set(cards.map((card) => card.area));
  const named = diagram.groupAreas ? diagram.areas : diagram.areas.filter((area) => tagged.has(area.id));
  // The legend wraps to the diagram's width, or to the title's widest when that's wider, so it never widens the image.
  const legendWidth = Math.max(scene.width, theme.sizes.header.maxWidth);
  const legend = diagram.legend ? buildLegend(statuses, named, legendWidth, theme.sizes) : undefined;
  const drawing = { scene, header, legend };

  const result: Partial<Outputs> = {};
  if (formats.includes("svg")) result.svg = paint(drawing, theme, { embedFonts });
  if (formats.includes("png")) {
    // The PNG is always drawn from the font-free SVG: the rasteriser gets the font files themselves.
    const plain = result.svg !== undefined && !embedFonts ? result.svg : paint(drawing, theme, { embedFonts: false });
    result.png = await rasterise(plain, scale);
  }
  return result as RenderResult<F>;
}

interface CheckedOptions {
  formats: readonly Format[];
  theme: ThemeName | undefined;
  embedFonts: boolean;
  scale: Scale;
}

/** The options, checked. Every problem with them is reported at once, as INVALID_OPTIONS. */
function readOptions(options: unknown): CheckedOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    const hint = 'write them as {"theme": "dark"}, for example';
    throw new StructaError("INVALID_OPTIONS", [{ path: "options", message: "must be an object", hint }]);
  }
  const asked = options as { formats?: unknown; theme?: unknown; embedFonts?: unknown; scale?: unknown };
  const problems: Problem[] = [];
  const formats = readFormats(asked.formats, problems);
  const theme = readTheme(asked.theme, problems);
  const embedFonts = readEmbedFonts(asked.embedFonts, problems);
  const scale = readScale(asked.scale, problems);
  if (problems.length > 0) throw new StructaError("INVALID_OPTIONS", problems);
  return { formats, theme, embedFonts, scale };
}

const FORMATS: readonly Format[] = ["svg", "png"];

function readFormats(formats: unknown, problems: Problem[]): readonly Format[] {
  if (formats === undefined) return ["svg"];
  const hint = 'use "svg", "png" or both';
  if (!Array.isArray(formats)) problems.push({ path: "options.formats", message: "must be a list of formats", hint });
  else if (formats.length === 0) problems.push({ path: "options.formats", message: "must list at least one format", hint });
  else {
    formats.forEach((format: unknown, i) => {
      if (FORMATS.includes(format as Format)) return;
      problems.push({ path: `options.formats[${i}]`, message: `${JSON.stringify(format)} is not a valid format`, hint });
    });
  }
  return Array.isArray(formats) ? FORMATS.filter((format) => formats.includes(format)) : [];
}

/** The theme asked for, or undefined to use the diagram's own. */
function readTheme(theme: unknown, problems: Problem[]): ThemeName | undefined {
  if (theme === undefined || THEME_NAMES.includes(theme as ThemeName)) return theme as ThemeName | undefined;
  const message = typeof theme === "string" ? `${JSON.stringify(theme)} is not a valid theme` : "must be a string";
  problems.push({ path: "options.theme", message, hint: `use ${THEME_NAMES.map((name) => JSON.stringify(name)).join(" or ")}` });
  return undefined;
}

/** Whether to embed the fonts: true when left out. */
function readEmbedFonts(embedFonts: unknown, problems: Problem[]): boolean {
  if (embedFonts === undefined || typeof embedFonts === "boolean") return embedFonts ?? true;
  problems.push({ path: "options.embedFonts", message: "must be true or false", hint: "leave it out to embed the fonts" });
  return true;
}

/** The PNG scale: DEFAULT_SCALE when left out. */
function readScale(scale: unknown, problems: Problem[]): Scale {
  if (scale === undefined) return DEFAULT_SCALE;
  if (SCALES.includes(scale as Scale)) return scale as Scale;
  const message = `must be a whole number from ${SCALES[0]} to ${SCALES.at(-1)}`;
  problems.push({ path: "options.scale", message, hint: `leave it out for ${DEFAULT_SCALE}` });
  return DEFAULT_SCALE;
}
