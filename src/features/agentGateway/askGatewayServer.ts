import type { FanoutResult } from "@/features/bridge";
import { parseProviderList } from "@/features/providers";
import { McpServer as McpProtocolServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * The outbound MCP surface: a local agent connects to this server and calls `ask` to
 * drive one or more web chats. This is the OPPOSITE direction to the inbound MCP server
 * in `tools/` (which exposes repo tools TO the web model). Both go over the same
 * fan-out core, injected here as `runFanout`.
 */
export interface AskGatewayDeps {
  /** Run one prompt across the resolved providers and return the keyed result. */
  runFanout: (
    providers: string[],
    prompt: string,
    opts: { timeoutMs?: number },
  ) => Promise<FanoutResult>;
}

/** Zod raw shape for the `ask` tool parameters. */
export const ASK_TOOL_PARAMS = {
  prompt: z.string().min(1).describe("The prompt to send to each provider."),
  providers: z
    .string()
    .optional()
    .describe("Comma-separated provider ids (e.g. 'chatgpt,gemini'); omit for the default."),
  timeoutSeconds: z.number().positive().optional().describe("Per-provider timeout in seconds."),
};

/** Arguments accepted by {@link handleAskGatewayCall}. */
export interface AskGatewayArgs {
  prompt: string;
  providers?: string;
  timeoutSeconds?: number;
}

/**
 * Handle one `ask` call: resolve the provider list (fail-loud on unknown), fan the
 * prompt out over the core, and return the keyed result as JSON. Never throws — an
 * unknown provider becomes `{ ok: false }` so the tool reports it cleanly.
 */
export async function handleAskGatewayCall(
  deps: AskGatewayDeps,
  args: AskGatewayArgs,
): Promise<{ ok: boolean; output: string }> {
  let providers: string[];
  try {
    providers = parseProviderList(args.providers);
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
  const result = await deps.runFanout(providers, args.prompt, {
    timeoutMs: args.timeoutSeconds ? args.timeoutSeconds * 1000 : undefined,
  });
  return { ok: true, output: JSON.stringify(result) };
}

/**
 * Build an MCP server exposing a single `ask` tool over the fan-out core. Served over
 * stdio by {@link serveAskGatewayStdio}; the browser-backed `runFanout` is injected at
 * the composition root — `bridge serve` (`runServe` in the terminal feature).
 */
export function createAskGatewayServer(deps: AskGatewayDeps): McpProtocolServer {
  const mcp = new McpProtocolServer({ name: "ai-browser-bridge-ask", version: "0.1.0" });
  mcp.tool(
    "ask",
    "Ask one prompt across one or more web-chat providers and return each reply, keyed by provider.",
    ASK_TOOL_PARAMS,
    {},
    async (args: Record<string, unknown>) => {
      // Args are validated against ASK_TOOL_PARAMS by the SDK before this runs.
      const result = await handleAskGatewayCall(deps, args as unknown as AskGatewayArgs);
      return { content: [{ type: "text" as const, text: result.output }], isError: !result.ok };
    },
  );
  return mcp;
}
