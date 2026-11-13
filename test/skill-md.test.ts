import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildSkillForTest, type BuiltSkill } from "./helpers/skill";

// Seam 2: SKILL.md as the built skill folder ships it, checked against the
// shipped structa.mjs run with node, so it can't drift from the tool: every
// command it shows runs, and every field, value, flag, file and limit it
// names is real.
let skill: BuiltSkill;
let skillMd: string;
/** What `node structa.mjs schema` prints. */
let schema: unknown;
beforeAll(async () => {
  skill = await buildSkillForTest();
  skillMd = readFileSync(join(skill.dir, "SKILL.md"), "utf8");
  schema = JSON.parse(skill.run(["schema"]).stdout);
}, 60_000);
afterAll(() => skill?.remove());

describe("SKILL.md in the skill folder", () => {
  it("is skill/SKILL.md from the repository, as it is", () => {
    expect(skillMd).toBe(readFileSync(fileURLToPath(new URL("../skill/SKILL.md", import.meta.url)), "utf8"));
  });

  it("starts with skill frontmatter: the skill folder's name, and what it does and when to use it", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)?.[1];
    expect(frontmatter).toBeDefined();
    const fields = parseYaml(frontmatter!) as Record<string, unknown>;

    expect(Object.keys(fields)).toEqual(["name", "description"]);
    // The folder the release zip unpacks to. A skill's name is lowercase words joined by hyphens.
    expect(fields.name).toBe(basename(skill.dir));
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(typeof fields.description).toBe("string");
    const description = fields.description as string;
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(description).toMatch(/\. Use when /);
  });

  // Each run starts node afresh, and every PNG starts the rasteriser afresh.
  it("shows commands that all run, one after another, from a working folder of your own", () => {
    const commands = shownCommands(skillMd);
    expect(commands.length).toBeGreaterThan(0);

    for (const line of commands) {
      const { args, stdin, stdout } = readCommand(line);
      const outputs = args.flatMap((arg, i) => (args[i - 1] === "-o" ? [join(skill.elsewhere, arg)] : []));
      for (const file of [...outputs, ...(stdout === undefined ? [] : [join(skill.elsewhere, stdout)])]) rmSync(file, { force: true });

      const result = skill.run(args, stdin === undefined ? {} : { stdin: readFileSync(join(skill.elsewhere, stdin)) });
      if (stdout !== undefined) writeFileSync(join(skill.elsewhere, stdout), result.stdout);

      expect([result.status, result.stderr], line).toEqual([0, ""]);
      for (const file of outputs) expect(existsSync(file), `${line} writes ${file}`).toBe(true);
      expect(outputs.length > 0 || result.stdout !== "", `${line} writes a file or prints something`).toBe(true);
    }
  }, 60_000);

  it("has only sh code blocks, which hold commands, and json ones, which hold diagrams that render", () => {
    const blocks = codeBlocks(skillMd);

    expect(blocks.map((block) => block.language).filter((language) => language !== "sh" && language !== "json")).toEqual([]);
    for (const { body } of blocks.filter((block) => block.language === "json")) {
      const result = skill.run(["-", "--no-embed-fonts"], { stdin: body });
      expect([result.status, result.stderr], body).toEqual([0, ""]);
    }
  });

  it("names only fields and values the schema has, words of --help, files in the skill folder and commands it shows", () => {
    const { fields, values } = schemaWords(schema);
    const helpWords = new Set(skill.run(["--help"]).stdout.split(/[\s,;|()[\]]+/));
    const commands = shownCommands(skillMd);
    /** True when `span` is the inside of a JSON object, such as "groupAreas": true, each of its fields with a value it can have. */
    const isFragment = (span: string) => {
      let fragment: object;
      try {
        fragment = JSON.parse(`{${span}}`) as object;
      } catch {
        return false;
      }
      return Object.entries(fragment).every(
        ([field, value]) => fields.has(field) && (typeof value === "string" ? values.has(value) : typeof value !== "object"),
      );
    };
    const exists = (span: string) =>
      fields.has(span) ||
      values.has(span) ||
      isFragment(span) ||
      span.split(" ").every((word) => helpWords.has(word)) ||
      (span.startsWith("node ") && commands.includes(span)) ||
      existsSync(join(skill.dir, span));

    const spans = codeSpans(skillMd);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.filter((span) => !exists(span))).toEqual([]);
  });

  it("says when to use each diagram type the schema has, one point each, in the schema's order", () => {
    const types = choicesOf(schema, "type");
    const points = [...section(skillMd, "Choosing the type").matchAll(/^- `([^`]+)`: .*\bUse it for\b/gm)].map(([, type]) => type);

    expect(types.length).toBeGreaterThan(0);
    expect(points).toEqual(types);
  });

  it("says when to give each status the schema has, one point each, in the schema's order", () => {
    const statuses = choicesOf(schema, "status");
    const points = [...section(skillMd, "Showing a change honestly").matchAll(/^- `([^`]+)`: /gm)].map(([, status]) => status);

    expect(statuses.length).toBeGreaterThan(0);
    expect(points).toEqual(statuses);
  });

  it("states every limit the schema sets, and only those, in its table of limits", () => {
    // Each as "<field> <limit>": a field can have several, as an area's, a card's and a line's label do.
    expect(statedLimits(skillMd)).toEqual(schemaLimits(schema));
  });

  it("asks for the Node that package.json does, and calls Bun and Deno untested wherever it names them", () => {
    const { engines } = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { engines: { node: string } };
    const major = /^>=(\d+)$/.exec(engines.node)?.[1];
    const naming = skillMd.split(/(?<=\.)\s+/).filter((sentence) => /\b(bun|deno)\b/i.test(sentence));

    expect(major).toBeDefined();
    expect(skillMd).toContain(`Node ${major} or newer`);
    expect(naming.length).toBeGreaterThan(0);
    expect(naming.filter((sentence) => !/\buntested\b/.test(sentence))).toEqual([]);
  });
});

/** The code blocks in `markdown`, in order, each with the language its opening fence names. */
function codeBlocks(markdown: string): { language: string; body: string }[] {
  return [...markdown.matchAll(/^```(.*)\n([\s\S]*?)^```$/gm)].map(([, language, body]) => ({ language: language!, body: body! }));
}

/** Each command in `markdown`'s sh code blocks, in order: every line that isn't blank once its comment is gone. */
function shownCommands(markdown: string): string[] {
  return codeBlocks(markdown)
    .filter((block) => block.language === "sh")
    .flatMap((block) =>
      block.body.split("\n").flatMap((line) => {
        const command = line.replace(/(^|\s)#.*$/, "").trim();
        return command === "" ? [] : [command];
      }),
    );
}

/**
 * The arguments of one shown command, `node structa.mjs` and then words with
 * no quotes, and the files it redirects standard input from (<) and standard
 * output to (>).
 */
function readCommand(line: string): { args: string[]; stdin?: string; stdout?: string } {
  const [node, module, ...words] = line.split(/\s+/);
  expect([node, module], line).toEqual(["node", "structa.mjs"]);
  const args: string[] = [];
  let stdin: string | undefined;
  let stdout: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    expect(word, `${line} quotes, pipes or joins nothing`).not.toMatch(/["'|&;$`]/);
    if (word === "<") stdin = words[++i];
    else if (word === ">") stdout = words[++i];
    else args.push(word);
  }
  return { args, ...(stdin === undefined ? {} : { stdin }), ...(stdout === undefined ? {} : { stdout }) };
}

/** Every inline code span in `markdown`'s text, outside its frontmatter and code blocks, in order. */
function codeSpans(markdown: string): string[] {
  const text = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^```.*\n[\s\S]*?^```$/gm, "");
  return [...text.matchAll(/`([^`]+)`/g)].map(([, span]) => span!);
}

/** The text under `markdown`'s "## <heading>", up to the next such heading. Empty when there's no such heading. */
function section(markdown: string, heading: string): string {
  const marker = `\n## ${heading}\n`;
  const start = markdown.indexOf(marker);
  if (start === -1) return "";
  const body = markdown.slice(start + marker.length);
  const end = body.indexOf("\n## ");
  return end === -1 ? body : body.slice(0, end);
}

/**
 * The limits in the table in `markdown`'s Limits section, as "<field>
 * <limit>", once each, sorted: each field named in a row's first cell, with
 * the first number in its second.
 */
function statedLimits(markdown: string): string[] {
  const rows = section(markdown, "Limits").split("\n").filter((line) => line.startsWith("|")).slice(2);
  const limits = rows.flatMap((row) => {
    const [what = "", most = ""] = row.split("|").slice(1, -1);
    const limit = /\d+/.exec(most)?.[0];
    return [...what.matchAll(/`([^`]+)`/g)].map(([, field]) => `${field} ${limit}`);
  });
  return [...new Set(limits)].sort();
}

/** The parts of a JSON Schema object these tests read. */
interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly $ref?: string;
  readonly maxItems?: number;
  readonly maxLength?: number;
}

/** Calls `visit` with every object in the JSON Schema `schema`, outermost first. */
function eachObject(schema: unknown, visit: (node: SchemaNode) => void): void {
  const queue = [schema];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (typeof next !== "object" || next === null) continue;
    if (!Array.isArray(next)) visit(next as SchemaNode);
    queue.push(...Object.values(next));
  }
}

/** The names of the fields anywhere in the JSON Schema `schema`, and every text value its choices allow. */
function schemaWords(schema: unknown): { fields: Set<string>; values: Set<string> } {
  const fields = new Set<string>();
  const values = new Set<string>();
  eachObject(schema, (node) => {
    for (const field of Object.keys(node.properties ?? {})) fields.add(field);
    for (const value of [...(node.enum ?? []), node.const]) if (typeof value === "string") values.add(value);
  });
  return { fields, values };
}

/** The choices of the outermost field named `field` in the JSON Schema `schema` that has them. */
function choicesOf(schema: unknown, field: string): readonly unknown[] {
  const found: (readonly unknown[])[] = [];
  eachObject(schema, (node) => {
    const choices = node.properties?.[field]?.enum;
    if (choices !== undefined) found.push(choices);
  });
  return found[0] ?? [];
}

/** Every field in the JSON Schema `schema` with a most items or a longest text, as "<field> <limit>", once each, sorted. */
function schemaLimits(schema: unknown): string[] {
  const defs = (schema as { $defs: Record<string, SchemaNode> }).$defs;
  const limits = new Set<string>();
  eachObject(schema, (node) => {
    for (const [field, def] of Object.entries(node.properties ?? {})) {
      const resolved = { ...(def.$ref === undefined ? {} : defs[def.$ref.replace("#/$defs/", "")]), ...def };
      const limit = resolved.maxItems ?? resolved.maxLength;
      if (limit !== undefined) limits.add(`${field} ${limit}`);
    }
  });
  return [...limits].sort();
}
