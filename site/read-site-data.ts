import fs from "node:fs/promises";
import path from "node:path";
import { HeroRunSchema } from "@site/hero-run.ts";
import type { ProviderPageData, SiteData } from "@site/site-data.ts";
import { readToolCatalog } from "@site/tool-catalog.ts";
import { PERMISSION_MODES } from "@/permissions.ts";
import { PROVIDER_IDS, PROVIDER_SETTINGS } from "@/provider-settings.ts";

const SITE_NAME_OVERRIDES: Record<string, string> = { flow: "Google Flow" };

const TOOL_PREFIXES: Record<string, string> = {
  chatgpt: "chatgpt_",
  flow: "flow_",
  design: "design_",
};

const createAbilities = (id: string): string[] => {
  const settings = PROVIDER_SETTINGS[id as keyof typeof PROVIDER_SETTINGS];
  const { selectors } = settings;
  const abilities = [`Send a prompt in your logged-in Chrome and read the reply back as text.`];

  if (selectors.newChat != null) abilities.push("Start a new chat for each task.");
  if (selectors.sidebarItem != null) abilities.push("Find and reopen earlier conversations.");
  if (selectors.attach != null) abilities.push("Attach files to a prompt.");
  if (selectors.modelTrigger != null)
    abilities.push(`Pick a model. The default is ${settings.defaultModel}.`);
  if (selectors.signedOut != null) abilities.push("Tell you when the chat app is signed out.");
  if (settings.supportsMcpConnector)
    abilities.push("Read your repo through the bridge repo tools over an MCP connector.");

  return abilities;
};

const createProviderPageData = (id: (typeof PROVIDER_IDS)[number]): ProviderPageData => {
  const settings = PROVIDER_SETTINGS[id];
  const displayName = settings.displayName;

  return {
    id,
    displayName,
    siteName: SITE_NAME_OVERRIDES[id] ?? displayName,
    host: `${settings.origin}${settings.pathPrefix ?? ""}`,
    defaultUrl: settings.defaultUrl,
    defaultModel: settings.defaultModel,
    supportsMcpConnector: settings.supportsMcpConnector,
    abilities: createAbilities(id),
    toolPrefix: TOOL_PREFIXES[id] ?? null,
  };
};

const readVersion = async (repoFolder: string): Promise<string> => {
  const packageText = await fs.readFile(path.join(repoFolder, "package.json"), "utf8");
  const packageJson: { version: string } = JSON.parse(packageText);

  return packageJson.version;
};

const readHeroRun = async (siteFolder: string) => {
  const heroRunText = await fs.readFile(path.join(siteFolder, "hero-run.json"), "utf8");

  return HeroRunSchema.parse(JSON.parse(heroRunText));
};

export const readSiteData = async (repoFolder: string, siteFolder: string): Promise<SiteData> => ({
  version: await readVersion(repoFolder),
  providers: PROVIDER_IDS.map(createProviderPageData),
  tools: await readToolCatalog(),
  permissionModes: [...PERMISSION_MODES],
  heroRun: await readHeroRun(siteFolder),
});
