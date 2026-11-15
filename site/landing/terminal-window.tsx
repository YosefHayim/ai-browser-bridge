import type { Child } from "hono/jsx";

const MacLights = () => (
  <span class="tw-lights tw-mac" aria-hidden="true">
    <i class="tw-light tw-light-close" />
    <i class="tw-light tw-light-min" />
    <i class="tw-light tw-light-max" />
  </span>
);

const WindowsControls = () => (
  <span class="tw-controls tw-windows" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <title>window control</title>
      <path d="M0 5h10" stroke="currentColor" stroke-width="1" />
    </svg>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <title>window control</title>
      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1" />
    </svg>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <title>window control</title>
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
    </svg>
  </span>
);

const LinuxControls = () => (
  <span class="tw-buttons tw-linux" aria-hidden="true">
    <i class="tw-round">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <title>window control</title>
        <path d="M1 6h6" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </i>
    <i class="tw-round">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <title>window control</title>
        <rect x="1" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </i>
    <i class="tw-round tw-round-close">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <title>window control</title>
        <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </i>
  </span>
);

interface TerminalWindowProps {
  title: string;
  className?: string;
  children: Child;
}

/**
 * The one frame every terminal on the page uses. It draws all three OS chromes and the page
 * CSS shows the one that matches `data-visitor-os` on the html element. All three are the
 * same height, so switching never moves the page.
 */
export const TerminalWindow = ({ title, className, children }: TerminalWindowProps) => (
  <div class={className ? `card tw ${className}` : "card tw"}>
    <div class="tw-head">
      <MacLights />
      <span class="tw-title">
        <svg class="tw-tab-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <title>terminal</title>
          <path
            d="M2 3l3.5 3L2 9M6.5 9.5h3.5"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="tw-title-text">{title}</span>
      </span>
      <WindowsControls />
      <LinuxControls />
    </div>
    {children}
  </div>
);

/** The shell prompt for each OS. The page CSS shows the one that matches the visitor. */
export const ShellPrompt = () => (
  <span class="prompt">
    <span class="prompt-mac">
      <span class="pr-user">you@mac</span> <span class="pr-path">~</span>{" "}
      <span class="pr-mark">%</span>
    </span>
    <span class="prompt-windows">
      <span class="pr-mark">PS</span> <span class="pr-path">C:\Users\you</span>
      <span class="pr-mark">&gt;</span>
    </span>
    <span class="prompt-linux">
      <span class="pr-user">you@ubuntu</span>
      <span class="pr-mark">:</span>
      <span class="pr-path">~</span>
      <span class="pr-mark">$</span>
    </span>{" "}
  </span>
);
