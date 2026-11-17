import {
  ARENA_MARKUP,
  CHATGPT_PATH,
  DESIGN_MARKUP,
  FLOW_ID_PLACEHOLDER,
  FLOW_MARKUP,
  GROK_PATH,
} from "@site/landing/brand-icon-artwork.ts";
import { raw } from "hono/html";
import {
  siClaude,
  siDeepseek,
  siDuckduckgo,
  siGithub,
  siGooglegemini,
  siNpm,
  siPerplexity,
} from "simple-icons";

interface BrandIconArtwork {
  /** The svg viewBox of the artwork. */
  viewBox: string;
  /** One path, or full inner svg markup when the mark has several shapes. */
  shape: { path: string } | { markup: string; hasIds?: boolean };
  /** "text-color" follows the surrounding text color. "own-colors" keeps the colors in the artwork. */
  color: "text-color" | "own-colors";
}

const SIMPLE_ICONS_VIEW_BOX = "0 0 24 24";

function simpleIconArtwork(path: string): BrandIconArtwork {
  return {
    viewBox: SIMPLE_ICONS_VIEW_BOX,
    shape: { path },
    color: "text-color",
  };
}

const BRAND_ICON_ARTWORK = {
  gemini: simpleIconArtwork(siGooglegemini.path),
  claude: simpleIconArtwork(siClaude.path),
  deepseek: simpleIconArtwork(siDeepseek.path),
  perplexity: simpleIconArtwork(siPerplexity.path),
  duck: simpleIconArtwork(siDuckduckgo.path),
  npm: simpleIconArtwork(siNpm.path),
  github: simpleIconArtwork(siGithub.path),
  chatgpt: { viewBox: "0 0 24 24", shape: { path: CHATGPT_PATH }, color: "text-color" },
  grok: { viewBox: "0 0 24 24", shape: { path: GROK_PATH }, color: "text-color" },
  arena: { viewBox: "80 80 560 560", shape: { markup: ARENA_MARKUP }, color: "text-color" },
  design: { viewBox: "0 0 16 16", shape: { markup: DESIGN_MARKUP }, color: "own-colors" },
  flow: {
    viewBox: "0 0 768 768",
    shape: { markup: FLOW_MARKUP, hasIds: true },
    color: "own-colors",
  },
} satisfies Record<string, BrandIconArtwork>;

export type BrandIconName = keyof typeof BRAND_ICON_ARTWORK;

function isBrandIconName(name: string): name is BrandIconName {
  return name in BRAND_ICON_ARTWORK;
}

/** Gradient and filter ids must be unique in the page, and one mark can appear many times. */
let renderedIconCount = 0;

interface BrandIconProps {
  name: string;
  size?: number;
}

export function BrandIcon({ name, size = 16 }: BrandIconProps) {
  if (!isBrandIconName(name)) return null;

  const artwork: BrandIconArtwork = BRAND_ICON_ARTWORK[name];
  const colorProps =
    artwork.color === "text-color" ? { fill: "currentColor", "fill-rule": "evenodd" } : {};
  const svgProps = {
    class: "brand-icon",
    width: size,
    height: size,
    viewBox: artwork.viewBox,
    ...colorProps,
  };

  if ("path" in artwork.shape) {
    return (
      <svg {...svgProps} aria-hidden="true">
        <path d={artwork.shape.path} />
      </svg>
    );
  }

  renderedIconCount += 1;
  const uniqueMarkup = artwork.shape.hasIds
    ? artwork.shape.markup.replaceAll(FLOW_ID_PLACEHOLDER, `${name}-${renderedIconCount}`)
    : artwork.shape.markup;

  return (
    <svg {...svgProps} aria-hidden="true">
      {raw(uniqueMarkup)}
    </svg>
  );
}
