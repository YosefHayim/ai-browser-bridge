import type { CatalogTool } from "@site/tool-catalog.ts";

interface ToolsExplorerProps {
  tools: CatalogTool[];
}

interface ToolGroup {
  id: string;
  label: string;
  tag: string;
  tools: CatalogTool[];
}

const GROUP_PREFIXES = [
  { prefix: "flow_", label: "flow_*", tag: "Flow" },
  { prefix: "design_", label: "design_*", tag: "Design" },
];

const createToolGroups = (tools: CatalogTool[]): ToolGroup[] => {
  const groups: ToolGroup[] = [];

  for (const tool of tools) {
    const groupPrefix = GROUP_PREFIXES.find((candidate) => tool.name.startsWith(candidate.prefix));
    const existingGroup = groups.find((group) => group.id === (groupPrefix?.prefix ?? tool.name));

    if (existingGroup != null) {
      existingGroup.tools.push(tool);
    } else if (groupPrefix != null) {
      groups.push({
        id: groupPrefix.prefix,
        label: groupPrefix.label,
        tag: groupPrefix.tag,
        tools: [tool],
      });
    } else {
      const tag = tool.name.startsWith("chatgpt_") ? "ChatGPT" : "core";
      groups.push({ id: tool.name, label: tool.name, tag, tools: [tool] });
    }
  }

  return groups;
};

export const ToolsExplorer = ({ tools }: ToolsExplorerProps) => {
  const groups = createToolGroups(tools);

  return (
    <div class="explorer" data-picker data-pick-hide>
      <div class="tools">
        {groups.map((group, index) => (
          <button
            class="tool"
            type="button"
            data-pick={group.id}
            aria-pressed={index === 0 ? "true" : "false"}
            key={group.id}
          >
            {group.label}
            <small>{group.tag}</small>
          </button>
        ))}
      </div>
      <div class="tool-detail">
        {groups.map((group, index) => (
          <div
            class="tool-group"
            data-pick-panel={group.id}
            hidden={index === 0 ? undefined : true}
            key={group.id}
          >
            {group.tools.map((tool) => (
              <div class="tool-item" key={tool.name}>
                <span class="label">signature</span>
                <div class="sig">{tool.signature}</div>
                <p>{tool.description}</p>
              </div>
            ))}
          </div>
        ))}
        <span class="label">register once</span>
        <div class="sig">claude mcp add ai-browser-bridge -- bridge serve</div>
      </div>
    </div>
  );
};
