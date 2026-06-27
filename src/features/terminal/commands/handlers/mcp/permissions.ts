import type { CommandContext } from "../../../../domain/types.ts";
import { normalizePermissionMode, PERMISSION_MODES } from "../../../../domain/permissions.ts";

/** Show or switch MCP permission mode. */
export async function handlePermissions(args: string, ctx: CommandContext): Promise<void> {
  const next = args.trim();
  if (!next) {
    printPermissionModes(ctx);
    return;
  }
  await setPermissionMode({ next, ctx });
}

/** Print current permission mode and available values. */
function printPermissionModes(ctx: CommandContext): void {
  console.log(`Permission mode: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`);
  console.log(`Available: ${PERMISSION_MODES.join(", ")}`);
}

/** Apply a new permission mode when valid. */
async function setPermissionMode(params: { next: string; ctx: CommandContext }): Promise<void> {
  const mode = normalizePermissionMode(params.next);
  if (mode !== params.next) {
    console.log(`Unknown permission mode "${params.next}". Available: ${PERMISSION_MODES.join(", ")}`);
    return;
  }
  await params.ctx.permission?.setMode(mode);
  params.ctx.config.permissionMode = mode;
  console.log(`Permission mode set to ${mode}.`);
}
