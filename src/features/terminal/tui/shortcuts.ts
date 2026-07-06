export const DOUBLE_ESCAPE_WINDOW_MS = 800;

/**
 * Return true when a second Escape press lands inside the shortcut window.
 *
 * @param previousPressAt - Previous press at value.
 * @param currentPressAt - Current press at value.
 * @returns Whether the condition matches.
 * @example
 * ```ts
 * const result = isDoubleEscapePress(previousPressAt, currentPressAt);
 * ```
 */
export const isDoubleEscapePress = (previousPressAt: number, currentPressAt: number): boolean => {
  return previousPressAt > 0 && currentPressAt - previousPressAt <= DOUBLE_ESCAPE_WINDOW_MS;
};
