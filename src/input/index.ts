import type { Problem } from "../errors";

export interface FlowStep {
  readonly id: string;
  readonly label: string;
  readonly shape: "step";
}

export interface FlowEdge {
  /** The explicit id, or `edges[N]` when the edge has none. */
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface FlowDiagram {
  readonly type: "flow";
  readonly nodes: readonly FlowStep[];
  readonly edges: readonly FlowEdge[];
}

export type Diagram = FlowDiagram;

export type ParseResult =
  | { readonly ok: true; readonly diagram: Diagram }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** Parses a JSON string or an already-parsed value into a diagram, or lists every problem found. */
export function parseDiagram(input: unknown): ParseResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { ok: false, problems: [{ path: "$", message: `invalid JSON: ${(error as Error).message}` }] };
    }
  }

  const top = value as { nodes: { id: string; label: string }[]; edges?: { id?: string; from: string; to: string }[] };
  const nodes: FlowStep[] = top.nodes.map((node) => ({ id: node.id, label: node.label, shape: "step" }));
  const edges: FlowEdge[] = (top.edges ?? []).map((edge, i) => ({
    id: edge.id ?? `edges[${i}]`,
    from: edge.from,
    to: edge.to,
  }));
  return { ok: true, diagram: { type: "flow", nodes, edges } };
}
