import type { Problem } from "../errors";
import type { ThemeName } from "../theme";
import { check } from "./check";
import {
  CLASS_SECTIONS,
  diagramDefinition,
  type ARCHITECTURE_EDGE_KINDS,
  type CARDINALITIES,
  type CLASS_EDGE_KINDS,
  type ComponentKind,
  type FlowShape,
  type Status,
  type STEREOTYPES,
  type VISIBILITIES,
} from "./definitions";
import { parseJson } from "./json";

export {
  ABSTRACT_CLASS_NAME_FACE,
  ABSTRACT_ROW_TEXT_FACE,
  AREA_LABEL_FACE,
  CARD_DESCRIPTION_FACE,
  CLASS_DESCRIPTION_FACE,
  CLASS_NAME_FACE,
  CLASS_SECTIONS,
  COLUMN_NAME_FACE,
  COLUMN_TYPE_FACE,
  COMPONENT_LABEL_FACE,
  DESCRIPTION_FACE,
  DIAGRAM_TYPES,
  ENUM_SECTIONS,
  KIND_WORD_FACE,
  LINE_LABEL_FACE,
  MEMBER_SECTIONS,
  NOTE_LABEL_FACE,
  ROW_TEXT_FACE,
  STATUSES,
  STEP_LABEL_FACE,
  STEREOTYPE_FACE,
  TABLE_DESCRIPTION_FACE,
  TABLE_NAME_FACE,
  TITLE_FACE,
  type ArchitectureKind,
  type ClassSection,
  type ComponentKind,
  type FlowShape,
  type Status,
} from "./definitions";
export { jsonSchema } from "./schema";

/** A named grouping of cards. */
export interface Area {
  readonly id: string;
  /** Tidied, like every text field. */
  readonly label: string;
  /** The id of the area it's inside. Areas nest at most 4 levels deep, never in a loop. */
  readonly parent?: string;
}

export interface FlowNode {
  readonly id: string;
  /** Tidied: runs of spaces collapsed and the ends trimmed. */
  readonly label: string;
  /** Tidied, like every text field. */
  readonly description?: string;
  /** The id of the innermost area the card is in. With groupAreas, a note about a shape is in that shape's area. */
  readonly area?: string;
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

export type Stereotype = (typeof STEREOTYPES)[number];

/** One member of a class, or one value of an enum. */
export interface ClassRow {
  /** The explicit id, or its section and position, like `methods[2]`. Unique within its card. */
  readonly id: string;
  readonly text: string;
  readonly visibility?: Visibility;
  /** Drawn underlined. */
  readonly static: boolean;
  /** Drawn in italics. */
  readonly abstract: boolean;
  /** Its own status, or, when it has none, its card's when the card is new or removed. */
  readonly status?: Status;
}

export interface ClassNode {
  readonly id: string;
  /** The class name, tidied. */
  readonly label: string;
  readonly description?: string;
  /** The id of the innermost area the card is in. */
  readonly area?: string;
  readonly status?: Status;
  readonly stereotype?: Stereotype;
  /** Set by the flag only; a class whose stereotype is "abstract" is abstract too. */
  readonly abstract: boolean;
  /** A class's members. An enum has none. */
  readonly properties: readonly ClassRow[];
  readonly methods: readonly ClassRow[];
  /** An enum's values. Only an enum has any. */
  readonly values: readonly ClassRow[];
  /** How many members or values were left out on purpose. */
  readonly more?: number;
}

/** A component of an architecture diagram: any kind but a class, which has a class card. */
export interface ComponentNode {
  readonly id: string;
  /** Tidied, like every text field. */
  readonly label: string;
  readonly description?: string;
  /** The id of the innermost area the card is in. */
  readonly area?: string;
  readonly status?: Status;
  readonly kind: ComponentKind;
}

/** A class in an architecture diagram, drawn as a class card. */
export interface ArchitectureClassNode extends ClassNode {
  readonly kind: "class";
}

export type ArchitectureNode = ComponentNode | ArchitectureClassNode;

export interface ArchitectureEdge extends FlowEdge {
  /** "call" when the input leaves it out. */
  readonly kind: (typeof ARCHITECTURE_EDGE_KINDS)[number];
}

/** How many rows at one end of a relationship go with one row at the other. */
export type Cardinality = (typeof CARDINALITIES)[number];

/** One column of a table. Its name is unique within the table, and is what the row is known by. */
export interface TableColumn {
  /** Tidied, like every text field. */
  readonly name: string;
  readonly type: string;
  readonly pk: boolean;
  readonly fk: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly status?: Status;
}

export interface TableNode {
  readonly id: string;
  /** The table's name, tidied. */
  readonly label: string;
  readonly description?: string;
  /** The id of the innermost area the card is in. */
  readonly area?: string;
  readonly status?: Status;
  readonly columns: readonly TableColumn[];
  /** How many columns were left out on purpose. */
  readonly more?: number;
}

/** A relationship between two tables, with a crow's foot at each end. */
export interface ErEdge extends FlowEdge {
  readonly fromCardinality: Cardinality;
  readonly toCardinality: Cardinality;
  /** False when the database doesn't enforce it with a foreign key. */
  readonly enforced: boolean;
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
  /** Draw a box round each area's cards, rather than a tag on each card. */
  readonly groupAreas: boolean;
  /** Whether to draw the legend of the statuses and areas used. */
  readonly legend: boolean;
  /** In the order given. Every one holds a card, directly or through the areas inside it. */
  readonly areas: readonly Area[];
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
}

export type FlowDiagram = DiagramBase<"flow", FlowNode, FlowEdge>;
export type ClassDiagram = DiagramBase<"class", ClassNode, ClassEdge>;
export type ErDiagram = DiagramBase<"er", TableNode, ErEdge>;
export type ArchitectureDiagram = DiagramBase<"architecture", ArchitectureNode, ArchitectureEdge>;
export type Diagram = FlowDiagram | ClassDiagram | ErDiagram | ArchitectureDiagram;

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
    nodes: readonly (FlowNode | WithoutIds<ClassNode> | TableNode | ComponentNode | WithoutIds<ArchitectureClassNode>)[];
    edges: readonly (Omit<FlowEdge, "id"> & { id?: string })[];
  };
  const nodes =
    diagram.type === "class"
      ? (diagram.nodes as WithoutIds<ClassNode>[]).map(classNode)
      : diagram.type === "er"
        ? (diagram.nodes as TableNode[]).map(tableNode)
        : diagram.type === "architecture"
          ? (diagram.nodes as (ComponentNode | WithoutIds<ArchitectureClassNode>)[]).map((node) =>
              node.kind === "class" ? { ...classNode(node), kind: "class" as const } : node,
            )
          : diagram.groupAreas
            ? notesInAreas(diagram.nodes as FlowNode[])
            : (diagram.nodes as FlowNode[]);
  return {
    ok: true,
    diagram: {
      type: diagram.type,
      ...(diagram.title === undefined ? {} : { title: diagram.title }),
      ...(diagram.description === undefined ? {} : { description: diagram.description }),
      theme: diagram.theme,
      direction: diagram.direction,
      groupAreas: diagram.groupAreas,
      legend: diagram.legend,
      areas: diagram.areas,
      nodes,
      edges: diagram.edges.map((edge, i) => ({ ...edge, id: edge.id ?? `edges[${i}]` })),
    } as Diagram,
  };
}

/**
 * With area boxes, a note about a shape is in that shape's box, whether it
 * says so or not: ELK can't join a note to a shape in another area. Tags
 * show only the area a note is given.
 */
function notesInAreas(nodes: readonly FlowNode[]): FlowNode[] {
  const areas = new Map(nodes.map((node) => [node.id, node.area]));
  return nodes.map((node) => {
    const area = node.about === undefined ? undefined : areas.get(node.about);
    return area === undefined || node.area !== undefined ? node : { ...node, area };
  });
}

/**
 * A class node as checked: a list left out isn't there, and rows may have no
 * id yet. The abstract flag may be missing too: in an architecture diagram,
 * where only a class may have it, it has no default.
 */
type WithoutIds<N extends ClassNode> = Omit<N, (typeof CLASS_SECTIONS)[number] | "abstract"> & {
  readonly abstract?: boolean;
} & {
  readonly [section in (typeof CLASS_SECTIONS)[number]]?: readonly (Omit<ClassRow, "id"> & { id?: string })[];
};

/**
 * Gives the card every list, empty when left out, its abstract flag, false
 * when left out, and every row its id (its own, or its section and position)
 * and its status: a row without one in a new or removed card takes the card's.
 */
function classNode(node: WithoutIds<ClassNode>): ClassNode {
  const [properties, methods, values] = CLASS_SECTIONS.map((section) =>
    (node[section] ?? []).map((row, i): ClassRow => ({ ...withStatus(row, node.status), id: row.id ?? `${section}[${i}]` })),
  );
  return { ...node, abstract: node.abstract ?? false, properties: properties!, methods: methods!, values: values! };
}

/** Gives every column its status: a column without one in a new or removed table takes the table's. */
function tableNode(node: TableNode): TableNode {
  return { ...node, columns: node.columns.map((column) => withStatus(column, node.status)) };
}

/** A row with its own status, or, when it has none, its card's when the card is new or removed. */
function withStatus<R extends { readonly status?: Status }>(row: R, card: Status | undefined): R {
  const status = row.status ?? (card === "new" || card === "removed" ? card : undefined);
  return status === undefined ? row : { ...row, status };
}
