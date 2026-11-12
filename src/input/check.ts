import type { Problem } from "../errors";
import { undrawable } from "../text";
import { ID_PATTERN, type Def, type Field, type ObjectDef, type TextDef } from "./definitions";

type Json = { readonly [key: string]: unknown };

const ID = new RegExp(ID_PATTERN);
const ID_HINT = "use only letters, digits and - _ . :";
const REF_HINT = "use the id of one of the nodes";

/**
 * Checks `input` against a definition. Returns the normalised value (defaults
 * filled in, text tidied) and every problem found, in input order. The value
 * is only complete when there are no problems.
 */
export function check(def: ObjectDef, input: unknown): { value: unknown; problems: Problem[] } {
  // Each problem gets a sequence number when its place in the input is visited,
  // so problems found later (like dangling references) still sort into place.
  const found: { seq: number; problem: Problem }[] = [];
  let seq = 0;
  const report = (path: string, message: string, hint: string, at = seq++): undefined => {
    found.push({ seq: at, problem: { path, message, hint } });
  };

  /** Every explicit id (node or edge) with where it was first used. */
  const ids = new Map<string, string>();
  /** Every string a node gave as its id, valid or not, so lines to it aren't also reported. */
  const nodeIds = new Set<string>();
  /** References are only checked once a list of nodes was read: without one, nothing is known. */
  let nodesListed = false;
  const refs: { path: string; target: string; seq: number }[] = [];

  function walk(def: Def, value: unknown, path: string, field?: Field): unknown {
    switch (def.kind) {
      case "object":
        return walkObject(def, value, path);
      case "list": {
        if (!Array.isArray(value)) {
          report(path, `must be a list of ${def.noun}`, "write it as [...]");
          return [];
        }
        if (value.length > def.maxItems) {
          report(path, `has ${value.length} ${def.noun}; the limit is ${def.maxItems}`, "split the diagram into smaller ones");
        }
        if (def.items.kind === "object" && def.items.fields.some((f) => f.def.kind === "id" && f.def.of === "node")) {
          nodesListed = true;
        }
        return value.map((item: unknown, i) => walk(def.items, item, `${path}[${i}]`));
      }
      case "text":
        return walkText(def, value, path);
      case "id": {
        if (typeof value !== "string") return report(path, "must be a string", ID_HINT);
        if (def.of === "node") nodeIds.add(value);
        if (value === "") report(path, "must not be empty", ID_HINT);
        else if (!ID.test(value)) report(path, `${show(value)} is not a valid id`, ID_HINT);
        else if (ids.has(value)) {
          report(path, `the id ${show(value)} is already used by ${ids.get(value)}`, "give every node and edge its own id");
        } else ids.set(value, path.slice(0, path.lastIndexOf(".")));
        return value;
      }
      case "ref":
        if (typeof value !== "string") return report(path, "must be a node id", REF_HINT);
        refs.push({ path, target: value, seq: seq++ });
        return value;
      case "choice": {
        if (typeof value === "string" && def.values.includes(value)) return value;
        const message =
          def.later && typeof value === "string"
            ? `${show(value)} is not supported yet`
            : `${show(value)} is not a valid ${field?.name ?? "value"}`;
        return report(path, message, `use ${orList(def.values)}`);
      }
      case "const":
        if (value === def.value) return value;
        return report(
          path,
          `${show(value)} is not supported`,
          field?.required === false ? `use ${def.value}, or leave ${field.name} out` : `use ${def.value}`,
        );
      case "any":
        return value;
    }
  }

  function walkObject(def: ObjectDef, value: unknown, path: string): Json {
    if (!isObject(value)) {
      const shape = def.fields.filter((f) => f.required).map((f) => `"${f.name}": ...`);
      report(path, `must be an object describing one ${def.noun}`, `write it as {${shape.join(", ")}}`);
      return {};
    }
    const allowed = def.fields.map((f) => f.name);
    // Sorted by code units: plain-object key order isn't something to rely on.
    const unknown = Object.keys(value)
      .filter((key) => !allowed.includes(key) && value[key] !== undefined)
      .sort();
    for (const key of unknown) {
      report(fieldPath(path, key), `unknown field ${JSON.stringify(key)}`, `allowed fields: ${allowed.join(", ")}`);
    }

    const result: { [key: string]: unknown } = {};
    for (const field of def.fields) {
      const at = fieldPath(path, field.name);
      const given = Object.hasOwn(value, field.name) ? value[field.name] : undefined;
      if (given !== undefined) result[field.name] = walk(field.def, given, at, field);
      else if (field.required) report(at, `missing required field "${field.name}"`, missingHint(field));
      else if (field.default !== undefined) result[field.name] = field.default;
    }
    return result;
  }

  function walkText(def: TextDef, value: unknown, path: string): string | undefined {
    if (typeof value !== "string") return report(path, "must be a string", "write the text in double quotes");
    // Counted in code points, as JSON Schema's maxLength counts.
    const length = [...value].length;
    if (length > def.text.maxLength) {
      report(path, `is ${length} characters long; the limit is ${def.text.maxLength}`, "shorten it");
    }
    for (const ch of undrawable(value, def.faces)) report(path, ...describeUndrawable(ch));
    // Runs of spaces collapse and the ends are trimmed, as SVG would show them anyway.
    const tidy = value.replace(/ {2,}/g, " ").replace(/^ | $/g, "");
    if (tidy === "") report(path, "must not be empty", "write the text to show");
    return tidy;
  }

  const value = walk(def, input, "$");
  for (const ref of refs) {
    if (nodesListed && !nodeIds.has(ref.target)) report(ref.path, `no node with id ${show(ref.target)}`, REF_HINT, ref.seq);
  }
  found.sort((a, b) => a.seq - b.seq);
  return { value, problems: found.map((f) => f.problem) };
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `nodes[0].label`, or `nodes[0]["odd name"]` for a name that isn't a plain word. Top-level fields have no `$.`. */
function fieldPath(parent: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `${parent === "$" ? "" : parent}[${JSON.stringify(name)}]`;
  return parent === "$" ? name : `${parent}.${name}`;
}

function missingHint(field: Field): string {
  const choices = field.def.kind === "choice" ? `, ${orList(field.def.values)}` : "";
  return `add "${field.name}": ${field.description}${choices}`;
}

/** `"a"`, `"a" or "b"`, `"a", "b" or "c"`. */
function orList(values: readonly string[]): string {
  const quoted = values.map((v) => JSON.stringify(v));
  return quoted.length <= 1 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

/** A short, readable form of any input value for a message. */
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (Array.isArray(value)) return "a list";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

const CONTROL_NAMES = new Map([
  [0x09, ["a tab", "use a space instead"]],
  [0x0a, ["a line feed", "use a space instead: text wraps by itself"]],
  [0x0d, ["a carriage return", "use a space instead: text wraps by itself"]],
]);

function describeUndrawable(ch: string): [message: string, hint: string] {
  const codePoint = ch.codePointAt(0)!;
  const code = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  if (codePoint <= 0x1f || codePoint === 0x7f) {
    const [name, hint] = CONTROL_NAMES.get(codePoint) ?? ["a control character", "remove it"];
    return [`contains ${name} (${code})`, hint!];
  }
  // Show the character itself only when it's visible.
  const shown = /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(ch) ? `"${ch}" (${code})` : code;
  return [`contains ${shown}, which Structa's fonts can't draw`, "use Latin letters, digits and common symbols"];
}
