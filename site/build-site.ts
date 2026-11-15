import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { toSSG } from "hono/ssg";
import type { SiteAssets } from "./site-assets.ts";

const siteFolder = path.dirname(fileURLToPath(import.meta.url));
const repoFolder = path.dirname(siteFolder);
const distFolder = path.join(siteFolder, "dist");
const serverBundleFolder = path.join(repoFolder, "node_modules", ".cache", "site-build");

const createShortHash = (hashedText: string): string => {
  const shortHashLength = 8;

  return createHash("sha256").update(hashedText).digest("hex").slice(0, shortHashLength);
};

const bundleBrowserScript = async (): Promise<string> => {
  const browserBuild = await build({
    entryPoints: [path.join(siteFolder, "page-script.ts")],
    outdir: distFolder,
    entryNames: "[name]-[hash]",
    metafile: true,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    alias: { "@site": siteFolder },
    logLevel: "info",
  });

  const [entryOutputPath] = Object.keys(browserBuild.metafile.outputs);
  const isEntryMissing = entryOutputPath == null;
  if (isEntryMissing) throw new Error("esbuild wrote no page script");

  return path.basename(entryOutputPath);
};

const writeStylesFile = async (): Promise<string> => {
  const stylesText = await fs.readFile(path.join(siteFolder, "styles.css"), "utf8");
  const stylesFile = `styles-${createShortHash(stylesText)}.css`;
  await fs.writeFile(path.join(distFolder, stylesFile), stylesText);

  return stylesFile;
};

const loadSiteModule = async () => {
  await fs.mkdir(serverBundleFolder, { recursive: true });
  const serverBundleFile = path.join(serverBundleFolder, "site-app.mjs");

  await build({
    entryPoints: [path.join(siteFolder, "site-app.tsx")],
    outfile: serverBundleFile,
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node24",
    jsx: "automatic",
    jsxImportSource: "hono/jsx",
    tsconfig: path.join(siteFolder, "tsconfig.json"),
    logLevel: "info",
  });

  return import(pathToFileURL(serverBundleFile).href);
};

const bundleSite = async () => {
  await fs.rm(distFolder, { recursive: true, force: true });
  await fs.mkdir(distFolder, { recursive: true });

  const scriptFile = await bundleBrowserScript();
  const stylesFile = await writeStylesFile();
  const siteAssets: SiteAssets = { scriptFile, stylesFile };

  const { createSiteApp, readSiteData } = await loadSiteModule();
  const siteData = await readSiteData(repoFolder, siteFolder);
  const siteApp = createSiteApp(siteData, siteAssets);

  const staticSiteReply = await toSSG(siteApp, fs, { dir: distFolder });
  const hasStaticSiteFailed = !staticSiteReply.success;
  if (hasStaticSiteFailed) throw new Error("toSSG failed", { cause: staticSiteReply.error });

  console.log(
    `site built: ${siteData.providers.length} providers, ${siteData.tools.length} tools, ${siteData.permissionModes.length} permission modes`,
  );
};

await bundleSite();
