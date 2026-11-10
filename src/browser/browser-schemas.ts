import { z } from "zod";

export const BrowserChoiceSchema = z.enum(["bridge-profile", "my-chrome"]);
export type BrowserChoice = z.infer<typeof BrowserChoiceSchema>;

const ChromeCacheFolderSchema = z.object({
  label: z.string(),
  path: z.string(),
  relativePath: z.string(),
  exists: z.boolean(),
  bytes: z.number(),
  safeToPrune: z.boolean(),
});
export type ChromeCacheFolder = z.infer<typeof ChromeCacheFolderSchema>;

const CacheInventorySchema = z.object({
  profileRoot: z.string(),
  entries: z.array(ChromeCacheFolderSchema),
  reclaimableBytes: z.number(),
});
export type CacheInventory = z.infer<typeof CacheInventorySchema>;

const PruneCacheDetailsSchema = z.object({
  profileRoot: z.string(),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
});
export type PruneCacheDetails = z.infer<typeof PruneCacheDetailsSchema>;

const PruneCacheReportSchema = z.object({
  profileRoot: z.string(),
  dryRun: z.boolean(),
  deletedBytes: z.number(),
  entries: z.array(ChromeCacheFolderSchema),
});
export type PruneCacheReport = z.infer<typeof PruneCacheReportSchema>;

const BrowserStatusSchema = z.object({
  port: z.number(),
  debugPortListening: z.boolean(),
  chromeRunning: z.boolean(),
  userDataDir: z.string().nullable(),
  bridgeProfileRoot: z.string(),
  canAttach: z.boolean(),
  state: z.enum([
    "ready",
    "chrome-not-running",
    "chrome-running-without-debug",
    "debug-port-unverified",
  ]),
  message: z.string(),
});
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>;
