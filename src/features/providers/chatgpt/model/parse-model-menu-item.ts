import type { Locator } from "playwright";
import type { ModelOption } from "../../../domain/types.ts";
import { isLikelyModelLabel } from "./is-likely-model-label.ts";
import { isSelectedModelItem } from "./is-selected-model-item.ts";
import { readModelItemId } from "./read-model-item-id.ts";
import { readModelItemLabel } from "./read-model-item-label.ts";

/** Context for {@link parseModelMenuItem}. */
export interface ParseModelMenuItemContext {
  /** Model menu item locator. */
  item: Locator;
}

/** Parse one model menu item into a {@link ModelOption}, or null when not a model. */
export async function parseModelMenuItem(ctx: ParseModelMenuItemContext): Promise<ModelOption | null> {
  const label = await readModelItemLabel({ item: ctx.item });
  if (!label || !isLikelyModelLabel(label)) return null;
  const id = await readModelItemId({ item: ctx.item });
  const selected = await isSelectedModelItem({ item: ctx.item });
  return { id, label, selected };
}
