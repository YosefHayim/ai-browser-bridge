import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DOCS_PAGES } from "@site/docs/docs-page-list.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import { readSitePath } from "@site/site-address.ts";
import type { SiteData } from "@site/site-data.ts";

interface DocsIndexPageProps {
  siteData: SiteData;
}

export function DocsIndexPage({ siteData }: DocsIndexPageProps) {
  return (
    <DocsPageLayout navGroups={createDocsNavGroups(siteData, "docs/")} heading="Docs">
      <p>
        How to run ai-browser-bridge, from your terminal or from an agent. Each chat app also has
        its own page with its commands and limits.
      </p>
      <h2 class="h3">Guides</h2>
      <ul>
        {DOCS_PAGES.map((page) => (
          <li key={page.pathInsideSite}>
            <a href={readSitePath(page.pathInsideSite)}>{page.label}</a>: {page.summary}
          </li>
        ))}
      </ul>
      <h2 class="h3">Providers</h2>
      <ul>
        {siteData.providers.map((provider) => (
          <li key={provider.id}>
            <a href={readSitePath(`providers/${provider.id}/`)}>{provider.siteName}</a>:{" "}
            {provider.host}
          </li>
        ))}
      </ul>
    </DocsPageLayout>
  );
}
