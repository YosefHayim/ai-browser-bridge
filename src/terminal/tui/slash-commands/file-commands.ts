import type { Page } from "playwright";
import type { Attachment } from "@/attachment-types.ts";
import type { CommandDef, CommandSession } from "@/command-types.ts";
import { downloadAll, downloadAttachment } from "@/providers/chatgpt/page/attachment-downloader.ts";
import { loadManifest } from "@/providers/chatgpt/page/attachment-manifest.ts";
import { readDownloadsDirectory } from "@/repo-files/paths.ts";
import { readConversationIdFromPage, readCurrentPage } from "@/terminal/cli/engine-session.ts";
import { splitArgumentList } from "@/terminal/cli/split-argument-list.ts";

function printAttachmentTable(attachments: Attachment[]): void {
  const isAttachmentsEmpty = attachments.length === 0;
  if (isAttachmentsEmpty) {
    console.log("No attachments captured in this conversation yet.");
    return;
  }

  const tableLines = [
    ["id", "role", "kind", "filename", "message"],
    ...attachments.map((attachment) => [
      attachment.id,
      attachment.role,
      attachment.kind,
      attachment.filename ?? "",
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(tableLines);
  for (const cells of tableLines) {
    console.log(createTableLine({ row: cells, widths }));
  }
}

function computeColumnWidths(tableLines: string[][]): number[] {
  const header = tableLines[0];

  const isHeaderMissing = header == null;
  if (isHeaderMissing) return [];

  return header.map((...argumentList: [string, number]) =>
    readMaxColumnLength({ rows: tableLines, column: argumentList[1] }),
  );
}

function readMaxColumnLength(details: { rows: string[][]; column: number }): number {
  return Math.max(
    ...details.rows.map((cells) => {
      const cell = cells[details.column];

      const isCellMissing = cell == null;
      if (isCellMissing) return 0;

      return cell.length;
    }),
  );
}

function createTableLine(details: { row: string[]; widths: number[] }): string {
  return details.row
    .map((...argumentList: [string, number]) =>
      padTableCell({ cell: argumentList[0], column: argumentList[1], widths: details.widths }),
    )
    .join("  ");
}

function padTableCell(details: { cell: string; column: number; widths: number[] }): string {
  const width = details.widths[details.column];

  const isWidthMissing = width == null;
  if (isWidthMissing) return details.cell;

  return details.cell.padEnd(width);
}

function parseOutDir(argumentList: string[]): string | undefined {
  const outIndex = argumentList.indexOf("--out");

  const isOutMarkerNotFound = outIndex === -1;
  if (isOutMarkerNotFound) return undefined;

  return argumentList[outIndex + 1];
}

function printError(message: string): void {
  console.error(`${"\u001b[31m"}${message}${"\u001b[0m"}`);
}

type FilesDownloadDetails = {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
  repoRoot: string;
};

async function downloadFilesCommand(details: FilesDownloadDetails): Promise<void> {
  const flagsStartIndex = 2;

  const outDir = parseOutDir(details.parts.slice(flagsStartIndex));

  const isAllRequested = details.parts[1] === "all";

  if (isAllRequested) {
    const isOutDirFound = outDir != null && outDir !== "";
    const reports = await downloadAll(details.page, details.conversationId, {
      repoRoot: details.repoRoot,
      manifestRoot: readDownloadsDirectory(details.repoRoot),
      ...(isOutDirFound ? { outDir } : {}),
    });
    printBulkDownloadReports(reports);
    return;
  }

  await downloadOneAttachment({ input: details, outDir });
}

async function downloadOneAttachment(details: {
  input: FilesDownloadDetails;
  outDir: string | undefined;
}): Promise<void> {
  const id = details.input.parts[1];

  const isIdBlank = id == null || id === "";
  if (isIdBlank) {
    printError("Usage: download <attachment-id>");
    return;
  }

  const isNotIdInManifestIds = !details.input.manifestIds.includes(id);
  if (isNotIdInManifestIds) {
    printError(`No attachment with id "${id}".`);
    return;
  }

  const isOutDirFound = details.outDir != null && details.outDir !== "";
  const downloaded = await downloadAttachment({
    page: details.input.page,
    conversationId: details.input.conversationId,
    id,
    settings: {
      repoRoot: details.input.repoRoot,
      manifestRoot: readDownloadsDirectory(details.input.repoRoot),
      ...(isOutDirFound ? { outDir: details.outDir } : {}),
    },
  });
  console.log(downloaded.path);
}

function printBulkDownloadReports(
  reports: ReadonlyArray<{ id: string; path: string; bytes: number; error?: string }>,
): void {
  const succeeded = reports.filter((element) => element.error == null).length;
  const failed = reports.length - succeeded;
  let summary = `Downloaded ${succeeded}/${reports.length} attachments`;

  const hasFailures = failed > 0;
  if (hasFailures) summary = `${summary} (${failed} failed)`;

  console.log(`${summary}.`);
  for (const element of reports) {
    const isElementFailed = element.error != null;
    if (isElementFailed) {
      printError(`${element.id}: ${element.error}`);
      continue;
    }

    console.log(`${element.id} -> ${element.path} (${element.bytes} bytes)`);
  }
}

export const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...argumentList: [string, CommandSession]) =>
    runRouteFilesCommand({ args: argumentList[0], commandSession: argumentList[1] }),
};

async function runRouteFilesCommand(details: {
  args: string;
  commandSession: CommandSession;
}): Promise<void> {
  const scope = await loadFilesScope(details);
  const parts = splitArgumentList(details.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) return printAttachmentTable(scope.manifest.attachments);

  await runRouteFilesDownload({ parts, context: scope });
}

async function loadFilesScope(details: { args: string; commandSession: CommandSession }) {
  const page = readCurrentPage(details.commandSession);
  const isPageFound = page != null;
  const conversationId = isPageFound ? readConversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId, {
    manifestRoot: readDownloadsDirectory(details.commandSession.bridgeSettings.repoPath),
  });

  return {
    page,
    conversationId,
    manifest,
    repoRoot: details.commandSession.bridgeSettings.repoPath,
  };
}

async function runRouteFilesDownload(details: {
  parts: string[];
  context: {
    page: Page | null;
    conversationId: string;
    manifest: Awaited<ReturnType<typeof loadManifest>>;
    repoRoot: string;
  };
}): Promise<void> {
  const isNotGetCommand = details.parts[0] !== "get";
  if (isNotGetCommand) return console.log("Usage: /files [get <id>|get all [--out <dir>]]");

  const isIdMissing = !details.parts[1];
  if (isIdMissing) return console.log("Usage: /files get <id> or /files get all [--out <dir>]");

  const { page } = details.context;
  const isPageMissing = page == null;
  if (isPageMissing) {
    printError("Browser not connected. Cannot download attachments.");
    return;
  }

  await downloadFilesCommand({
    page,
    conversationId: details.context.conversationId,
    parts: details.parts,
    manifestIds: details.context.manifest.attachments.map((element) => element.id),
    repoRoot: details.context.repoRoot,
  });
}
