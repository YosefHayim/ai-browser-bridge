import { CopyIcon } from "@site/landing/copy-icon.tsx";
import { GITHUB_URL, readSitePath } from "@site/site-address.ts";

const INSTALL_COMMAND = "npm install -g ai-browser-bridge";

export const InstallBox = () => (
  <div class="install">
    <div class="install-row">
      <span class="dollar">$</span>
      <span class="cmd">{INSTALL_COMMAND}</span>
      <button
        class="copy"
        type="button"
        data-copy={INSTALL_COMMAND}
        aria-label="Copy install command"
      >
        <CopyIcon />
      </button>
    </div>
    <div class="install-actions">
      <a class="btn btn-accent" href={readSitePath("docs/usage/")}>
        Read the quick start
      </a>
      <a class="btn btn-ghost" href={GITHUB_URL}>
        View on GitHub
      </a>
    </div>
  </div>
);
