import { useEffect } from "react";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import { loadPromptSuggestions } from "@/terminal/tui/suggestions/load-suggestions.ts";
import type { ComposerStatus } from "./use-composer-state.ts";

export const useComposerSuggestions = (status: ComposerStatus, props: AppProps) => {
  useEffect(() => {
    const abortController = new AbortController();

    const loadSuggestions = async () => {
      try {
        const suggestions = await loadPromptSuggestions(status.input, {
          repoRoot: props.config.repoPath,
          commands: status.allCommands,
        });

        const isLoadCancelled = abortController.signal.aborted;
        if (isLoadCancelled) return;

        const isSuggestionsMissing = suggestions == null;
        if (isSuggestionsMissing) {
          status.setInputSuggestions(null);
          return;
        }

        status.setInputSuggestions(suggestions);
      } catch {
        const isLoadCancelled = abortController.signal.aborted;
        if (isLoadCancelled) return;

        status.setInputSuggestions(null);
      }
    };

    void loadSuggestions();
    return () => {
      abortController.abort();
    };
  }, [props.config.repoPath, status.allCommands, status.input, status.setInputSuggestions]);
};
