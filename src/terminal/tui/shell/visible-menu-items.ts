export type VisibleMenuChoice<T> = {
  item: T;
  index: number;
};

export type VisibleMenuElementsSettings<T> = {
  items: readonly T[];
  selectedIndex: number;
  limit: number;
};

export const listVisibleMenuElements = <T>(
  settings: VisibleMenuElementsSettings<T>,
): VisibleMenuChoice<T>[] => {
  const clampedSelected = Math.min(
    Math.max(settings.selectedIndex, 0),
    Math.max(settings.items.length - 1, 0),
  );
  const start = Math.max(
    0,
    Math.min(clampedSelected - settings.limit + 1, settings.items.length - settings.limit),
  );

  return settings.items.slice(start, start + settings.limit).map((element, index) => ({
    item: element,
    index: start + index,
  }));
};
