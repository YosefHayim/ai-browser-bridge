import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["bin/bridge.ts"],
  format: ["esm"],
  target: "node20",
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  banner: {
    js: "",
  },
});
