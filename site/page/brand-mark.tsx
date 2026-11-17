import { readSitePath } from "@site/site-address.ts";

export function BrandMark() {
  return (
    <a class="brand" href={readSitePath("")} aria-label="ai-browser-bridge home">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="1" y="6" width="7" height="10" rx="2" stroke-width="1.5" />
        <rect x="14" y="6" width="7" height="10" rx="2" stroke-width="1.5" />
        <path d="M8 11h6" stroke-width="1.5" />
      </svg>
      <span>ai-browser-bridge</span>
    </a>
  );
}
