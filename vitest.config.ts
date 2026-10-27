import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // `server-only` is resolved by the Next build and by nothing
      // else, so a module that imports it cannot be loaded here at
      // all: the suite dies at collection with "Cannot find package
      // 'server-only'". src/lib/db carries that guard and every
      // repository on the test graph reaches it.
      //
      // The guard is worth keeping, because it is what stops a server
      // module being bundled into the browser. It just needs to
      // resolve to nothing under test.
      "server-only": fileURLToPath(
        new URL("./tests/shims/server-only.ts", import.meta.url),
      ),
    },
  },
});
