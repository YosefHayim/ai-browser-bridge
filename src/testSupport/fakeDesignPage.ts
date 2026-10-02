import type { Page } from "playwright";

export type DesignRpcCall = {
  readonly method: string;
  readonly body: unknown;
  readonly organizationUuid: string;
};

/**
 * A claude.ai/design tab whose in-page fetch is answered by `answerRpc` — the browser
 * boundary every Claude Design RPC crosses. A string answer is sent as the raw body;
 * anything else is JSON-encoded. Every call is recorded in `calls`.
 */
export const fakeDesignPage = (input: {
  readonly status?: number;
  readonly answerRpc: (call: DesignRpcCall) => unknown;
}) => {
  const calls: DesignRpcCall[] = [];
  let status = 200;
  if (input.status !== undefined) status = input.status;
  const page = {
    url: () => "https://claude.ai/design",
    context: () => ({
      cookies: async () => [{ name: "lastActiveOrg", value: "org-1" }],
      pages: (): Page[] => [], // allow-duplicate
    }),
    evaluate: async (_fetchInTab: unknown, request: DesignRpcCall) => {
      const call = {
        method: request.method,
        body: request.body,
        organizationUuid: request.organizationUuid,
      };
      calls.push(call);
      const answer = input.answerRpc(call);
      if (typeof answer === "string") return { status, text: answer };
      return { status, text: JSON.stringify(answer) };
    },
  } as unknown as Page;
  return { page, calls };
};
