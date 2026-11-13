import type { Problem } from "../errors";
import { undrawable } from "../text";
import { describeChar } from "./chars";
import {
  ID_PATTERN,
  type Condition,
  type Def,
  type Field,
  type ListDef,
  type ObjectDef,
  type RefDef,
  type TextDef,
} from "./definitions";

type Json = { readonly [key: string]: unknown };

/** What a reference can name. */
type Target = RefDef["to"];

const ID = new RegExp(ID_PATTERN);
const ID_HINT = "use only letters, digits and - _ . :";
const REF_HINTS = new Map<Target, { readonly noun: string; readonly hint: string }>([
  ["node", { noun: "node", hint: "use the id of one of the nodes" }],
  ["area", { noun: "area", hint: 'use the id of one of the areas in "areas"' }],
]);
const DUPLICATE_HINTS = new Map([
  ["row", "give every row in a card its own id"],
  ["area", "give every area its own id"],
]);
const DRAW_HINT = "use Latin letters, digits and common symbols";
/** Characters a field can't draw are named one by one up to this many; the rest are counted. */
const NAMED_CHARS = 5;

/**
 * Checks `input` against a definition. Returns the normalised value (defaults
 * filled in, text tidied) and every problem found. The value is only complete
 * when there are no problems.
 *
 * Problems come in a fixed order: list items in order, and in each object its
 * unknown fields first (sorted by name), then its own fields in the order the
 * definition lists them, then what its rules find. A dangling reference sorts
 * to where the reference is.
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
  /** The explicit row ids of the node being read, with where each was first used. Each node starts afresh. */
  let rowIds = new Map<string, string>();
  /** Every area id with where it was first used: areas have ids of their own, apart from nodes and edges. */
  const areaIds = new Map<string, string>();
  /** Every string a node or an area gave as its id, valid or not, so references to it aren't also reported. */
  const given = new Map<Target, Set<string>>([
    ["node", new Set()],
    ["area", new Set()],
  ]);
  /** The first node with each id, as given, so a reference can check what kind of node it names. */
  const nodes = new Map<string, Json>();
  /**
   * References to nodes or areas are only checked once their list was read,
   * or left out (so empty): without it, nothing is known.
   */
  const listed = new Set<Target>();
  const refs: { path: string; target: string; seq: number; def: RefDef }[] = [];

  function walk(def: Def, value: unknown, path: string, field?: Field): unknown {
    switch (def.kind) {
      case "object":
        return walkObject(def, value, path);
      case "list": {
        if (!Array.isArray(value)) {
          report(path, `must be a list of ${def.noun}`, "write it as [...]");
          return [];
        }
        if (value.length > def.maxItems) report(path, `has ${value.length} ${def.noun}; the limit is ${def.maxItems}`, def.limitHint);
        const target = targetOf(def);
        if (target) listed.add(target);
        return value.map((item: unknown, i) => walk(def.items, item, `${path}[${i}]`));
      }
      case "text":
        return walkText(def, value, path);
      case "id": {
        if (typeof value !== "string") return report(path, "must be a string", ID_HINT);
        if (def.of === "node" || def.of === "area") given.get(def.of)!.add(value);
        const used = def.of === "row" ? rowIds : def.of === "area" ? areaIds : ids;
        if (value === "") report(path, "must not be empty", ID_HINT);
        else if (!ID.test(value)) report(path, `${show(value)} is not a valid id`, ID_HINT);
        else if (used.has(value)) {
          const hint = DUPLICATE_HINTS.get(def.of) ?? "give every node and edge its own id";
          report(path, `the id ${show(value)} is already used by ${used.get(value)}`, hint);
        } else used.set(value, path.slice(0, path.lastIndexOf(".")));
        return value;
      }
      case "ref":
        if (typeof value !== "string") return report(path, `must be ${def.to === "area" ? "an" : "a"} ${def.to} id`, REF_HINTS.get(def.to)!.hint);
        refs.push({ path, target: value, seq: seq++, def });
        return value;
      case "choice": {
        if (typeof value === "string" && def.values.includes(value)) return value;
        const message =
          def.later && typeof value === "string"
            ? `${show(value)} is not supported yet`
            : `${show(value)} is not a valid ${field?.name ?? "value"}`;
        return report(path, message, `use ${orList(def.values)}`);
      }
      case "boolean":
        if (typeof value === "boolean") return value;
        return report(path, `${show(value)} is not true or false`, "write true or false, without quotes");
      case "count": {
        if (Number.isInteger(value) && (value as number) >= def.min && (value as number) <= def.max) return value;
        const hint = `write a whole number without quotes${field?.required === false ? `, or leave ${field.name} out` : ""}`;
        return report(path, `${show(value)} is not a whole number from ${def.min} to ${def.max}`, hint);
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
    if (isNode(def)) rowIds = new Map();
    const allowed = def.fields.map((f) => f.name);
    // Sorted by code units: plain-object key order isn't something to rely on.
    const unknown = Object.keys(value)
      .filter((key) => def.otherFields !== "allowed" && !allowed.includes(key) && value[key] !== undefined)
      .sort();
    for (const key of unknown) {
      report(fieldPath(path, key), `unknown field ${JSON.stringify(key)}`, `allowed fields: ${allowed.join(", ")}`);
    }

    const id = nodeIdField(def);
    const given = (name: string) => (Object.hasOwn(value, name) ? value[name] : undefined);
    const nodeId = id && given(id.name);
    if (typeof nodeId === "string" && !nodes.has(nodeId)) nodes.set(nodeId, value);

    const result: { [key: string]: unknown } = {};
    for (const field of def.fields) {
      const at = fieldPath(path, field.name);
      const fieldValue = given(field.name);
      if (fieldValue !== undefined) {
        // A field given without its conditions is reported as a whole, at the first that fails: what's inside it doesn't matter.
        const unmet = field.onlyWhen?.find((condition) => !allowedHere(def, condition, given(condition.field)));
        if (unmet) report(at, conditionMessage(def, field.name, unmet), unmet.hint);
        else result[field.name] = walk(field.def, fieldValue, at, field);
      } else if (field.required) report(at, `missing required field "${field.name}"`, missingHint(field));
      else if (field.default !== undefined) {
        result[field.name] = field.default;
        // A list left out is empty, so what it would have listed is known: nothing.
        const target = field.def.kind === "list" ? targetOf(field.def) : undefined;
        if (target) listed.add(target);
      }
    }
    for (const rule of def.rules ?? []) {
      for (const problem of rule(result, value, path)) report(problem.path, problem.message, problem.hint);
    }
    return result;
  }

  /** Text tidied, or nothing when it had a problem, so rules don't judge it again. */
  function walkText(def: TextDef, value: unknown, path: string): string | undefined {
    if (typeof value !== "string") return report(path, "must be a string", "write the text in double quotes");
    const before = found.length;
    // Counted in code points, as JSON Schema's maxLength counts.
    const length = [...value].length;
    if (length > def.text.maxLength) {
      report(path, `is ${length} characters long; the limit is ${def.text.maxLength}`, "shorten it");
    }
    // Named one by one up to a point, so a long run of unusual text stays one short list.
    const bad = undrawable(value, def.faces);
    for (const ch of bad.slice(0, NAMED_CHARS)) report(path, ...describeUndrawable(ch));
    const more = bad.length - NAMED_CHARS;
    if (more > 0) {
      report(path, `contains ${more} other ${more === 1 ? "character" : "characters"} Structa's fonts can't draw`, DRAW_HINT);
    }
    // Runs of spaces collapse and the ends are trimmed, as SVG would show them anyway.
    const tidy = value.replace(/ {2,}/g, " ").replace(/^ | $/g, "");
    if (tidy === "") report(path, "must not be empty", "write the text to show");
    return found.length === before ? tidy : undefined;
  }

  const value = walk(def, input, "$");
  for (const { path, target, seq: at, def: ref } of refs) {
    if (!listed.has(ref.to)) continue;
    if (!given.get(ref.to)!.has(target)) {
      // Lines connect cards only: an area's id gets its own message.
      if (ref.to === "node" && given.get("area")!.has(target)) {
        report(path, `${show(target)} is an area, and lines connect cards only`, "point the line at a card in the area", at);
      } else report(path, `no ${REF_HINTS.get(ref.to)!.noun} with id ${show(target)}`, REF_HINTS.get(ref.to)!.hint, at);
    } else if (ref.notTo && nodes.get(target)?.[ref.notTo.field] === ref.notTo.value) {
      const { value: kind, reason, hint } = ref.notTo;
      report(path, `${show(target)} is a ${kind}, and ${reason}`, hint, at);
    }
  }
  found.sort((a, b) => a.seq - b.seq);
  return { value, problems: found.map((f) => f.problem) };
}

/** The field holding a node's id, when objects of this definition are nodes. */
function nodeIdField(def: ObjectDef): Field | undefined {
  return def.fields.find((f) => f.def.kind === "id" && f.def.of === "node");
}

/** Whether objects of this definition are nodes: they have a node id. */
function isNode(def: ObjectDef): boolean {
  return nodeIdField(def) !== undefined;
}

/** What references can name in a list of this definition: its items' ids, when they're nodes or areas. */
function targetOf(def: ListDef): Target | undefined {
  if (def.items.kind !== "object") return undefined;
  for (const field of def.items.fields) {
    if (field.def.kind === "id" && (field.def.of === "node" || field.def.of === "area")) return field.def.of;
  }
  return undefined;
}

/**
 * Whether a field that needs `condition` may be given, when the deciding
 * field is `actual`. A deciding field that's required but missing, or given
 * but not one of its choices, is reported on its own, so judging by it would
 * only add noise. An optional one left out isn't the condition's value.
 */
function allowedHere(def: ObjectDef, condition: Condition, actual: unknown): boolean {
  const deciding = def.fields.find((f) => f.name === condition.field)!;
  const known = deciding.def.kind === "choice" && typeof actual === "string" && deciding.def.values.includes(actual);
  if (actual === undefined ? deciding.required : !known) return true;
  return (actual === condition.value) !== (condition.not === true);
}

/** Says which objects can have `name`, such as `only a node with "shape": "note" can have "about"`. */
function conditionMessage(def: ObjectDef, name: string, { field, value, not }: Condition): string {
  const having = `${/^[aeiou]/.test(def.noun) ? "an" : "a"} ${def.noun} with "${field}": "${value}"`;
  return not ? `${having} can't have "${name}"` : `only ${having} can have "${name}"`;
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
  if (typeof value === "string") return JSON.stringify(shorten(value, 40));
  if (Array.isArray(value)) return "a list";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

/** At most `max` characters of `text`, cut between code points so an emoji is never split. */
function shorten(text: string, max: number): string {
  // 2 * max + 2 code units always hold more than `max` whole code points when the text has them.
  const head = Array.from(text.slice(0, 2 * max + 2));
  return head.length > max ? `${head.slice(0, max).join("")}…` : text;
}

function describeUndrawable(ch: string): [message: string, hint: string] {
  const { code, control, visible } = describeChar(ch);
  if (control) return [`contains ${control.name} (${code})`, control.hint];
  // Show the character itself only when it's visible.
  const shown = visible ? `"${ch}" (${code})` : code;
  return [`contains ${shown}, which Structa's fonts can't draw`, DRAW_HINT];
}
