import { StructaError } from "./errors";
import { parseDiagram } from "./input";
import { FLOW_PROFILE, layout } from "./layout";
import { paint } from "./painter";
import { buildStep } from "./shapes";
import { getTheme } from "./theme";

interface Outputs {
  svg: string;
}

export type Format = keyof Outputs;

export interface RenderOptions<F extends Format = Format> {
  /** Which outputs to make, from one layout pass. Default: svg only. */
  readonly formats?: readonly F[];
  /** Embed the used font faces in the SVG. Fonts aren't embedded yet, so this has no effect. */
  readonly embedFonts?: boolean;
}

export type RenderResult<F extends Format = "svg"> = Pick<Outputs, F>;

/** Turns one diagram (a JSON string or an already-parsed object) into the requested outputs. */
export async function render<F extends Format = "svg">(
  input: string | object,
  options: RenderOptions<F> = {},
): Promise<RenderResult<F>> {
  const parsed = parseDiagram(input);
  if (!parsed.ok) throw new StructaError("INVALID_INPUT", parsed.problems);
  const { diagram } = parsed;

  const theme = getTheme("light");
  const cards = diagram.nodes.map((node, i) => ({ ...buildStep(node, theme.sizes), path: `nodes[${i}]` }));
  const scene = await layout({ cards }, FLOW_PROFILE);
  const svg = paint(scene, theme);

  void options;
  return { svg } as RenderResult<F>;
}
