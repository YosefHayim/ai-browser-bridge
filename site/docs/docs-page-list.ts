export interface DocsPageEntry {
  label: string;
  pathInsideSite: string;
  summary: string;
}

export const DOCS_PAGES: DocsPageEntry[] = [
  {
    label: "Usage",
    pathInsideSite: "docs/usage/",
    summary: "Install, start Chrome, ask, the interactive commands, file mentions and Projects.",
  },
  {
    label: "Agents and fan-out",
    pathInsideSite: "docs/agents/",
    summary: "bridge ask for scripts, fan-out across providers, and the bridge serve MCP server.",
  },
  {
    label: "Where state lives",
    pathInsideSite: "docs/state/",
    summary: "The .bridge folder, what creates it, and the shared Chrome profile.",
  },
  {
    label: "Permissions and checkpoints",
    pathInsideSite: "docs/permissions/",
    summary: "Permission modes and how to restore files after a patch.",
  },
  {
    label: "Limitations",
    pathInsideSite: "docs/limitations/",
    summary: "What the bridge does not do today.",
  },
];
