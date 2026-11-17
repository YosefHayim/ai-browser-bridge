import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bridge: "src/main.ts" },
  format: ["esm"],
  target: "node24",
  clean: true,
});
