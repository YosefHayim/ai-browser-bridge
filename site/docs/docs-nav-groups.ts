import { DOCS_PAGES } from "@site/docs/docs-page-list.ts";
import type { DocsNavGroup } from "@site/page/docs-page-layout.tsx";
import { readSitePath } from "@site/site-address.ts";
import type { SiteData } from "@site/site-data.ts";

export function createDocsNavGroups(
  siteData: SiteData,
  currentPathInsideSite: string,
): DocsNavGroup[] {
  return [
    {
      title: "docs",
      links: [
        { label: "Overview", pathInsideSite: "docs/" },
        ...DOCS_PAGES.map((page) => ({
          label: page.label,
          pathInsideSite: page.pathInsideSite,
        })),
      ].map((page) => ({
        label: page.label,
        href: readSitePath(page.pathInsideSite),
        isCurrent: page.pathInsideSite === currentPathInsideSite,
      })),
    },
    {
      title: "providers",
      links: siteData.providers.map((provider) => ({
        label: provider.siteName,
        href: readSitePath(`providers/${provider.id}/`),
        isCurrent: `providers/${provider.id}/` === currentPathInsideSite,
      })),
    },
  ];
}
