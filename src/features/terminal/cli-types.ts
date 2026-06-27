/** Common CLI flags shared by interactive and headless commands. */
export interface CommonCliOptions {
  /** Target repository path. */
  repo?: string;
  /** MCP listen port. */
  port?: string;
  /** Browser provider id. */
  provider?: string;
}
