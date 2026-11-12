/**
 * The shared input definitions: the one description of the JSON format.
 * The validator (check.ts) and the JSON Schema (schema.ts) are both generated
 * from these, so they can't disagree. Every new field goes here.
 */
import type { FaceId } from "../text";

/** One kind of text, with its length limit. Limits are set here once and shown in the schema. */
export interface TextKind {
  /** Its name under `$defs` in the schema. */
  readonly name: string;
  readonly maxLength: number;
  readonly description: string;
}

const LABEL: TextKind = { name: "label", maxLength: 100, description: "the name shown on a card" };
// No field uses these two yet: descriptions and line labels arrive with their drawing.
const DESCRIPTION: TextKind = { name: "description", maxLength: 300, description: "a sentence about a card" };
const LINE_LABEL: TextKind = { name: "lineLabel", maxLength: 60, description: "a short label on a line" };
export const TEXT_KINDS: readonly TextKind[] = [LABEL, DESCRIPTION, LINE_LABEL];

/** Node, edge and area ids: letters, digits and `-_.:`. Brackets can't appear, so `edges[N]` never clashes. */
export const ID_PATTERN = "^[A-Za-z0-9_.:-]+$";

export type Def =
  | ObjectDef
  | ListDef
  | TextDef
  | { readonly kind: "id"; readonly of: "node" | "edge" }
  | { readonly kind: "ref"; readonly to: "node" }
  | ChoiceDef
  | { readonly kind: "const"; readonly value: number }
  | { readonly kind: "any" };

export interface ObjectDef {
  readonly kind: "object";
  /** What one of these is called in messages: "node", "edge", "diagram". */
  readonly noun: string;
  readonly fields: readonly Field[];
  /** Lets other fields through unchecked. Only for a type that isn't built yet, whose fields aren't known. */
  readonly otherFields?: "allowed";
}

export interface ListDef {
  readonly kind: "list";
  /** What the items are called in messages: "nodes", "edges". */
  readonly noun: string;
  readonly items: Def;
  readonly maxItems: number;
}

/** Plain text. It may only use characters that every face it's drawn in can draw. */
export interface TextDef {
  readonly kind: "text";
  readonly text: TextKind;
  readonly faces: readonly FaceId[];
}

/** One of a fixed list of words. With `later`, other values are "not supported yet". */
export interface ChoiceDef {
  readonly kind: "choice";
  readonly values: readonly string[];
  readonly later: boolean;
}

export interface Field {
  readonly name: string;
  readonly def: Def;
  readonly required: boolean;
  /** Shown in the schema, and in the hint when a required field is missing. */
  readonly description: string;
  readonly default?: string | readonly [];
}

function required(name: string, def: Def, description: string): Field {
  return { name, def, required: true, description };
}

function optional(name: string, def: Def, description: string, defaultValue?: Field["default"]): Field {
  return defaultValue === undefined
    ? { name, def, required: false, description }
    : { name, def, required: false, description, default: defaultValue };
}

/** The diagram types implemented so far. */
const DIAGRAM_TYPES: readonly string[] = ["flow"];

const LIMITS = { nodes: 500, edges: 1000 } as const;

/** The top level of one diagram type. `direction` is its default: "right" for ER, "down" for the rest. */
function diagram(node: Def, edge: Def, direction: "down" | "right"): ObjectDef {
  return {
    kind: "object",
    noun: "diagram",
    fields: [
      optional("version", { kind: "const", value: 1 }, "the format version; leave it out to mean the current one"),
      required("type", { kind: "choice", values: DIAGRAM_TYPES, later: true }, "the kind of diagram"),
      optional(
        "direction",
        { kind: "choice", values: ["down", "right"], later: false },
        "which way the diagram flows: top to bottom or left to right",
        direction,
      ),
      required(
        "nodes",
        { kind: "list", noun: "nodes", items: node, maxItems: LIMITS.nodes },
        "the cards, in reading order; the order gently guides the layout",
      ),
      optional("edges", { kind: "list", noun: "edges", items: edge, maxItems: LIMITS.edges }, "the lines between cards", []),
    ],
  };
}

/**
 * The faces text fields are drawn in. src/shapes draws with these, and each
 * text field below registers the same ones, so its characters are checked
 * against the faces that really draw it.
 */
export const STEP_LABEL_FACE: FaceId = "inter-semibold";

const FLOW_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [STEP_LABEL_FACE] }, "the text shown in the shape"),
    required("shape", { kind: "choice", values: ["step"], later: true }, "the shape drawn"),
  ],
};

const FLOW_EDGE: ObjectDef = {
  kind: "object",
  noun: "edge",
  fields: [
    optional("id", { kind: "id", of: "edge" }, "a unique id; without one the line is known as edges[N]"),
    required("from", { kind: "ref", to: "node" }, "the id of the node the line starts at"),
    required("to", { kind: "ref", to: "node" }, "the id of the node the line ends at"),
  ],
};

export const FLOW: ObjectDef = diagram(FLOW_NODE, FLOW_EDGE, "down");

/**
 * When the type isn't one we implement, only the fields every type shares can
 * be checked: its other fields, and everything inside its nodes and edges,
 * aren't known.
 */
const ANY_TYPE: ObjectDef = { ...diagram({ kind: "any" }, { kind: "any" }, "down"), otherFields: "allowed" };

/** The definition to check a diagram against, chosen by its `type`. */
export function diagramDefinition(type: unknown): ObjectDef {
  return type === "flow" ? FLOW : ANY_TYPE;
}
