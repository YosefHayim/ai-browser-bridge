import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";
import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import type { SiteData } from "@site/site-data.ts";

interface StatePageProps {
  siteData: SiteData;
}

const STATE_TREE_CODE = `<repo>/.bridge/
├── config.json       # per-repo settings (includes \`provider\`: chatgpt | gemini)
├── sessions/<id>/    # metadata.json + append-only events.jsonl transcript
├── logs/<date>.jsonl # prompts, replies, and MCP tool-call summaries
├── checkpoints/      # before/after snapshots around each apply_patch
├── exports/          # /export output
├── downloads/<conv>/ # attachment downloads (default when no --out given)
└── screenshots/      # /screenshot and /ui-qa captures`;

export const StatePage = ({ siteData }: StatePageProps) => (
  <DocsPageLayout
    navGroups={createDocsNavGroups(siteData, "docs/state/")}
    heading="Where state lives"
  >
    <p>
      Persistent bridge state is written under the canonical Git working-tree root's{" "}
      <code>&lt;repo&gt;/.bridge/</code>. The bridge resolves both <code>--repo</code> and the
      launch directory to that root, so nested launches cannot create competing state or download
      folders. An explicit non-Git directory remains its own root.
    </p>
    <CodeBlock code={STATE_TREE_CODE} />
    <p>
      Plain <code>bridge ask</code> and <code>bridge chrome start</code> do not create repo-local
      state; they only reuse the shared Chrome profile. The bridge creates{" "}
      <code>&lt;repo&gt;/.bridge/</code> for persistent TUI sessions, tool-enabled asks (
      <code>bridge ask --tools</code>), checkpoints, exports, screenshots, or default attachment
      downloads.
    </p>
    <p>
      The bridge does not create or manage <code>.bridge/.gitignore</code>; ignore policy belongs to
      the target repository. Chrome cookies for bridge-driven sessions stay in the shared bridge
      profile under <code>~/.ai-browser-bridge/chrome-profile</code>, not under{" "}
      <code>.bridge/</code>.
    </p>
    <p>
      User-authored config meant to apply across <strong>all</strong> repos lives in your home
      directory: custom commands in <code>~/.ai-browser-bridge/commands/*.md</code> and user-level
      hooks in <code>~/.ai-browser-bridge/hooks.json</code>.
    </p>
    <DocsSection title="Migrating from chatgpt-local-bridge">
      <p>
        The package was renamed to <strong>ai-browser-bridge</strong>. Global user config moved from{" "}
        <code>~/.chatgpt-local-bridge/</code> to <code>~/.ai-browser-bridge/</code>: copy your{" "}
        <code>commands/</code> folder and <code>hooks.json</code> if you had them. Persistent
        repo-local state stays at <code>&lt;repo&gt;/.bridge/</code> (unchanged). Re-run{" "}
        <code>/connector</code> or <code>bridge ask --tools</code> once so ChatGPT picks up the
        renamed MCP connector app.
      </p>
    </DocsSection>
  </DocsPageLayout>
);
