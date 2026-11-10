import { useEffect } from "react";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import { loadPromptSuggestions } from "@/terminal/tui/suggestions/load-suggestions.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export const useComposerSuggestions = (status: ComposerStatus, props: AppProps) => {
  useEffect(() => {
    let cancelled = false;

    const loadSuggestions = async () => {
      try {
        const suggestions = await loadPromptSuggestions(status.input, {
          repoRoot: props.config.repoPath,
          commands: status.allCommands,
        });

        if (cancelled) return;

        const isSuggestionsMissing = suggestions == null;
        if (isSuggestionsMissing) {
          status.setInputSuggestions(null);
          return;
        }

        status.setInputSuggestions(suggestions);
      } catch {
        const isNotCancelled = !cancelled;
        if (isNotCancelled) status.setInputSuggestions(null);
      }
    };

    void loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [props.config.repoPath, status.allCommands, status.input, status.setInputSuggestions]);
};
