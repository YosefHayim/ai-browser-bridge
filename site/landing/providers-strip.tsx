import { BrandIcon } from "@site/landing/brand-icons.tsx";
import { readSitePath } from "@site/site-address.ts";
import type { ProviderPageData } from "@site/site-data.ts";

interface ProvidersStripProps {
  providers: ProviderPageData[];
}

interface ProviderNamesProps {
  providers: ProviderPageData[];
  isCopy: boolean;
}

function ProviderNames({ providers, isCopy }: ProviderNamesProps) {
  return (
    <div class="names" aria-hidden={isCopy ? "true" : undefined}>
      {providers.map((provider) => (
        <a
          href={readSitePath(`providers/${provider.id}/`)}
          tabindex={isCopy ? -1 : undefined}
          key={provider.id}
        >
          <BrandIcon name={provider.id} size={18} />
          {provider.siteName}
        </a>
      ))}
    </div>
  );
}

export function ProvidersStrip({ providers }: ProvidersStripProps) {
  return (
    <div class="strip reveal">
      <span class="label">drives the chat apps you already pay for</span>
      <div class="marquee">
        <div class="marquee-track">
          <ProviderNames providers={providers} isCopy={false} />
          <ProviderNames providers={providers} isCopy={true} />
        </div>
      </div>
    </div>
  );
}
