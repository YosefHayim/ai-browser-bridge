import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readChatGptApi, readChatGptApiReplyStatus } from "./chatgpt-backend-api.ts";

const createFakePage = (): Page => {
  return {
    evaluate: async (pageFunction: (argument: unknown) => Promise<unknown>, argument: unknown) =>
      pageFunction(argument),
  } as unknown as Page;
};

const stubChatGptApi = (apiReply: Response): void => {
  vi.stubGlobal("fetch", async (requestPath: string) => {
    const isSessionRequest = requestPath === "/api/auth/session";
    if (isSessionRequest) return Response.json({ accessToken: "test-access-token" });

    return apiReply;
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readChatGptApiReplyStatus", () => {
  it("reads a 2xx status as ok", () => {
    expect(readChatGptApiReplyStatus(200)).toBe("ok");
    expect(readChatGptApiReplyStatus(204)).toBe("ok");
  });

  it("reads HTTP 429 as rate-limited", () => {
    expect(readChatGptApiReplyStatus(429)).toBe("rate-limited");
  });

  it("reads any other status as failed", () => {
    expect(readChatGptApiReplyStatus(404)).toBe("failed");
    expect(readChatGptApiReplyStatus(500)).toBe("failed");
  });
});

describe("readChatGptApi", () => {
  it("returns the parsed JSON of a successful reply", async () => {
    stubChatGptApi(Response.json({ items: [] }));

    const reply = await readChatGptApi<{ items: unknown[] }>(
      createFakePage(),
      "/backend-api/fixture",
    );

    expect(reply).toEqual({ items: [] });
  });

  it("throws with the HTTP status when the reply is rate-limited", async () => {
    stubChatGptApi(new Response("{}", { status: 429 }));

    await expect(readChatGptApi(createFakePage(), "/backend-api/fixture")).rejects.toThrow(
      "/backend-api/fixture failed with HTTP 429",
    );
  });
});
