/** A menu item paired with its absolute index in the source list. */
export type VisibleMenuItem<T> = {
  item: T;
  index: number;
};

/** Options for slicing a menu around the selected index. */
export type VisibleMenuItemsOptions<T> = {
  items: readonly T[];
  selectedIdx: number;
  limit: number;
};

/** Window of menu items centered around the selected index. */
export const visibleMenuItems = <T>(options: VisibleMenuItemsOptions<T>): VisibleMenuItem<T>[] => {
  const { items, selectedIdx, limit } = options;
  const safeSelected = Math.min(Math.max(selectedIdx, 0), Math.max(items.length - 1, 0));
  const start = Math.max(0, Math.min(safeSelected - limit + 1, items.length - limit));
  return items.slice(start, start + limit).map((item, index) => ({
    item,
    index: start + index,
  }));
};
