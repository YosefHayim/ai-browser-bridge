import { ArenaDetails } from "@site/providers/arena-details.tsx";
import { DesignDetails } from "@site/providers/design-details.tsx";
import { FlowDetails } from "@site/providers/flow-details.tsx";
import { GeminiDetails } from "@site/providers/gemini-details.tsx";
import type { JSX } from "hono/jsx/jsx-runtime";

const PROVIDER_DETAILS: Record<string, () => JSX.Element> = {
  gemini: GeminiDetails,
  arena: ArenaDetails,
  flow: FlowDetails,
  design: DesignDetails,
};

interface ProviderDetailsProps {
  providerId: string;
}

export function ProviderDetails({ providerId }: ProviderDetailsProps) {
  const Details = PROVIDER_DETAILS[providerId];
  if (Details == null) return null;

  return <Details />;
}
