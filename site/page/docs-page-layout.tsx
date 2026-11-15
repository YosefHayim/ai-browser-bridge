import type { Child } from "hono/jsx";

interface DocsNavLink {
  label: string;
  href: string;
  isCurrent: boolean;
}

export interface DocsNavGroup {
  title: string;
  links: DocsNavLink[];
}

interface DocsPageLayoutProps {
  navGroups: DocsNavGroup[];
  heading: string;
  children: Child;
}

export const DocsPageLayout = ({ navGroups, heading, children }: DocsPageLayoutProps) => (
  <div class="wrap docs">
    <nav class="docs-nav" aria-label="Pages">
      {navGroups.map((group) => (
        <div class="docs-nav-group" key={group.title}>
          <span class="label">{group.title}</span>
          {group.links.map((link) => (
            <a href={link.href} aria-current={link.isCurrent ? "page" : undefined} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
    <article class="docs-body">
      <h1 class="h2">{heading}</h1>
      {children}
    </article>
  </div>
);
