import { useEffect } from "react";
import type { ComposerStatus } from "@/terminal/tui/composer/use-composer-state.ts";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import { loadPromptSuggestions } from "@/terminal/tui/suggestions/load-suggestions.ts";

export function useComposerSuggestions(status: ComposerStatus, props: AppProps) {
  useEffect(() => {
    const abortController = new AbortController();

    async function loadSuggestions() {
      try {
        const suggestions = await loadPromptSuggestions(status.input, {
          repoRoot: props.bridgeSettings.repoPath,
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
    }

    void loadSuggestions();
    return () => {
      abortController.abort();
    };
  }, [props.bridgeSettings.repoPath, status.allCommands, status.input, status.setInputSuggestions]);
}
