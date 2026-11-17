import { CodeBlock } from "@site/docs/docs-blocks.tsx";
import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import type { SiteData } from "@site/site-data.ts";

interface PermissionsPageProps {
  siteData: SiteData;
}

const MODES_CODE = `/permissions read-only   # grep_code, read_file, git_diff
/permissions auto        # also the narrow write/test tools
/permissions ask         # blocks write/test/process tools (interactive confirm pending)`;

export function PermissionsPage({ siteData }: PermissionsPageProps) {
  return (
    <DocsPageLayout
      navGroups={createDocsNavGroups(siteData, "docs/permissions/")}
      heading="Permissions and checkpoints"
    >
      <CodeBlock code={MODES_CODE} />
      <p>
        <code>apply_patch</code> snapshots every touched path before and after the change. Recover
        with <code>/checkpoints</code>, <code>/restore &lt;id&gt;</code>, or{" "}
        <code>/rewind --files &lt;id&gt;</code>.
      </p>
    </DocsPageLayout>
  );
}
