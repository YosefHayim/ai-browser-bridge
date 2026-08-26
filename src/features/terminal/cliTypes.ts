// Shared CLI flag shapes for interactive and headless commands.
export type CliOptions = {
  readonly repo?: string;
  readonly port?: string;
  readonly provider?: string;
};

// Flags selecting which Chrome debug session a command drives. Set both to run a
// second signed-in account in parallel (e.g. Brave on 9222 + Chrome on 9223).
export type BrowserTargetOptions = {
  readonly debugPort?: string;
  readonly profile?: string;
};

export type AskOptions = CliOptions &
  BrowserTargetOptions & {
    readonly fresh?: boolean;
    readonly model?: string;
    readonly tools?: boolean;
    readonly json?: boolean;
    readonly timeout?: string;
    readonly conversation?: string;
    readonly attach?: readonly string[];
    readonly images?: string;
    readonly strict?: boolean;
    readonly fanOut?: string;
    readonly maxConcurrency?: string;
    readonly limit?: string;
    readonly offset?: string;
    readonly maxReplyChars?: string;
  };

export type ServeOptions = CliOptions & {
  readonly timeout?: string;
};

export type DownloadCmdOptions = CliOptions &
  BrowserTargetOptions & {
    readonly conversation?: string;
    readonly out?: string;
    readonly id?: readonly string[];
    readonly scan?: boolean;
    readonly json?: boolean;
  };

export type DownloadResult = {
  readonly id?: string;
  readonly path: string;
  readonly bytes: number;
  readonly error?: string;
};

export type ChromeStartOptions = BrowserTargetOptions & {
  readonly repo?: string;
  readonly provider?: string;
};

export type BrowserStatusOptions = {
  readonly json?: boolean;
};

export type CacheCmdOptions = {
  readonly profile?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
};

export type ProjectCmdOptions = CliOptions &
  BrowserTargetOptions & {
    readonly json?: boolean;
    readonly instructions?: string;
    readonly to?: string;
    readonly yes?: boolean;
  };

export type ChatCmdOptions = CliOptions &
  BrowserTargetOptions & {
    readonly json?: boolean;
    readonly orphans?: boolean;
    readonly project?: string;
    readonly id?: readonly string[];
    readonly limit?: string;
    readonly open?: boolean;
  };

export type ChatOrganizationOptions = CliOptions &
  BrowserTargetOptions & {
    readonly json?: boolean;
    readonly plan?: string;
    readonly interval?: string;
    readonly cooldown?: string;
    readonly maxAttempts?: string;
    readonly restart?: boolean;
    readonly dryRun?: boolean;
  };

export type TaskCmdOptions = CliOptions &
  BrowserTargetOptions & {
    readonly json?: boolean;
    readonly every?: string;
    readonly at?: string;
  };

export type ChatgptCmdOptions = CliOptions & {
  readonly json?: boolean;
  readonly allTabs?: boolean;
};

export type FlowCmdOptions = CliOptions &
  BrowserTargetOptions & {
    readonly json?: boolean;
    readonly id?: readonly string[];
    readonly name?: string;
    readonly out?: string;
    readonly yes?: boolean;
    readonly start?: string;
    readonly prompt?: string;
  };
