/** Options for the non-interactive `bridge ask` command. */
export interface AskOptions {
  repo?: string;
  port?: string;
  provider?: string;
  /** Start a fresh conversation before sending. */
  fresh?: boolean;
  /** Switch model before sending (e.g. "GPT-4o" or "Gemini Flash"). */
  model?: string;
  /** Bring up the tunnel + connector so ChatGPT can call local MCP tools. */
  tools?: boolean;
  /** Emit a JSON object instead of plain reply text. */
  json?: boolean;
  /** Max seconds to wait for the reply. */
  timeout?: string;
}
