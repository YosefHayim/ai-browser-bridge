import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The pre-push hook runs the test suite with Git's hook variables exported. Tests that run
// `git init` in a temp directory would otherwise re-initialize the pushing repository itself
// (flipping core.bare), and repo-root probes would resolve against it.
for (const gitHookVariable of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
  delete process.env[gitHookVariable];
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
  },
});
