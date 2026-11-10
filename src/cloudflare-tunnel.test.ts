import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { startCloudflareTunnel } from "./cloudflare-tunnel.ts";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const TUNNEL_URL_LINE = "https://quiet-test-tunnel.trycloudflare.com\n";

const createFakeCloudflared = () => {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startCloudflareTunnel", () => {
  test("stop kills the cloudflared child with SIGTERM", async () => {
    const fakeCloudflared = createFakeCloudflared();
    spawnMock.mockReturnValue(fakeCloudflared);

    const tunnelPromise = startCloudflareTunnel(8765);
    fakeCloudflared.stdout.emit("data", Buffer.from(TUNNEL_URL_LINE));
    const tunnel = await tunnelPromise;
    tunnel.stop();

    expect(tunnel.publicUrl).toBe("https://quiet-test-tunnel.trycloudflare.com");
    expect(fakeCloudflared.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("the bridge process exiting kills the cloudflared child even without stop", async () => {
    const fakeCloudflared = createFakeCloudflared();
    spawnMock.mockReturnValue(fakeCloudflared);
    const processOnSpy = vi.spyOn(process, "on");

    const tunnelPromise = startCloudflareTunnel(8765);
    fakeCloudflared.stdout.emit("data", Buffer.from(TUNNEL_URL_LINE));
    await tunnelPromise;
    const exitListener = processOnSpy.mock.calls.find(([eventName]) => eventName === "exit")?.[1];
    exitListener?.(0);

    expect(fakeCloudflared.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("a tunnel that fails before it has a URL kills its cloudflared child", async () => {
    const fakeCloudflared = createFakeCloudflared();
    spawnMock.mockReturnValue(fakeCloudflared);

    const tunnelPromise = startCloudflareTunnel(8765);
    fakeCloudflared.emit("exit", 1);

    await expect(tunnelPromise).rejects.toThrow("cloudflared exited with code 1");
    expect(fakeCloudflared.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
