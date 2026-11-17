import { AgentsPage } from "@site/docs/agents-page.tsx";
import { DocsIndexPage } from "@site/docs/docs-index-page.tsx";
import { LimitationsPage } from "@site/docs/limitations-page.tsx";
import { PermissionsPage } from "@site/docs/permissions-page.tsx";
import { StatePage } from "@site/docs/state-page.tsx";
import { UsagePage } from "@site/docs/usage-page.tsx";
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
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: Hono only lets you add a renderer type by merging into its ContextRenderer interface
    (
      content: string | Promise<string>,
      pageMeta: { title: string; description: string; pathInsideSite: string },
    ): Response | Promise<Response>;
  }
}

export { readSiteData } from "@site/read-site-data.ts";

const LANDING_DESCRIPTION =
  "Drive ChatGPT, Claude, Gemini, DeepSeek, Grok and more in your own logged-in Chrome from one command or from your agent. You get the reply text, not the page.";

export function createSiteApp(siteData: SiteData, siteAssets: SiteAssets) {
  const siteApp = new Hono();
  function findProvider(providerId: string) {
    return siteData.providers.find((provider) => provider.id === providerId);
  }

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

  const docsPageRoutes = [
    {
      route: "/docs/",
      page: <DocsIndexPage siteData={siteData} />,
      title: "ai-browser-bridge docs",
      description: "Guides for running ai-browser-bridge from the terminal or from an agent.",
      pathInsideSite: "docs/",
    },
    {
      route: "/docs/usage/",
      page: <UsagePage siteData={siteData} />,
      title: "Usage: install, start Chrome and ask",
      description:
        "Install ai-browser-bridge, start the shared Chrome, ask from the terminal, and use the interactive commands.",
      pathInsideSite: "docs/usage/",
    },
    {
      route: "/docs/agents/",
      page: <AgentsPage siteData={siteData} />,
      title: "Agents and fan-out",
      description:
        "Script bridge ask, fan out one question across providers, and serve MCP tools with bridge serve.",
      pathInsideSite: "docs/agents/",
    },
    {
      route: "/docs/state/",
      page: <StatePage siteData={siteData} />,
      title: "Where state lives",
      description: "The .bridge folder, what creates it, and the shared Chrome profile.",
      pathInsideSite: "docs/state/",
    },
    {
      route: "/docs/permissions/",
      page: <PermissionsPage siteData={siteData} />,
      title: "Permissions and checkpoints",
      description: "Permission modes for the repo tools, and how to restore files after a patch.",
      pathInsideSite: "docs/permissions/",
    },
    {
      route: "/docs/limitations/",
      page: <LimitationsPage siteData={siteData} />,
      title: "Limitations",
      description: "What ai-browser-bridge does not do today.",
      pathInsideSite: "docs/limitations/",
    },
  ];
  for (const { route, page, ...pageMeta } of docsPageRoutes) {
    siteApp.get(route, (context) => context.render(page, pageMeta));
  }

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
}
