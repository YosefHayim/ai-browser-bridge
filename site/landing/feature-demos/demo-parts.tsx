import { colorCommand } from "@site/landing/command-colors.tsx";
import type { Child } from "hono/jsx";

interface BeatWindow {
  "data-at": string;
  "data-until"?: string;
  "data-shown"?: string;
}

/**
 * Marks an element as visible from beat `start` up to (not including) beat `end`.
 * An element with no `end` is still visible in the settled final frame, so the
 * server renders it already shown; the script takes over once the card plays.
 */
export function shownFrom(start: number, end?: number): BeatWindow {
  const isOpenEnded = end == null;
  if (isOpenEnded) return { "data-at": String(start), "data-shown": "" };

  return { "data-at": String(start), "data-until": String(end) };
}

interface DemoCardProps {
  title: string;
  text: string;
  cardIndex: number;
  loopMs: number;
  beatTimesMs: number[];
  isWide?: boolean;
  children: Child;
}

export function DemoCard({
  title,
  text,
  cardIndex,
  loopMs,
  beatTimesMs,
  isWide,
  children,
}: DemoCardProps) {
  return (
    <article
      class={isWide ? "fd-card fd-card-wide" : "fd-card"}
      data-demo=""
      data-loop-ms={String(loopMs)}
      data-beat-times={beatTimesMs.join(",")}
      style={`--card-index:${cardIndex}`}
    >
      <div class="fd-copy">
        <h3 class="h3">{title}</h3>
        <p>{text}</p>
      </div>
      <div class="fd-stage" aria-hidden="true">
        {children}
      </div>
    </article>
  );
}

interface DemoWindowProps {
  label: string;
  children: Child;
}

export function DemoWindow({ label, children }: DemoWindowProps) {
  return (
    <div class="card fd-window">
      <div class="card-head">
        <i class="dot" />
        <i class="dot" />
        <i class="dot" />
        <span class="label" style="margin-left:8px">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

interface TypedTextProps {
  beat: number;
  durationMs: number;
  text: string;
  className?: string;
  isCommand?: boolean;
}

/** Text that types itself out, one character per step, when its beat arrives. */
export function TypedText({ beat, durationMs, text, className, isCommand }: TypedTextProps) {
  return (
    <span
      class={className ? `fd-type ${className}` : "fd-type"}
      style={`--chars:${text.length};--type-ms:${durationMs}ms`}
      {...shownFrom(beat)}
    >
      {isCommand ? colorCommand(text) : text}
    </span>
  );
}
