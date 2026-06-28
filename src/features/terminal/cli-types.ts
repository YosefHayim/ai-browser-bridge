/** Common CLI flags shared by interactive and headless commands. */
export interface CommonCliOptions {
  /** Target repository path. */
  repo?: string;
  /** MCP listen port. */
  port?: string;
  /** Browser provider id. */
  provider?: string;
}

/** Options for the non-interactive `bridge ask` command. */
export interface AskOptions extends CommonCliOptions {
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

/** Options for the non-interactive `bridge download` command. */
export interface DownloadCmdOptions extends CommonCliOptions {
  /** Conversation id to read from; defaults to the current page's `/c/<id>`. */
  conversation?: string;
  /** Output directory; defaults to `./downloads/<conversationId>` when omitted. */
  out?: string;
  /** Specific attachment id(s); omit to download every attachment. */
  id?: string[];
  /** Emit a JSON array of results instead of one human line per attachment. */
  json?: boolean;
}

/** Shape of a single attachment download outcome, success or failure. */
export interface DownloadResult {
  id?: string;
  path: string;
  bytes: number;
  error?: string;
}

/** Options for the non-interactive `bridge login` command. */
export interface LoginOptions {
  repo?: string;
  provider?: string;
}
