/**
 * The entry point of the shipped structa.mjs: the library API, plus the
 * command line when the file is run with node.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runCli } from "./cli";

export * from "./index";

if (isRunDirectly()) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

/** True when node was started on this file, false when it was imported. */
function isRunDirectly(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return pathToFileURL(realpathSync(script)).href === import.meta.url;
  } catch {
    return false;
  }
}
