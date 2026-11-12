import type { Problem } from "../errors";
import { check } from "./check";
import { diagramDefinition, type Status } from "./definitions";
import { parseJson } from "./json";

export { STATUSES, STEP_LABEL_FACE, type Status } from "./definitions";
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
  readonly status?: Status;
  readonly emphasis: boolean;
}

/** Which way the diagram flows. */
export type Direction = "down" | "right";

export interface FlowDiagram {
  readonly type: "flow";
  readonly direction: Direction;
  readonly nodes: readonly FlowStep[];
  readonly edges: readonly FlowEdge[];
}

export type Diagram = FlowDiagram;

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
  const diagram = checked.value as Omit<FlowDiagram, "edges"> & { edges: readonly (Omit<FlowEdge, "id"> & { id?: string })[] };
  return {
    ok: true,
    diagram: {
      type: diagram.type,
      direction: diagram.direction,
      nodes: diagram.nodes,
      edges: diagram.edges.map((edge, i) => ({ ...edge, id: edge.id ?? `edges[${i}]` })),
    },
  };
}
