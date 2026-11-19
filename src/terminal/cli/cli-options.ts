import { Command, InvalidArgumentError, Option, type OptionValues } from "commander";
import { DEFAULT_PROVIDER } from "@/app-defaults.ts";
import { PROVIDER_IDS } from "@/provider-settings.ts";
import { SPACE } from "@/terminal/cli/cli-text.ts";

const lowestPort = 1;
const highestPort = 65535;

// Digits only, so "12abc" and "1e3" are not read as numbers.
const wholeNumberPattern = /^\d+$/;

function parseWholeNumber(text: string): number {
  const isWholeNumber = wholeNumberPattern.test(text);
  if (!isWholeNumber) throw new InvalidArgumentError("Expected a whole number.");

  return Number(text);
}

export function parsePositiveInteger(text: string): number {
  const number = parseWholeNumber(text);
  const isZero = number === 0;
  if (isZero) throw new InvalidArgumentError("Expected a whole number above 0.");

  return number;
}

export function parseNonNegativeInteger(text: string): number {
  return parseWholeNumber(text);
}

export function parsePositiveSeconds(text: string): number {
  const seconds = Number(text);
  const isPositiveNumber = text.trim() !== "" && Number.isFinite(seconds) && seconds > 0;
  if (!isPositiveNumber) throw new InvalidArgumentError("Expected a number of seconds above 0.");

  return seconds;
}

export function parsePort(text: string): number {
  const port = parseWholeNumber(text);
  const isPortInRange = port >= lowestPort && port <= highestPort;
  if (!isPortInRange) {
    throw new InvalidArgumentError(`Expected a whole number from ${lowestPort} to ${highestPort}.`);
  }

  return port;
}

export function createRepoOption(description = "Target repository for bridge state"): Option {
  return new Option("-r, --repo <path>", description);
}

export function createPortOption(description = "MCP server port"): Option {
  return new Option("-p, --port <number>", description).argParser(parsePort);
}

export function createDebugPortOption(
  description = "Chrome remote-debugging port to drive (parallel accounts; default 9222)",
): Option {
  return new Option("--debug-port <number>", description).argParser(parsePort);
}

export function createProfileOption(
  description = "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
): Option {
  return new Option("--profile <path>", description);
}

export function createJsonOption(
  description = "Emit JSON instead of human-readable lines",
): Option {
  return new Option("--json", description);
}

// Derived from PROVIDER_IDS so help text cannot go stale.
export function createProviderOption(): Option {
  return new Option("--provider <name>", `Browser provider (default: ${DEFAULT_PROVIDER})`).choices(
    PROVIDER_IDS,
  );
}

export function createPositiveIntegerOption(flags: string, description: string): Option {
  return new Option(flags, description).argParser(parsePositiveInteger);
}

export function createNonNegativeIntegerOption(flags: string, description: string): Option {
  return new Option(flags, description).argParser(parseNonNegativeInteger);
}

export function createSecondsOption(flags: string, description: string): Option {
  return new Option(flags, description).argParser(parsePositiveSeconds);
}

export function createYesOption(description: string): Option {
  return new Option("-y, --yes", description);
}

export function addBrowserTargetOptions(command: Command): Command {
  return command.addOption(createDebugPortOption()).addOption(createProfileOption());
}

export function addBrowserCommandOptions(command: Command): Command {
  return command
    .addOption(createRepoOption())
    .addOption(createPortOption())
    .addOption(createDebugPortOption())
    .addOption(createProfileOption())
    .addOption(createJsonOption());
}

export function addWorkspaceOptions(command: Command): Command {
  return command
    .addOption(createRepoOption())
    .addOption(createPortOption())
    .addOption(createProviderOption())
    .addOption(createDebugPortOption())
    .addOption(createProfileOption())
    .addOption(createJsonOption());
}

// Commander passes the positional words, then the leaf options, then the command itself.
function readActionCommand(actionArguments: readonly unknown[]): Command {
  const lastArgument = actionArguments.at(-1);
  const isCommand = lastArgument instanceof Command;
  if (!isCommand) throw new Error("Commander did not pass the command to the action.");

  return lastArgument;
}

// Commander hoists shared flags to the root; optsWithGlobals merges root and leaf options.
export function runWithSettings<Settings extends OptionValues>(
  run: (settings: Settings) => Promise<void>,
) {
  return function runCommand(...actionArguments: unknown[]): Promise<void> {
    return run(readActionCommand(actionArguments).optsWithGlobals<Settings>());
  };
}

export function runWithWords<Settings extends OptionValues>(
  run: (words: string, settings: Settings) => Promise<void>,
) {
  return function runCommand(...actionArguments: unknown[]): Promise<void> {
    const [words] = actionArguments;
    const command = readActionCommand(actionArguments);

    return run((words as string[]).join(SPACE), command.optsWithGlobals<Settings>());
  };
}
