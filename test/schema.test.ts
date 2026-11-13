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

/** A small valid class diagram: two classes with members, and an enum with values. */
function toolShed() {
  return {
    type: "class",
    nodes: [
      { id: "shed", label: "ToolShed", properties: [{ text: "floor: Area" }], methods: [{ text: "lock(key: Key): void" }] },
      { id: "rake", label: "Rake", properties: [{ text: "tines: int" }], methods: [{ text: "gather(): Leaves" }] },
      { id: "handle", label: "HandleWood", stereotype: "enum", values: [{ text: "ASH" }, { text: "HICKORY" }] },
    ],
    edges: [{ id: "holds", from: "shed", to: "rake", kind: "association" }],
  } as Node;
}

/** A part of the schema: its name, the type of diagram it's in, where it is in the schema and in the input, and its path. */
type Part = readonly [name: string, type: string, part: () => Node, target: (input: Node) => Node, prefix: string];

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

  /**
   * The class card's property and method rows, as parts of the schema, in the
   * class node at `n`, and an enum's value rows, in the fixture's enum.
   */
  function rowParts(n: number): Part[] {
    return [
      ...(["properties", "methods"] as const).map((section): Part => [
        `a class row in ${section}`,
        "class",
        () => items("class", "nodes").properties[section].items,
        (input: Node) => input.nodes[n][section][0],
        `nodes[${n}].${section}[0].`,
      ]),
      ["an enum value", "class", () => items("class", "nodes").properties.values.items, (input: Node) => input.nodes[2].values[n], `nodes[2].values[${n}].`],
    ];
  }

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

  it.each<Part>([
    ["the top level", "flow", () => root, (input: Node) => input, ""],
    ["a flow node", "flow", () => node, (input: Node) => input.nodes[0], "nodes[0]."],
    ["a flow edge", "flow", () => edge, (input: Node) => input.edges[0], "edges[0]."],
    ["a class node", "class", () => items("class", "nodes"), (input: Node) => input.nodes[0], "nodes[0]."],
    ["a class edge", "class", () => items("class", "edges"), (input: Node) => input.edges[0], "edges[0]."],
    ...rowParts(0),
  ])("lists exactly the fields render() allows on %s", async (_name, type, part, target, prefix) => {
    const input = FIXTURES.get(type)!();
    target(input).mulch = true;

    expect(part().additionalProperties).toBe(false);
    expect(await outcome(input)).toEqual([
      expect.objectContaining({ path: `${prefix}mulch`, hint: `allowed fields: ${Object.keys(part().properties).join(", ")}` }),
    ]);
  });

  it.each<Part>([
    ["the top level", "flow", () => root, (input: Node) => input, ""],
    ["a flow node", "flow", () => node, (input: Node) => input.nodes[1], "nodes[1]."],
    ["a flow edge", "flow", () => edge, (input: Node) => input.edges[0], "edges[0]."],
    ["a class node", "class", () => items("class", "nodes"), (input: Node) => input.nodes[1], "nodes[1]."],
    ["a class edge", "class", () => items("class", "edges"), (input: Node) => input.edges[0], "edges[0]."],
    ...rowParts(1),
  ])("requires exactly the fields render() requires on %s", async (_name, type, part, target, prefix) => {
    for (const field of Object.keys(part().properties)) {
      const input = FIXTURES.get(type)!();
      delete target(input)[field];

      const result = await outcome(input);

      const missing = result === "ok" ? [] : result.filter((p) => p.message === `missing required field "${field}"`);
      expect(missing.map((p) => p.path)).toEqual(part().required.includes(field) ? [`${prefix}${field}`] : []);
    }
  });

  /** The class sections that hold rows, each in the fixture's first card that has it. */
  const ROW_SECTIONS = [
    ["properties", 0],
    ["methods", 0],
    ["values", 2],
  ] as const;

  /** The first row of a class card's section: its part of the schema, its card and the row in the input. */
  const classRow = (section: (typeof ROW_SECTIONS)[number][0], n: number) => ({
    part: () => items("class", "nodes").properties[section].items,
    card: (input: Node) => input.nodes[n],
    row: (input: Node) => input.nodes[n][section][0],
  });

  it.each<readonly [name: string, type: string, part: () => Node, set: (input: Node, value: string) => void]>([
    ["theme", "flow", () => root, (input, value) => (input.theme = value)],
    ["direction", "flow", () => root, (input, value) => (input.direction = value)],
    // On a node with no lines, since lines can't touch a note.
    ["shape", "flow", () => node, (input, value) => input.nodes.push({ id: "mist", label: "Mist the cuttings", shape: value })],
    ["node status", "flow", () => node, (input, value) => (input.nodes[0].status = value)],
    ["edge status", "flow", () => edge, (input, value) => (input.edges[0].status = value)],
    ["class node status", "class", () => items("class", "nodes"), (input, value) => (input.nodes[0].status = value)],
    [
      "class node stereotype",
      "class",
      () => items("class", "nodes"),
      (input, value) => {
        input.nodes[0].stereotype = value;
        // An enum lists values, not properties and methods.
        if (value === "enum") {
          input.nodes[0].values = [{ text: "OPEN" }];
          delete input.nodes[0].properties;
          delete input.nodes[0].methods;
        }
      },
    ],
    ["class edge kind", "class", () => items("class", "edges"), (input, value) => (input.edges[0].kind = value)],
    ...ROW_SECTIONS.flatMap(([section, n]) => {
      const { part, card, row } = classRow(section, n);
      return [
        [`${section} row visibility`, "class", part, (input: Node, value: string) => (row(input).visibility = value)],
        [
          `${section} row status`,
          "class",
          part,
          (input: Node, value: string) => {
            // A row with a status needs its card to have one; a changed card's rows may have any.
            card(input).status = "changed";
            row(input).status = value;
          },
        ],
      ] as const;
    }),
  ])("offers exactly the %s values render() accepts", async (name, type, part, set) => {
    const values: string[] = part().properties[name.split(" ").at(-1)!].enum;
    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      const input = FIXTURES.get(type)!();
      set(input, value);
      expect([value, await outcome(input)]).toEqual([value, "ok"]);
    }
    const input = FIXTURES.get(type)!();
    set(input, "sideways");
    const quoted = values.map((v) => JSON.stringify(v));
    const choices = quoted.length <= 2 ? quoted.join(" or ") : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
    expect(await outcome(input)).toEqual([expect.objectContaining({ hint: `use ${choices}` })]);
  });

  it.each<readonly [name: string, type: string, part: () => Node, set: (input: Node, value: unknown) => void]>([
    ["legend", "flow", () => root, (input, value) => (input.legend = value)],
    ["emphasis", "flow", () => edge, (input, value) => (input.edges[0].emphasis = value)],
    ["class abstract", "class", () => items("class", "nodes"), (input, value) => (input.nodes[0].abstract = value)],
    ...ROW_SECTIONS.flatMap(([section, n]) => {
      const { part, row } = classRow(section, n);
      return (["static", "abstract"] as const).map(
        (flag) => [`${section} row ${flag}`, "class", part, (input: Node, value: unknown) => (row(input)[flag] = value)] as const,
      );
    }),
  ])("agrees with render() that %s is true or false, and false when left out", async (name, type, part, set) => {
    const field = part().properties[name.split(" ").at(-1)!];
    expect(field.type).toBe("boolean");

    for (const value of [true, false]) {
      const input = FIXTURES.get(type)!();
      set(input, value);
      expect(await outcome(input)).toBe("ok");
    }
    const input = FIXTURES.get(type)!();
    set(input, "true");
    expect(await outcome(input)).not.toBe("ok");
    // The default the schema documents draws the same as leaving the field out.
    const given = FIXTURES.get(type)!();
    set(given, field.default);
    expect((await render(given, opts)).svg).toBe((await render(FIXTURES.get(type)!(), opts)).svg);
  });

  it("agrees with render() that only a note can be about another node", async () => {
    const validate = new Ajv2020({ strict: true }).compile(root);
    const withAbout = (shape: string) => {
      const input = greenhouse();
      input.nodes.push({ id: "aside", label: "Close them at dusk", shape, about: "vent" });
      return input;
    };

    for (const shape of node.properties.shape.enum as string[]) {
      const input = withAbout(shape);
      const accepted = validate(input);
      expect([shape, accepted]).toEqual([shape, shape === "note"]);
      expect([shape, (await outcome(input)) === "ok"]).toEqual([shape, accepted]);
    }
    expect(node.properties.about.$ref).toBe("#/$defs/id");
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

  it("documents only defaults that, filled in, keep the input valid and draw the same", async () => {
    // A tool may write out every default the schema documents, as Ajv's useDefaults does.
    const fill = new Ajv2020({ strict: true, useDefaults: true }).compile(root);

    for (const [type, fixture] of FIXTURES) {
      const filled = fixture();
      expect([type, fill(filled), fill.errors ?? []]).toEqual([type, true, []]);
      expect(filled).not.toEqual(fixture());
      expect([type, await outcome(filled)]).toEqual([type, "ok"]);
      expect([type, (await render(filled, opts)).svg]).toEqual([type, (await render(fixture(), opts)).svg]);
    }
    // Only some classes may have each list, so none of them has a default.
    const classNode = items("class", "nodes");
    expect(["properties", "methods", "values"].map((list) => [list, classNode.properties[list].default])).toEqual([
      ["properties", undefined],
      ["methods", undefined],
      ["values", undefined],
    ]);
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

  it("gives a node's description the same length limit as the diagram's, and only the characters its font draws", async () => {
    const description = resolve(root, node.properties.description);
    expect(node.properties.description.$ref).toBe(root.properties.description.$ref);
    expect(description.maxLength).toBe(300);
    expect(new RegExp(description.pattern, "u").test("Shade from noon – 2 pm")).toBe(true);
    expect(new RegExp(description.pattern, "u").test("Shade 🌞")).toBe(false);

    const input = greenhouse();
    input.nodes[0].description = "V".repeat(description.maxLength + 1);
    expect(await outcome(input)).toEqual([expect.objectContaining({ path: "nodes[0].description" })]);
  });

  it("sets the length limits for titles, labels, descriptions, line labels and row text in one place, and rules out blank text", () => {
    for (const kind of ["title", "label", "description", "lineLabel", "rowText"]) {
      expect(root.$defs[kind]).toMatchObject({ type: "string", minLength: 1, maxLength: expect.any(Number), pattern: "[^ ]" });
    }
  });

  it.each<readonly [name: string, fields: Node, accepted: boolean]>([
    ["an enum with values", { stereotype: "enum", values: [{ text: "ASH" }] }, true],
    ["an enum with no rows", { stereotype: "enum" }, true],
    ["a record with members", { stereotype: "record", properties: [{ text: "length: Metres" }] }, true],
    ["a class with values", { values: [{ text: "ASH" }] }, false],
    ["an interface with values", { stereotype: "interface", values: [] }, false],
    ["an enum with properties", { stereotype: "enum", properties: [] }, false],
    ["an enum with methods and values", { stereotype: "enum", methods: [{ text: "grain(): Grain" }], values: [{ text: "ASH" }] }, false],
    ["a stereotype that isn't one, with values", { stereotype: "struct", values: [{ text: "ASH" }] }, false],
  ])("agrees with render() about %s: only an enum has values, and an enum has no members", async (_name, fields, accepted) => {
    const validate = new Ajv2020({ strict: true }).compile(root);
    const input = toolShed();
    input.nodes[1] = { id: "rake", label: "Rake", ...fields };

    expect([validate(input), (await outcome(input)) === "ok"]).toEqual([accepted, accepted]);
  });

  it("agrees with render() that more is a whole number from 1 to 9999", async () => {
    const validate = new Ajv2020({ strict: true }).compile(root);
    expect(items("class", "nodes").properties.more).toMatchObject({ type: "integer", minimum: 1, maximum: 9999 });

    for (const more of [0, 1, 2.5, 12, 9999, 10000, "12", -1]) {
      const input = toolShed();
      input.nodes[0].more = more;
      const accepted = validate(input);
      expect([more, (await outcome(input)) === "ok"]).toEqual([more, accepted]);
    }
  });

  it("agrees with render() that row text may use what JetBrains Mono draws, not what Inter draws", async () => {
    const pattern = new RegExp(items("class", "nodes").properties.methods.items.properties.text.pattern, "u");

    // JetBrains Mono can draw ⇑ but not Ĳ; Inter is the other way round.
    for (const [text, drawable] of [["climb(): ⇑", true], ["Ĳssel(): void", false]] as const) {
      const input = toolShed();
      input.nodes[0].methods[0].text = text;
      expect([text, pattern.test(text), (await outcome(input)) === "ok"]).toEqual([text, drawable, drawable]);
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
