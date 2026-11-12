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

type Json = { readonly [key: string]: unknown };

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

  const problems: Problem[] = [];
  const problem = (path: string, message: string, hint?: string) =>
    problems.push(hint === undefined ? { path, message } : { path, message, hint });

  if (!isObject(value)) {
    problem("$", "must be an object describing one diagram");
    return { ok: false, problems };
  }
  if (value.type !== "flow") problem("type", 'only "flow" is supported so far');
  const direction = value.direction ?? "down";
  if (direction !== "down" && direction !== "right") problem("direction", 'must be "down" or "right"');

  const nodes: FlowStep[] = [];
  // Every node with a usable id, even one with other problems, so edges to it aren't reported as dangling.
  const nodeIds = new Set<string>();
  if (!Array.isArray(value.nodes)) {
    problem("nodes", "must be a list of nodes");
  } else {
    value.nodes.forEach((node: unknown, i) => {
      const path = `nodes[${i}]`;
      if (!isObject(node)) return problem(path, "must be an object");
      const id = node.id;
      if (!isId(id)) problem(`${path}.id`, "must be a non-empty string");
      else if (nodeIds.has(id)) problem(`${path}.id`, `another node already has the id "${id}"`, "give every node its own id");
      else nodeIds.add(id);
      if (typeof node.label !== "string") problem(`${path}.label`, "must be a string");
      if (node.shape !== "step") problem(`${path}.shape`, 'only "step" is supported so far');
      if (isId(id) && typeof node.label === "string") nodes.push({ id, label: node.label, shape: "step" });
    });
  }

  const edges: FlowEdge[] = [];
  if (value.edges !== undefined && !Array.isArray(value.edges)) {
    problem("edges", "must be a list of edges");
  } else {
    (value.edges ?? []).forEach((edge: unknown, i: number) => {
      const path = `edges[${i}]`;
      if (!isObject(edge)) return problem(path, "must be an object");
      if (edge.id !== undefined && !isId(edge.id)) problem(`${path}.id`, "must be a non-empty string");
      for (const end of ["from", "to"] as const) {
        const target = edge[end];
        if (typeof target !== "string") problem(`${path}.${end}`, "must be a node id");
        else if (!nodeIds.has(target)) problem(`${path}.${end}`, `no node with id "${target}"`, "use the id of one of the nodes");
      }
      edges.push({ id: typeof edge.id === "string" ? edge.id : path, from: String(edge.from), to: String(edge.to) });
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, diagram: { type: "flow", direction: direction as Direction, nodes, edges } };
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
