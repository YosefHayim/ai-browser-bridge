import { Config } from "effect";

/**
 * Repo root path, resolved from `BRIDGE_REPO_PATH` env var.
 * @returns The configured repo path or the current working directory.
 */
export const RepoPathConfig = Config.string("BRIDGE_REPO_PATH").pipe(
  Config.withDefault(process.cwd()),
);

/**
 * MCP server listen port, resolved from `BRIDGE_MCP_PORT` env var.
 * @returns The configured port or `8765`.
 */
export const McpPortConfig = Config.integer("BRIDGE_MCP_PORT").pipe(Config.withDefault(8765));

/**
 * Active provider id, resolved from `BRIDGE_PROVIDER` env var.
 * @returns The configured provider or `"chatgpt"`.
 */
export const ProviderConfig = Config.string("BRIDGE_PROVIDER").pipe(Config.withDefault("chatgpt"));
