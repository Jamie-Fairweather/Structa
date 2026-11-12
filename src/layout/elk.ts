/**
 * The only module that loads elkjs code. Everything else imports elkjs types only.
 *
 * In source and test runs this resolves elkjs from the repository's
 * node_modules, relative to this file. The build injects STRUCTA_ELK_FILE,
 * the sibling file's path, and drops the `source:` statement, so the built
 * structa.mjs only ever loads the elk.bundled.js next to it.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { ELK, ELKConstructorArguments } from "elkjs/lib/elk-api";

type ElkConstructor = new (args?: ELKConstructorArguments) => ELK;

/** Set by the build (esbuild `define`) to "./elk.bundled.js"; undeclared in source runs. */
declare const STRUCTA_ELK_FILE: string | undefined;

let Elk: ElkConstructor | undefined;

/** A fresh in-process ELK instance (no worker). */
export function createElk(): ELK {
  Elk ??= loadElk();
  return new Elk();
}

function loadElk(): ElkConstructor {
  const require = createRequire(import.meta.url);
  source: if (typeof STRUCTA_ELK_FILE === "undefined") return require("elkjs/lib/elk.bundled.js") as ElkConstructor;
  const file = fileURLToPath(new URL(STRUCTA_ELK_FILE!, import.meta.url));
  if (!existsSync(file)) {
    throw new Error(`can't find the layout engine: expected ${file} next to structa.mjs`);
  }
  return require(file) as ElkConstructor;
}
