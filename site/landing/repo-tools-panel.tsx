import type { CatalogTool } from "@site/tool-catalog.ts";

interface RepoToolsPanelProps {
  repoTools: CatalogTool[];
  permissionModes: string[];
}

const MODE_EXPLANATIONS: Record<string, string> = {
  "read-only": "grep, read and git_diff",
  ask: "write and test tools are blocked",
  auto: "adds apply_patch and run_tests",
};

export const RepoToolsPanel = ({ repoTools, permissionModes }: RepoToolsPanelProps) => (
  <div class="mcp-box reveal">
    <h3 class="h3">bridge ask --tools</h3>
    <div data-picker data-pick-hide>
      <div class="chips">
        {repoTools.map((tool, index) => (
          <button
            class="chip"
            type="button"
            data-pick={tool.name}
            aria-pressed={index === 0 ? "true" : "false"}
            key={tool.name}
          >
            {tool.name}
          </button>
        ))}
      </div>
      <div class="chip-detail">
        {repoTools.map((tool, index) => (
          <p
            class="hint-line"
            data-pick-panel={tool.name}
            hidden={index === 0 ? undefined : true}
            key={tool.name}
          >
            {tool.description}
          </p>
        ))}
      </div>
    </div>
    <div data-picker>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border and padding into the segmented buttons */}
      <div class="seg" role="group" aria-label="Permission mode">
        {permissionModes.map((mode, index) => (
          <button
            type="button"
            data-pick={mode}
            aria-pressed={index === 0 ? "true" : "false"}
            key={mode}
          >
            {mode}
          </button>
        ))}
      </div>
      <div class="modes">
        {permissionModes.map((mode, index) => (
          <div data-pick-panel={mode} data-picked={index === 0 ? "" : undefined} key={mode}>
            <b>{mode}</b>
            {MODE_EXPLANATIONS[mode] ?? ""}
          </div>
        ))}
      </div>
    </div>
    <p>
      Calls reach your Mac through a Cloudflare quick tunnel. apply_patch snapshots each file first,
      so you can restore it.
    </p>
  </div>
);
