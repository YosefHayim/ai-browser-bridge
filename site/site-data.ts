import type { HeroRun } from "@site/hero-run.ts";
import type { CatalogTool } from "@site/tool-catalog.ts";

export interface ProviderPageData {
  id: string;
  displayName: string;
  siteName: string;
  host: string;
  defaultUrl: string;
  defaultModel: string;
  supportsMcpConnector: boolean;
  abilities: string[];
  toolPrefix: string | null;
}

export interface SiteData {
  version: string;
  providers: ProviderPageData[];
  tools: CatalogTool[];
  permissionModes: string[];
  heroRun: HeroRun;
}
