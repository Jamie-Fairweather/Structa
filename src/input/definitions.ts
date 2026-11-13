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
/** Short, as it's drawn on one line beside a line's end. */
const END_LABEL: TextKind = { name: "endLabel", maxLength: 20, description: "a count at one end of a line, such as 1 or 0..*" };
const ROW_TEXT: TextKind = { name: "rowText", maxLength: 200, description: "one row of a card, such as a class member" };
/** Short, as it's drawn on one line in a tag on a card's border. */
const AREA_LABEL: TextKind = { name: "areaLabel", maxLength: 40, description: "an area's name, on its cards' tags or its box" };
const COLUMN_NAME: TextKind = { name: "columnName", maxLength: 100, description: "the name of a table's column" };
const COLUMN_TYPE: TextKind = { name: "columnType", maxLength: 100, description: "the type of a table's column, such as uuid or varchar(200)" };
export const TEXT_KINDS: readonly TextKind[] = [TITLE, LABEL, DESCRIPTION, LINE_LABEL, END_LABEL, ROW_TEXT, AREA_LABEL, COLUMN_NAME, COLUMN_TYPE];

/** What a change does to a card, row or line: the same words the badges show. */
export const STATUSES = ["new", "changed", "removed", "unchanged"] as const;
export type Status = (typeof STATUSES)[number];
const STATUS: Def = { kind: "choice", values: STATUSES, later: false };

/**
 * Node, edge, row and area ids: letters, digits and `-_.:`. Brackets can't
 * appear, so `edges[N]` and `methods[N]` never clash with one.
 */
export const ID_PATTERN = "^[A-Za-z0-9_.:-]+$";

/** How deep areas may nest: an area with no parent is 1 level deep. */
export const MAX_AREA_DEPTH = 4;

export type Def =
  | ObjectDef
  | ListDef
  | TextDef
  /** Node and edge ids are unique across the diagram; a row's id only within its card, and an area's among the areas. */
  | { readonly kind: "id"; readonly of: "node" | "edge" | "row" | "area" }
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

/** The id of a node, or of an area. */
export interface RefDef {
  readonly kind: "ref";
  readonly to: "node" | "area";
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
  /**
   * Allowed only when every one of these conditions holds, as "about" is only
   * for notes. Such a field has no default. When several don't hold, the first
   * is the one reported.
   */
  readonly onlyWhen?: readonly Condition[];
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

/**
 * An optional field allowed only when every condition in `onlyWhen` holds.
 * It has no default: filling one in would give the field where it isn't allowed.
 */
function conditional(name: string, def: Def, description: string, ...onlyWhen: [Condition, ...Condition[]]): Field {
  return { ...optional(name, def, description), onlyWhen };
}

/** The diagram types implemented so far, in the spec's order. Each has an example, examples/<type>.json. */
export const DIAGRAM_TYPES: readonly string[] = ["class", "er", "flow", "architecture"];

const LIMITS = { nodes: 500, edges: 1000, areas: 100 } as const;
const SPLIT_HINT = "split the diagram into smaller ones";

/**
 * The top level of one diagram type. `direction` is its default: "right" for
 * ER, "down" for the rest. `rules` check across its nodes and areas.
 */
function diagram(node: Def, edge: Def, direction: "down" | "right", rules: readonly Rule[]): ObjectDef {
  return {
    kind: "object",
    noun: "diagram",
    rules,
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
        "which way the diagram flows: top to bottom or left to right; by default right for ER diagrams, down for the others",
        direction,
      ),
      optional(
        "groupAreas",
        BOOLEAN,
        "true draws a box round each area's cards, nested as the areas are; otherwise each card shows its area as a tag",
        false,
      ),
      optional("legend", BOOLEAN, "false leaves out the legend of statuses and areas at the bottom", true),
      optional(
        "areas",
        { kind: "list", noun: "areas", items: AREA, maxItems: LIMITS.areas, limitHint: SPLIT_HINT },
        "named groupings that cards can be in, such as the parts of a system; drawn in this order",
        [],
      ),
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
/** A class line's counts, beside its ends. */
export const END_LABEL_FACE: FaceId = "inter-regular";
export const CLASS_NAME_FACE: FaceId = "inter-semibold";
/** A class's «stereotype» line. Its words are fixed, so no input is checked against it. */
export const STEREOTYPE_FACE: FaceId = "inter-regular";
/** An abstract class's name: real italics, as UML draws it. */
export const ABSTRACT_CLASS_NAME_FACE: FaceId = "inter-semibold-italic";
export const CLASS_DESCRIPTION_FACE: FaceId = "inter-regular";
export const ROW_TEXT_FACE: FaceId = "mono-regular";
/** An abstract member's text: real italics, as UML draws it. */
export const ABSTRACT_ROW_TEXT_FACE: FaceId = "mono-italic";
/** An area's name, wherever it's drawn: on a card's tag, at the top-left of its box and in the legend. */
export const AREA_LABEL_FACE: FaceId = "inter-semibold";

const AREA: ObjectDef = {
  kind: "object",
  noun: "area",
  description:
    `A named grouping of cards. Areas nest through "parent", at most ${MAX_AREA_DEPTH} levels deep and never in a loop, ` +
    "and each must hold a card, directly or in an area inside it. Areas have no colours.",
  fields: [
    required("id", { kind: "id", of: "area" }, "a unique id among the areas, made of letters, digits and - _ . :"),
    required(
      "label",
      { kind: "text", text: AREA_LABEL, faces: [AREA_LABEL_FACE] },
      "the area's name, shown on its cards' tags or at the top-left of its box",
    ),
    optional("parent", { kind: "ref", to: "area" }, "the id of the area this one is inside; leave it out for an outermost area"),
  ],
};

/** A card's area field, shared by every type of node. */
function areaField(description: string): Field {
  return optional("area", { kind: "ref", to: "area" }, description);
}

/** An area as checked: a field that had a problem is missing. */
interface CheckedArea {
  readonly id?: string;
  readonly parent?: string;
}

const VALID_ID = new RegExp(ID_PATTERN);

/**
 * Areas nest in a tree, at most MAX_AREA_DEPTH levels deep, and every area
 * holds a card, directly or through the areas inside it. A parent that names
 * no area was reported already, so here its area has no parent; a loop is
 * reported once, at the first of its areas.
 */
const areaRule: Rule = (checked, given) => {
  const areas = (checked.areas ?? []) as readonly CheckedArea[];
  // The first area with each id: a repeated id was reported already.
  const index = new Map<string, number>();
  areas.forEach((area, i) => {
    if (typeof area.id === "string" && !index.has(area.id)) index.set(area.id, i);
  });
  const parentOf = (i: number) => {
    const parent = areas[i]!.parent;
    return parent === undefined ? undefined : index.get(parent);
  };

  // Each problem with the area it's about, and its place among that area's problems.
  const found: { at: number; order: number; problem: Required<Problem> }[] = [];
  // Each area's depth, or null when its parents loop or lead into a loop.
  const depths = new Map<number, number | null>();
  areas.forEach((_, start) => {
    // Up through the parents until an area whose depth is known, the top, or an area seen on the way.
    const chain: number[] = [];
    let i: number | undefined = start;
    while (i !== undefined && !depths.has(i) && !chain.includes(i)) {
      chain.push(i);
      i = parentOf(i);
    }
    let depth: number | null = i === undefined ? 0 : (depths.get(i) ?? null);
    if (i !== undefined && chain.includes(i)) {
      // The chain came back round to an area on it: from there on, it's a loop.
      const loop = chain.splice(chain.indexOf(i));
      const first = Math.min(...loop);
      const from = loop.indexOf(first);
      const names = [...loop.slice(from), ...loop.slice(0, from), first].map((j) => JSON.stringify(areas[j]!.id));
      const hint = "give one of them no parent, or a parent outside the loop";
      found.push({ at: first, order: 0, problem: { path: `areas[${first}].parent`, message: `the areas' parents go round in a loop: ${names.join(" → ")}`, hint } });
      for (const j of loop) depths.set(j, null);
      depth = null;
    }
    // Back down from the top, so each area is one level deeper than its parent.
    for (const j of chain.reverse()) {
      depth = depth === null ? null : depth + 1;
      depths.set(j, depth);
      // Only the first area too deep: those inside it move up with it.
      if (depth !== MAX_AREA_DEPTH + 1) continue;
      const message = `puts ${JSON.stringify(areas[j]!.id)} ${depth} levels deep; areas nest at most ${MAX_AREA_DEPTH} levels`;
      found.push({ at: j, order: 0, problem: { path: `areas[${j}].parent`, message, hint: "give it a parent higher up, or no parent" } });
    }
  });

  // Without a list of nodes, which areas hold cards isn't known.
  if (Array.isArray(given.nodes)) {
    const held = new Set<number>();
    for (const node of (checked.nodes ?? []) as readonly { readonly area?: unknown }[]) {
      let i = typeof node.area === "string" ? index.get(node.area) : undefined;
      while (i !== undefined && !held.has(i)) {
        held.add(i);
        i = parentOf(i);
      }
    }
    for (const [id, i] of index) {
      // An area whose id isn't valid was reported already, and can't be named.
      if (held.has(i) || !VALID_ID.test(id)) continue;
      const message = `${JSON.stringify(id)} has no cards, in it or in the areas inside it`;
      found.push({ at: i, order: 1, problem: { path: `areas[${i}]`, message, hint: `put a card in it with "area": ${JSON.stringify(id)}, or remove it` } });
    }
  }
  return found.sort((a, b) => a.at - b.at || a.order - b.order).map((f) => f.problem);
};

export const COMPONENT_LABEL_FACE: FaceId = "inter-semibold";
/** A component card's kind word, beside its icon. Its words are fixed, so no input is checked against it. */
export const KIND_WORD_FACE: FaceId = "inter-regular";
export const TABLE_NAME_FACE: FaceId = "inter-semibold";
export const TABLE_DESCRIPTION_FACE: FaceId = "inter-regular";
export const COLUMN_NAME_FACE: FaceId = "mono-regular";
export const COLUMN_TYPE_FACE: FaceId = "mono-regular";

/**
 * The flowchart shapes: start and end are pills, a step a rounded box, a
 * decision a diamond, io (input or output) a slanted box, a subprocess a box
 * with double side bars, and a note an aside with a folded corner.
 */
export const FLOW_SHAPES = ["start", "end", "step", "decision", "io", "subprocess", "note"] as const;
export type FlowShape = (typeof FLOW_SHAPES)[number];

/** A node as checked, for the rules across a flowchart's nodes. */
interface CheckedFlowNode {
  readonly id?: string;
  readonly shape?: string;
  readonly about?: string;
  readonly area?: string;
}

/**
 * With area boxes, a note about a shape is in that shape's box, so it can
 * only name the same area. A reference that names nothing, or the wrong kind
 * of node, was reported already. Tags don't nest, so without boxes a note
 * can name any area.
 */
const noteAreaRule: Rule = (checked) => {
  if (checked.groupAreas !== true) return [];
  const nodes = (checked.nodes ?? []) as readonly CheckedFlowNode[];
  const areas = new Set(((checked.areas ?? []) as readonly CheckedArea[]).map((area) => area.id));
  const byId = new Map<string, CheckedFlowNode>();
  for (const node of nodes) if (typeof node.id === "string" && !byId.has(node.id)) byId.set(node.id, node);
  return nodes.flatMap((note, i) => {
    if (note.shape !== "note" || note.about === undefined || note.area === undefined || !areas.has(note.area)) return [];
    const shape = byId.get(note.about);
    if (shape === undefined || shape.shape === "note" || shape.area === note.area) return [];
    if (shape.area !== undefined && !areas.has(shape.area)) return [];
    const about = JSON.stringify(note.about);
    const area = JSON.stringify(note.area);
    const where = shape.area === undefined ? "no area" : JSON.stringify(shape.area);
    const hint = shape.area === undefined ? `leave "area" out, or put ${about} in ${area} too` : `leave "area" out, or make it ${where}`;
    const message = `with groupAreas, a note is in the area of the shape it's about, and ${about} is in ${where}`;
    return [{ path: `nodes[${i}].area`, message, hint }];
  });
};

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
    areaField("the id of the area the shape is in; with groupAreas, a note about a shape is in that shape's area, so it can leave this out"),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    required("shape", { kind: "choice", values: FLOW_SHAPES, later: false }, "the shape drawn"),
    conditional(
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
      { field: "shape", value: "note", hint: 'remove "about", or make this node a note' },
    ),
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

/**
 * A line: its ends are checked by `end` and described with `endNote` after
 * them, and `extra` fields follow the shared ones. `description` says what
 * the schema can't.
 */
function edge(end: RefDef, endNote: string, extra: readonly Field[], description?: string): ObjectDef {
  return {
    kind: "object",
    noun: "edge",
    ...(description === undefined ? {} : { description }),
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

/** How many rows a card leaves out on purpose. */
const MORE: Def = { kind: "count", min: 1, max: 9999 };

/** The most rows one card may have, all its sections together. */
const ROWS_PER_CARD = 100;
const ROWS_HINT = 'split the class, or leave dull members out and count them with "more"';

/** A card's rows as checked: a section that had a problem may be missing, and a row that had one is `{}`. */
type CheckedRows = { readonly status?: Status } & {
  readonly [section: string]: readonly { readonly status?: Status }[] | undefined;
};

/** What to do about a row whose status differs from its card's. A changed card can hold rows of any status. */
const ROW_STATUS_HINTS = new Map<Status, string>([
  ["new", 'leave it out, as rows in a new card are new, or make the card "changed"'],
  ["removed", 'leave it out, as rows in a removed card are removed, or make the card "changed"'],
  ["unchanged", 'make the card "changed", or leave the row\'s status out'],
]);

/**
 * A card's rows, in these lists of it, can't contradict it: a new or removed
 * card's rows can only have its status, an unchanged card's rows can only be
 * unchanged, and a card whose rows have a status needs one of its own.
 */
const rowStatusRule = (sections: readonly string[]): Rule => (checked, given, path) => {
  const card = checked as CheckedRows;
  // A card status that isn't valid was reported already; judging its rows against nothing would only add noise.
  if (given.status !== undefined && card.status === undefined) return [];
  const rows = sections.flatMap((section) =>
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

/**
 * At most ROWS_PER_CARD rows in a card, every section together. A section over
 * it alone was reported already, and so was one the card can't have, which
 * isn't counted.
 */
const rowLimitRule: Rule = (checked, _given, path) => {
  const card = checked as CheckedRows;
  const counts = CLASS_SECTIONS.map((section) => card[section]?.length ?? 0);
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (counts.some((n) => n > ROWS_PER_CARD) || total <= ROWS_PER_CARD) return [];
  return [{ path, message: `has ${total} rows; the limit is ${ROWS_PER_CARD} per card`, hint: ROWS_HINT }];
};

const MEMBER_TEXT = "the member as you'd write it, such as a name and type or a signature";
const VALUE_TEXT = "the value as you'd write it, such as a constant's name";

/** One row of a class: a property, a method or an enum value, called `noun` in messages, its text described by `text`. */
function classRow(section: ClassSection, noun: string, text: string): ObjectDef {
  return {
    kind: "object",
    noun,
    fields: [
      required("text", { kind: "text", text: ROW_TEXT, faces: [ROW_TEXT_FACE, ABSTRACT_ROW_TEXT_FACE] }, text),
      optional("id", { kind: "id", of: "row" }, `an id unique within the card; without one the row is known as ${section}[N]`),
      optional(
        "visibility",
        { kind: "choice", values: VISIBILITIES, later: false },
        "drawn before the text: + public, - private, # protected, ~ package",
      ),
      optional("static", BOOLEAN, "true underlines the row's text", false),
      optional("abstract", BOOLEAN, "true draws the row's text in italics", false),
      optional("status", STATUS, "what the change does to this row; leave it out for no status"),
    ],
  };
}

/** What a class must follow, which a schema can't say: how its rows' statuses agree with its own, and how many rows it may have. */
const CLASS_RULES =
  `Its rows' statuses must agree with its own: a row in a new or removed card can only have the card's status, and takes it when it has none; ` +
  `a row in an unchanged card can only be unchanged; and a card needs a status when any of its rows has one. ` +
  `A card has at most ${ROWS_PER_CARD} rows, all its lists together.`;

/**
 * The fields of a class card beyond a node's own: its stereotype, its
 * abstract flag, its rows and its "more" count. In a class diagram every node
 * has them; in an architecture diagram only a class, so there `onlyClasses`
 * makes each one need "kind": "class" too.
 */
function classCardFields(onlyClasses: boolean): Field[] {
  const field = (name: string, def: Def, description: string, own: readonly Condition[], defaultValue?: Field["default"]): Field => {
    const onlyWhen = [
      ...(onlyClasses ? [{ field: "kind", value: "class", hint: `remove "${name}", or make this node "kind": "class"` }] : []),
      ...own,
    ];
    const [first, ...rest] = onlyWhen;
    return first
      ? conditional(name, def, `${description}${onlyClasses ? '. Only for "kind": "class"' : ""}`, first, ...rest)
      : optional(name, def, description, defaultValue);
  };
  const rows = (section: ClassSection, noun: string, text: string): ListDef => ({
    kind: "list",
    noun: section,
    items: classRow(section, noun, text),
    maxItems: ROWS_PER_CARD,
    limitHint: ROWS_HINT,
  });
  return [
    field("stereotype", { kind: "choice", values: STEREOTYPES, later: false }, "what kind of class this is, drawn as a «…» line above the name", []),
    field("abstract", BOOLEAN, 'true draws the name in italics, as stereotype "abstract" does, without the «abstract» line', [], false),
    field("properties", rows("properties", "property", MEMBER_TEXT), "the class's properties, in order; leave it out for none. Not for an enum", [NOT_ENUM]),
    field(
      "methods",
      rows("methods", "method", MEMBER_TEXT),
      "the class's methods, in order, drawn under the properties; leave it out for none. Not for an enum",
      [NOT_ENUM],
    ),
    field("values", rows("values", "value", VALUE_TEXT), 'an enum\'s values, in order; leave it out for none. Only with "stereotype": "enum"', [ENUM]),
    field("more", MORE, 'how many members or values were left out on purpose, drawn as a muted "… N more" row', []),
  ];
}

const CLASS_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  description: `One class. An enum (stereotype "enum") lists values instead of properties and methods, and only an enum has values. ${CLASS_RULES}`,
  rules: [rowStatusRule(CLASS_SECTIONS), rowLimitRule],
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [CLASS_NAME_FACE, ABSTRACT_CLASS_NAME_FACE] }, "the class name"),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [CLASS_DESCRIPTION_FACE] },
      "a short sentence drawn under the name",
    ),
    areaField("the id of the area the class is in"),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    ...classCardFields(false),
  ],
};

/** The relationships a class line can show, as UML draws them. */
export const CLASS_EDGE_KINDS = ["inherits", "implements", "composition", "aggregation", "association", "dependency"] as const;

/** The kinds of line whose `to` is the parent of its `from`: drawn before it, and never in a loop. */
export const PARENT_KINDS: ReadonlySet<string> = new Set<(typeof CLASS_EDGE_KINDS)[number]>(["inherits", "implements"]);

const CLASS_EDGE_RULES =
  'One relationship between two classes, drawn as UML draws it. For inherits and implements, "from" is the child and "to" the parent: ' +
  "a hollow triangle points at the parent, which is drawn before its children, and these lines can't go round in a loop. " +
  'For composition and aggregation, "from" is the owner, which gets the diamond. A dependency, and a directed association, ' +
  'point an arrow at "to". Implements and dependency lines are dashed.';

const CLASS_EDGE = edge(
  { kind: "ref", to: "node" },
  "",
  [
    required("kind", { kind: "choice", values: CLASS_EDGE_KINDS, later: false }, "the relationship the line shows"),
    optional(
      "fromLabel",
      { kind: "text", text: END_LABEL, faces: [END_LABEL_FACE] },
      'a count drawn beside the line where it leaves "from", such as 1 or 0..*',
    ),
    optional(
      "toLabel",
      { kind: "text", text: END_LABEL, faces: [END_LABEL_FACE] },
      'a count drawn beside the line where it reaches "to", such as 1 or 0..*',
    ),
    conditional(
      "directed",
      BOOLEAN,
      'associations only: true draws an arrow at "to", the class the association is navigable to',
      { field: "kind", value: "association", hint: 'remove "directed", or make the line an association' },
    ),
  ],
  CLASS_EDGE_RULES,
);

/** A class line as checked, for the rule across a class diagram's lines. */
interface CheckedClassEdge {
  readonly from?: string;
  readonly to?: string;
  readonly kind?: string;
}

/**
 * A class can't be its own parent, even through other classes: inherits and
 * implements lines never go round in a loop. The lines are taken in the
 * order listed, and one is reported when it closes a loop with those before
 * it that weren't reported, so each loop is reported once, at the last of
 * its lines, and removing every line reported leaves no loop. A line whose
 * end names no node, or whose kind isn't valid, was reported already.
 */
const parentLoopRule: Rule = (checked) => {
  const nodes = new Set(((checked.nodes ?? []) as readonly { readonly id?: unknown }[]).map((node) => node.id));
  // Each class's parents, through the lines kept so far, in the order listed.
  const parents = new Map<string, string[]>();
  const found: Required<Problem>[] = [];
  ((checked.edges ?? []) as readonly CheckedClassEdge[]).forEach(({ from, to, kind }, i) => {
    if (kind === undefined || !PARENT_KINDS.has(kind) || from === undefined || to === undefined) return;
    if (!nodes.has(from) || !nodes.has(to)) return;
    const back = upTo(parents, to, from);
    if (back === undefined) return parents.set(from, [...(parents.get(from) ?? []), to]);
    const names = [from, ...back].map((id) => JSON.stringify(id));
    const hint = "a class can't be its own parent, even through others: remove one of the lines in the loop";
    found.push({ path: `edges[${i}].to`, message: `the classes' parents go round in a loop: ${names.join(" → ")}`, hint });
  });
  return found;
};

/** The shortest way from `start` up through `parents` to `goal`, both included, or undefined when there's none. */
function upTo(parents: ReadonlyMap<string, readonly string[]>, start: string, goal: string): string[] | undefined {
  const cameFrom = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    if (at === goal) {
      const way: string[] = [];
      for (let step: string | undefined = at; step !== undefined; step = cameFrom.get(step)) way.unshift(step);
      return way;
    }
    for (const parent of parents.get(at) ?? []) {
      if (cameFrom.has(parent)) continue;
      cameFrom.set(parent, at);
      queue.push(parent);
    }
  }
  return undefined;
}

/**
 * What an architecture diagram's card is: a component of one of these kinds,
 * drawn as a card with its icon and kind word, or a class, drawn as a class card.
 */
export const ARCHITECTURE_KINDS = ["service", "api", "ui", "job", "queue", "database", "cache", "external", "library", "actor", "class"] as const;
export type ArchitectureKind = (typeof ARCHITECTURE_KINDS)[number];

/** The kinds drawn as component cards: every kind but a class. */
export type ComponentKind = Exclude<ArchitectureKind, "class">;

const ARCHITECTURE_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  description:
    `One part of a system. Every kind but "class" is a component card with its kind's icon and word. ` +
    `A node of kind "class" is a class card instead, with a class's fields: an enum (stereotype "enum") lists values instead of properties and methods. ${CLASS_RULES}`,
  rules: [rowStatusRule(CLASS_SECTIONS), rowLimitRule],
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required(
      "label",
      { kind: "text", text: LABEL, faces: [COMPONENT_LABEL_FACE, CLASS_NAME_FACE, ABSTRACT_CLASS_NAME_FACE] },
      "the name shown on the card",
    ),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [CARD_DESCRIPTION_FACE, CLASS_DESCRIPTION_FACE] },
      "a sentence or two drawn smaller and muted under the label, and shown in the tooltip",
    ),
    areaField("the id of the area the card is in"),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    required(
      "kind",
      { kind: "choice", values: ARCHITECTURE_KINDS, later: false },
      'what the card is, shown by its icon and kind word; "class" draws a class card',
    ),
    ...classCardFields(true),
  ],
};

/** How one part of a system talks to another: a call it waits on, or a message or event it doesn't. */
export const ARCHITECTURE_EDGE_KINDS = ["call", "async"] as const;

const ARCHITECTURE_EDGE = edge({ kind: "ref", to: "node" }, "", [
  optional(
    "kind",
    { kind: "choice", values: ARCHITECTURE_EDGE_KINDS, later: false },
    "how the from card talks to the to card: call, drawn solid with a filled arrowhead, or async (a message or event), drawn dashed with an open arrowhead",
    "call",
  ),
]);

/** The most columns one table may have. */
const COLUMNS_PER_TABLE = 100;
const COLUMNS_HINT = 'split the table, or leave dull columns out and count them with "more"';

/** One column of a table: a row of its card. */
const COLUMN: ObjectDef = {
  kind: "object",
  noun: "column",
  fields: [
    required(
      "name",
      { kind: "text", text: COLUMN_NAME, faces: [COLUMN_NAME_FACE] },
      "the column's name, unique within its table",
    ),
    required("type", { kind: "text", text: COLUMN_TYPE, faces: [COLUMN_TYPE_FACE] }, "the column's type, such as uuid or varchar(200)"),
    optional("pk", BOOLEAN, "true marks the column as part of the primary key, drawn as PK", false),
    optional("fk", BOOLEAN, "true marks the column as a foreign key, drawn as FK", false),
    optional("unique", BOOLEAN, "true marks the column's values as unique, drawn as UQ", false),
    optional("nullable", BOOLEAN, "true lets the column be null, drawn as ? after its type", false),
    optional("status", STATUS, "what the change does to this column; leave it out for no status"),
  ],
};

/** A column is known by its name, so no two columns of a table share one, compared as tidied. */
const uniqueColumnNames: Rule = (checked, _given, path) => {
  const columns = (checked.columns ?? []) as readonly { readonly name?: string }[];
  const first = new Map<string, number>();
  return columns.flatMap((column, i) => {
    // A name that had a problem, or was blank, was reported already.
    if (!column.name) return [];
    const used = first.get(column.name);
    if (used === undefined) {
      first.set(column.name, i);
      return [];
    }
    return [
      {
        path: `${path}.columns[${i}].name`,
        message: `the column name ${JSON.stringify(column.name)} is already used by ${path}.columns[${used}]`,
        hint: "give every column in a table its own name",
      },
    ];
  });
};

const TABLE_NODE: ObjectDef = {
  kind: "object",
  noun: "node",
  description:
    `One table. Its columns' names are unique within it. Its columns' statuses must agree with its own: a column in a new or removed table can only have the table's status, and takes it when it has none; ` +
    `a column in an unchanged table can only be unchanged; and a table needs a status when any of its columns has one. ` +
    `A table has at most ${COLUMNS_PER_TABLE} columns.`,
  rules: [uniqueColumnNames, rowStatusRule(["columns"])],
  fields: [
    required("id", { kind: "id", of: "node" }, "a unique id made of letters, digits and - _ . :"),
    required("label", { kind: "text", text: LABEL, faces: [TABLE_NAME_FACE] }, "the table's name"),
    optional(
      "description",
      { kind: "text", text: DESCRIPTION, faces: [TABLE_DESCRIPTION_FACE] },
      "a short sentence drawn under the name",
    ),
    areaField("the id of the area the table is in"),
    optional("status", STATUS, "what the change does to this card; leave it out for no status"),
    optional(
      "columns",
      { kind: "list", noun: "columns", items: COLUMN, maxItems: COLUMNS_PER_TABLE, limitHint: COLUMNS_HINT },
      "the table's columns, in order",
      [],
    ),
    optional("more", MORE, 'how many columns were left out on purpose, drawn as a muted "… N more" row'),
  ],
};

/** How many rows at one end of a relationship go with one row at the other, drawn as that end's crow's foot. */
export const CARDINALITIES = ["one", "zero-or-one", "many", "one-or-many", "zero-or-many"] as const;
const CARDINALITY: Def = { kind: "choice", values: CARDINALITIES, later: false };

/** A line's end that names a column: the name of a column of the table at that end, drawn as that column's name is. */
const COLUMN_END: Def = { kind: "text", text: COLUMN_NAME, faces: [COLUMN_NAME_FACE] };

/** Each end of an ER line that can name a column: the field naming its table, and the field naming the column. */
const COLUMN_ENDS = [
  ["from", "fromColumn"],
  ["to", "toColumn"],
] as const;

/** A table as checked: a field that had a problem is missing. */
interface CheckedTable {
  readonly id?: string;
  readonly columns?: readonly { readonly name?: string }[];
}

type CheckedErEdge = { readonly [field in (typeof COLUMN_ENDS)[number][number]]?: string };

/**
 * A line's fromColumn and toColumn name columns of its own from and to
 * tables, compared as tidied. A from or to that names no node was reported
 * already, and so was a column name with a problem of its own, such as a
 * blank one; a table whose columns aren't all known, because their list or a
 * name had a problem, isn't judged. The hint lists the table's columns.
 */
const columnEndsRule: Rule = (checked, given) => {
  const tables = (checked.nodes ?? []) as readonly CheckedTable[];
  const listed = Array.isArray(given.nodes) ? (given.nodes as readonly unknown[]) : [];
  // The column names of the first table with each id, or undefined when they aren't all known.
  const names = new Map<string, ReadonlySet<string> | undefined>();
  tables.forEach((table, i) => {
    if (typeof table.id !== "string" || names.has(table.id)) return;
    const columns = (listed[i] as { readonly columns?: unknown } | undefined)?.columns;
    const known = (columns === undefined || Array.isArray(columns)) && (table.columns ?? []).every((c) => typeof c.name === "string");
    names.set(table.id, known ? new Set((table.columns ?? []).map((c) => c.name!)) : undefined);
  });
  return ((checked.edges ?? []) as readonly CheckedErEdge[]).flatMap((edge, i) =>
    COLUMN_ENDS.flatMap(([end, field]) => {
      const [table, name] = [edge[end], edge[field]];
      if (table === undefined || !name) return [];
      const columns = names.get(table);
      if (columns === undefined || columns.has(name)) return [];
      const quoted = JSON.stringify(table);
      const header = `leave ${field} out to attach the line at the table's header`;
      const choices = [...columns].map((column) => JSON.stringify(column)).join(", ");
      return [
        {
          path: `edges[${i}].${field}`,
          message: `no column named ${JSON.stringify(name)} in ${quoted}`,
          hint: columns.size === 0 ? `${quoted} has no columns: ${header}` : `use one of the columns of ${quoted} (${choices}), or ${header}`,
        },
      ];
    }),
  );
};

/**
 * A relationship between two tables. It has no kind: every ER line is a
 * relationship. Each end attaches at the column it names, or at its table's
 * header when it names none.
 */
const ER_EDGE = edge({ kind: "ref", to: "node" }, "", [
  optional(
    "fromColumn",
    COLUMN_END,
    "the name of the column of the from table the line starts at, such as a foreign key; leave it out to attach the line at the table's header",
  ),
  optional(
    "toColumn",
    COLUMN_END,
    "the name of the column of the to table the line ends at, such as the key it refers to; leave it out to attach the line at the table's header",
  ),
  required(
    "fromCardinality",
    CARDINALITY,
    "how many rows of the from table go with one row of the to table, drawn as a crow's foot at the from end",
  ),
  required(
    "toCardinality",
    CARDINALITY,
    "how many rows of the to table go with one row of the from table, drawn as a crow's foot at the to end",
  ),
  optional("enforced", BOOLEAN, "false shows a relationship the database doesn't enforce with a foreign key, drawn dotted", true),
]);

/** Each implemented type's definition, in DIAGRAM_TYPES order. */
export const DEFINITIONS: ReadonlyMap<string, ObjectDef> = new Map([
  ["class", diagram(CLASS_NODE, CLASS_EDGE, "down", [areaRule, parentLoopRule])],
  ["er", diagram(TABLE_NODE, ER_EDGE, "right", [areaRule, columnEndsRule])],
  ["flow", diagram(FLOW_NODE, FLOW_EDGE, "down", [areaRule, noteAreaRule])],
  ["architecture", diagram(ARCHITECTURE_NODE, ARCHITECTURE_EDGE, "down", [areaRule])],
]);

/**
 * The fields every type shares, with its nodes and edges left unchecked. The
 * schema's top level shows these. Without known nodes, the rules across them
 * can't be checked.
 */
export const SHARED: ObjectDef = diagram({ kind: "any" }, { kind: "any" }, "down", []);

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
