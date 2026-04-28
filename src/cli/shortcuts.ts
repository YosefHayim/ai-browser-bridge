export const DOUBLE_ESCAPE_WINDOW_MS = 800;

/** Return true when a second Escape press lands inside the shortcut window. */
export function isDoubleEscapePress(previousPressAt: number, currentPressAt: number): boolean {
  return previousPressAt > 0 && currentPressAt - previousPressAt <= DOUBLE_ESCAPE_WINDOW_MS;
}
