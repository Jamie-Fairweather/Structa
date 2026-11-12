import { defineConfig } from "vitest/config";

// The tests must run under Node, the runtime Structa ships for.
if (process.versions.bun) {
  throw new Error("Run the tests under Node with `bun run test`, not with `bun --bun`.");
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
