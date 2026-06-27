import type { Page } from "playwright";
import { clickConnectorEntryButton } from "./click-connector-entry-button.ts";
import { findBridgeConnectorButtons } from "./find-bridge-connector-buttons.ts";
import { openConnectorList } from "./open-connector-list.ts";

/** Context for {@link clickConnectorListEntry}. */
export interface ClickConnectorListEntryContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Zero-based connector button index in the list. */
  index: number;
}

/** Open one connector list entry by index. */
export async function clickConnectorListEntry(ctx: ClickConnectorListEntryContext): Promise<boolean> {
  await openConnectorList({ page: ctx.page });
  const entry = (await findBridgeConnectorButtons({ page: ctx.page }))[ctx.index];
  if (!entry) return false;
  await clickConnectorEntryButton({ button: entry.button, page: ctx.page });
  return true;
}
