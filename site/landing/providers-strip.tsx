import { readSitePath } from "@site/site-address.ts";
import type { ProviderPageData } from "@site/site-data.ts";

interface ProvidersStripProps {
  providers: ProviderPageData[];
}

export const ProvidersStrip = ({ providers }: ProvidersStripProps) => (
  <div class="strip reveal">
    <span class="label">drives the chat apps you already pay for</span>
    <div class="names">
      {providers.map((provider) => (
        <a href={readSitePath(`providers/${provider.id}/`)} key={provider.id}>
          {provider.siteName}
        </a>
      ))}
    </div>
  </div>
);
