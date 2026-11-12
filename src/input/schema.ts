import { FLOW, ID_PATTERN, TEXT_KINDS, type Def, type Field, type ObjectDef } from "./definitions";

/** A JSON value; objects are built in a fixed key order. */
type JsonSchema = { [key: string]: unknown };

/**
 * The JSON Schema (draft 2020-12) for the input, generated from the same
 * definitions as the validator. The validator also checks what a schema
 * can't say: references, unique ids and which characters the fonts draw.
 */
export function jsonSchema(): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Structa diagram",
    description:
      'One diagram for Structa to draw. Text is plain text in Latin letters, digits and common symbols, with no control characters; runs of spaces collapse to one. Ids must be unique across nodes and edges, and "from" and "to" must name a node.',
    ...objectSchema(FLOW),
    $defs: {
      id: { description: "letters, digits and - _ . :", type: "string", pattern: ID_PATTERN },
      ...Object.fromEntries(
        TEXT_KINDS.map((kind) => [
          kind.name,
          { description: `${kind.description}: plain text`, type: "string", minLength: 1, maxLength: kind.maxLength },
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
  if (field.default !== undefined) schema.default = typeof field.default === "string" ? field.default : [];
  return schema;
}

function defSchema(def: Def): JsonSchema {
  switch (def.kind) {
    case "object":
      return objectSchema(def);
    case "list":
      return { type: "array", maxItems: def.maxItems, items: defSchema(def.items) };
    case "text":
      return { $ref: `#/$defs/${def.text.name}` };
    case "id":
    case "ref":
      return { $ref: "#/$defs/id" };
    case "choice":
      return { enum: [...def.values] };
    case "const":
      return { const: def.value };
    case "any":
      return {};
  }
}
