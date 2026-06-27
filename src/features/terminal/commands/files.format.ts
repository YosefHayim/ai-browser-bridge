import type { Attachment } from "../../domain/types.ts";

/** Print a formatted attachment table to stdout. */
export function printAttachmentTable(attachments: Attachment[]): void {
  if (attachments.length === 0) {
    console.log("No attachments captured in this conversation yet.");
    return;
  }
  const rows = [
    ["id", "role", "kind", "filename", "message"],
    ...attachments.map((attachment) => [
      attachment.id,
      attachment.role,
      attachment.kind,
      attachment.filename ?? "",
      String(attachment.messageIndex),
    ]),
  ];
  const widths = computeColumnWidths(rows);
  for (const row of rows) {
    console.log(formatTableRow({ row, widths }));
  }
}

/** Compute max column widths for a table row matrix. */
function computeColumnWidths(rows: string[][]): number[] {
  return rows[0].map((...args: [string, number]) =>
    maxColumnLength({ rows, column: args[1] }));
}

/** Return the longest cell length in one column. */
function maxColumnLength(input: { rows: string[][]; column: number }): number {
  return Math.max(...input.rows.map((row) => row[input.column].length));
}

/** Format one table row with padded cells. */
function formatTableRow(input: { row: string[]; widths: number[] }): string {
  return input.row.map((...args: [string, number]) =>
    padTableCell({ cell: args[0], column: args[1], widths: input.widths })).join("  ");
}

/** Pad one table cell to its column width. */
function padTableCell(input: { cell: string; column: number; widths: number[] }): string {
  return input.cell.padEnd(input.widths[input.column]);
}

/** Split slash-command args respecting quotes. */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (const char of input.trim()) {
    const next = consumeSplitChar({ char, quote, current, args });
    current = next.current;
    quote = next.quote;
  }
  return finalizeSplitArgs({ current, args });
}

/** Push trailing token when arg splitting finishes. */
function finalizeSplitArgs(input: { current: string; args: string[] }): string[] {
  if (input.current) input.args.push(input.current);
  return input.args;
}

function consumeSplitChar(input: {
  char: string;
  quote: "'" | '"' | null;
  current: string;
  args: string[];
}): { current: string; quote: "'" | '"' | null } {
  if ((input.char === "'" || input.char === '"') && input.quote === null) {
    return { current: input.current, quote: input.char };
  }
  if (input.char === input.quote) return { current: input.current, quote: null };
  if (/\s/.test(input.char) && input.quote === null) {
    if (input.current) input.args.push(input.current);
    return { current: "", quote: input.quote };
  }
  return { current: input.current + input.char, quote: input.quote };
}
