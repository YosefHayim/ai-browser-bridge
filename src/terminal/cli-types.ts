export type ExitCode = 0 | 1 | 2;

export type CliSettings = {
  readonly repo?: string;
  readonly port?: string;
  readonly provider?: string;
};

export type BrowserTargetSettings = {
  readonly debugPort?: string;
  readonly profile?: string;
};

export type AskSettings = CliSettings &
  BrowserTargetSettings & {
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

export type ServeSettings = CliSettings & {
  readonly timeout?: string;
};

export type DownloadCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly conversation?: string;
    readonly out?: string;
    readonly id?: readonly string[];
    readonly scan?: boolean;
    readonly json?: boolean;
  };

export type DownloadReport = {
  readonly id?: string;
  readonly path: string;
  readonly bytes: number;
  readonly error?: string;
};

export type ChromeStartSettings = BrowserTargetSettings & {
  readonly repo?: string;
  readonly provider?: string;
};

export type BrowserStatusSettings = {
  readonly json?: boolean;
};

export type CacheCommandSettings = {
  readonly profile?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
  readonly yes?: boolean;
};

export type ProjectCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly instructions?: string;
    readonly to?: string;
    readonly yes?: boolean;
  };

export type ChatCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly orphans?: boolean;
    readonly project?: string;
    readonly title?: string;
    readonly id?: readonly string[];
    readonly limit?: string;
    readonly open?: boolean;
  };

export type ChatOrganizationSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly plan?: string;
    readonly interval?: string;
    readonly adaptive?: boolean;
    readonly minInterval?: string;
    readonly maxInterval?: string;
    readonly speedUpAfter?: string;
    readonly cooldown?: string;
    readonly maxAttempts?: string;
    readonly queue?: string;
    readonly verify?: boolean;
    readonly restart?: boolean;
    readonly dryRun?: boolean;
  };

export type TaskCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly every?: string;
    readonly at?: string;
  };

export type ChatgptCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly allTabs?: boolean;
  };

export type DesignCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly project?: string;
    readonly conversation?: string;
    readonly query?: string;
    readonly designSystems?: boolean;
    readonly limit?: string;
    readonly name?: string;
    readonly prompt?: string;
    readonly message?: string;
    readonly template?: string;
    readonly model?: string;
    readonly effort?: string;
    readonly attach?: readonly string[];
    readonly designSystem?: readonly string[];
    readonly none?: boolean;
    readonly autoDecide?: boolean;
    readonly wait?: boolean;
    readonly timeout?: string;
    readonly title?: string;
    readonly off?: boolean;
    readonly file?: readonly string[];
    readonly dir?: string;
    readonly path?: readonly string[];
    readonly out?: string;
    readonly access?: string;
    readonly permission?: string;
    readonly yes?: boolean;
  };

export type FlowCommandSettings = CliSettings &
  BrowserTargetSettings & {
    readonly json?: boolean;
    readonly id?: readonly string[];
    readonly name?: string;
    readonly out?: string;
    readonly yes?: boolean;
    readonly start?: string;
    readonly prompt?: string;
  };
