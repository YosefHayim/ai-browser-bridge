import { SiteFooter } from "@site/page/site-footer.tsx";
import { TopBar } from "@site/page/top-bar.tsx";
import { readSitePath, SITE_URL } from "@site/site-address.ts";
import type { SiteAssets } from "@site/site-assets.ts";
import type { Child } from "hono/jsx";

interface PageShellProps {
  siteAssets: SiteAssets;
  version: string;
  title: string;
  description: string;
  pathInsideSite: string;
  children: Child;
}

const SAVED_THEME_SCRIPT =
  'try { const savedTheme = localStorage.getItem("theme"); const isThemeSaved = savedTheme == "light" || savedTheme == "dark"; if (isThemeSaved) document.documentElement.dataset.theme = savedTheme; } catch (error) { console.error({ error }); }';

const FAVICON_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22' fill='none'%3E%3Crect x='1' y='6' width='7' height='10' rx='2' stroke='%23888' stroke-width='1.5'/%3E%3Crect x='14' y='6' width='7' height='10' rx='2' stroke='%23888' stroke-width='1.5'/%3E%3Cpath d='M8 11h6' stroke='%23B4E22E' stroke-width='1.5'/%3E%3C/svg%3E";

export function PageShell({
  siteAssets,
  version,
  title,
  description,
  pathInsideSite,
  children,
}: PageShellProps) {
  return (
    <html lang="en" data-visitor-os="macos">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the script is a fixed constant from this repo, no user input */}
        <script dangerouslySetInnerHTML={{ __html: SAVED_THEME_SCRIPT }} />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={`${SITE_URL}${pathInsideSite}`} />
        <link rel="icon" href={FAVICON_URL} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
        />
        <link rel="stylesheet" href={readSitePath(siteAssets.stylesFile)} />
      </head>
      <body>
        <div class="page">
          <TopBar />
          <main>{children}</main>
          <SiteFooter version={version} />
        </div>
        <script type="module" src={readSitePath(siteAssets.scriptFile)} />
      </body>
    </html>
  );
}
