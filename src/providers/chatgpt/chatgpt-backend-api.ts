import type { Page } from "playwright";

const OK_STATUS = "ok";

interface SessionReply {
  accessToken?: string;
}

export interface ChatGptApiRequest {
  method: "GET" | "PATCH";
  apiPath: string;
  body?: unknown;
}

export interface ChatGptApiReply {
  status: number;
  bodyText: string;
}

export type ChatGptApiReplyStatus = "ok" | "rate-limited" | "failed";

const HTTP_TOO_MANY_REQUESTS = 429;

export const readChatGptApiReplyStatus = (status: number): ChatGptApiReplyStatus => {
  const isRateLimited = status === HTTP_TOO_MANY_REQUESTS;
  if (isRateLimited) return "rate-limited";

  const firstNonSuccessStatus = 300;

  const firstSuccessStatus = 200;

  const isSuccess = status >= firstSuccessStatus && status < firstNonSuccessStatus;
  if (isSuccess) return OK_STATUS;

  return "failed";
};

// Runs the call inside the signed-in chatgpt.com page, so the access token never leaves the page.
export const requestChatGptApi = (
  page: Page,
  apiRequest: ChatGptApiRequest,
): Promise<ChatGptApiReply> => {
  return page.evaluate(async (request: ChatGptApiRequest): Promise<ChatGptApiReply> => {
    const sessionReply = await fetch("/api/auth/session");
    const isNotSessionOk = !sessionReply.ok;
    if (isNotSessionOk) {
      throw new Error(`ChatGPT session request failed with HTTP ${sessionReply.status}`);
    }

    const session = (await sessionReply.json()) as SessionReply;

    const hasNoAccessToken = session.accessToken == null;
    if (hasNoAccessToken) {
      throw new Error(
        "ChatGPT session has no access token. Sign in to chatgpt.com in the bridge Chrome.",
      );
    }

    const hasFields = request.body !== undefined;
    const apiReply = await fetch(request.apiPath, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(hasFields ? { "Content-Type": "application/json" } : {}),
      },
      body: hasFields ? JSON.stringify(request.body) : undefined,
    });
    return { status: apiReply.status, bodyText: await apiReply.text() };
  }, apiRequest);
};

export const readChatGptApi = async <ApiReply>(page: Page, apiPath: string): Promise<ApiReply> => {
  const reply = await requestChatGptApi(page, { method: "GET", apiPath });

  const isNotReplyOk = readChatGptApiReplyStatus(reply.status) !== OK_STATUS;
  if (isNotReplyOk) {
    throw new Error(`ChatGPT API request ${apiPath} failed with HTTP ${reply.status}`);
  }

  return JSON.parse(reply.bodyText) as ApiReply;
};
