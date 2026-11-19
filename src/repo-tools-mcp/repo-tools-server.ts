import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import packageJson from "@/../package.json" with { type: "json" };
import { DEFAULT_PERMISSION_MODE } from "@/app-defaults.ts";
import { type HookDefinition, runHooks } from "@/hooks/hooks.ts";
import type { ToolReport } from "@/message-types.ts";
import {
  convertPermissionDecisionToToolReport,
  evaluateToolPermission,
  type PermissionMode,
} from "@/permissions.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { appendBridgeLog } from "@/repo-files/logging.ts";
import type { McpServerSettings, McpToolAction } from "@/repo-tools-mcp/mcp-server-types.ts";
import { toolRegistry } from "@/repo-tools-mcp/tool-registry.ts";
import type { ToolDef } from "@/tool-types.ts";

type ToolArgumentList = Record<string, unknown>;

function readToolActionStatus(toolReport: ToolReport, isBlocked: boolean): McpToolAction["status"] {
  if (isBlocked) return "blocked";

  const isToolReportOk = toolReport.ok;
  if (isToolReportOk) return "completed";

  return "failed";
}

function sanitizeToolArgumentList(argumentList: ToolArgumentList): ToolArgumentList {
  const publicArgumentList: ToolArgumentList = {};
  for (const [key, field] of Object.entries(argumentList)) {
    const isKeyRepoRoot = key === "_repoRoot";
    if (isKeyRepoRoot) continue;

    publicArgumentList[key] = field;
  }
  return publicArgumentList;
}

export class RepoToolsServer {
  constructor(
    private readonly repoRoot: string,
    private readonly settings: McpServerSettings = {},
  ) {}

  createProtocolServer = (): McpServer => {
    const mcp = new McpServer({ name: "ai-browser-bridge", version: packageJson.version });

    for (const [name, tool] of toolRegistry) {
      this.registerTool(mcp, name, tool);
    }

    return mcp;
  };

  private registerTool = (mcp: McpServer, name: string, tool: ToolDef): void => {
    const { annotations } = tool;
    const isAnnotationsMissing = annotations == null;
    const toolSettings = {
      description: tool.description,
      inputSchema: tool.argsSchema.shape,
      ...(isAnnotationsMissing ? {} : { annotations }),
    };

    // The callback closes over this tool's name and definition, so it stays an inline arrow.
    mcp.registerTool(name, toolSettings, async (argumentList: ToolArgumentList) => {
      try {
        return await this.runToolCall(name, tool, argumentList);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: readErrorMessage(error) }],
          isError: true,
        };
      }
    });
  };

  private listHooks = (): readonly HookDefinition[] => {
    const hooks = this.settings.hooks;

    const isHooksMissing = hooks == null;
    if (isHooksMissing) return [];

    return hooks;
  };

  private readPermissionMode = (): PermissionMode => {
    const currentPermissionMode = this.settings.getPermissionMode?.();

    const isPermissionModeMissing = currentPermissionMode == null;
    if (isPermissionModeMissing) return DEFAULT_PERMISSION_MODE;

    return currentPermissionMode;
  };

  private runToolCall = async (
    name: string,
    tool: ToolDef,
    argumentList: ToolArgumentList,
  ): Promise<CallToolResult> => {
    const hooks = this.listHooks();

    await Promise.allSettled([runHooks("PreToolUse", hooks)]);

    const toolReport = await this.executeToolCall(name, tool, argumentList);

    await Promise.allSettled([runHooks("PostToolUse", hooks)]);

    return {
      content: [{ type: "text" as const, text: toolReport.output }],
      isError: !toolReport.ok,
    };
  };

  private executeToolCall = async (
    name: string,
    tool: ToolDef,
    argumentList: ToolArgumentList,
  ): Promise<ToolReport> => {
    await this.logToolCallStart(name, argumentList);

    const permissionMode = this.readPermissionMode();
    const permissionDecision = evaluateToolPermission(name, permissionMode);
    const denied = convertPermissionDecisionToToolReport(permissionDecision);
    const toolReport = await this.invokeToolHandler(tool, argumentList, denied);

    await this.logToolCallEnd(name, toolReport, denied != null);

    return toolReport;
  };

  private invokeToolHandler = async (
    tool: ToolDef,
    argumentList: ToolArgumentList,
    denied: ToolReport | null,
  ): Promise<ToolReport> => {
    const hasDenied = denied != null;
    if (hasDenied) return denied;

    try {
      return await this.callToolHandler(tool, argumentList);
    } catch (error) {
      return { ok: false, output: readErrorMessage(error), error: "tool-handler-error" };
    }
  };

  private callToolHandler = async (
    tool: ToolDef,
    argumentList: ToolArgumentList,
  ): Promise<ToolReport> => {
    const repoArgumentList = { ...argumentList, _repoRoot: this.repoRoot };
    const page = this.settings.getPage?.();

    const isPageMissing = page == null;
    if (isPageMissing) return await tool.handler(repoArgumentList);

    return await tool.handler({ ...repoArgumentList, _page: page });
  };

  private reportToolAction = async (action: McpToolAction): Promise<void> => {
    const { onToolAction } = this.settings;

    const isToolActionMissing = onToolAction == null;
    if (isToolActionMissing) return;

    try {
      await onToolAction(action);
    } catch (error) {
      await Promise.allSettled([
        appendBridgeLog({
          repoPath: this.repoRoot,
          type: "mcp_tool_action_error",
          data: { name: action.name, status: action.status, error: readErrorMessage(error) },
        }),
      ]);
    }
  };

  private logToolCallStart = async (
    name: string,
    argumentList: ToolArgumentList,
  ): Promise<void> => {
    const publicArgumentList = sanitizeToolArgumentList(argumentList);
    await Promise.allSettled([
      appendBridgeLog({
        repoPath: this.repoRoot,
        type: "mcp_tool_call",
        data: { name, args: publicArgumentList },
      }),
    ]);

    await this.reportToolAction({ name, status: "started", data: { args: publicArgumentList } });
  };

  private logToolCallEnd = async (
    name: string,
    toolReport: ToolReport,
    isBlocked: boolean,
  ): Promise<void> => {
    const outputBytes = toolReport.output.length;
    await Promise.allSettled([
      appendBridgeLog({
        repoPath: this.repoRoot,
        type: "mcp_tool_result",
        data: { name, ok: toolReport.ok, outputBytes, error: toolReport.error },
      }),
    ]);

    const status = readToolActionStatus(toolReport, isBlocked);
    await this.reportToolAction({
      name,
      status,
      data: { ok: toolReport.ok, error: toolReport.error, outputBytes },
    });
  };
}
