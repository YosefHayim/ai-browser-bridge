/** Options for the non-interactive `bridge download` command. */
export interface DownloadCmdOptions {
  repo?: string;
  port?: string;
  provider?: string;
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
