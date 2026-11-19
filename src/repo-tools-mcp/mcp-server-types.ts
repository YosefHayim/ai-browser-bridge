import type { Page } from "playwright";
import type { HookDefinition } from "@/hooks/hooks.ts";
import type { PermissionMode } from "@/permissions.ts";

export type McpToolAction = {
  name: string;
  status: "started" | "completed" | "blocked" | "failed";
  data?: Record<string, unknown>;
};

export type McpServerSettings = {
  getPage?: () => Page | null | undefined;
  getPermissionMode?: () => PermissionMode;
  hooks?: readonly HookDefinition[];
  onToolAction?: (action: McpToolAction) => void | Promise<void>;
};

export type McpServerHandle = {
  url: string;
  close: () => void;
};
