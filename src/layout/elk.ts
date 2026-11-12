/**
 * The only module that loads elkjs code. Everything else imports elkjs types only.
 *
 * In source and test runs this resolves elkjs from the repository's
 * node_modules, relative to this file.
 */
import { createRequire } from "node:module";
import type { ELK, ELKConstructorArguments } from "elkjs/lib/elk-api";

type ElkConstructor = new (args?: ELKConstructorArguments) => ELK;

const ELK_MODULE = "elkjs/lib/elk.bundled.js";

let Elk: ElkConstructor | undefined;

/** A fresh in-process ELK instance (no worker). */
export function createElk(): ELK {
  Elk ??= createRequire(import.meta.url)(ELK_MODULE) as ElkConstructor;
  return new Elk();
}
