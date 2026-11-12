import type { Problem } from "../errors";
import type { ThemeName } from "../theme";
import { check } from "./check";
import { diagramDefinition, type CLASS_EDGE_KINDS, type Status } from "./definitions";
import { parseJson } from "./json";

export {
  CLASS_NAME_FACE,
  DESCRIPTION_FACE,
  DIAGRAM_TYPES,
  LINE_LABEL_FACE,
  STATUSES,
  STEP_LABEL_FACE,
  TITLE_FACE,
  type Status,
} from "./definitions";
export { jsonSchema } from "./schema";

export interface FlowStep {
  readonly id: string;
  /** Tidied: runs of spaces collapsed and the ends trimmed. */
  readonly label: string;
  readonly status?: Status;
  readonly shape: "step";
}

export interface FlowEdge {
  /** The explicit id, or `edges[N]` when the edge has none. */
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Tidied, like every text field. */
  readonly label?: string;
  readonly status?: Status;
  readonly emphasis: boolean;
}

export interface ClassEdge extends FlowEdge {
  readonly kind: (typeof CLASS_EDGE_KINDS)[number];
}

export interface ClassNode {
  readonly id: string;
  /** The class name, tidied. */
  readonly label: string;
  readonly status?: Status;
}

/** Which way the diagram flows. */
export type Direction = "down" | "right";

/** What every diagram type shares at the top level. */
interface DiagramBase<T extends string, N, E> {
  readonly type: T;
  readonly title?: string;
  readonly description?: string;
  readonly theme: ThemeName;
  readonly direction: Direction;
  /** Whether to draw the legend of the statuses used. */
  readonly legend: boolean;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
}

export type FlowDiagram = DiagramBase<"flow", FlowStep, FlowEdge>;
export type ClassDiagram = DiagramBase<"class", ClassNode, ClassEdge>;
export type Diagram = FlowDiagram | ClassDiagram;

export type ParseResult =
  | { readonly ok: true; readonly diagram: Diagram }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/**
 * Parses a JSON string or an already-parsed value into a diagram, or lists
 * every problem found. The checks come from the shared input definitions.
 */
export function parseDiagram(input: unknown): ParseResult {
  let value = input;
  if (typeof input === "string") {
    const parsed = parseJson(input);
    if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
    value = parsed.value;
  }

  const type = typeof value === "object" && value !== null ? (value as { type?: unknown }).type : undefined;
  const checked = check(diagramDefinition(type), value);
  if (checked.problems.length > 0) return { ok: false, problems: checked.problems };

  // Without problems, the checked value has exactly the shape the definitions describe.
  const diagram = checked.value as Omit<Diagram, "edges"> & { edges: readonly (Omit<FlowEdge, "id"> & { id?: string })[] };
  return {
    ok: true,
    diagram: {
      type: diagram.type,
      ...(diagram.title === undefined ? {} : { title: diagram.title }),
      ...(diagram.description === undefined ? {} : { description: diagram.description }),
      theme: diagram.theme,
      direction: diagram.direction,
      legend: diagram.legend,
      nodes: diagram.nodes,
      edges: diagram.edges.map((edge, i) => ({ ...edge, id: edge.id ?? `edges[${i}]` })),
    } as Diagram,
  };
}
