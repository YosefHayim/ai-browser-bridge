import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { InstallBox } from "@site/landing/install-box.tsx";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import { ProviderDetails } from "@site/providers/provider-details.tsx";
import type { ProviderPageData, SiteData } from "@site/site-data.ts";

interface ProviderPageProps {
  provider: ProviderPageData;
  siteData: SiteData;
}

const createAskExample = (providerId: string): string =>
  `bridge ask --provider ${providerId} "Review this migration"`;

export const ProviderPage = ({ provider, siteData }: ProviderPageProps) => {
  const providerTools = siteData.tools.filter(
    (tool) => provider.toolPrefix != null && tool.name.startsWith(provider.toolPrefix),
  );

  return (
    <DocsPageLayout
      navGroups={createDocsNavGroups(siteData, `providers/${provider.id}/`)}
      heading={`${provider.siteName} through the bridge`}
    >
      <p>
        The bridge drives {provider.siteName} in your own logged-in Chrome. Your agent sends a
        prompt and gets the reply text back, not the page.
      </p>
      <dl class="docs-facts">
        <div>
          <dt class="label">host</dt>
          <dd>{provider.host}</dd>
        </div>
        <div>
          <dt class="label">provider id</dt>
          <dd>{provider.id}</dd>
        </div>
        <div>
          <dt class="label">default model</dt>
          <dd>{provider.defaultModel}</dd>
        </div>
        <div>
          <dt class="label">start page</dt>
          <dd>{provider.defaultUrl}</dd>
        </div>
      </dl>
      <h2 class="h3">What the bridge can do here</h2>
      <ul>
        {provider.abilities.map((ability) => (
          <li key={ability}>{ability}</li>
        ))}
      </ul>
      <h2 class="h3">Example</h2>
      <div class="panel">
        <div class="panel-head">
          <span class="label">terminal</span>
        </div>
        <pre class="code">
          <span class="p">$</span> {createAskExample(provider.id)}
        </pre>
      </div>
      {providerTools.length === 0 ? null : (
        <>
          <h2 class="h3">MCP tools for {provider.siteName}</h2>
          <ul>
            {providerTools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>: {tool.description}
              </li>
            ))}
          </ul>
        </>
      )}
      <ProviderDetails providerId={provider.id} />
      <h2 class="h3">Install</h2>
      <InstallBox />
    </DocsPageLayout>
  );
};
