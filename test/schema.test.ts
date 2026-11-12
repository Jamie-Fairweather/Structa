import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, StructaError, type Problem } from "../src/index";
import { buildSkillForTest, type BuiltSkill, type RunResult } from "./helpers/skill";

// The schema is a plain JSON value; these tests walk it loosely.
type Node = { [key: string]: any };

// Seam 2: the schema is what `node structa.mjs schema` prints from the built
// skill folder. The tests below check that it agrees with render().
let skill: BuiltSkill;
let printed: RunResult;
beforeAll(async () => {
  skill = await buildSkillForTest();
  printed = skill.run(["schema"]);
}, 60_000);
afterAll(() => skill?.remove());
const examplesDir = fileURLToPath(new URL("../examples/", import.meta.url));

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

describe("node structa.mjs schema", () => {
  it("prints the schema on standard output, and nothing on standard error", () => {
    expect(printed.status).toBe(0);
    expect(printed.stderr).toBe("");
  });

  it("is valid JSON Schema, by the 2020-12 meta-schema", () => {
    const ajv = new Ajv2020();

    const valid = ajv.validateSchema(JSON.parse(printed.stdout));

    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it("accepts every example, and compiles with no unknown or ignored keywords", () => {
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(printed.stdout));
    const examples = readdirSync(examplesDir).filter((file) => file.endsWith(".json"));

    expect(examples.length).toBeGreaterThan(0);
    for (const file of examples) {
      validate(JSON.parse(readFileSync(join(examplesDir, file), "utf8")));
      expect([file, validate.errors ?? []]).toEqual([file, []]);
    }
  });

  it("ships the same schema in the skill folder, as structa.schema.json", () => {
    expect(readFileSync(join(skill.dir, "structa.schema.json"), "utf8")).toBe(printed.stdout);
  });
});

/** A small valid class diagram. */
function toolShed() {
  return {
    type: "class",
    nodes: [
      { id: "shed", label: "ToolShed" },
      { id: "rake", label: "Rake" },
    ],
    edges: [{ id: "holds", from: "shed", to: "rake", kind: "association" }],
  } as Node;
}

/** A small valid diagram of each type. */
const FIXTURES = new Map<string, () => Node>([
  ["class", toolShed],
  ["flow", greenhouse],
]);

describe("the JSON Schema", () => {
  let root: Node;
  /** The schema of one node or one edge in a diagram of this type. */
  let items: (type: string, list: "nodes" | "edges") => Node;
  let node: Node;
  let edge: Node;
  beforeAll(() => {
    root = JSON.parse(printed.stdout) as Node;
    items = (type, list) => {
      const branches = (root.allOf as Node[]).filter((branch) => branch.if.properties.type.const === type);
      expect(branches).toHaveLength(1);
      return branches[0]!.then.properties[list].items;
    };
    node = items("flow", "nodes");
    edge = items("flow", "edges");
  });

  it("offers exactly the diagram types render() accepts, each with its own nodes and edges", async () => {
    const validate = new Ajv2020({ strict: true }).compile(root);
    expect(root.properties.type.enum).toEqual(["class", "flow"]);

    for (const [type, fixture] of FIXTURES) {
      expect([type, await outcome(fixture())]).toEqual([type, "ok"]);
      expect([type, validate(fixture())]).toEqual([type, true]);
      // The other type's nodes don't fit this type.
      for (const [other, otherFixture] of FIXTURES) {
        if (other === type) continue;
        const mixed = { ...fixture(), nodes: otherFixture().nodes, edges: [] };
        expect([type, other, await outcome(mixed)]).not.toEqual([type, other, "ok"]);
        expect([type, other, validate(mixed)]).toEqual([type, other, false]);
      }
    }
    expect(await outcome({ ...greenhouse(), type: "sideways" })).toEqual([
      expect.objectContaining({ path: "type", hint: 'use "class" or "flow"' }),
    ]);
  });

  it("is written down as a reviewable file", async () => {
    await expect(printed.stdout).toMatchFileSnapshot("__snapshots__/structa.schema.json");
  });

  it("is a 2020-12 JSON Schema for one diagram object", () => {
    expect(root.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(root.type).toBe("object");
  });

  it.each([
    ["the top level", "flow", () => root, (input: Node) => input, ""],
    ["a flow node", "flow", () => node, (input: Node) => input.nodes[0], "nodes[0]."],
    ["a flow edge", "flow", () => edge, (input: Node) => input.edges[0], "edges[0]."],
    ["a class node", "class", () => items("class", "nodes"), (input: Node) => input.nodes[0], "nodes[0]."],
    ["a class edge", "class", () => items("class", "edges"), (input: Node) => input.edges[0], "edges[0]."],
  ])("lists exactly the fields render() allows on %s", async (_name, type, part, target, prefix) => {
    const input = FIXTURES.get(type)!();
    target(input).mulch = true;

    expect(part().additionalProperties).toBe(false);
    expect(await outcome(input)).toEqual([
      expect.objectContaining({ path: `${prefix}mulch`, hint: `allowed fields: ${Object.keys(part().properties).join(", ")}` }),
    ]);
  });

  it.each([
    ["the top level", "flow", () => root, (input: Node) => input, ""],
    ["a flow node", "flow", () => node, (input: Node) => input.nodes[1], "nodes[1]."],
    ["a flow edge", "flow", () => edge, (input: Node) => input.edges[0], "edges[0]."],
    ["a class node", "class", () => items("class", "nodes"), (input: Node) => input.nodes[1], "nodes[1]."],
    ["a class edge", "class", () => items("class", "edges"), (input: Node) => input.edges[0], "edges[0]."],
  ])("requires exactly the fields render() requires on %s", async (_name, type, part, target, prefix) => {
    for (const field of Object.keys(part().properties)) {
      const input = FIXTURES.get(type)!();
      delete target(input)[field];

      const result = await outcome(input);

      const missing = result === "ok" ? [] : result.filter((p) => p.message === `missing required field "${field}"`);
      expect(missing.map((p) => p.path)).toEqual(part().required.includes(field) ? [`${prefix}${field}`] : []);
    }
  });

  it.each([
    ["theme", () => root, (input: Node, value: string) => (input.theme = value)],
    ["direction", () => root, (input: Node, value: string) => (input.direction = value)],
    ["shape", () => node, (input: Node, value: string) => (input.nodes[0].shape = value)],
    ["node status", () => node, (input: Node, value: string) => (input.nodes[0].status = value)],
    ["edge status", () => edge, (input: Node, value: string) => (input.edges[0].status = value)],
  ])("offers exactly the %s values render() accepts", async (name, part, set) => {
    const values: string[] = part().properties[name.split(" ").at(-1)!].enum;

    for (const value of values) {
      const input = greenhouse();
      set(input, value);
      expect(await outcome(input)).toBe("ok");
    }
    const input = greenhouse();
    set(input, "sideways");
    const quoted = values.map((v) => JSON.stringify(v));
    const choices = quoted.length <= 2 ? quoted.join(" or ") : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
    expect(await outcome(input)).toEqual([expect.objectContaining({ hint: `use ${choices}` })]);
  });

  it.each([
    ["legend", () => root, (input: Node, value: unknown) => (input.legend = value)],
    ["emphasis", () => edge, (input: Node, value: unknown) => (input.edges[0].emphasis = value)],
  ])("agrees with render() that %s is true or false", async (name, part, set) => {
    expect(part().properties[name].type).toBe("boolean");

    for (const value of [true, false]) {
      const input = greenhouse();
      set(input, value);
      expect(await outcome(input)).toBe("ok");
    }
    const input = greenhouse();
    set(input, "true");
    expect(await outcome(input)).not.toBe("ok");
  });

  it("documents the defaults render() uses", async () => {
    expect(root.properties.theme.default).toBe("light");
    expect(root.properties.direction.default).toBe("down");
    expect(root.properties.edges.default).toEqual([]);

    const { edges, ...withoutEdges } = greenhouse();
    const bare = await render({ ...withoutEdges, edges: [] }, opts);
    expect((await render(withoutEdges, opts)).svg).toBe(bare.svg);
    expect((await render({ ...greenhouse(), direction: "down" }, opts)).svg).toBe((await render(greenhouse(), opts)).svg);
    expect((await render({ ...greenhouse(), theme: "light" }, opts)).svg).toBe((await render(greenhouse(), opts)).svg);
  });

  it("documents that emphasis is off unless asked for", async () => {
    expect(edge.properties.emphasis.default).toBe(false);

    const off = greenhouse();
    off.edges[0].emphasis = false;
    expect((await render(off, opts)).svg).toBe((await render(greenhouse(), opts)).svg);
  });

  it("documents that the legend is on unless turned off", async () => {
    expect(root.properties.legend.default).toBe(true);

    const changed = greenhouse();
    changed.nodes[0].status = "changed";
    expect((await render({ ...changed, legend: true }, opts)).svg).toBe((await render(changed, opts)).svg);
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

  it("sets the length limits for titles, labels, descriptions and line labels in one place, and rules out blank text", () => {
    for (const kind of ["title", "label", "description", "lineLabel"]) {
      expect(root.$defs[kind]).toMatchObject({ type: "string", minLength: 1, maxLength: expect.any(Number), pattern: "[^ ]" });
    }
  });

  describe("agrees with render() about label text", () => {
    let schemaAccepts: (text: string) => boolean;
    beforeAll(() => {
      const { minLength, maxLength, pattern: notBlank } = root.$defs.label;
      const characters = new RegExp(node.properties.label.pattern, "u");
      schemaAccepts = (text) =>
        characters.test(text) && new RegExp(notBlank, "u").test(text) && [...text].length >= minLength && [...text].length <= maxLength;
    });

    it.each(["Open the vents", "", " ", "   ", "  Open   the vents  ", String.fromCodePoint(0xa0)])("for %j", async (text) => {
      const input = greenhouse();
      input.nodes[0].label = text;

      expect((await outcome(input)) === "ok").toBe(schemaAccepts(text));
    });

    it("for every character of the Basic Multilingual Plane, and some beyond it", async () => {
      const codePoints = [...Array.from({ length: 0x10000 }, (_, i) => i), 0x1f331, 0x1f600, 0x20000, 0x10ffff];
      const disagreements: string[] = [];
      const verdicts = new Set<boolean>();
      // 500 labels per render. The unknown field stops each render before layout, so this stays quick.
      for (let start = 0; start < codePoints.length; start += 500) {
        const batch = codePoints.slice(start, start + 500);
        const labels = batch.map((codePoint) => `V${String.fromCodePoint(codePoint)}`);
        const nodes = labels.map((label, i) => ({ id: `n${i}`, label, shape: "step" }));

        const result = await outcome({ type: "flow", nodes, mulch: true });

        const rejected = new Set(result === "ok" ? [] : result.map((p) => p.path));
        batch.forEach((codePoint, i) => {
          const accepted = schemaAccepts(labels[i]!);
          verdicts.add(accepted);
          if (accepted === rejected.has(`nodes[${i}].label`)) disagreements.push(`U+${codePoint.toString(16).toUpperCase()}`);
        });
      }

      expect(disagreements).toEqual([]);
      expect(verdicts).toEqual(new Set([true, false]));
    });
  });
});
