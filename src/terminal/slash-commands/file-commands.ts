import type { Page } from "playwright";
import type { Attachment } from "@/domain/attachment-types.ts";
import type { CommandDef, CommandSession } from "@/domain/command-types.ts";
import { downloadAll, downloadAttachment, loadManifest } from "@/providers/chatgpt/chatgpt-page.ts";
import { readDownloadsDirectory } from "@/store/paths.ts";
import { readConversationIdFromPage, readCurrentPage } from "@/terminal/engine-session.ts";
import { splitArgumentList } from "@/terminal/split-argument-list.ts";

const printAttachmentTable = (attachments: Attachment[]): void => {
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
      attachment.filename == null ? "" : attachment.filename,
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(tableLines);
  for (const cells of tableLines) {
    console.log(createTableLine({ row: cells, widths }));
  }
};

const computeColumnWidths = (tableLines: string[][]): number[] => {
  const header = tableLines[0];

  const isHeaderMissing = header == null;
  if (isHeaderMissing) return [];

  return header.map((...argumentList: [string, number]) =>
    readMaxColumnLength({ rows: tableLines, column: argumentList[1] }),
  );
};

const readMaxColumnLength = (details: { rows: string[][]; column: number }): number => {
  return Math.max(
    ...details.rows.map((cells) => {
      const cell = cells[details.column];

      const isCellMissing = cell == null;
      if (isCellMissing) return 0;

      return cell.length;
    }),
  );
};

const createTableLine = (details: { row: string[]; widths: number[] }): string => {
  return details.row
    .map((...argumentList: [string, number]) =>
      padTableCell({ cell: argumentList[0], column: argumentList[1], widths: details.widths }),
    )
    .join("  ");
};

const padTableCell = (details: { cell: string; column: number; widths: number[] }): string => {
  const width = details.widths[details.column];

  const isWidthMissing = width == null;
  if (isWidthMissing) return details.cell;

  return details.cell.padEnd(width);
};

const parseOutDir = (argumentList: string[]): string | undefined => {
  const outIndex = argumentList.indexOf("--out");

  const isOutMarkerNotFound = outIndex === -1;
  if (isOutMarkerNotFound) return undefined;

  return argumentList[outIndex + 1];
};

const printError = (message: string): void => {
  console.error(`${"\u001b[31m"}${message}${"\u001b[0m"}`);
};

type FilesDownloadDetails = {
  page: Page;
  conversationId: string;
  parts: string[];
  manifestIds: string[];
  repoRoot: string;
};

const downloadFilesCommand = async (details: FilesDownloadDetails): Promise<void> => {
  const outDir = parseOutDir(details.parts.slice(2));

  if (details.parts[1] === "all") {
    const reports = await downloadAll(details.page, details.conversationId, {
      repoRoot: details.repoRoot,
      manifestRoot: readDownloadsDirectory(details.repoRoot),
      ...(outDir ? { outDir } : {}),
    });
    printBulkDownloadReports(reports);
    return;
  }

  await downloadOneAttachment({ input: details, outDir });
};

const downloadOneAttachment = async (details: {
  input: FilesDownloadDetails;
  outDir: string | undefined;
}): Promise<void> => {
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

  const downloaded = await downloadAttachment({
    page: details.input.page,
    conversationId: details.input.conversationId,
    id,
    settings: {
      repoRoot: details.input.repoRoot,
      manifestRoot: readDownloadsDirectory(details.input.repoRoot),
      ...(details.outDir ? { outDir: details.outDir } : {}),
    },
  });
  console.log(downloaded.path);
};

const printBulkDownloadReports = (
  reports: ReadonlyArray<{ id: string; path: string; bytes: number; error?: string }>,
): void => {
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
};

export const filesCommand: CommandDef = {
  name: "files",
  description: "List or download ChatGPT conversation attachments",
  handler: (...argumentList: [string, CommandSession]) =>
    runRouteFilesCommand({ args: argumentList[0], ctx: argumentList[1] }),
};

const runRouteFilesCommand = async (details: {
  args: string;
  ctx: CommandSession;
}): Promise<void> => {
  const scope = await loadFilesScope(details);
  const parts = splitArgumentList(details.args);

  const isPartsEmpty = parts.length === 0;
  if (isPartsEmpty) return printAttachmentTable(scope.manifest.attachments);

  await runRouteFilesDownload({ parts, context: scope });
};

const loadFilesScope = async (details: { args: string; ctx: CommandSession }) => {
  const page = readCurrentPage(details.ctx);
  const conversationId = page ? readConversationIdFromPage(page) : "current";
  const manifest = await loadManifest(conversationId, {
    manifestRoot: readDownloadsDirectory(details.ctx.config.repoPath),
  });

  return { page, conversationId, manifest, repoRoot: details.ctx.config.repoPath };
};

const runRouteFilesDownload = async (details: {
  parts: string[];
  context: {
    page: Page | null;
    conversationId: string;
    manifest: Awaited<ReturnType<typeof loadManifest>>;
    repoRoot: string;
  };
}): Promise<void> => {
  if (details.parts[0] !== "get")
    return console.log("Usage: /files [get <id>|get all [--out <dir>]]");

  if (!details.parts[1])
    return console.log("Usage: /files get <id> or /files get all [--out <dir>]");

  if (details.context.page == null) {
    printError("Browser not connected. Cannot download attachments.");
    return;
  }

  await downloadFilesCommand({
    page: details.context.page,
    conversationId: details.context.conversationId,
    parts: details.parts,
    manifestIds: details.context.manifest.attachments.map((element) => element.id),
    repoRoot: details.context.repoRoot,
  });
};
