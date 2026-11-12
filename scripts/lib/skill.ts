/**
 * Builds the skill folder: our code bundled into one ES module, with resvg's
 * glue and wasm inside it, elkjs's own file copied beside it untouched, a
 * one-line package.json that makes the folder CommonJS so elkjs's UMD file
 * loads even inside an ESM project, the examples folder, and the JSON Schema
 * the module prints.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { build, type Plugin } from "esbuild";
import { FACES } from "../../src/text/faces";
import { LAYOUT_TABLES } from "./subset";
import { readTtf, type TtfFont } from "./ttf";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MODULE_FILE = "structa.mjs";
const ELK_FILE = "elk.bundled.js";
const SCHEMA_FILE = "structa.schema.json";
const EXAMPLES_DIR = "examples";
const LICENSES_DIR = "licenses";
const PACKAGE_JSON = '{"type":"commonjs"}\n';

/**
 * The elkjs release we ship, and the SHA-256 of lib/elk.bundled.js in its
 * published npm tarball. The build fails unless package.json pins exactly
 * this version and the shipped file has exactly this hash, so upgrading
 * elkjs means changing both here on purpose.
 */
const PUBLISHED_ELK = {
  version: "0.12.1",
  sha256: "b1032b7cfd2a57c54c6f0e8369d7665e19a579954f7cd20a6dae28f1912ea0d7",
};

/**
 * Builds the skill folder from the project at `project` (this repository;
 * tests pass a changed copy) into `outDir`, replacing whatever was there.
 * Throws, listing every problem, if the folder fails the packaging checks.
 */
export async function buildSkill(outDir: string, project: string = repository): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const resvg = readResvg(project);
  const elkPackage = dirname(createRequire(join(project, "package.json")).resolve("elkjs/package.json"));
  const elkVersion = String((JSON.parse(readFileSync(join(elkPackage, "package.json"), "utf8")) as Manifest).version);
  const notices: Notices = {
    licences: licenceFiles(project, elkPackage, elkVersion, resvg),
    banner: banner(elkVersion, resvg),
    legalComment: resvg.legalComment,
  };
  await build({
    absWorkingDir: project,
    entryPoints: ["src/structa.ts"],
    outfile: join(outDir, MODULE_FILE),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Our code only imports elkjs types. Keep it external anyway, so a stray
    // value import can't pull ELK into the bundle (the checks would catch it).
    external: ["elkjs", "elkjs/*"],
    define: {
      // The paths to the elkjs file and the examples folder next to
      // structa.mjs, and no source-only fallbacks.
      STRUCTA_ELK_FILE: JSON.stringify(`./${ELK_FILE}`),
      STRUCTA_EXAMPLES_DIR: JSON.stringify(`./${EXAMPLES_DIR}/`),
      // resvg's wasm, carried inside structa.mjs.
      STRUCTA_RESVG_WASM: JSON.stringify(resvg.wasm),
    },
    dropLabels: ["source"],
    banner: { js: notices.banner },
    // Keep legal comments where they are, so resvg's sits right before its glue.
    legalComments: "inline",
    plugins: [legalComment(resvg.glue, notices.legalComment)],
    logLevel: "warning",
  });
  copyFileSync(join(elkPackage, "lib", ELK_FILE), join(outDir, ELK_FILE));
  writeFileSync(join(outDir, "package.json"), PACKAGE_JSON);
  cpSync(join(project, EXAMPLES_DIR), join(outDir, EXAMPLES_DIR), { recursive: true });
  writeLicences(join(outDir, LICENSES_DIR), notices.licences);

  const problems = [...checkSkill(outDir, project, elkPackage), ...checkLicences(outDir, project, notices)];
  if (problems.length > 0) throw new Error(`the skill folder failed its checks:\n${problems.join("\n")}`);

  // The shipped schema is exactly what the shipped tool prints when Node runs
  // it: this Node when the build runs under Node (as in the tests), otherwise
  // the node on PATH.
  const node = process.versions.bun === undefined ? process.execPath : "node";
  const schema = spawnSync(node, [join(outDir, MODULE_FILE), "schema"], { encoding: "utf8" });
  if (schema.error) {
    throw new Error(`can't run node to write ${SCHEMA_FILE}: ${schema.error.message} (the build needs Node 20 or later on PATH)`);
  }
  if (schema.status !== 0) throw new Error(`node ${MODULE_FILE} schema failed: ${schema.stderr}`);
  writeFileSync(join(outDir, SCHEMA_FILE), schema.stdout);
}

/** The pinned @resvg/resvg-wasm, as the build embeds it. */
interface Resvg {
  /** Its folder, which holds its JavaScript glue. */
  readonly glue: string;
  /** Its unmodified wasm, brotli-compressed and base64-encoded. */
  readonly wasm: string;
  readonly version: string;
  /** Its source code at that version. */
  readonly source: string;
  /** The comment that goes before its glue. */
  readonly legalComment: string;
}

/** The pinned @resvg/resvg-wasm in `project`. */
function readResvg(project: string): Resvg {
  // The package exports only its entry point and its wasm, so find its folder from the wasm.
  const wasmFile = createRequire(join(project, "package.json")).resolve("@resvg/resvg-wasm/index_bg.wasm");
  const glue = dirname(wasmFile);
  const version = String((JSON.parse(readFileSync(join(glue, "package.json"), "utf8")) as Manifest).version);
  const compressed = brotliCompressSync(readFileSync(wasmFile), { params: { [zlib.BROTLI_PARAM_QUALITY]: 9 } });
  const source = `https://github.com/thx/resvg-js/tree/v${version}`;
  return {
    glue,
    wasm: compressed.toString("base64"),
    version,
    source,
    legalComment: `/*! @resvg/resvg-wasm ${version} | MPL-2.0 | ${source} */`,
  };
}

/**
 * Puts `comment` at the top of each file esbuild bundles from the folder
 * `dir`. With legalComments "inline", it then sits right before that code.
 */
function legalComment(dir: string, comment: string): Plugin {
  return {
    name: "legal-comment",
    setup(build) {
      build.onLoad({ filter: /\.m?js$/ }, (args) => {
        if (!args.path.startsWith(dir + sep)) return undefined;
        return { contents: `${comment}\n${readFileSync(args.path, "utf8")}`, loader: "js" };
      });
    },
  };
}

/** A file in the skill folder's licenses/ folder. */
interface LicenceFile {
  /** Its name in licenses/. */
  readonly name: string;
  /** What it is, as the checks name it. */
  readonly what: string;
  /** Phrases it must hold to be that. */
  readonly says: readonly string[];
  /** The file the build copies there; otherwise `text` is what it writes. */
  readonly copy?: string;
  readonly text?: string;
}

const OFL = "SIL OPEN FONT LICENSE Version 1.1";

/**
 * The licence texts and source notes for everything the skill folder ships,
 * built from `project`, whose installed elkjs is version `elk` at `elkPackage`.
 * The texts that no installed package carries live in the project's own
 * licenses/ folder.
 */
function licenceFiles(project: string, elkPackage: string, elk: string, resvg: Resvg): LicenceFile[] {
  const elkSource = `https://github.com/kieler/elkjs/tree/${elk}`;
  return [
    { name: "MIT.txt", what: "Structa's MIT licence", says: ["MIT License"], copy: join(project, "LICENSE") },
    { name: "EPL-2.0.md", what: "the EPL-2.0 text", says: ["Eclipse Public License - v 2.0"], copy: join(elkPackage, "LICENSE.md") },
    {
      name: "Apache-2.0.txt",
      what: "the Apache-2.0 text",
      says: ["Apache License", "Version 2.0, January 2004"],
      copy: join(project, LICENSES_DIR, "Apache-2.0.txt"),
    },
    {
      name: "elkjs-source.txt",
      what: "elkjs's source note",
      says: [elkSource],
      text: [
        `${ELK_FILE} is lib/${ELK_FILE} from the published elkjs ${elk}, byte for byte. It ships next to ${MODULE_FILE}, which loads it to lay out diagrams.`,
        "",
        "Licence: EPL-2.0 OR GPL-3.0-or-later. The EPL-2.0 text is in EPL-2.0.md. The GPL-3.0 text is at https://www.gnu.org/licenses/gpl-3.0-standalone.html.",
        "",
        "Source code:",
        `- elkjs ${elk}: ${elkSource}`,
        "- Eclipse ELK, the Java code elkjs is compiled from: https://github.com/eclipse-elk/elk",
        "",
        `${ELK_FILE} also holds Guava and GWT code, compiled into it along with ELK. That code is licensed Apache-2.0, and its text is in Apache-2.0.txt.`,
        "- Guava: https://github.com/google/guava",
        "- GWT: https://github.com/gwtproject/gwt",
        "",
      ].join("\n"),
    },
    {
      name: "MPL-2.0.txt",
      what: "the MPL-2.0 text",
      says: ["Mozilla Public License Version 2.0"],
      copy: join(project, LICENSES_DIR, "MPL-2.0.txt"),
    },
    {
      name: "resvg-source.txt",
      what: "resvg's source note",
      says: [resvg.source],
      text: [
        `${MODULE_FILE} carries index_bg.wasm from the published @resvg/resvg-wasm ${resvg.version} unmodified ` +
          "(brotli-compressed and base64-encoded, and unpacked with Node's zlib to draw a PNG), " +
          "and bundles its JavaScript glue, index.mjs, unminified, straight after a comment naming the package, version, licence and source.",
        "",
        "Licence: MPL-2.0. Its text is in MPL-2.0.txt.",
        "",
        `Source code: ${resvg.source}`,
        "",
      ].join("\n"),
    },
    {
      name: "OFL-1.1-Inter.txt",
      what: "Inter's OFL-1.1",
      says: [OFL, "The Inter Project Authors"],
      copy: join(project, "fonts", "inter", "OFL.txt"),
    },
    {
      name: "OFL-1.1-JetBrains-Mono.txt",
      what: "JetBrains Mono's OFL-1.1",
      says: [OFL, "The JetBrains Mono Project Authors"],
      copy: join(project, "fonts", "jetbrains-mono", "OFL.txt"),
    },
  ];
}

/**
 * The comment structa.mjs starts with: the third-party parts embedded in it
 * and their licences, and elkjs, which ships beside it, with elkjs version `elk`.
 */
function banner(elk: string, resvg: Resvg): string {
  const licence = (name: string) => `${LICENSES_DIR}/${name}`;
  return [
    "/*!",
    ` * Structa, under the MIT licence (${licence("MIT.txt")}). This file also embeds:`,
    ` * - @resvg/resvg-wasm ${resvg.version}, its wasm and JavaScript glue: MPL-2.0 (${licence("MPL-2.0.txt")}, ${licence("resvg-source.txt")})`,
    ` * - the Inter fonts, subset: OFL-1.1 (${licence("OFL-1.1-Inter.txt")})`,
    ` * - the JetBrains Mono fonts, subset: OFL-1.1 (${licence("OFL-1.1-JetBrains-Mono.txt")})`,
    ` * elkjs ${elk} is not in this file: it ships next to it as ${ELK_FILE},`,
    ` * under EPL-2.0 OR GPL-3.0-or-later, with Apache-2.0 parts (${licence("elkjs-source.txt")}).`,
    " */",
  ].join("\n");
}

/** Writes `files` into the folder `dir`. A file to copy that isn't there is left for the checks to report. */
function writeLicences(dir: string, files: readonly LicenceFile[]): void {
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    if (file.copy === undefined) writeFileSync(join(dir, file.name), file.text ?? "");
    else if (existsSync(file.copy)) copyFileSync(file.copy, join(dir, file.name));
  }
}

/** What the skill folder must carry for the licences of the parts it ships. */
interface Notices {
  /** The files in licenses/. */
  readonly licences: readonly LicenceFile[];
  /** The comment structa.mjs starts with. */
  readonly banner: string;
  /** The comment before resvg's glue in structa.mjs. */
  readonly legalComment: string;
}

/**
 * The release-blocking licence checks on the skill folder built from
 * `project`: every licence file is there and holds the right text,
 * structa.mjs starts with its banner, and resvg's legal comment is in it.
 */
function checkLicences(dir: string, project: string, notices: Notices): string[] {
  const problems: string[] = [];
  for (const file of notices.licences) {
    const shipped = `${LICENSES_DIR}/${file.name}`;
    const path = join(dir, LICENSES_DIR, file.name);
    if (!existsSync(path)) {
      const from = file.copy === undefined ? "" : ` (the build copies it from ${relative(project, file.copy).split(sep).join("/")})`;
      problems.push(`${shipped} is missing${from}`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    for (const phrase of file.says) {
      if (!text.includes(phrase)) problems.push(`${shipped} is not ${file.what}: it doesn't say ${JSON.stringify(phrase)}`);
    }
  }
  const module = readFileSync(join(dir, MODULE_FILE), "utf8");
  if (!module.startsWith(`${notices.banner}\n`)) problems.push(`${MODULE_FILE} doesn't start with its licence banner`);
  if (!module.includes(notices.legalComment)) problems.push(`${MODULE_FILE} has no legal comment for resvg's glue: ${notices.legalComment}`);
  return problems;
}

/** Text that only ELK's compiled code contains: its Java package names and GWT's runtime markers. */
const ELK_MARKERS = ["org.eclipse.elk.", "$clinit_", "gwtOnLoad", "$wnd.", "com.google.gwt."];
/** A string literal naming the elkjs package or a file in it. */
const ELK_SPECIFIER = /(["'`])elkjs(?:\/[^"'`\s]*)?\1/;
/** A package.json patchedDependencies, overrides or resolutions key for elkjs, with or without a version or a parent path. */
const ELK_KEY = /(?:^|\/)elkjs(?:@|$)/;
/** A run of this many characters shared with elk.bundled.js counts as copied ELK code. */
const COPIED_RUN = 100;

interface Manifest {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly patchedDependencies?: Readonly<Record<string, unknown>>;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly resolutions?: Readonly<Record<string, unknown>>;
}

/**
 * The release-blocking packaging checks on the skill folder built from
 * `project`, whose installed elkjs is at `elkPackage`. Returns every
 * problem found; empty means it passes.
 */
function checkSkill(dir: string, project: string, elkPackage: string): string[] {
  const problems: string[] = [];
  const readJson = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest;

  const manifest = readJson(join(project, "package.json"));
  const pinned = manifest.dependencies?.elkjs;
  if (pinned !== PUBLISHED_ELK.version) {
    problems.push(
      `package.json pins elkjs ${pinned}, but the build only knows the published ${ELK_FILE} of elkjs ${PUBLISHED_ELK.version}: ` +
        `to upgrade, update PUBLISHED_ELK in scripts/lib/skill.ts with the new version and its file's SHA-256`,
    );
  }
  for (const field of ["patchedDependencies", "overrides", "resolutions"] as const) {
    for (const key of Object.keys(manifest[field] ?? {})) {
      if (ELK_KEY.test(key)) problems.push(`package.json ${field} changes elkjs (${JSON.stringify(key)}): ship the published elkjs unchanged`);
    }
  }
  const { version } = readJson(join(elkPackage, "package.json"));
  if (version !== pinned) {
    problems.push(`node_modules has elkjs ${version}, but package.json pins ${pinned}: run bun install --frozen-lockfile`);
  }
  const elk = readFileSync(join(dir, ELK_FILE));
  const sha256 = createHash("sha256").update(elk).digest("hex");
  if (sha256 !== PUBLISHED_ELK.sha256) {
    problems.push(
      `${ELK_FILE} is not byte-for-byte lib/${ELK_FILE} from the published elkjs ${PUBLISHED_ELK.version}: ` +
        `its SHA-256 is ${sha256}, not ${PUBLISHED_ELK.sha256}`,
    );
  }

  const module = readFileSync(join(dir, MODULE_FILE), "utf8");
  for (const marker of ELK_MARKERS) {
    if (module.includes(marker)) problems.push(`${MODULE_FILE} contains elkjs code: ${JSON.stringify(marker)}`);
  }
  const specifier = ELK_SPECIFIER.exec(module);
  if (specifier) problems.push(`${MODULE_FILE} names the elkjs package: ${specifier[0]}`);
  const copied = longestSharedRun(module, elk.toString("utf8"));
  if (copied.length >= COPIED_RUN) {
    const start = JSON.stringify(module.slice(copied.at, copied.at + 40));
    problems.push(`${MODULE_FILE} contains ${copied.length} characters copied from ${ELK_FILE}, starting ${start}`);
  }
  problems.push(...checkFonts(module));
  return problems;
}

/** A font embedded in structa.mjs. SVGs carry these data URLs as they are. */
const EMBEDDED_FONT = /data:font\/ttf;base64,([A-Za-z0-9+/]+=*)/g;

/**
 * The release-blocking font checks: every font embedded in structa.mjs is
 * trimmed of its OpenType layout tables, and the fonts are exactly Structa's
 * faces, each named with its family, weight and style the way a renderer
 * finds it.
 */
function checkFonts(module: string): string[] {
  const problems: string[] = [];
  const describe = (family: string | undefined, weight: number, style: string) =>
    `${family === undefined ? "(no family name)" : JSON.stringify(family)} ${weight} ${style}`;

  const found: string[] = [];
  for (const [, base64] of module.matchAll(EMBEDDED_FONT)) {
    let font: TtfFont;
    try {
      font = readTtf(Buffer.from(base64!, "base64"));
    } catch (error) {
      problems.push(`${MODULE_FILE} embeds a font it can't read: ${(error as Error).message}`);
      continue;
    }
    const face = describe(font.family, font.weight, font.style);
    found.push(face);
    const layout = font.tables.filter((table) => LAYOUT_TABLES.includes(table));
    if (layout.length > 0) problems.push(`${MODULE_FILE} embeds ${face} with OpenType layout tables: ${layout.join(", ")}`);
  }

  const expected = FACES.map(({ family, weight, style }) => describe(family, weight, style));
  for (const face of expected) {
    const count = found.filter((f) => f === face).length;
    if (count === 0) problems.push(`${MODULE_FILE} embeds no ${face} font`);
    if (count > 1) problems.push(`${MODULE_FILE} embeds ${count} ${face} fonts`);
  }
  for (const face of found) {
    if (!expected.includes(face)) problems.push(`${MODULE_FILE} embeds a ${face} font, which is not one of its faces`);
  }
  return problems;
}

/**
 * The longest run of `text` that also appears in `source`, among runs of at
 * least 2 * WINDOW - 1 characters (shorter ones may be missed). It indexes
 * `source` in windows at every WINDOW-th position: any longer shared run
 * contains one of them whole.
 */
function longestSharedRun(text: string, source: string): { at: number; length: number } {
  // 2 * WINDOW - 1 <= COPIED_RUN, so every run of COPIED_RUN characters is found.
  const WINDOW = Math.floor((COPIED_RUN + 1) / 2);
  const windows = new Map<string, number[]>();
  for (let start = 0; start + WINDOW <= source.length; start += WINDOW) {
    const key = source.slice(start, start + WINDOW);
    const starts = windows.get(key);
    if (starts) starts.push(start);
    else windows.set(key, [start]);
  }
  let best = { at: 0, length: 0 };
  for (let i = 0; i + WINDOW <= text.length; i++) {
    for (const start of windows.get(text.slice(i, i + WINDOW)) ?? []) {
      let before = 0;
      while (i > before && start > before && text[i - before - 1] === source[start - before - 1]) before++;
      let after = WINDOW;
      while (i + after < text.length && text[i + after] === source[start + after]) after++;
      if (before + after > best.length) best = { at: i - before, length: before + after };
    }
  }
  return best;
}
