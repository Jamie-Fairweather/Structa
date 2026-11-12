import type { Problem } from "../errors";
import type { ThemeName } from "../theme";
import { check } from "./check";
import {
  CLASS_SECTIONS,
  diagramDefinition,
  type CLASS_EDGE_KINDS,
  type FlowShape,
  type Status,
  type VISIBILITIES,
} from "./definitions";
import { parseJson } from "./json";

export {
  CARD_DESCRIPTION_FACE,
  CLASS_DESCRIPTION_FACE,
  CLASS_NAME_FACE,
  CLASS_SECTIONS,
  DESCRIPTION_FACE,
  DIAGRAM_TYPES,
  LINE_LABEL_FACE,
  NOTE_LABEL_FACE,
  ROW_TEXT_FACE,
  STATUSES,
  STEP_LABEL_FACE,
  TITLE_FACE,
  type FlowShape,
  type Status,
} from "./definitions";
export { jsonSchema } from "./schema";

export interface FlowNode {
  readonly id: string;
  /** Tidied: runs of spaces collapsed and the ends trimmed. */
  readonly label: string;
  /** Tidied, like every text field. */
  readonly description?: string;
  readonly status?: Status;
  readonly shape: FlowShape;
  /** A note's subject: the id of a node that isn't a note. Only notes have one. */
  readonly about?: string;
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

export type Visibility = (typeof VISIBILITIES)[number];

/** One member of a class. */
export interface ClassRow {
  /** The explicit id, or its section and position, like `methods[2]`. Unique within its card. */
  readonly id: string;
  readonly text: string;
  readonly visibility?: Visibility;
  /** Its own status, or, when it has none, its card's when the card is new or removed. */
  readonly status?: Status;
}

export interface ClassNode {
  readonly id: string;
  /** The class name, tidied. */
  readonly label: string;
  readonly description?: string;
  readonly status?: Status;
  readonly properties: readonly ClassRow[];
  readonly methods: readonly ClassRow[];
  /** How many members were left out on purpose. */
  readonly more?: number;
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

export type FlowDiagram = DiagramBase<"flow", FlowNode, FlowEdge>;
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

  // Without problems, the checked value has exactly the shape the definitions describe, less the ids made here.
  const diagram = checked.value as Omit<Diagram, "nodes" | "edges"> & {
    nodes: readonly (FlowNode | WithoutIds<ClassNode>)[];
    edges: readonly (Omit<FlowEdge, "id"> & { id?: string })[];
  };
  return {
    ok: true,
    diagram: {
      type: diagram.type,
      ...(diagram.title === undefined ? {} : { title: diagram.title }),
      ...(diagram.description === undefined ? {} : { description: diagram.description }),
      theme: diagram.theme,
      direction: diagram.direction,
      legend: diagram.legend,
      nodes: diagram.type === "class" ? (diagram.nodes as WithoutIds<ClassNode>[]).map(classNode) : diagram.nodes,
      edges: diagram.edges.map((edge, i) => ({ ...edge, id: edge.id ?? `edges[${i}]` })),
    } as Diagram,
  };
}

/** A class node as checked: rows may have no id yet. */
type WithoutIds<N extends ClassNode> = Omit<N, (typeof CLASS_SECTIONS)[number]> & {
  readonly [section in (typeof CLASS_SECTIONS)[number]]: readonly (Omit<ClassRow, "id"> & { id?: string })[];
};

/**
 * Gives every row its id (its own, or its section and position) and its
 * status: a row without one in a new or removed card takes the card's.
 */
function classNode(node: WithoutIds<ClassNode>): ClassNode {
  const inherited = node.status === "new" || node.status === "removed" ? node.status : undefined;
  const [properties, methods] = CLASS_SECTIONS.map((section) =>
    node[section].map((row, i): ClassRow => {
      const status = row.status ?? inherited;
      return { ...row, id: row.id ?? `${section}[${i}]`, ...(status === undefined ? {} : { status }) };
    }),
  );
  return { ...node, properties: properties!, methods: methods! };
}
