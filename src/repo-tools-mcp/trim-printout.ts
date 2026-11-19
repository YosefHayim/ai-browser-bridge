const defaultPrintoutLimit = 20_000;

export function trimPrintout(printout: string, limit = defaultPrintoutLimit): string {
  const isLengthAtMostLimit = printout.length <= limit;
  if (isLengthAtMostLimit) return printout;

  return `${printout.slice(0, limit)}\n\n[trimmed: output exceeded ${limit} chars]`;
}
