/** A menu item paired with its absolute index in the source list. */
export type VisibleMenuItem<T> = {
  /** The underlying menu item. */
  item: T;
  /** Absolute index in the full list. */
  index: number;
};

/** Options for slicing a menu around the selected index. */
export type VisibleMenuItemsOptions<T> = {
  /** Full list of menu items. */
  items: readonly T[];
  /** Currently selected index. */
  selectedIdx: number;
  /** Maximum number of visible rows. */
  limit: number;
};

/** Returns a window of menu items centered around the selected index. */
export function visibleMenuItems<T>(options: VisibleMenuItemsOptions<T>): VisibleMenuItem<T>[] {
  const { items, selectedIdx, limit } = options;
  const safeSelected = Math.min(Math.max(selectedIdx, 0), Math.max(items.length - 1, 0));
  const start = Math.max(0, Math.min(safeSelected - limit + 1, items.length - limit));
  return items.slice(start, start + limit).map((...args: [T, number]) => ({
    item: args[0],
    index: start + args[1],
  }));
}
