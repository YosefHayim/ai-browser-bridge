import { describe, expect, it } from "vitest";
import { launchChrome } from "@/operating-system/launch-chrome.ts";

const createFakeSpawn = () => {
  const calls: { command: string; argumentList: string[] }[] = [];
  let unrefCount = 0;
  const spawnProcess = (command: string, argumentList: string[]) => {
    calls.push({ command, argumentList });
    return {
      unref: () => {
        unrefCount += 1;
      },
    };
  };
  return { calls, spawnProcess, readUnrefCount: () => unrefCount };
};

describe("launchChrome", () => {
  it("opens the app with open -na on macos", () => {
    const fakeSpawn = createFakeSpawn();

    launchChrome({
      operatingSystem: "macos",
      args: ["--a", "https://x.test"],
      spawnProcess: fakeSpawn.spawnProcess,
    });

    const [call] = fakeSpawn.calls;
    expect(fakeSpawn.calls).toHaveLength(1);
    expect(call?.command).toBe("open");
    expect(call?.argumentList.slice(0, 2)).toEqual(["-na", expect.any(String)]);
    expect(call?.argumentList.slice(2)).toEqual(["--args", "--a", "https://x.test"]);
    expect(fakeSpawn.readUnrefCount()).toBe(1);
  });

  it("starts the executable directly on windows and linux", () => {
    for (const operatingSystem of ["windows", "linux"] as const) {
      const fakeSpawn = createFakeSpawn();

      launchChrome({
        operatingSystem,
        args: ["--a"],
        spawnProcess: fakeSpawn.spawnProcess,
        findChromePath: () => "/path/to/chrome",
      });

      expect(fakeSpawn.calls).toEqual([{ command: "/path/to/chrome", argumentList: ["--a"] }]);
      expect(fakeSpawn.readUnrefCount()).toBe(1);
    }
  });
});
