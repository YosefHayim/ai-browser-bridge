import {
  siClaude,
  siDeepseek,
  siDuckduckgo,
  siGithub,
  siGooglegemini,
  siNpm,
  siPerplexity,
} from "simple-icons";

/** Path data for marks that simple-icons does not ship. Each fits a 24x24 box and uses one fill. */
const CUSTOM_ICON_PATHS = {
  chatgpt:
    "M12 2.2 20.5 7.1v9.8L12 21.8 3.5 16.9V7.1zm0 3.1L6.2 8.65v6.7L12 18.7l5.8-3.35v-6.7zm0 2.9a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z",
  grok: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 0 1 7.2 4.8l-9.9 8.6-1.6-1.8 5.9-5.1-6.3.2A7.8 7.8 0 0 1 12 4.2zM5.4 14.4l-.1 0A7.8 7.8 0 0 0 12 19.8a7.8 7.8 0 0 0 6.7-3.8l-2.9-1.2L12 18.1z",
  arena:
    "M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm7 4.2L6.8 17.8h2.2l1-2.4h4l1 2.4h2.2zm0 4.1 1.3 3H10.7z",
  flow: "M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM7 6.5v2.2h9.5V6.5zm0 4.4v2.2h6.4v-2.2zm0 4.4v2.2h3.2v-2.2z",
  design:
    "M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm7 4.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6zm0 2.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z",
} as const;

const SIMPLE_ICON_PATHS = {
  gemini: siGooglegemini.path,
  claude: siClaude.path,
  deepseek: siDeepseek.path,
  perplexity: siPerplexity.path,
  duck: siDuckduckgo.path,
  npm: siNpm.path,
  github: siGithub.path,
} as const;

const ICON_PATHS = { ...SIMPLE_ICON_PATHS, ...CUSTOM_ICON_PATHS };

export type BrandIconName = keyof typeof ICON_PATHS;

const isBrandIconName = (name: string): name is BrandIconName => name in ICON_PATHS;

interface BrandIconProps {
  name: string;
  size?: number;
}

export const BrandIcon = ({ name, size = 16 }: BrandIconProps) => {
  if (!isBrandIconName(name)) return null;

  return (
    <svg
      class="brand-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
};
