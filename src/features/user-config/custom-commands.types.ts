/** Source directory for a custom command definition. */
export type CustomCommandSource = "project" | "user";

/** Optional YAML frontmatter metadata for a custom command. */
export interface CustomCommandMetadata {
  /** Short description shown in help output. */
  description?: string;
  /** Preferred model override for the command. */
  model?: string;
  /** Tool names allowed when running the command. */
  allowedTools?: string[];
}

/** Loaded custom command ready for rendering. */
export interface CustomCommand {
  /** Command name derived from the markdown filename. */
  name: string;
  /** Absolute path to the markdown file. */
  filePath: string;
  /** Whether the command came from project or user config. */
  source: CustomCommandSource;
  /** Optional description from frontmatter. */
  description?: string;
  /** Optional model override from frontmatter. */
  model?: string;
  /** Allowed tool names from frontmatter. */
  allowedTools: string[];
  /** Prompt template body after frontmatter. */
  promptTemplate: string;
}

/** Options for discovering custom commands on disk. */
export interface LoadCustomCommandsOptions {
  /** Repo root whose `.bridge/commands` directory is searched. */
  repoRoot: string;
  /** Optional home directory override. */
  homeDir?: string;
}

/** Parsed markdown command file contents. */
export interface ParsedCommandFile {
  /** Frontmatter metadata when present. */
  metadata: CustomCommandMetadata;
  /** Prompt template body. */
  body: string;
}

/** Directory entry used while scanning command sources. */
export interface CommandDir {
  /** Whether commands come from project or user config. */
  source: CustomCommandSource;
  /** Absolute directory path to scan. */
  dir: string;
}
