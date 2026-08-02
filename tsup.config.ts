import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bridge: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  banner: {
    js: "",
  },
});
