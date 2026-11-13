import { readFileSync } from "node:fs";
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
});
