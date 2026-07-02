import { useEffect } from "react";
import type { AppProps } from "./appTypes.ts";
import { loadInputSuggestions } from "./inputSuggestions.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Loads autocomplete suggestions whenever the composer input changes. */
export function useComposerSuggestions(state: ComposerState, props: AppProps) {
  useEffect(() => {
    let cancelled = false;
    loadInputSuggestions(state.input, {
      repoRoot: props.config.repoPath,
      commands: state.allCommands,
    })
      .then((suggestions) => {
        if (!cancelled) state.setInputSuggestions(suggestions);
      })
      .catch(() => {
        if (!cancelled) state.setInputSuggestions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.config.repoPath, state.allCommands, state.input, state.setInputSuggestions]);
}
