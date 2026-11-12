import { StructaError, type Problem } from "./errors";
import { parseDiagram } from "./input";
import { FLOW_PROFILE, layout } from "./layout";
import { paint } from "./painter";
import { buildCards, buildHeader, buildLegend, buildLine } from "./shapes";
import { getTheme, THEME_NAMES, type ThemeName } from "./theme";

interface Outputs {
  svg: string;
}

export type Format = keyof Outputs;

export interface RenderOptions<F extends Format = Format> {
  /** Which outputs to make, from one layout pass. Default: svg only. */
  readonly formats?: readonly F[];
  /** The colour theme. Wins over the diagram's own `theme`. Default: light. */
  readonly theme?: ThemeName;
  /** Embed the font faces the SVG's text is drawn in. Default: true. */
  readonly embedFonts?: boolean;
}

export type RenderResult<F extends Format = "svg"> = Pick<Outputs, F>;

/** Turns one diagram (a JSON string or an already-parsed object) into the requested outputs. */
export async function render<F extends Format = "svg">(
  input: string | object,
  options: RenderOptions<F> = {},
): Promise<RenderResult<F>> {
  const { formats, theme: themeName, embedFonts } = readOptions(options);
  const parsed = parseDiagram(input);
  if (!parsed.ok) throw new StructaError("INVALID_INPUT", parsed.problems);
  const { diagram } = parsed;

  const theme = getTheme(themeName ?? diagram.theme);
  const cards = buildCards(diagram.nodes, theme.sizes).map((card, i) => ({ ...card, path: `nodes[${i}]` }));
  const index = new Map(diagram.nodes.map((node, i) => [node.id, i]));
  const lines = diagram.edges.map((edge, i) => {
    const source = index.get(edge.from)!;
    const target = index.get(edge.to)!;
    const line = buildLine(edge, diagram.nodes[source]!.label, diagram.nodes[target]!.label, theme.sizes);
    return { ...line, source, target, path: `edges[${i}]` };
  });
  const scene = await layout({ cards, lines }, FLOW_PROFILE, diagram.direction);
  const header = buildHeader(diagram.title, diagram.description, theme.sizes);
  const statuses = [...diagram.nodes, ...diagram.edges].map((item) => item.status);
  const legend = diagram.legend ? buildLegend(statuses, theme.sizes) : undefined;
  const outputs: Outputs = { svg: paint({ scene, header, legend }, theme, { embedFonts }) };

  const result: Partial<Outputs> = {};
  for (const format of formats) result[format] = outputs[format];
  return result as RenderResult<F>;
}

interface CheckedOptions {
  formats: readonly Format[];
  theme: ThemeName | undefined;
  embedFonts: boolean;
}

/** The options, checked. Every problem with them is reported at once, as INVALID_OPTIONS. */
function readOptions(options: unknown): CheckedOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    const hint = 'write them as {"theme": "dark"}, for example';
    throw new StructaError("INVALID_OPTIONS", [{ path: "options", message: "must be an object", hint }]);
  }
  const asked = options as { formats?: unknown; theme?: unknown; embedFonts?: unknown };
  const problems: Problem[] = [];
  const formats = readFormats(asked.formats, problems);
  const theme = readTheme(asked.theme, problems);
  const embedFonts = readEmbedFonts(asked.embedFonts, problems);
  if (problems.length > 0) throw new StructaError("INVALID_OPTIONS", problems);
  return { formats, theme, embedFonts };
}

const FORMATS: readonly Format[] = ["svg"];

function readFormats(formats: unknown, problems: Problem[]): readonly Format[] {
  if (formats === undefined) return ["svg"];
  const hint = `use ${JSON.stringify(FORMATS)}`;
  if (!Array.isArray(formats)) problems.push({ path: "options.formats", message: "must be a list of formats", hint });
  else if (formats.length === 0) problems.push({ path: "options.formats", message: "must list at least one format", hint });
  else {
    formats.forEach((format: unknown, i) => {
      if (FORMATS.includes(format as Format)) return;
      problems.push({ path: `options.formats[${i}]`, message: `format ${JSON.stringify(format)} is not supported yet`, hint });
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
