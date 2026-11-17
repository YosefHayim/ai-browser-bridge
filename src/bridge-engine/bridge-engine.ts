import type {
  AskEngineDetails,
  EngineAssembly,
  EngineRuntimeStatus,
  ShutdownEngineDetails,
  StartEngineSettings,
} from "@/bridge-engine/bridge-engine-types.ts";
import { bootEngine } from "@/bridge-engine/engine-boot.ts";
import { saveSettings } from "@/bridge-engine/repo-settings.ts";
import type { BridgeSettings } from "@/bridge-types.ts";
import type { BrowserSession } from "@/browser/browser-session.ts";
import { runHooks } from "@/hooks/hooks.ts";
import type { Message } from "@/message-types.ts";
import type { TokenCounter } from "@/orchestrator/context-counter.ts";
import type { Orchestrator } from "@/orchestrator/orchestrator.ts";
import { cleanPermissionMode, type PermissionMode } from "@/permissions.ts";
import { readErrorMessage } from "@/read-error-message.ts";
import { expandFileMentions } from "@/repo-files/file-mentions.ts";
import type { McpServerHandle, McpToolAction } from "@/repo-tools-mcp/mcp-server.ts";
import type { CloudflareTunnel } from "@/tunnel/cloudflare-tunnel.ts";

export class BridgeEngine {
  readonly bridgeSettings: BridgeSettings;
  readonly counter: TokenCounter;
  readonly browser: BrowserSession | null;
  readonly connectorUrl: string;
  readonly hooksSettings: EngineAssembly["hooksSettings"];
  readonly toolActions: McpToolAction[];
  readonly branch?: string;

  private readonly orchestrator: Orchestrator;
  private readonly mcpServer: McpServerHandle | null;
  private readonly tunnel: CloudflareTunnel | null;
  private runtime: EngineRuntimeStatus;

  constructor(
    private readonly assembly: EngineAssembly,
    private readonly saveEngineSettings = saveSettings,
    private readonly expandMentions = expandFileMentions,
    private readonly runEngineHooks = runHooks,
  ) {
    this.bridgeSettings = assembly.bridgeSettings;
    this.orchestrator = assembly.orchestrator;
    this.counter = assembly.counter;
    this.browser = assembly.browser;
    this.mcpServer = assembly.mcpServer;
    this.tunnel = assembly.tunnel;
    this.connectorUrl = assembly.connectorUrl;
    this.hooksSettings = assembly.hooksSettings;
    this.toolActions = assembly.toolActions;
    this.branch = assembly.branch;
    this.runtime = { ...assembly.runtime };
  }

  static start = async (settings: StartEngineSettings): Promise<BridgeEngine> => {
    const bootedEngineParts = await bootEngine(settings);
    return new BridgeEngine(bootedEngineParts);
  };

  getOrchestrator = (): Orchestrator => {
    return this.orchestrator;
  };

  ask = async (details: AskEngineDetails): Promise<Message | null> => {
    await Promise.allSettled([this.runEngineHooks("UserPromptSubmit", this.hooksSettings.hooks)]);

    const expanded = await this.expandMentions(details.content, this.bridgeSettings.repoPath);

    return this.orchestrator.sendPrompt({
      content: expanded.prompt,
      timeoutMilliseconds: details.timeoutMilliseconds,
      expectImages: details.expectImages,
    });
  };

  shutDown = async (details: ShutdownEngineDetails = {}): Promise<void> => {
    await Promise.allSettled([
      this.orchestrator.stopReply(),
      this.runEngineHooks("SessionEnd", this.hooksSettings.hooks),
    ]);
    this.tunnel?.stop();
    this.mcpServer?.close();

    const isBrowserMissing = this.browser == null;
    if (isBrowserMissing) return;

    await Promise.allSettled([this.browser.closeOwnTab()]);

    const isCloseBrowserSkipped = details.closeBrowser !== true;
    if (isCloseBrowserSkipped) return;

    await Promise.allSettled([this.browser.close()]);
  };

  private savePermissionMode = async (): Promise<void> => {
    try {
      await this.saveEngineSettings(this.bridgeSettings);
    } catch (error) {
      const reason = readErrorMessage(error);
      process.stderr.write(`Settings: could not save the permission mode (${reason}).\n`);
    }
  };

  get sessionId(): string {
    return this.runtime.sessionId;
  }

  set sessionId(id: string) {
    this.runtime.sessionId = id;
    this.assembly.runtime.sessionId = id;
  }

  get permissionMode(): PermissionMode {
    return this.runtime.permissionMode;
  }

  set permissionMode(mode: PermissionMode) {
    this.runtime.permissionMode = cleanPermissionMode(mode);
    this.assembly.runtime.permissionMode = this.runtime.permissionMode;
    this.bridgeSettings.permissionMode = this.runtime.permissionMode;

    const isNotAssemblyPersistent = !this.assembly.persistent;
    if (isNotAssemblyPersistent) return;

    void this.savePermissionMode();
  }
}

export function startEngine(settings: StartEngineSettings): Promise<BridgeEngine> {
  return BridgeEngine.start(settings);
}
