import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildSkillForTest, type BuiltSkill } from "./helpers/skill";

// Seam 2: SKILL.md as the built skill folder ships it, checked against the
// shipped structa.mjs run with node.
let skill: BuiltSkill;
let skillMd: string;
beforeAll(async () => {
  skill = await buildSkillForTest();
  skillMd = readFileSync(join(skill.dir, "SKILL.md"), "utf8");
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
    const description = fields.description as string;
    expect(typeof description).toBe("string");
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(description).toMatch(/\. Use when /);
  });

  it("shows commands that all run, one after another, from a working folder of your own", () => {
    const commands = shownCommands(skillMd);
    expect(commands.length).toBeGreaterThan(0);

    for (const line of commands) {
      const { args, stdin, stdout } = readCommand(line);
      const outputs = args.flatMap((arg, i) => (args[i - 1] === "-o" ? [join(skill.elsewhere, arg)] : []));
      for (const file of [...outputs, ...(stdout === undefined ? [] : [join(skill.elsewhere, stdout)])]) rmSync(file, { force: true });

      const result = skill.run(args, stdin === undefined ? {} : { stdin: readFileSync(join(skill.elsewhere, stdin)) });
      if (stdout !== undefined) writeFileSync(join(skill.elsewhere, stdout), result.stdout);

      expect([line, result.status, result.stderr]).toEqual([line, 0, ""]);
      for (const file of outputs) expect([line, file, existsSync(file)]).toEqual([line, file, true]);
      expect([line, outputs.length > 0 || result.stdout.length > 0]).toEqual([line, true]);
    }
    // Each run starts node afresh, and every PNG starts the rasteriser afresh.
  }, 60_000);

  it("names only fields and values the schema has, words of --help, files in the skill folder and commands it shows", () => {
    const schema = JSON.parse(skill.run(["schema"]).stdout) as unknown;
    const { fields, values } = schemaWords(schema);
    const helpWords = new Set(skill.run(["--help"]).stdout.split(/[\s,;|()[\]]+/));
    const commands = shownCommands(skillMd);
    /** True when `span` is a JSON object's fields, such as "groupAreas": true, each a field with a value it can have. */
    const isFragment = (span: string) => {
      let fragment: unknown;
      try {
        fragment = JSON.parse(`{${span}}`);
      } catch {
        return false;
      }
      return Object.entries(fragment as object).every(
        ([field, value]) => fields.has(field) && (typeof value !== "string" || values.has(value)) && typeof value !== "object",
      );
    };
    const exists = (span: string) =>
      (span.startsWith("node ") && commands.includes(span)) ||
      fields.has(span) ||
      values.has(span) ||
      span.split(" ").every((word) => helpWords.has(word)) ||
      isFragment(span) ||
      existsSync(join(skill.dir, span));

    const spans = codeSpans(skillMd);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.filter((span) => !exists(span))).toEqual([]);
  });

  it("has only sh code blocks, which hold commands, and json ones, which hold diagrams that render", () => {
    const languages = [...skillMd.matchAll(/^```(.*)$/gm)].map(([, language]) => language).filter((_, i) => i % 2 === 0);

    expect(languages.filter((language) => language !== "sh" && language !== "json")).toEqual([]);
    for (const json of codeBlocks(skillMd, "json")) {
      const result = skill.run(["-", "--no-embed-fonts"], { stdin: json });
      expect([json, result.status, result.stderr]).toEqual([json, 0, ""]);
    }
  });
});

/** Every inline code span in `markdown`'s text, outside its frontmatter and code blocks, in order. */
function codeSpans(markdown: string): string[] {
  const text = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^```.*\n[\s\S]*?^```$/gm, "");
  return [...text.matchAll(/`([^`]+)`/g)].map(([, span]) => span!);
}

/** The names of the fields anywhere in the JSON Schema `schema`, and every value its choices allow. */
function schemaWords(schema: unknown): { fields: Set<string>; values: Set<string> } {
  const fields = new Set<string>();
  const values = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    const { properties, enum: choices, const: only } = node as { properties?: object; enum?: unknown[]; const?: unknown };
    for (const field of Object.keys(properties ?? {})) fields.add(field);
    for (const value of [...(choices ?? []), only]) if (typeof value === "string") values.add(value);
    Object.values(node).forEach(walk);
  };
  walk(schema);
  return { fields, values };
}

/** The contents of the code blocks in `markdown` written in `language`, in order. */
function codeBlocks(markdown: string, language: string): string[] {
  return [...markdown.matchAll(/^```(.*)\n([\s\S]*?)^```$/gm)].flatMap(([, lang, body]) => (lang === language ? [body!] : []));
}

/** Each command in SKILL.md's sh code blocks, in order: every line that isn't blank or only a comment. */
function shownCommands(markdown: string): string[] {
  return codeBlocks(markdown, "sh").flatMap((block) =>
    block.split("\n").flatMap((line) => {
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
  expect([line, node, module]).toEqual([line, "node", "structa.mjs"]);
  const args: string[] = [];
  let stdin: string | undefined;
  let stdout: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    expect([line, word]).not.toEqual([line, expect.stringMatching(/["'|&;$`]/)]);
    if (word === "<") stdin = words[++i];
    else if (word === ">") stdout = words[++i];
    else args.push(word);
  }
  return { args, ...(stdin === undefined ? {} : { stdin }), ...(stdout === undefined ? {} : { stdout }) };
}
