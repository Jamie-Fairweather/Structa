/**
 * The shared input definitions: the one description of the JSON format.
 * The validator (check.ts) and the JSON Schema (schema.ts) are both generated
 * from these, so they can't disagree. Every new field goes here.
 */
import type { FaceId } from "../text";
import { THEME_NAMES } from "../theme";

/** One kind of text, with its length limit. Limits are set here once and shown in the schema. */
export interface TextKind {
  /** Its name under `$defs` in the schema. */
  readonly name: string;
  readonly maxLength: number;
  readonly description: string;
}

const TITLE: TextKind = { name: "title", maxLength: 100, description: "the diagram's title" };
const LABEL: TextKind = { name: "label", maxLength: 100, description: "the name shown on a card" };
const DESCRIPTION: TextKind = { name: "description", maxLength: 300, description: "a sentence or two about a diagram or card" };
const LINE_LABEL: TextKind = { name: "lineLabel", maxLength: 60, description: "a short label on a line" };
const ROW_TEXT: TextKind = { name: "rowText", maxLength: 200, description: "one row of a card, such as a class member" };
export const TEXT_KINDS: readonly TextKind[] = [TITLE, LABEL, DESCRIPTION, LINE_LABEL, ROW_TEXT];

/** What a change does to a card, row or line: the same words the badges show. */
export const STATUSES = ["new", "changed", "removed", "unchanged"] as const;
export type Status = (typeof STATUSES)[number];
const STATUS: Def = { kind: "choice", values: STATUSES, later: false };

/**
 * Node, edge, row and area ids: letters, digits and `-_.:`. Brackets can't
 * appear, so `edges[N]` and `methods[N]` never clash with one.
 */
export const ID_PATTERN = "^[A-Za-z0-9_.:-]+$";

export type Def =
  | ObjectDef
  | ListDef
  | TextDef
  /** Node and edge ids are unique across the diagram; a row's id only within its card. */
  | { readonly kind: "id"; readonly of: "node" | "edge" | "row" }
  | { readonly kind: "ref"; readonly to: "node" }
  | ChoiceDef
  | { readonly kind: "boolean" }
  /** A whole number from `min` to `max`. */
  | { readonly kind: "count"; readonly min: number; readonly max: number }
  | { readonly kind: "const"; readonly value: number }
  | { readonly kind: "any" };

const BOOLEAN: Def = { kind: "boolean" };

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
  readonly default?: string | boolean | readonly [];
}

function required(name: string, def: Def, description: string): Field {
  return { name, def, required: true, description };
}

function optional(name: string, def: Def, description: string, defaultValue?: Field["default"]): Field {
  return defaultValue === undefined
    ? { name, def, required: false, description }
    : { name, def, required: false, description, default: defaultValue };
}

/** The diagram types implemented so far, in the spec's order. Each has an example, examples/<type>.json. */
export const DIAGRAM_TYPES: readonly string[] = ["class", "flow"];

const LIMITS = { nodes: 500, edges: 1000 } as const;

/** The top level of one diagram type. `direction` is its default: "right" for ER, "down" for the rest. */
function diagram(node: Def, edge: Def, direction: "down" | "right"): ObjectDef {
  return {
    kind: "object",
    noun: "diagram",
    fields: [
      optional("version", { kind: "const", value: 1 }, "the format version; leave it out to mean the current one"),
      required("type", { kind: "choice", values: DIAGRAM_TYPES, later: true }, "the kind of diagram"),
      optional("title", { kind: "text", text: TITLE, faces: [TITLE_FACE] }, "a title drawn at the top-left"),
      optional(
        "description",
        { kind: "text", text: DESCRIPTION, faces: [DESCRIPTION_FACE] },
        "a sentence or two drawn under the title",
      ),
      optional(
        "theme",
        { kind: "choice", values: THEME_NAMES, later: false },
        "the colours to draw in; the --theme flag and render()'s theme option win over it",
        "light",
      ),
      optional(
        "direction",
        { kind: "choice", values: ["down", "right"], later: false },
        "which way the diagram flows: top to bottom or left to right",
        direction,
      ),
      optional("legend", BOOLEAN, "false leaves out the legend of statuses at the bottom", true),
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
export const TITLE_FACE: FaceId = "inter-bold";
export const DESCRIPTION_FACE: FaceId = "inter-regular";
export const STEP_LABEL_FACE: FaceId = "inter-semibold";
export const LINE_LABEL_FACE: FaceId = "inter-regular";
export const CLASS_NAME_FACE: FaceId = "inter-semibold";
export const CLASS_DESCRIPTION_FACE: FaceId = "inter-regular";
export const ROW_TEXT_FACE: FaceId = "mono-regular";

const FLOW_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [STEP_LABEL_FACE] }, "the text shown in the shape"),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
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
    optional("label", { kind: "text", text: LINE_LABEL, faces: [LINE_LABEL_FACE] }, "a short label drawn in a pill on the line"),
    optional("status", STATUS, "what the change does to this line, shown by its colour; leave it out for no status"),
    optional("emphasis", BOOLEAN, "true draws the line thicker, to point out the main path", false),
  ],
};

/** Who can use a class member, drawn before its text as + - # ~. */
export const VISIBILITIES = ["public", "private", "protected", "package"] as const;

/** The two lists of a class card's rows, in the order they're drawn. */
export const CLASS_SECTIONS = ["properties", "methods"] as const;

/** The most rows one card may have. */
const ROWS_PER_CARD = 100;

/** One member of a class: a property or a method, called `noun` in messages. */
function classRow(section: (typeof CLASS_SECTIONS)[number], noun: string): ObjectDef {
  return {
    kind: "object",
    noun,
    fields: [
      required(
        "text",
        { kind: "text", text: ROW_TEXT, faces: [ROW_TEXT_FACE] },
        "the member as you'd write it, such as a name and type or a signature",
      ),
      optional("id", { kind: "id", of: "row" }, `an id unique within the card; without one the row is known as ${section}[N]`),
      optional(
        "visibility",
        { kind: "choice", values: VISIBILITIES, later: false },
        "drawn before the text: + public, - private, # protected, ~ package",
      ),
      optional("status", STATUS, "what the change does to this row; leave it out for no status"),
    ],
  };
}

const CLASS_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [CLASS_NAME_FACE] }, "the class name"),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [CLASS_DESCRIPTION_FACE] },
      "a short sentence drawn under the name",
    ),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    optional(
      "properties",
      { kind: "list", noun: "properties", items: classRow("properties", "property"), maxItems: ROWS_PER_CARD },
      "the class's properties, in order",
      [],
    ),
    optional(
      "methods",
      { kind: "list", noun: "methods", items: classRow("methods", "method"), maxItems: ROWS_PER_CARD },
      "the class's methods, in order, drawn under the properties",
      [],
    ),
    optional(
      "more",
      { kind: "count", min: 1, max: 9999 },
      'how many members were left out on purpose, drawn as a muted "… N more" row',
    ),
  ],
};

/** The relationship a class line shows. Only association is drawn so far. */
export const CLASS_EDGE_KINDS = ["association"] as const;

const CLASS_EDGE: ObjectDef = {
  ...FLOW_EDGE,
  fields: [
    ...FLOW_EDGE.fields,
    required("kind", { kind: "choice", values: CLASS_EDGE_KINDS, later: true }, "the relationship the line shows"),
  ],
};

/** Each implemented type's definition, in DIAGRAM_TYPES order. */
export const DEFINITIONS: ReadonlyMap<string, ObjectDef> = new Map([
  ["class", diagram(CLASS_NODE, CLASS_EDGE, "down")],
  ["flow", diagram(FLOW_NODE, FLOW_EDGE, "down")],
]);

/** The fields every type shares, with its nodes and edges left unchecked. The schema's top level shows these. */
export const SHARED: ObjectDef = diagram({ kind: "any" }, { kind: "any" }, "down");

/**
 * When the type isn't one we implement, only the fields every type shares can
 * be checked: its other fields, and everything inside its nodes and edges,
 * aren't known.
 */
const ANY_TYPE: ObjectDef = { ...SHARED, otherFields: "allowed" };

/** The definition to check a diagram against, chosen by its `type`. */
export function diagramDefinition(type: unknown): ObjectDef {
  return (typeof type === "string" && DEFINITIONS.get(type)) || ANY_TYPE;
}
