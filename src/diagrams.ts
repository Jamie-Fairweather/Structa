/**
 * The registry of diagram types: for each, its input definitions and how a
 * diagram that passes them is read, its layout profile, and how its nodes
 * become cards and its edges lines. It's the one list of types: the CLI, the
 * JSON Schema, the validator and render() all take them from here, so adding
 * a type, once its definitions, profile and builders exist, means adding it
 * here and nowhere else.
 */
import type { Problem } from "./errors";
import {
  ARCHITECTURE_INPUT,
  CLASS_INPUT,
  ER_INPUT,
  FLOW_INPUT,
  jsonSchema as schemaOf,
  selectType,
  type DiagramEdge,
  type DiagramModel,
  type DiagramNode,
  type InputType,
} from "./input";
import { ARCHITECTURE_PROFILE, CLASS_PROFILE, ER_PROFILE, FLOW_PROFILE, type LayoutProfile } from "./layout";
import {
  architectureBody,
  architectureLine,
  classBody,
  classLine,
  flowLine,
  relationshipLine,
  shapeBody,
  tableBody,
  type CardBuilder,
  type LineBuilder,
} from "./shapes";

/** What one diagram type, whose nodes are `N` and edges `E`, does its own way once its input is read. */
export interface DiagramType<N extends DiagramNode, E extends DiagramEdge> {
  /** The fixed ELK options it's laid out with. */
  readonly profile: LayoutProfile;
  /** Each node's card, inside the shared card frame. */
  readonly card: CardBuilder<N>;
  /** Each edge's line, between its two nodes' cards. */
  readonly line: LineBuilder<N, E>;
  /** For a note, the id of the node it's about, joined to it by a dotted connector. Only flowcharts have notes. */
  readonly about?: (node: N) => string | undefined;
}

/**
 * What to do with a diagram, whatever its type: given the diagram and what
 * its type does its own way. It's handed both together, so the nodes it gets
 * are always the ones its type's builders take.
 */
export type UseDiagram<R> = <N extends DiagramNode, E extends DiagramEdge>(diagram: DiagramModel<string, N, E>, type: DiagramType<N, E>) => R;

/** A diagram that passed its type's definitions, ready to `use`; or every problem found in the input. */
export type ParseResult =
  | { readonly ok: true; readonly use: <R>(use: UseDiagram<R>) => R }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** One registered type: its name and definition, and how a value of it is parsed. */
interface Registered<T extends string, N extends DiagramNode, E extends DiagramEdge> {
  readonly type: T;
  readonly input: InputType<T, DiagramModel<T, N, E>>;
  readonly parse: (value: unknown) => ParseResult;
}

function register<T extends string, N extends DiagramNode, E extends DiagramEdge>(
  input: InputType<T, DiagramModel<T, N, E>>,
  type: DiagramType<N, E>,
): Registered<T, N, E> {
  return {
    type: input.type,
    input,
    parse: (value) => {
      const parsed = input.parse(value);
      return parsed.ok ? { ok: true, use: (use) => use(parsed.value, type) } : parsed;
    },
  };
}

/** Every diagram type, in the spec's order. Each has an example, examples/<type>.json. */
const REGISTRY = [
  register(CLASS_INPUT, { profile: CLASS_PROFILE, card: classBody, line: classLine }),
  register(ER_INPUT, { profile: ER_PROFILE, card: tableBody, line: relationshipLine }),
  register(FLOW_INPUT, { profile: FLOW_PROFILE, card: shapeBody, line: flowLine, about: (node) => node.about }),
  register(ARCHITECTURE_INPUT, { profile: ARCHITECTURE_PROFILE, card: architectureBody, line: architectureLine }),
];

/** A diagram of any registered type, read. */
export type Diagram = ModelOf<(typeof REGISTRY)[number]>;
type ModelOf<R> = R extends Registered<infer T, infer N, infer E> ? DiagramModel<T, N, E> : never;

/** The registered types' names, in the spec's order. */
export const DIAGRAM_TYPES: readonly Diagram["type"][] = REGISTRY.map((registered) => registered.type);

/**
 * Parses a JSON string or an already-parsed value into a diagram of the type
 * it names, or lists every problem found. The checks come from the shared
 * input definitions.
 */
export function parseDiagram(input: unknown): ParseResult {
  const selected = selectType(input, REGISTRY);
  return selected.ok ? selected.type.parse(selected.value) : selected;
}

/** The JSON Schema for a diagram of any registered type, generated from the same definitions as the validator. */
export function jsonSchema() {
  return schemaOf(REGISTRY.map(({ type, input }) => ({ type, definition: input.definition })));
}
