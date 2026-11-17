import { ContextSection } from "@site/landing/context-section.tsx";
import { FactsStrip } from "@site/landing/facts-strip.tsx";
import { FaqList } from "@site/landing/faq-list.tsx";
import { FeatureDemosSection } from "@site/landing/feature-demos-section.tsx";
import { HeroSection } from "@site/landing/hero-section.tsx";
import { HowItWorks } from "@site/landing/how-it-works.tsx";
import { InstallCallToAction } from "@site/landing/install-call-to-action.tsx";
import { McpSection } from "@site/landing/mcp-section.tsx";
import { ProvidersStrip } from "@site/landing/providers-strip.tsx";
import type { SiteData } from "@site/site-data.ts";

interface LandingViewProps {
  siteData: SiteData;
}

const CONTEXT_PROVIDER_ID = "claude";

export function LandingView({ siteData }: LandingViewProps) {
  const { heroRun } = siteData;
  const contextProvider =
    heroRun.providers.find((provider) => provider.id === CONTEXT_PROVIDER_ID) ??
    heroRun.providers[0];
  const isContextProviderMissing = contextProvider == null;
  if (isContextProviderMissing) throw new Error("hero-run.json has no providers");

  return (
    <>
      <HeroSection siteData={siteData} />
      <section class="wrap" aria-label="Providers and facts">
        <ProvidersStrip providers={siteData.providers} />
        <FactsStrip siteData={siteData} />
      </section>
      <HowItWorks heroRun={heroRun} />
      <FeatureDemosSection />
      <ContextSection provider={contextProvider} />
      <McpSection siteData={siteData} />
      <section class="sec wrap" id="faq">
        <FaqList />
        <InstallCallToAction />
      </section>
    </>
  );
}
