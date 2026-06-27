import { resolve } from "node:path";
import { startEngine } from "../../bridge/create-engine.factory.ts";
import type { AskOptions } from "./ask.types.ts";
import { runAskFlow } from "./ask.helpers.ts";

export type { AskOptions } from "./ask.types.ts";

/** Send one prompt and print the reply, leaving the browser warm. */
export async function runAsk(prompt: string, options: AskOptions): Promise<void> {
  await runAskFlow({ prompt, options });
}
