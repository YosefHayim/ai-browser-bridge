import type { Page } from "playwright";

interface SessionReply {
  accessToken?: string;
}

export const readChatGptApi = async <ApiReply>(page: Page, apiPath: string): Promise<ApiReply> => {
  const reply = await page.evaluate(async (path: string): Promise<unknown> => {
    const sessionResponse = await fetch("/api/auth/session");
    if (!sessionResponse.ok) {
      throw new Error(`ChatGPT session request failed with HTTP ${sessionResponse.status}`);
    }
    const session = (await sessionResponse.json()) as SessionReply;

    const hasAccessToken = session.accessToken !== undefined;
    if (!hasAccessToken) {
      throw new Error(
        "ChatGPT session has no access token. Sign in to chatgpt.com in the bridge Chrome.",
      );
    }

    const apiResponse = await fetch(path, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!apiResponse.ok) {
      throw new Error(`ChatGPT API request ${path} failed with HTTP ${apiResponse.status}`);
    }
    return apiResponse.json();
  }, apiPath);
  return reply as ApiReply;
};
