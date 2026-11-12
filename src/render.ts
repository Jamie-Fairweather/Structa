import { StructaError } from "./errors";
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
  /** Embed the used font faces in the SVG. Fonts aren't embedded yet, so this has no effect. */
  readonly embedFonts?: boolean;
  /** The colour theme. Default: light. */
  readonly theme?: ThemeName;
}

export type RenderResult<F extends Format = "svg"> = Pick<Outputs, F>;

/** Turns one diagram (a JSON string or an already-parsed object) into the requested outputs. */
export async function render<F extends Format = "svg">(
  input: string | object,
  options: RenderOptions<F> = {},
): Promise<RenderResult<F>> {
  const formats = readFormats(options?.formats);
  const themeName = readTheme(options?.theme);
  const parsed = parseDiagram(input);
  if (!parsed.ok) throw new StructaError("INVALID_INPUT", parsed.problems);
  const { diagram } = parsed;

  const theme = getTheme(themeName);
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
  const outputs: Outputs = { svg: paint({ scene, header, legend }, theme) };

  const result: Partial<Outputs> = {};
  for (const format of formats) result[format] = outputs[format];
  return result as RenderResult<F>;
}

const FORMATS: readonly Format[] = ["svg"];

function readFormats(formats: unknown): readonly Format[] {
  if (formats === undefined) return ["svg"];
  const hint = `use ${JSON.stringify(FORMATS)}`;
  const fail = (path: string, message: string) => new StructaError("INVALID_OPTIONS", [{ path, message, hint }]);
  if (!Array.isArray(formats)) throw fail("options.formats", "must be a list of formats");
  if (formats.length === 0) throw fail("options.formats", "must list at least one format");
  const problems = formats.flatMap((format: unknown, i) =>
    FORMATS.includes(format as Format)
      ? []
      : [{ path: `options.formats[${i}]`, message: `format ${JSON.stringify(format)} is not supported yet`, hint }],
  );
  if (problems.length > 0) throw new StructaError("INVALID_OPTIONS", problems);
  return FORMATS.filter((format) => formats.includes(format));
}

function readTheme(theme: unknown): ThemeName {
  if (theme === undefined) return "light";
  if (THEME_NAMES.includes(theme as ThemeName)) return theme as ThemeName;
  throw new StructaError("INVALID_OPTIONS", [
    { path: "options.theme", message: `${JSON.stringify(theme)} is not a theme`, hint: 'use "light" or "dark"' },
  ]);
}
