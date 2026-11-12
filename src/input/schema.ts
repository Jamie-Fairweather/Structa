import { drawableRanges, type FaceId } from "../text";
import { FLOW, ID_PATTERN, TEXT_KINDS, type Def, type Field, type ObjectDef } from "./definitions";

/** A JSON value; objects are built in a fixed key order. */
type JsonSchema = { [key: string]: unknown };

/**
 * The JSON Schema (draft 2020-12) for the input, generated from the same
 * definitions as the validator. The validator also checks what a schema
 * can't say: references and unique ids.
 */
export function jsonSchema(): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Structa diagram",
    description:
      'One diagram for Structa to draw. Text is plain text in Latin letters, digits and common symbols, with no control characters; runs of spaces collapse to one, and text can\'t be only spaces. Ids must be unique across nodes and edges, and "from" and "to" must name a node.',
    ...objectSchema(FLOW),
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

function objectSchema(def: ObjectDef): JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(def.fields.map((field) => [field.name, fieldSchema(field)])),
    required: def.fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: def.otherFields === "allowed",
  };
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
      return { type: "array", maxItems: def.maxItems, items: defSchema(def.items) };
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
