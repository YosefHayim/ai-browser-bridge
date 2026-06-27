import { execFile } from "node:child_process";

/** Copy text to the macOS clipboard via `pbcopy`. */
export async function copyTextToClipboard(text: string): Promise<void> {
  await new Promise<void>((...args: [() => void, (reason?: unknown) => void]) => {
    runPbcopy({ text, resolve: args[0], reject: args[1] });
  });
}

/** Spawn `pbcopy` and stream text to stdin. */
function runPbcopy(input: { text: string; resolve: () => void; reject: (reason?: unknown) => void }): void {
  const child = execFile("pbcopy", (error) => {
    if (error) input.reject(error);
    else input.resolve();
  });
  child.stdin?.end(input.text);
}
