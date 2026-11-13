import type { Problem } from "../errors";
import { check, type Result } from "./check";
import {
  ARCHITECTURE_DIAGRAM,
  CLASS_DIAGRAM,
  CLASS_SECTIONS,
  ER_DIAGRAM,
  FLOW_DIAGRAM,
  sharedDefinition,
  unknownTypeDefinition,
  type CARDINALITIES,
  type Checked,
  type ClassCardField,
  type ClassSection,
  type ComponentKind,
  type Flat,
  type ObjectDef,
  type Status,
  type STEREOTYPES,
  type VISIBILITIES,
} from "./definitions";
import { parseJson } from "./json";
import { jsonSchema as schemaOf } from "./schema";

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
  END_LABEL_FACE,
  ENUM_SECTIONS,
  KIND_WORD_FACE,
  LINE_LABEL_FACE,
  MEMBER_SECTIONS,
  NOTE_LABEL_FACE,
  PARENT_KINDS,
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
  type Direction,
  type FlowShape,
  type Status,
} from "./definitions";
export { fieldPath, type Result } from "./check";

/*
 * Every type below is derived from the shared input definitions, through
 * Checked: what input that passes a definition is once checked. Reading a
 * diagram then only adds what checking doesn't: an id for each edge and row
 * that has none, a row's status taken from its card, and empty lists.
 */

/** A diagram type's definition, as checked. */
type CheckedDiagram<T extends { readonly definition: ObjectDef }> = Checked<T["definition"]>;
type NodeOf<T extends { readonly definition: ObjectDef }> = CheckedDiagram<T> extends { readonly nodes: readonly (infer N)[] } ? N : never;
type EdgeOf<T extends { readonly definition: ObjectDef }> = CheckedDiagram<T> extends { readonly edges: readonly (infer E)[] } ? WithId<E> : never;

/** With its id: an edge without one is known as `edges[N]`, and a row as its section and position, like `methods[2]`. */
type WithId<T> = T & { readonly id: string };

/** A named grouping of cards. Areas nest at most 4 levels deep, never in a loop. */
export type Area = CheckedDiagram<typeof CLASS_DIAGRAM>["areas"][number];

export type FlowNode = NodeOf<typeof FLOW_DIAGRAM>;
export type FlowEdge = EdgeOf<typeof FLOW_DIAGRAM>;

type CheckedClassNode = NodeOf<typeof CLASS_DIAGRAM>;

/** One member of a class, or one value of an enum. Its status is its own, or, when it has none, its card's when the card is new or removed. */
export type ClassRow = WithId<NonNullable<CheckedClassNode["properties"]>[number]>;

/** A class: every list of rows there, empty when left out, and its abstract flag, false when left out. */
export type ClassNode = Flat<
  Omit<CheckedClassNode, ClassSection | "abstract"> & { readonly abstract: boolean } & { readonly [section in ClassSection]: readonly ClassRow[] }
>;
export type ClassEdge = EdgeOf<typeof CLASS_DIAGRAM>;

type CheckedArchitectureNode = NodeOf<typeof ARCHITECTURE_DIAGRAM>;

/** A component of an architecture diagram: any kind but a class, which has a class card. */
export type ComponentNode = Flat<Omit<CheckedArchitectureNode, ClassCardField | "kind"> & { readonly kind: ComponentKind }>;

/** A class in an architecture diagram, drawn as a class card. */
export type ArchitectureClassNode = Flat<ClassNode & { readonly kind: "class" }>;

export type ArchitectureNode = ComponentNode | ArchitectureClassNode;
export type ArchitectureEdge = EdgeOf<typeof ARCHITECTURE_DIAGRAM>;

export type TableNode = NodeOf<typeof ER_DIAGRAM>;
/** One column of a table. Its name is unique within the table, and is what the row is known by. */
export type TableColumn = TableNode["columns"][number];
export type ErEdge = EdgeOf<typeof ER_DIAGRAM>;

export type Visibility = (typeof VISIBILITIES)[number];
export type Stereotype = (typeof STEREOTYPES)[number];
/** How many rows at one end of a relationship go with one row at the other. */
export type Cardinality = (typeof CARDINALITIES)[number];

/** The top level every diagram type shares, as checked. */
type Shared = Checked<ReturnType<typeof sharedDefinition>>;

/**
 * A diagram of the type named `T`, normalised: its top level as checked,
 * without the version, and its nodes and edges read.
 */
export interface DiagramModel<T extends string, N, E> extends Omit<Shared, "version" | "type" | "nodes" | "edges"> {
  readonly type: T;
  readonly nodes: readonly N[];
  readonly edges: readonly E[];
}

/** What every node has, whatever its diagram's type. */
export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  /** The id of the innermost area its card is in. */
  readonly area?: string;
  readonly status?: Status;
}

/** What every edge has, whatever its diagram's type. */
export type DiagramEdge = FlowEdge;

export type FlowDiagram = DiagramModel<"flow", FlowNode, FlowEdge>;
export type ClassDiagram = DiagramModel<"class", ClassNode, ClassEdge>;
export type ErDiagram = DiagramModel<"er", TableNode, ErEdge>;
export type ArchitectureDiagram = DiagramModel<"architecture", ArchitectureNode, ArchitectureEdge>;
export type Diagram = FlowDiagram | ClassDiagram | ErDiagram | ArchitectureDiagram;

/** One diagram type, as far as its input goes: its name, its definition, and how a value is checked against it and read. */
export interface InputType<T extends string, M> {
  readonly type: T;
  readonly definition: ObjectDef;
  /** Checks a value against the definition and, when it passes, reads it. */
  readonly parse: (value: unknown) => Result<M>;
}

/** A diagram type's input, reading what passes its definition with `read`. */
function inputType<T extends string, D extends ObjectDef, M>(
  { type, definition }: { readonly type: T; readonly definition: D },
  read: (checked: Checked<D>) => M,
): InputType<T, M> {
  return {
    type,
    definition,
    parse: (value) => {
      const checked = check(definition, value);
      return checked.ok ? { ok: true, value: read(checked.value) } : checked;
    },
  };
}

export const CLASS_INPUT = inputType(CLASS_DIAGRAM, (diagram) => model(diagram, diagram.nodes.map(classNode)));
export const ER_INPUT = inputType(ER_DIAGRAM, (diagram) => model(diagram, diagram.nodes.map(tableNode)));
export const FLOW_INPUT = inputType(FLOW_DIAGRAM, (diagram) => model(diagram, diagram.groupAreas ? notesInAreas(diagram.nodes) : diagram.nodes));
export const ARCHITECTURE_INPUT = inputType(ARCHITECTURE_DIAGRAM, (diagram) => model(diagram, diagram.nodes.map(architectureNode)));

const TYPES = [CLASS_INPUT, ER_INPUT, FLOW_INPUT, ARCHITECTURE_INPUT];

/** The diagram types implemented so far, in the spec's order. Each has an example, examples/<type>.json. */
export const DIAGRAM_TYPES: readonly Diagram["type"][] = TYPES.map((type) => type.type);

/** The JSON Schema for every diagram type. */
export function jsonSchema() {
  return schemaOf(TYPES);
}

/**
 * Parses a JSON string or an already-parsed value into a diagram, or lists
 * every problem found. The checks come from the shared input definitions.
 */
export function parseDiagram(input: unknown): Result<Diagram> {
  const selected = selectType(input, TYPES);
  return selected.ok ? selected.type.parse(selected.value) : selected;
}

/**
 * Reads JSON text, or takes an already-parsed value, and picks the one of
 * `types` its `type` names. When it names none of them, it's checked against
 * the fields every type shares instead, to report every problem with them.
 */
export function selectType<I extends { readonly type: string }>(
  input: unknown,
  types: readonly I[],
): { readonly ok: true; readonly value: unknown; readonly type: I } | { readonly ok: false; readonly problems: readonly Problem[] } {
  let value = input;
  if (typeof input === "string") {
    const parsed = parseJson(input);
    if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
    value = parsed.value;
  }
  const name = typeof value === "object" && value !== null && "type" in value ? value.type : undefined;
  const type = types.find((t) => t.type === name);
  if (type !== undefined) return { ok: true, value, type };
  // Its type is missing, or none of these, so checking it always finds that problem.
  const checked = check(unknownTypeDefinition(types.map((t) => t.type)), value);
  return { ok: false, problems: checked.ok ? [] : checked.problems };
}

/** A diagram's top level, as checked, whatever its type: with its type's name and its edges. */
type CheckedTop<T extends string, E> = Omit<Shared, "type" | "nodes" | "edges"> & { readonly type: T; readonly edges: readonly E[] };

/** The diagram as checked, with its `nodes` read, and each edge given its id. */
function model<T extends string, N, E extends { readonly id?: string }>(checked: CheckedTop<T, E>, nodes: readonly N[]): DiagramModel<T, N, WithId<E>> {
  return {
    type: checked.type,
    ...(checked.title === undefined ? {} : { title: checked.title }),
    ...(checked.description === undefined ? {} : { description: checked.description }),
    theme: checked.theme,
    direction: checked.direction,
    groupAreas: checked.groupAreas,
    legend: checked.legend,
    areas: checked.areas,
    nodes,
    edges: checked.edges.map((edge, i) => ({ ...edge, id: edge.id ?? `edges[${i}]` })),
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
 * Gives the card every list, empty when left out, its abstract flag, false
 * when left out, and every row its id (its own, or its section and position)
 * and its status: a row without one in a new or removed card takes the card's.
 * The flag may be left out of a class in an architecture diagram, where only
 * a class may have it, so it has no default there.
 */
function classNode(node: CheckedClassNode): ClassNode {
  const [properties, methods, values] = CLASS_SECTIONS.map((section) =>
    (node[section] ?? []).map((row, i): ClassRow => ({ ...withStatus(row, node.status), id: row.id ?? `${section}[${i}]` })),
  );
  return { ...node, abstract: node.abstract ?? false, properties: properties!, methods: methods!, values: values! };
}

/** A class card for a class, or the node as it is for a component. */
function architectureNode(node: CheckedArchitectureNode): ArchitectureNode {
  const { kind } = node;
  return kind === "class" ? { ...classNode(node), kind } : { ...node, kind };
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
