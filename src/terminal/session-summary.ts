import type { SessionMetadata } from "@/store/session-store.ts";
import { NEWLINE } from "./cli-text.ts";

export const createSessionSummary = (session: SessionMetadata, currentId?: string): string => {
  const isCurrentSession = session.id === currentId;
  const marker = isCurrentSession ? "current" : "loaded";

  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${readSessionModelLabel(session.model)}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${readSessionTunnelLabel(session.tunnelUrl)}`,
  ].join(NEWLINE);
};

export const readSessionModelLabel = (model: string | null | undefined): string => {
  const isModelBlank = model == null || model === "";
  if (isModelBlank) return "unknown";

  return model;
};

const readSessionTunnelLabel = (tunnelUrl: string | null | undefined): string => {
  const isTunnelUrlBlank = tunnelUrl == null || tunnelUrl === "";
  if (isTunnelUrlBlank) return "none";

  return tunnelUrl;
};
