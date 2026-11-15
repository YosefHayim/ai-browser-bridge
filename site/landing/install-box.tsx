import { BrandIcon } from "@site/landing/brand-icons.tsx";
import { colorCommand } from "@site/landing/command-colors.tsx";
import { CopyIcon } from "@site/landing/copy-icon.tsx";
import { ShellPrompt, TerminalWindow } from "@site/landing/terminal-window.tsx";
import { GITHUB_URL, readSitePath } from "@site/site-address.ts";

const INSTALL_COMMAND = "npm install -g ai-browser-bridge";

export const InstallBox = () => (
  <TerminalWindow title="install" className="install">
    <div class="install-row">
      <span class="cmd">
        <ShellPrompt />
        {colorCommand(INSTALL_COMMAND)}
      </span>
      <button class="copy" type="button" data-copy={INSTALL_COMMAND} aria-label="Copy">
        <CopyIcon />
      </button>
    </div>
    <div class="install-actions">
      <a class="btn btn-accent" href={readSitePath("docs/usage/")}>
        Read the quick start
      </a>
      <a class="btn btn-ghost" href={GITHUB_URL}>
        <BrandIcon name="github" size={16} />
        View on GitHub
      </a>
    </div>
  </TerminalWindow>
);
