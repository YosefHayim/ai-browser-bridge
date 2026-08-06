export type VisibleMenuItem<T> = {
  item: T;
  index: number;
};

export type VisibleMenuItemsOptions<T> = {
  items: readonly T[];
  selectedIdx: number;
  limit: number;
};

/** Window of menu items centered around the selected index. */
export const visibleMenuItems = <T>(options: VisibleMenuItemsOptions<T>): VisibleMenuItem<T>[] => {
  const clampedSelected = Math.min(
    Math.max(options.selectedIdx, 0),
    Math.max(options.items.length - 1, 0),
  );
  const start = Math.max(
    0,
    Math.min(clampedSelected - options.limit + 1, options.items.length - options.limit),
  );
  return options.items.slice(start, start + options.limit).map((item, index) => ({
    item,
    index: start + index,
  }));
};
