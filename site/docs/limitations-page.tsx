import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import type { SiteData } from "@site/site-data.ts";

interface LimitationsPageProps {
  siteData: SiteData;
}

export const LimitationsPage = ({ siteData }: LimitationsPageProps) => (
  <DocsPageLayout
    navGroups={createDocsNavGroups(siteData, "docs/limitations/")}
    heading="Limitations"
  >
    <ul>
      <li>
        On Linux, copying a transcript needs <code>wl-copy</code>, <code>xclip</code> or{" "}
        <code>xsel</code>. Chrome in an unusual place needs{" "}
        <code>AI_BROWSER_BRIDGE_CHROME_PATH</code>.
      </li>
      <li>
        ChatGPT and Gemini browser selectors can break when the web UI changes; fixes are localized
        to the browser layer.
      </li>
      <li>
        Context usage is an <strong>estimate</strong>: the browser does not expose exact server-side
        token counts.
      </li>
      <li>
        The Cloudflare Tunnel requires <code>cloudflared</code> installed.
      </li>
      <li>Local-first by design; not a hosted multi-user service.</li>
      <li>
        Hook command execution is parsed and reported but not yet executed (an allowlisted
        confirmation flow is pending).
      </li>
    </ul>
  </DocsPageLayout>
);
