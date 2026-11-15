import { BrandMark } from "@site/page/brand-mark.tsx";
import { ThemeToggle } from "@site/page/theme-toggle.tsx";
import { GITHUB_URL, readSitePath } from "@site/site-address.ts";

const NAV_LINKS = [
  { label: "How it works", href: readSitePath("#how") },
  { label: "Context", href: readSitePath("#context") },
  { label: "MCP tools", href: readSitePath("#mcp") },
  { label: "FAQ", href: readSitePath("#faq") },
  { label: "Docs", href: readSitePath("docs/") },
];

export const TopBar = () => (
  <header class="nav" data-nav>
    <div class="wrap nav-in">
      <BrandMark />
      <nav class="nav-links" aria-label="Main">
        {NAV_LINKS.map((link) => (
          <a href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </nav>
      <div class="nav-end">
        <a class="gh" href={GITHUB_URL}>
          GitHub
        </a>
        <a class="btn btn-accent" href={readSitePath("#install")}>
          Install
        </a>
        <ThemeToggle />
        <button class="menu" type="button" data-menu-toggle aria-label="Open menu">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M2 5h14M2 9h14M2 13h14"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </header>
);
