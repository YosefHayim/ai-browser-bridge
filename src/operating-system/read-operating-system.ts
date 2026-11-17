export type OperatingSystem = "macos" | "windows" | "linux";

export function readOperatingSystem(platform: string = process.platform): OperatingSystem {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";

  throw new Error(`ai-browser-bridge does not support the "${platform}" platform.`);
}
