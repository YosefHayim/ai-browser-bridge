import { LandingView } from "@site/landing/landing-view.tsx";
import { createLlmsText } from "@site/llms-text.ts";
import { PageShell } from "@site/page/page-shell.tsx";
import { ProviderPage } from "@site/providers/provider-page.tsx";
import type { SiteAssets } from "@site/site-assets.ts";
import type { SiteData } from "@site/site-data.ts";
import { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { ssgParams } from "hono/ssg";

declare module "hono" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: Hono only lets you add a renderer type by merging into its ContextRenderer interface
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      pageMeta: { title: string; description: string; pathInsideSite: string },
    ): Response | Promise<Response>;
  }
}

export { readSiteData } from "@site/read-site-data.ts";

const LANDING_DESCRIPTION =
  "Drive ChatGPT, Claude, Gemini, DeepSeek, Grok and more in your own logged-in Chrome from one command or from your agent. You get the reply text, not the page.";

export const createSiteApp = (siteData: SiteData, siteAssets: SiteAssets) => {
  const siteApp = new Hono();
  const findProvider = (providerId: string) =>
    siteData.providers.find((provider) => provider.id === providerId);

  siteApp.use(
    jsxRenderer(({ children, title, description, pathInsideSite }) => (
      <PageShell
        siteAssets={siteAssets}
        version={siteData.version}
        title={title}
        description={description}
        pathInsideSite={pathInsideSite}
      >
        {children}
      </PageShell>
    )),
  );

  siteApp.get("/", (context) =>
    context.render(<LandingView siteData={siteData} />, {
      title: "ai-browser-bridge: every chat app from one command",
      description: LANDING_DESCRIPTION,
      pathInsideSite: "",
    }),
  );

  siteApp.get(
    "/providers/:id/",
    ssgParams(() => siteData.providers.map((provider) => ({ id: provider.id }))),
    (context) => {
      const provider = findProvider(context.req.param("id"));
      if (provider == null) return context.notFound();

      return context.render(<ProviderPage provider={provider} siteData={siteData} />, {
        title: `${provider.siteName} through ai-browser-bridge`,
        description: `Ask ${provider.siteName} from your terminal or agent with ai-browser-bridge. Host, abilities and an example command.`,
        pathInsideSite: `providers/${provider.id}/`,
      });
    },
  );

  siteApp.get("/llms.txt", (context) => context.text(createLlmsText(siteData)));

  return siteApp;
};
