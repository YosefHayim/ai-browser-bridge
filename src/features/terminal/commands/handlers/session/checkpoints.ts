import type { CommandContext } from "../../../../domain/types.ts";
import { listCheckpoints, restoreCheckpoint } from "../../../../store/checkpoints.ts";
import { splitArgs } from "../helpers/split-args.ts";

/** List file checkpoints for the current repo. */
export async function handleCheckpoints(_args: string, ctx: CommandContext): Promise<void> {
  const checkpoints = await listCheckpoints({ repoRoot: ctx.config.repoPath });
  if (checkpoints.length === 0) {
    console.log("No checkpoints found.");
    return;
  }
  printCheckpointRows(checkpoints);
}

/** Print up to 20 checkpoint rows. */
function printCheckpointRows(
  checkpoints: Array<{ id: string; phase: string; fileCount: number; label?: string }>,
): void {
  console.log("\nCheckpoints:\n");
  for (const checkpoint of checkpoints.slice(0, 20)) {
    console.log(
      `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${checkpoint.label ?? ""}`,
    );
  }
  console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
}

/** Restore files from a checkpoint, optionally scoped to paths. */
export async function handleRestore(args: string, ctx: CommandContext): Promise<void> {
  const parts = splitArgs(args);
  const checkpointId = parts[0];
  if (!checkpointId) {
    console.log("Usage: /restore <checkpoint-id> [path ...]");
    return;
  }
  const restored = await restoreCheckpoint({
    repoRoot: ctx.config.repoPath,
    checkpointId,
    paths: parts.slice(1),
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
}

/** Rewind the last prompt and/or restore checkpoint files. */
export async function handleRewind(args: string, ctx: CommandContext): Promise<void> {
  const parts = splitArgs(args);
  if (parts[0] === "--files" || parts[0] === "--both") {
    await rewindWithCheckpoint({ mode: parts[0], parts, ctx });
    return;
  }
  const replacement = args.trim() || undefined;
  await ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
}

/** Inputs for checkpoint-aware rewind. */
interface RewindWithCheckpointParams {
  /** `--files` or `--both` mode flag. */
  mode: string;
  /** Parsed command tokens. */
  parts: string[];
  /** Active command context. */
  ctx: CommandContext;
}

/** Restore checkpoint files and optionally rewind the last prompt. */
async function rewindWithCheckpoint(params: RewindWithCheckpointParams): Promise<void> {
  const checkpointId = params.parts[1];
  if (!checkpointId) {
    console.log(`Usage: /rewind ${params.mode} <checkpoint-id> [replacement prompt]`);
    return;
  }
  await restoreAndMaybeRewind(params);
}

/** Restore checkpoint files and optionally rewind with a replacement prompt. */
async function restoreAndMaybeRewind(params: RewindWithCheckpointParams): Promise<void> {
  const checkpointId = params.parts[1]!;
  const restored = await restoreCheckpoint({ repoRoot: params.ctx.config.repoPath, checkpointId });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
  if (params.mode === "--files") return;
  await rewindPromptAfterRestore(params);
}

/** Rewind the last prompt after checkpoint restore in `--both` mode. */
async function rewindPromptAfterRestore(params: RewindWithCheckpointParams): Promise<void> {
  const replacement = params.parts.slice(2).join(" ").trim() || undefined;
  await params.ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(
    replacement ? "Restored files and rewound with replacement prompt." : "Restored files and rewound the last prompt.",
  );
}
