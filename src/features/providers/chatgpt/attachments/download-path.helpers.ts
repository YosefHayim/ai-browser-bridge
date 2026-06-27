import path from "node:path";
import { AttachmentDownloadError } from "./download-attachment.types.ts";

interface OutputDirectoryInput {
  /** Conversation id used for the default downloads folder. */
  conversationId: string;
  /** Optional explicit output directory. */
  outDir?: string;
}

/** Resolve the output directory for attachment downloads. */
export function outputDirectory(input: OutputDirectoryInput): string {
  if (input.outDir) return path.resolve(input.outDir);
  return path.resolve(process.cwd(), "downloads", input.conversationId);
}

interface OutputPathInput {
  /** Resolved output directory. */
  outDir: string;
  /** Filename relative to the output directory. */
  filename: string;
}

/** Build a safe absolute output path inside the output directory. */
export function outputPath(input: OutputPathInput): string {
  const resolvedOutDir = path.resolve(input.outDir);
  const filePath = path.resolve(resolvedOutDir, input.filename);
  const relativePath = path.relative(resolvedOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AttachmentDownloadError("", undefined, `Invalid attachment output path: ${input.filename}`);
  }
  return filePath;
}

/** Whether a URL uses HTTP or HTTPS. */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

interface DisambiguateInput {
  /** Original filename that collided. */
  filename: string;
  /** Attachment id appended to disambiguate. */
  id: string;
}

/** Append an attachment id before the extension to avoid filename collisions. */
export function disambiguateFilename(input: DisambiguateInput): string {
  const extension = path.extname(input.filename);
  if (!extension) return `${input.filename}-${input.id}`;
  return `${input.filename.slice(0, -extension.length)}-${input.id}${extension}`;
}
