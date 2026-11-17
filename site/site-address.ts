const SITE_ORIGIN = "https://yosefhayim.github.io";

/** The site lives in a project folder on GitHub Pages, so every link starts with this. */
const SITE_BASE_PATH = "/ai-browser-bridge/";

export const SITE_URL = `${SITE_ORIGIN}${SITE_BASE_PATH}`;

export const GITHUB_URL = "https://github.com/YosefHayim/ai-browser-bridge";

export const NPM_URL = "https://www.npmjs.com/package/ai-browser-bridge";

export function readSitePath(pathInsideSite: string): string {
  return `${SITE_BASE_PATH}${pathInsideSite}`;
}
