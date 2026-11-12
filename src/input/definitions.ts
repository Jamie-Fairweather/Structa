/**
 * The shared input definitions: the one description of the JSON format.
 * The validator (check.ts) and the JSON Schema (schema.ts) are both generated
 * from these, so they can't disagree. Every new field goes here.
 */
import type { Problem } from "../errors";
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
  | RefDef
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
  /** Shown in the schema: what one of these is, and the rules it must follow that a schema can't say. */
  readonly description?: string;
  readonly fields: readonly Field[];
  /** Lets other fields through unchecked. Only for a type that isn't built yet, whose fields aren't known. */
  readonly otherFields?: "allowed";
  /** Checks across its fields, run once its fields have been checked. */
  readonly rules?: readonly Rule[];
}

/**
 * A check across an object's fields: given the object as checked (a field that
 * had a problem is left out) and as given, and its path, it returns the
 * problems it finds, each with a hint.
 */
export type Rule = (checked: Fields, given: Fields, path: string) => readonly Required<Problem>[];

type Fields = { readonly [name: string]: unknown };

export interface ListDef {
  readonly kind: "list";
  /** What the items are called in messages: "nodes", "edges". */
  readonly noun: string;
  readonly items: Def;
  readonly maxItems: number;
  /** What to do about too many items. */
  readonly limitHint: string;
}

/** Plain text. It may only use characters that every face it's drawn in can draw. */
export interface TextDef {
  readonly kind: "text";
  readonly text: TextKind;
  readonly faces: readonly FaceId[];
}

/** The id of a node. */
export interface RefDef {
  readonly kind: "ref";
  readonly to: "node";
  /**
   * A kind of node it may not name: one whose `field` is `value`. The message
   * reads `"<id>" is a <value>, and <reason>`. The schema can't say this; only
   * the validator checks it.
   */
  readonly notTo?: { readonly field: string; readonly value: string; readonly reason: string; readonly hint: string };
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
  /** Allowed only when a condition holds, as "about" is only for notes. */
  readonly onlyWhen?: Condition;
}

/**
 * Another field of the same object, a choice, is `value`, or, with `not`,
 * isn't. An optional deciding field left out isn't `value`. `hint` says what
 * to do when a field is given without its condition.
 */
export interface Condition {
  readonly field: string;
  readonly value: string;
  readonly not?: true;
  readonly hint: string;
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
const SPLIT_HINT = "split the diagram into smaller ones";

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
        { kind: "list", noun: "nodes", items: node, maxItems: LIMITS.nodes, limitHint: SPLIT_HINT },
        "the cards, in reading order; the order gently guides the layout",
      ),
      optional(
        "edges",
        { kind: "list", noun: "edges", items: edge, maxItems: LIMITS.edges, limitHint: SPLIT_HINT },
        "the lines between cards",
        [],
      ),
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
/** Notes are asides, so their labels are lighter than the shapes'. */
export const NOTE_LABEL_FACE: FaceId = "inter-regular";
/** A card's description, muted under its label. */
export const CARD_DESCRIPTION_FACE: FaceId = "inter-regular";
export const LINE_LABEL_FACE: FaceId = "inter-regular";
export const CLASS_NAME_FACE: FaceId = "inter-semibold";
/** An abstract class's name: real italics, as UML draws it. */
export const ABSTRACT_CLASS_NAME_FACE: FaceId = "inter-semibold-italic";
export const CLASS_DESCRIPTION_FACE: FaceId = "inter-regular";
export const ROW_TEXT_FACE: FaceId = "mono-regular";
/** An abstract member's text: real italics, as UML draws it. */
export const ABSTRACT_ROW_TEXT_FACE: FaceId = "mono-italic";

/**
 * The flowchart shapes: start and end are pills, a step a rounded box, a
 * decision a diamond, io (input or output) a slanted box, a subprocess a box
 * with double side bars, and a note an aside with a folded corner.
 */
export const FLOW_SHAPES = ["start", "end", "step", "decision", "io", "subprocess", "note"] as const;
export type FlowShape = (typeof FLOW_SHAPES)[number];

const FLOW_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [STEP_LABEL_FACE, NOTE_LABEL_FACE] }, "the text shown in the shape"),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [CARD_DESCRIPTION_FACE] },
      "a sentence or two drawn smaller under the label, and shown in the tooltip",
    ),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    required("shape", { kind: "choice", values: FLOW_SHAPES, later: false }, "the shape drawn"),
    {
      ...optional(
        "about",
        {
          kind: "ref",
          to: "node",
          notTo: {
            field: "shape",
            value: "note",
            reason: "a note can only be about a shape that isn't a note",
            hint: "use the id of a shape that isn't a note",
          },
        },
        "notes only: the id of the shape the note is about, joined to it by a dotted line; without it the note floats near the chart",
      ),
      onlyWhen: { field: "shape", value: "note", hint: 'remove "about", or make this node a note' },
    },
  ],
};

/** Lines join shapes; a note is joined to its shape by its own "about" instead. */
const LINE_END: RefDef = {
  kind: "ref",
  to: "node",
  notTo: {
    field: "shape",
    value: "note",
    reason: "lines can't start or end at a note",
    hint: 'point the note at a shape with "about" instead',
  },
};

/** A line: its ends are checked by `end` and described with `endNote` after them, and `extra` fields follow the shared ones. */
function edge(end: RefDef, endNote: string, extra: readonly Field[]): ObjectDef {
  return {
    kind: "object",
    noun: "edge",
    fields: [
      optional("id", { kind: "id", of: "edge" }, "a unique id; without one the line is known as edges[N]"),
      required("from", end, `the id of the node the line starts at${endNote}`),
      required("to", end, `the id of the node the line ends at${endNote}`),
      optional("label", { kind: "text", text: LINE_LABEL, faces: [LINE_LABEL_FACE] }, "a short label drawn in a pill on the line"),
      optional("status", STATUS, "what the change does to this line, shown by its colour; leave it out for no status"),
      optional("emphasis", BOOLEAN, "true draws the line thicker, to point out the main path", false),
      ...extra,
    ],
  };
}

const FLOW_EDGE = edge(LINE_END, ", which can't be a note", []);

/** What kind of class a card is, drawn as a «…» line above its name. */
export const STEREOTYPES = ["interface", "abstract", "enum", "record"] as const;

/** Who can use a class member, drawn before its text as + - # ~. */
export const VISIBILITIES = ["public", "private", "protected", "package"] as const;

/** A class's lists of members, in the order they're drawn. */
export const MEMBER_SECTIONS = ["properties", "methods"] as const;

/** An enum's one list of rows, which it has instead of members. */
export const ENUM_SECTIONS = ["values"] as const;

/** Every list of a class card's rows. A card has either members or values. */
export const CLASS_SECTIONS = [...MEMBER_SECTIONS, ...ENUM_SECTIONS] as const;

export type ClassSection = (typeof CLASS_SECTIONS)[number];

/** What a field only an enum, or only a class that isn't one, may have. */
const ENUM: Condition = { field: "stereotype", value: "enum", hint: 'add "stereotype": "enum", or list the rows in properties and methods' };
const NOT_ENUM: Condition = { field: "stereotype", value: "enum", not: true, hint: "list an enum's rows in values" };

/** The most rows one card may have, all its sections together. */
const ROWS_PER_CARD = 100;
const ROWS_HINT = 'split the class, or leave dull members out and count them with "more"';

/** A card's rows as checked: a section that had a problem may be missing, and a row that had one is `{}`. */
type CheckedRows = { readonly status?: Status } & {
  readonly [section in ClassSection]?: readonly { readonly status?: Status }[];
};

/** What to do about a row whose status differs from its card's. A changed card can hold rows of any status. */
const ROW_STATUS_HINTS = new Map<Status, string>([
  ["new", 'leave it out, as rows in a new card are new, or make the card "changed"'],
  ["removed", 'leave it out, as rows in a removed card are removed, or make the card "changed"'],
  ["unchanged", 'make the card "changed", or leave the row\'s status out'],
]);

/**
 * A card's rows can't contradict it: a new or removed card's rows can only
 * have its status, an unchanged card's rows can only be unchanged, and a card
 * whose rows have a status needs one of its own.
 */
const rowStatusRule: Rule = (checked, given, path) => {
  const card = checked as CheckedRows;
  // A card status that isn't valid was reported already; judging its rows against nothing would only add noise.
  if (given.status !== undefined && card.status === undefined) return [];
  const rows = CLASS_SECTIONS.flatMap((section) =>
    (card[section] ?? []).flatMap((row, i) => (row.status === undefined ? [] : [{ status: row.status, path: `${path}.${section}[${i}].status` }])),
  );
  if (card.status === undefined) {
    if (rows.length === 0) return [];
    const hint = 'give the card a status, such as "changed", or take the statuses off its rows';
    return [{ path: `${path}.status`, message: "missing: a card needs a status when any of its rows has one", hint }];
  }
  const hint = ROW_STATUS_HINTS.get(card.status);
  if (hint === undefined) return [];
  const article = card.status === "unchanged" ? "an" : "a";
  return rows
    .filter((row) => row.status !== card.status)
    .map((row) => ({ path: row.path, message: `a row in ${article} ${card.status} card can't be "${row.status}"`, hint }));
};

/** At most ROWS_PER_CARD rows in a card, every section together. A section over it alone was reported already. */
const rowLimitRule: Rule = (_checked, given, path) => {
  const counts = CLASS_SECTIONS.map((section) => (Array.isArray(given[section]) ? given[section].length : 0));
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (counts.some((n) => n > ROWS_PER_CARD) || total <= ROWS_PER_CARD) return [];
  return [{ path, message: `has ${total} rows; the limit is ${ROWS_PER_CARD} per card`, hint: ROWS_HINT }];
};

/** One member of a class: a property or a method, called `noun` in messages. */
function classRow(section: (typeof MEMBER_SECTIONS)[number], noun: string): ObjectDef {
  return {
    kind: "object",
    noun,
    fields: [
      required(
        "text",
        { kind: "text", text: ROW_TEXT, faces: [ROW_TEXT_FACE, ABSTRACT_ROW_TEXT_FACE] },
        "the member as you'd write it, such as a name and type or a signature",
      ),
      optional("id", { kind: "id", of: "row" }, `an id unique within the card; without one the row is known as ${section}[N]`),
      optional(
        "visibility",
        { kind: "choice", values: VISIBILITIES, later: false },
        "drawn before the text: + public, - private, # protected, ~ package",
      ),
      optional("static", BOOLEAN, "true underlines the member's text", false),
      optional("abstract", BOOLEAN, "true draws the member's text in italics", false),
      optional("status", STATUS, "what the change does to this row; leave it out for no status"),
    ],
  };
}

/** One value of an enum. Enum values are never static or abstract, and have no visibility. */
const ENUM_VALUE: ObjectDef = {
  kind: "object",
  noun: "value",
  fields: [
    required("text", { kind: "text", text: ROW_TEXT, faces: [ROW_TEXT_FACE] }, "the value as you'd write it, such as a constant's name"),
    optional("id", { kind: "id", of: "row" }, "an id unique within the card; without one the row is known as values[N]"),
    optional("status", STATUS, "what the change does to this row; leave it out for no status"),
  ],
};

const CLASS_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  description:
    `One class. An enum (stereotype "enum") lists values instead of properties and methods, and only an enum has values. ` +
    `Its rows' statuses must agree with its own: a row in a new or removed card can only have the card's status, and takes it when it has none; ` +
    `a row in an unchanged card can only be unchanged; and a card needs a status when any of its rows has one. ` +
    `A card has at most ${ROWS_PER_CARD} rows, all its lists together.`,
  rules: [rowStatusRule, rowLimitRule],
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [CLASS_NAME_FACE, ABSTRACT_CLASS_NAME_FACE] }, "the class name"),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [CLASS_DESCRIPTION_FACE] },
      "a short sentence drawn under the name",
    ),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    optional(
      "stereotype",
      { kind: "choice", values: STEREOTYPES, later: false },
      "what kind of class this is, drawn as a «…» line above the name",
    ),
    optional(
      "abstract",
      BOOLEAN,
      'true draws the name in italics, as stereotype "abstract" does, without the «abstract» line',
      false,
    ),
    {
      ...optional(
        "properties",
        { kind: "list", noun: "properties", items: classRow("properties", "property"), maxItems: ROWS_PER_CARD, limitHint: ROWS_HINT },
        "the class's properties, in order; not for an enum",
        [],
      ),
      onlyWhen: NOT_ENUM,
    },
    {
      ...optional(
        "methods",
        { kind: "list", noun: "methods", items: classRow("methods", "method"), maxItems: ROWS_PER_CARD, limitHint: ROWS_HINT },
        "the class's methods, in order, drawn under the properties; not for an enum",
        [],
      ),
      onlyWhen: NOT_ENUM,
    },
    {
      ...optional(
        "values",
        { kind: "list", noun: "values", items: ENUM_VALUE, maxItems: ROWS_PER_CARD, limitHint: ROWS_HINT },
        'an enum\'s values, in order; only with "stereotype": "enum"',
        [],
      ),
      onlyWhen: ENUM,
    },
    optional(
      "more",
      { kind: "count", min: 1, max: 9999 },
      'how many members or values were left out on purpose, drawn as a muted "… N more" row',
    ),
  ],
};

/** The relationship a class line shows. Only association is drawn so far. */
export const CLASS_EDGE_KINDS = ["association"] as const;

const CLASS_EDGE = edge({ kind: "ref", to: "node" }, "", [
  required("kind", { kind: "choice", values: CLASS_EDGE_KINDS, later: true }, "the relationship the line shows"),
]);

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
