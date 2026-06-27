import type { CommandContext } from "../../domain/types.ts";

/**
 * Prompt templates for the project-agent commands (`/task`, `/work`).
 *
 * These build the instruction block sent to ChatGPT that forces it to drive the
 * repo through the MCP connector tools (grep_code/read_file/apply_patch/…) rather
 * than guessing from memory. Kept separate from the command registry so the large
 * static prompt text lives with the other command data, not the dispatch logic.
 */

/** Build the project-agent wrapper used by `/task` and `/work` (no instruction files). */
export function buildProjectTaskPrompt(task: string, ctx: CommandContext): string {
  return buildProjectTaskPromptWithInstructions(task, ctx, "");
}

/**
 * Build the project-agent prompt, optionally appending the repo's instruction
 * files (AGENTS.md / CLAUDE.md) so ChatGPT honours project conventions.
 *
 * The prompt deliberately front-loads a "prove the connector is active" step:
 * if ChatGPT answers from `/mnt/data` or asks for a zip/tree, the connector is
 * not wired up and the task should not proceed.
 */
export function buildProjectTaskPromptWithInstructions(
  task: string,
  ctx: CommandContext,
  projectInstructions: string,
): string {
  return [
    "You are helping me modify this local project through the registered MCP connector.",
    "",
    "Project context:",
    `- Repo path: ${ctx.config.repoPath}`,
    "- The terminal bridge exposes narrow local tools; use them instead of guessing from memory.",
    "",
    "Available MCP tools:",
    "- grep_code: search source code and find relevant files.",
    "- read_file: inspect exact file contents before proposing or editing.",
    "- apply_patch: make minimal code edits through sandbox-validated patches.",
    "- run_tests: run only allowlisted verification commands.",
    "- git_diff: review the current local diff before reporting completion.",
    "",
    "Required workflow:",
    "1. First action: call an MCP tool such as grep_code or read_file to prove the connector is active.",
    "2. Inspect the repository structure with grep_code/read_file and identify the relevant modules.",
    "3. Use grep_code to find the files, commands, tests, selectors, and patterns involved.",
    "4. Use read_file on the important files before making claims or edits.",
    "5. Briefly explain the structure you found and the files that matter.",
    "6. Make the smallest correct change, following existing patterns and avoiding unrelated refactors.",
    "7. If behavior changes, add or update focused tests when practical.",
    "8. Run the smallest useful verification first, then broader tests/build when relevant.",
    "9. Use git_diff to review the final diff.",
    "10. Report changed files, verification commands, and remaining risks.",
    "",
    "Rules:",
    "- Do not answer from guessing when the MCP tools can inspect the repo.",
    "- Do not ask me to paste tree/find output for this repo; use the MCP connector tools instead.",
    "- If you see only a hosted sandbox such as /mnt/data, or you ask for a zip/tree/find output, the connector is not active.",
    "- Do not use raw shell access or ask for broad local access.",
    "- Do not commit unless I explicitly ask.",
    "- If the MCP connector tools are unavailable in this chat, say: MCP connector is not active in this chat.",
    "- If a needed operation is not available through the tools, say exactly what is missing.",
    ...(projectInstructions.trim()
      ? [
          "",
          "Project instruction files:",
          projectInstructions.trim(),
        ]
      : []),
    "",
    "User task:",
    task.trim(),
  ].join("\n");
}
