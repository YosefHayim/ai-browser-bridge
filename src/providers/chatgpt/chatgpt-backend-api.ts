import type { Page } from "playwright";

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

export type ChatGptApiReplyState = "ok" | "rate-limited" | "failed";

const HTTP_TOO_MANY_REQUESTS = 429;

export const readChatGptApiReplyStateFrom = (status: number): ChatGptApiReplyState => {
  const isRateLimited = status === HTTP_TOO_MANY_REQUESTS;
  if (isRateLimited) return "rate-limited";

  const isSuccess = status >= 200 && status < 300;
  if (isSuccess) return "ok";

  return "failed";
};

// Runs the call inside the signed-in chatgpt.com page, so the access token never leaves the page.
export const requestChatGptApi = (
  page: Page,
  apiRequest: ChatGptApiRequest,
): Promise<ChatGptApiReply> => {
  return page.evaluate(async (request: ChatGptApiRequest): Promise<ChatGptApiReply> => {
    const sessionResponse = await fetch("/api/auth/session");
    const isNotSessionOk = !sessionResponse.ok;
    if (isNotSessionOk) {
      throw new Error(`ChatGPT session request failed with HTTP ${sessionResponse.status}`);
    }

    const session = (await sessionResponse.json()) as SessionReply;

    const hasNoAccessToken = session.accessToken === undefined;
    if (hasNoAccessToken) {
      throw new Error(
        "ChatGPT session has no access token. Sign in to chatgpt.com in the bridge Chrome.",
      );
    }

    const hasBody = request.body !== undefined;
    const apiResponse = await fetch(request.apiPath, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
    return { status: apiResponse.status, bodyText: await apiResponse.text() };
  }, apiRequest);
};

export const readChatGptApi = async <ApiReply>(page: Page, apiPath: string): Promise<ApiReply> => {
  const reply = await requestChatGptApi(page, { method: "GET", apiPath });

  const isNotReplyOk = readChatGptApiReplyStateFrom(reply.status) !== "ok";
  if (isNotReplyOk) {
    throw new Error(`ChatGPT API request ${apiPath} failed with HTTP ${reply.status}`);
  }

  return JSON.parse(reply.bodyText) as ApiReply;
};
