import type { Page } from "playwright";

export type DesignRpcCall = {
  readonly method: string;
  readonly body: unknown;
  readonly organizationUuid: string;
};

export const createFakeDesignPage = (details: {
  readonly status?: number;
  readonly answerRpc: (call: DesignRpcCall) => unknown;
}) => {
  const calls: DesignRpcCall[] = [];

  let status = 200;

  const hasStatus = details.status != null;
  if (hasStatus) status = details.status;

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

      const answer = details.answerRpc(call);

      const isAnswerTypeString = typeof answer === "string";
      if (isAnswerTypeString) return { status, text: answer };

      return { status, text: JSON.stringify(answer) };
    },
  } as unknown as Page;
  return { page, calls };
};
