import type { CommandSession } from "@/domain/command-types.ts";
import { listCheckpoints, restoreCheckpoint } from "@/store/checkpoints.ts";
import { FILES_FLAG } from "@/terminal/cli-option-readers.ts";
import { SPACE } from "@/terminal/cli-text.ts";
import { splitArgumentList } from "@/terminal/split-argument-list.ts";

export const listCheckpointsCommand = async (
  _argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const checkpoints = await listCheckpoints({ repoRoot: commandSession.config.repoPath });

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

  const checkpointListLimit = 20;

  for (const checkpoint of checkpoints.slice(0, checkpointListLimit)) {
    const checkpointPhaseColumnWidth = 6;

    const checkpointIdColumnWidth = 38;

    console.log(
      `  ${checkpoint.id.padEnd(checkpointIdColumnWidth)} ${checkpoint.phase.padEnd(checkpointPhaseColumnWidth)} ${checkpoint.fileCount} files ${readCheckpointLabel(checkpoint.label)}`,
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
  commandSession: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);

  const checkpointId = parts[0];

  const isCheckpointIdEmpty = !checkpointId;
  if (isCheckpointIdEmpty) {
    console.log("Usage: /restore <checkpoint-id> [path ...]");
    return;
  }

  const restored = await restoreCheckpoint({
    repoRoot: commandSession.config.repoPath,
    checkpointId,
    paths: parts.slice(1),
  });
  console.log(
    `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
  );
};

export const runRewindPromptCommand = async (
  argumentList: string,
  commandSession: CommandSession,
): Promise<void> => {
  const parts = splitArgumentList(argumentList);
  const mode = parts[0];

  const isFilesOrBothFlag = mode === FILES_FLAG || mode === "--both";

  if (isFilesOrBothFlag) {
    await rewindWithCheckpoint({ mode, parts, commandSession: commandSession });
    return;
  }

  const replacement = argumentList.trim() || undefined;
  await commandSession.orchestrator.rewindLastPrompt(replacement);
  const isReplacementFound = replacement != null && replacement !== "";
  console.log(isReplacementFound ? "Rewound with replacement prompt." : "Rewound the last prompt.");
};

type RewindWithCheckpointParameters = {
  mode: string;
  parts: string[];
  commandSession: CommandSession;
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
    repoRoot: parameters.commandSession.config.repoPath,
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
  const replacementStartIndex = 2;

  const replacement = parameters.parts.slice(replacementStartIndex).join(SPACE).trim() || undefined;

  await parameters.commandSession.orchestrator.rewindLastPrompt(replacement);
  const isReplacementFound = replacement != null && replacement !== "";
  console.log(
    isReplacementFound
      ? "Restored files and rewound with replacement prompt."
      : "Restored files and rewound the last prompt.",
  );
};
