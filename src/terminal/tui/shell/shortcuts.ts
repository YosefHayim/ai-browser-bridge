export const DOUBLE_ESCAPE_WINDOW_MILLISECONDS = 800;

export const isDoubleEscapePress = (previousPressAt: number, currentPressAt: number): boolean => {
  return (
    previousPressAt > 0 && currentPressAt - previousPressAt <= DOUBLE_ESCAPE_WINDOW_MILLISECONDS
  );
};
