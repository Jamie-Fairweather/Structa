import { drawableRanges, type FaceId } from "../text";
import {
  DEFINITIONS,
  ID_PATTERN,
  SHARED,
  TEXT_KINDS,
  type Condition,
  type Def,
  type Field,
  type ListDef,
  type ObjectDef,
} from "./definitions";

/** A JSON value; objects are built in a fixed key order. */
type JsonSchema = { [key: string]: unknown };

/**
 * The JSON Schema (draft 2020-12) for the input, generated from the same
 * definitions as the validator. The top level holds the fields every type
 * shares; each type's nodes and edges come in a branch chosen by `type`. The
 * validator also checks what a schema can't say: references and unique ids.
 */
export function jsonSchema(): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Structa diagram",
    description:
      'One diagram for Structa to draw. Text is plain text in Latin letters, digits and common symbols, with no control characters; runs of spaces collapse to one, and text can\'t be only spaces. Ids must be unique across nodes and edges, and a row\'s id within its card; "from", "to" and "about" must name a node that isn\'t a note.',
    ...objectSchema(SHARED),
    allOf: [...DEFINITIONS].map(([type, def]) => ({
      if: { properties: { type: { const: type } }, required: ["type"] },
      then: { properties: { nodes: itemsSchema(def, "nodes"), edges: itemsSchema(def, "edges") } },
    })),
    $defs: {
      id: { description: "letters, digits and - _ . :", type: "string", pattern: ID_PATTERN },
      ...Object.fromEntries(
        TEXT_KINDS.map((kind) => [
          kind.name,
          // The pattern says "not only spaces": the validator trims text and then rejects it if nothing is left.
          { description: `${kind.description}: plain text`, type: "string", minLength: 1, maxLength: kind.maxLength, pattern: "[^ ]" },
        ]),
      ),
    },
  };
}

/** What one item of a type's `nodes` or `edges` list must be. */
function itemsSchema(def: ObjectDef, name: "nodes" | "edges"): JsonSchema {
  const list = def.fields.find((field) => field.name === name)!.def as ListDef;
  return { type: "array", items: defSchema(list.items) };
}

function objectSchema(def: ObjectDef): JsonSchema {
  const conditional = def.fields.filter((field) => field.onlyWhen !== undefined);
  return {
    ...(def.description === undefined ? {} : { description: def.description }),
    type: "object",
    properties: Object.fromEntries(def.fields.map((field) => [field.name, fieldSchema(field)])),
    required: def.fields.filter((f) => f.required).map((f) => f.name),
    // Each field that needs a condition, given, makes the object hold it.
    ...(conditional.length === 0
      ? {}
      : { dependentSchemas: Object.fromEntries(conditional.map((field) => [field.name, conditionSchema(field.onlyWhen!)])) }),
    additionalProperties: def.otherFields === "allowed",
  };
}

/** What an object must be for `condition` to hold: a field left out doesn't have the value. */
function conditionSchema({ field, value, not }: Condition): JsonSchema {
  const holds = { properties: { [field]: { const: value } }, required: [field] };
  return not ? { not: holds } : holds;
}

function fieldSchema(field: Field): JsonSchema {
  const schema: JsonSchema = { description: field.description, ...defSchema(field.def) };
  if (field.default !== undefined) schema.default = typeof field.default === "object" ? [] : field.default;
  return schema;
}

function defSchema(def: Def): JsonSchema {
  switch (def.kind) {
    case "object":
      return objectSchema(def);
    case "list":
      // Items that depend on the diagram's type are given in that type's branch.
      return { type: "array", maxItems: def.maxItems, ...(def.items.kind === "any" ? {} : { items: defSchema(def.items) }) };
    case "text":
      // The length limit lives under $defs; the characters allowed depend on the faces this field is drawn in.
      return { $ref: `#/$defs/${def.text.name}`, type: "string", pattern: drawablePattern(def.faces) };
    case "id":
    case "ref":
      return { $ref: "#/$defs/id" };
    case "choice":
      return { enum: [...def.values] };
    case "boolean":
      return { type: "boolean" };
    case "count":
      return { type: "integer", minimum: def.min, maximum: def.max };
    case "const":
      return { const: def.value };
    case "any":
      return {};
  }
}

/** Only the characters every one of `faces` can draw, read from the width tables the validator uses. */
function drawablePattern(faces: readonly FaceId[]): string {
  const hex = (codePoint: number) => `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  const ranges = drawableRanges(faces).map(([first, last]) => (first === last ? hex(first) : `${hex(first)}-${hex(last)}`));
  return `^[${ranges.join("")}]*$`;
}
