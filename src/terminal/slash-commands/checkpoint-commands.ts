import type { CommandSession } from "@/domain/command-types.ts";
import { listCheckpoints, restoreCheckpoint } from "@/store/checkpoints.ts";
import { FILES_FLAG } from "@/terminal/cli-option-readers.ts";
import { SPACE } from "@/terminal/cli-text.ts";
import { splitArgumentList } from "@/terminal/split-argument-list.ts";

export const listCheckpointsCommand = async (
  _argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const checkpoints = await listCheckpoints({ repoRoot: commandScope.config.repoPath });

  const isCheckpointsEmpty = checkpoints.length === 0;
  if (isCheckpointsEmpty) {
    console.log("No checkpoints found.");
    return;
  }

  printCheckpoints(checkpoints);
};

const printCheckpoints = (
  checkpoints: Array<{ id: string; phase: string; fileCount: number; label?: string }>,
): void => {
  console.log("\nCheckpoints:\n");

  for (const checkpoint of checkpoints.slice(0, 20)) {
    console.log(
      `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${readCheckpointLabel(checkpoint.label)}`,
    );
  }

  console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
};

const readCheckpointLabel = (label: string | undefined): string => {
  const isLabelMissing = label == null;
  if (isLabelMissing) return "";

  return label;
};

export const restoreCheckpointCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);

  const checkpointId = parts[0];

  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log("Usage: /restore <checkpoint-id> [path ...]");
    return;
  }

  const restored = await restoreCheckpoint({
    repoRoot: commandScope.config.repoPath,
    checkpointId,
    paths: parts.slice(1),
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
};

export const runRewindPromptCommand = async (
  argumentList: string,
  commandScope: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);
  const mode = parts[0];
  const isFilesOrBothFlag = mode === FILES_FLAG || mode === "--both";

  if (isFilesOrBothFlag) {
    await rewindWithCheckpoint({ mode, parts, ctx: commandScope });
    return;
  }

  const replacement = argumentList.trim() || undefined;
  await commandScope.orchestrator.rewindLastPrompt(replacement);
  console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
};

type RewindWithCheckpointParameters = {
  mode: string;
  parts: string[];
  ctx: CommandSession;
};

const rewindWithCheckpoint = async (parameters: RewindWithCheckpointParameters): Promise<void> => {
  const checkpointId = parameters.parts[1];

  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log(`Usage: /rewind ${parameters.mode} <checkpoint-id> [replacement prompt]`);
    return;
  }

  await restoreAndMaybeRewind(parameters, checkpointId);
};

const restoreAndMaybeRewind = async (
  parameters: RewindWithCheckpointParameters,
  checkpointId: string,
): Promise<void> => {
  const restored = await restoreCheckpoint({
    repoRoot: parameters.ctx.config.repoPath,
    checkpointId,
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );

  const isModeFiles = parameters.mode === FILES_FLAG;
  if (isModeFiles) return;

  await rewindPromptAfterRestore(parameters);
};

const rewindPromptAfterRestore = async (
  parameters: RewindWithCheckpointParameters,
): Promise<void> => {
  const replacement = parameters.parts.slice(2).join(SPACE).trim() || undefined;

  await parameters.ctx.orchestrator.rewindLastPrompt(replacement);
  console.log(
    replacement
      ? "Restored files and rewound with replacement prompt."
      : "Restored files and rewound the last prompt.",
  );
};
