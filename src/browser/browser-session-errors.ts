export function attachOnlyError(port: number): Error {
  return new Error(
    `No Chrome listening on debug port ${port}. Run \`bridge chrome start\` before using browser automation.`,
  );
}

export function spawnReadyError(port: number): Error {
  return new Error(`Chrome started but debug port ${port} did not become ready.`);
}

export function createAttachFailedError(details: {
  readonly port: number;
  readonly portOwnerProfileRoot: string | null;
  readonly cause: unknown;
}): Error {
  const hasPortOwnerProfile = details.portOwnerProfileRoot != null;
  if (!hasPortOwnerProfile) {
    return new Error(
      `Chrome debug port ${details.port} is open but the bridge could not attach. Run \`bridge status\` to inspect the Chrome owner.`,
      { cause: details.cause },
    );
  }

  return new Error(
    `Chrome debug port ${details.port} is open but the bridge could not attach. The Chrome on that port uses profile ${details.portOwnerProfileRoot}. Run \`bridge status\` to inspect the Chrome owner.`,
    { cause: details.cause },
  );
}

export function writeMyChromeOffError(): Error {
  return new Error(
    "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging, then run the command again and click Allow.",
  );
}

export function writeMyChromeConnectError(cause: unknown): Error {
  const reason = String(cause);
  return new Error(
    `Could not connect to your Chrome. Click Allow when Chrome asks, and keep remote debugging on at chrome://inspect/#remote-debugging. (${reason})`,
  );
}
