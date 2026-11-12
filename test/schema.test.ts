import { describe, expect, it } from "vitest";
import { render, schema, StructaError, type Problem } from "../src/index";

// The schema is a plain JSON value; these tests walk it loosely.
type Node = { [key: string]: any };

const opts = { embedFonts: false } as const;

function greenhouse() {
  return {
    type: "flow",
    nodes: [
      { id: "vent", label: "Open the vents", shape: "step" },
      { id: "shade", label: "Pull the shade cloth", shape: "step" },
    ],
    edges: [{ id: "then-shade", from: "vent", to: "shade" }],
  } as Node;
}

async function outcome(input: object): Promise<"ok" | readonly Problem[]> {
  return render(input, opts).then(
    () => "ok" as const,
    (e: unknown) => {
      expect(e).toBeInstanceOf(StructaError);
      expect((e as StructaError).code).toBe("INVALID_INPUT");
      return (e as StructaError).problems;
    },
  );
}

/** Follows a `$ref` into `$defs`. */
function resolve(root: Node, node: Node): Node {
  if (!node.$ref) return node;
  return { ...root.$defs[(node.$ref as string).replace("#/$defs/", "")], ...node };
}

describe("the JSON Schema", () => {
  const root = schema() as Node;
  const node = root.properties.nodes.items;
  const edge = root.properties.edges.items;

  it("is written down as a reviewable file", async () => {
    await expect(`${JSON.stringify(schema(), null, 2)}\n`).toMatchFileSnapshot("__snapshots__/structa.schema.json");
  });

  it("is a 2020-12 JSON Schema for one diagram object", () => {
    expect(root.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(root.type).toBe("object");
  });

  it("gives a fresh copy each time, so callers can't change it for others", () => {
    (schema() as Node).properties.nodes.maxItems = 1;

    expect((schema() as Node).properties.nodes.maxItems).toBe(500);
  });

  it.each([
    ["the top level", () => root, (input: Node) => input, ""],
    ["a node", () => node, (input: Node) => input.nodes[0], "nodes[0]."],
    ["an edge", () => edge, (input: Node) => input.edges[0], "edges[0]."],
  ])("lists exactly the fields render() allows on %s", async (_name, part, target, prefix) => {
    const input = greenhouse();
    target(input).mulch = true;

    expect(part().additionalProperties).toBe(false);
    expect(await outcome(input)).toEqual([
      expect.objectContaining({ path: `${prefix}mulch`, hint: `allowed fields: ${Object.keys(part().properties).join(", ")}` }),
    ]);
  });

  it.each([
    ["the top level", () => root, (input: Node) => input, ""],
    ["a node", () => node, (input: Node) => input.nodes[1], "nodes[1]."],
    ["an edge", () => edge, (input: Node) => input.edges[0], "edges[0]."],
  ])("requires exactly the fields render() requires on %s", async (_name, part, target, prefix) => {
    for (const field of Object.keys(part().properties)) {
      const input = greenhouse();
      delete target(input)[field];

      const result = await outcome(input);

      const missing = result === "ok" ? [] : result.filter((p) => p.message === `missing required field "${field}"`);
      expect(missing.map((p) => p.path)).toEqual(part().required.includes(field) ? [`${prefix}${field}`] : []);
    }
  });

  it.each([
    ["type", (input: Node, value: string) => (input.type = value)],
    ["direction", (input: Node, value: string) => (input.direction = value)],
    ["shape", (input: Node, value: string) => (input.nodes[0].shape = value)],
  ])("offers exactly the %s values render() accepts", async (field, set) => {
    const values: string[] = (field === "shape" ? node : root).properties[field].enum;

    for (const value of values) {
      const input = greenhouse();
      set(input, value);
      expect(await outcome(input)).toBe("ok");
    }
    const input = greenhouse();
    set(input, "sideways");
    expect(await outcome(input)).toEqual([
      expect.objectContaining({ hint: `use ${values.map((v) => JSON.stringify(v)).join(" or ")}` }),
    ]);
  });

  it("documents the defaults render() uses", async () => {
    expect(root.properties.direction.default).toBe("down");
    expect(root.properties.edges.default).toEqual([]);

    const { edges, ...withoutEdges } = greenhouse();
    const bare = await render({ ...withoutEdges, edges: [] }, opts);
    expect((await render(withoutEdges, opts)).svg).toBe(bare.svg);
    expect((await render({ ...greenhouse(), direction: "down" }, opts)).svg).toBe((await render(greenhouse(), opts)).svg);
  });

  it("accepts version 1 only", async () => {
    expect(root.properties.version.const).toBe(1);
    expect(root.required).not.toContain("version");
  });

  it.each(["airflow", "Vent-2_a.b:c", "vent hole", "edges[0]", "vent/1", "évent", ""])(
    "agrees with render() about the id %j",
    async (id) => {
      const pattern = new RegExp(resolve(root, node.properties.id).pattern, "u");
      const input = greenhouse();
      input.edges[0].id = id;

      expect(await outcome(input) === "ok").toBe(pattern.test(id));
    },
  );

  it("points every reference at the same id rule", () => {
    expect(node.properties.id.$ref).toBe("#/$defs/id");
    expect(edge.properties.id.$ref).toBe("#/$defs/id");
    expect(edge.properties.from.$ref).toBe("#/$defs/id");
    expect(edge.properties.to.$ref).toBe("#/$defs/id");
  });

  it("shows the node and edge limits render() enforces: 500 nodes and 1,000 edges", () => {
    expect(root.properties.nodes.maxItems).toBe(500);
    expect(root.properties.edges.maxItems).toBe(1000);
  });

  it("shows the label length limit render() enforces", async () => {
    const label = resolve(root, node.properties.label);
    const longest = "V".repeat(label.maxLength);
    const tooLong = `${longest}V`;

    const withLabel = (text: string) => {
      const input = greenhouse();
      input.nodes[0].label = text;
      return input;
    };
    expect(await outcome(withLabel(longest))).toBe("ok");
    expect(await outcome(withLabel(tooLong))).toEqual([
      expect.objectContaining({ path: "nodes[0].label", message: `is ${label.maxLength + 1} characters long; the limit is ${label.maxLength}` }),
    ]);
    expect(label.minLength).toBe(1);
  });

  it("sets the length limits for labels, descriptions and line labels in one place", () => {
    for (const kind of ["label", "description", "lineLabel"]) {
      expect(root.$defs[kind]).toMatchObject({ type: "string", minLength: 1, maxLength: expect.any(Number) });
    }
  });
});
