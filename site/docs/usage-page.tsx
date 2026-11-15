import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";
import { createDocsNavGroups } from "@site/docs/docs-nav-groups.ts";
import { DocsPageLayout } from "@site/page/docs-page-layout.tsx";
import type { SiteData } from "@site/site-data.ts";

interface UsagePageProps {
  siteData: SiteData;
}

const INSTALL_CODE = `git clone https://github.com/YosefHayim/ai-browser-bridge.git
cd ai-browser-bridge
pnpm install
pnpm build`;

const CHATGPT_CODE = `node dist/bridge.js chrome start
node dist/bridge.js --repo /path/to/your/project
node dist/bridge.js --debug-port 9223 --profile /path/to/chrome-profile`;

const GEMINI_CODE = `node dist/bridge.js chrome start --provider gemini
node dist/bridge.js --provider gemini --repo /path/to/your/project`;

const CHROME_APP_CODE = `AI_BROWSER_BRIDGE_CHROME_APP="Google Chrome for Testing" bridge chrome start`;

const OWN_CHROME_CODE = `export AI_BROWSER_BRIDGE_BROWSER=my-chrome`;

const ONE_SHOT_CODE = `node dist/bridge.js ask "summarize @src/core/engine.ts" --repo /path/to/project
node dist/bridge.js ask "hello" --provider gemini --repo /path/to/project`;

const COMMANDS_CODE = `/help             list commands              /sessions         list local sessions
/resume <query>   resume by number/title/id  /transcript       print the session transcript
/new              start a new conversation   /export           export transcript (md/json/jsonl)
/model [name]     show or switch the model    /permissions      show or switch MCP permission mode
/rewind [text]    edit last prompt + regen   /checkpoints      list file checkpoints
/stop             stop the active response   /restore <id>     restore files from a checkpoint
/context          model-aware context est.   /status           repo/model/context/session status
/diff             ask ChatGPT to read diff   /mcp              connector + exposed tools
/task <request>   project-agent task (MCP)   /connector        (re)run MCP connector setup
/conversations    list/search/open browser conversations`;

const MENTIONS_CODE = `refactor the CLI input flow in @src/terminal/tui/shell/app.tsx
compare @src/store/file-mentions.ts with @src/store/file-mentions.test.ts`;

const PLAN_CODE = `[
  { "conversation": "11111111-1111-4111-8111-111111111111", "project": "Yoga App" },
  { "conversation": "22222222-2222-4222-8222-222222222222", "project": "Invoices & Purchases" }
]`;

const ORGANIZE_CODE = `bridge chat organize --plan @organization-plan.json --dry-run
bridge chat organize --plan @organization-plan.json \\
  --interval 60 --cooldown 600 --max-attempts 4

# No plan argument is needed after the queue exists
bridge chat organize status
bridge chat organize pause
bridge chat organize resume`;

export const UsagePage = ({ siteData }: UsagePageProps) => (
  <DocsPageLayout navGroups={createDocsNavGroups(siteData, "docs/usage/")} heading="Usage">
    <DocsSection title="Prerequisites">
      <ul>
        <li>
          <strong>macOS</strong>: Chrome is launched with the macOS <code>open</code> command, and
          clipboard/process helpers use <code>pbcopy</code>/<code>lsof</code>.
        </li>
        <li>
          <strong>Node.js 22 or newer</strong> and <strong>pnpm</strong> (the repo pins{" "}
          <code>pnpm@10.14.0</code>).
        </li>
        <li>
          <strong>Google Chrome or Chrome for Testing</strong>: the bridge drives one shared bridge
          profile through a debug port. Sign in once in that bridge-launched window; every repo
          reuses it.
        </li>
        <li>
          <strong>
            <code>cloudflared</code>
          </strong>{" "}
          (optional; ChatGPT, Claude, Grok): only needed for those providers to call local MCP
          tools. Without it the TUI still runs. Install with <code>brew install cloudflared</code>.
        </li>
      </ul>
    </DocsSection>
    <DocsSection title="Install and build">
      <CodeBlock code={INSTALL_CODE} />
      <p>
        Install the published CLI with <code>npm install -g ai-browser-bridge</code>; it also
        installs <code>SKILL.md</code>. From a source checkout, run{" "}
        <code>pnpm build && pnpm link --global</code> to get the <code>bridge</code> command, then
        use <code>bridge</code>, <code>bridge chrome start</code>, <code>bridge ask "..."</code>,
        and so on.
      </p>
    </DocsSection>
    <DocsSection title="Start Chrome, then run (ChatGPT, the default)">
      <CodeBlock code={CHATGPT_CODE} />
    </DocsSection>
    <DocsSection title="Start Chrome, then run (Gemini web)">
      <CodeBlock code={GEMINI_CODE} />
    </DocsSection>
    <DocsSection title="One-shot, non-interactive">
      <CodeBlock code={ONE_SHOT_CODE} />
    </DocsSection>
    <DocsSection title="Browser profile policy">
      <p>
        Chrome 136+ no longer accepts remote debugging switches against the real default Chrome data
        directory. ai-browser-bridge therefore never launches Chrome on{" "}
        <code>~/Library/Application Support/Google/Chrome</code>. By default it launches the browser
        on the debug port with one global bridge profile:
      </p>
      <CodeBlock code="~/.ai-browser-bridge/chrome-profile" />
      <p>
        That profile is the browser-login SSOT for the bridge. Sign in once in the bridge-launched
        Chrome window, then <code>bridge chrome start</code>, <code>bridge ask</code>, and the TUI
        reuse that login from any repo or shell root.
      </p>
      <p>
        For release and automation work, Chrome's team recommends{" "}
        <a href="https://developer.chrome.com/blog/chrome-for-testing">Chrome for Testing</a>.
        Install it separately, then point the bridge at that app while keeping the same shared
        profile:
      </p>
      <CodeBlock code={CHROME_APP_CODE} />
      <p>
        The app override changes only which Chrome build is launched. The profile remains{" "}
        <code>~/.ai-browser-bridge/chrome-profile</code>; do not add per-repo Chrome profiles. See
        Chrome's{" "}
        <a href="https://developer.chrome.com/blog/remote-debugging-port">
          remote-debugging profile change
        </a>{" "}
        for the upstream reason.
      </p>
    </DocsSection>
    <DocsSection title="Use your own Chrome instead">
      <p>
        Chrome 144+ can share your everyday Chrome with local tools: open{" "}
        <code>chrome://inspect/#remote-debugging</code> and turn remote debugging on (
        <a href="https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect">
          Chrome guide
        </a>
        ). Then choose it:
      </p>
      <CodeBlock code={OWN_CHROME_CODE} />
      <p>
        The bridge then never launches or quits Chrome. Each command connects to your running
        Chrome, opens its own tab, and closes that tab when it ends; it never types into a tab you
        opened. Chrome asks you to click <strong>Allow</strong> each time a command connects.{" "}
        <code>bridge stop</code> only ever closes a Chrome the bridge launched, and fan-out tasks
        with <code>isolate</code> still use their own isolated profile.
      </p>
    </DocsSection>
    <DocsSection title="Interactive commands">
      <CodeBlock code={COMMANDS_CODE} />
    </DocsSection>
    <DocsSection title="File mentions">
      <p>
        Reference repo files inline; they are resolved inside the repo and expanded before ChatGPT
        sees them:
      </p>
      <CodeBlock code={MENTIONS_CODE} />
      <p>
        Paths that escape the repo root are skipped; files over 100 KB are summarized rather than
        inlined.
      </p>
    </DocsSection>
    <DocsSection title="Conversation search">
      <p>
        <code>bridge chat search "query" --json</code> opens ChatGPT's Search UI, selects Chats, and
        returns matching Conversations across titles and message content. It scrolls the result
        overlay up to <code>--limit</code>; add <code>--open</code> to navigate the browser to the
        best match.
      </p>
    </DocsSection>
    <DocsSection title="Rate-safe Project organization">
      <p>
        Prepare one ordered plan with Conversations for any number of Projects (Conversation ids are
        preferred because they can be verified exactly):
      </p>
      <CodeBlock code={PLAN_CODE} />
      <p>Then validate it and start the autonomous queue:</p>
      <CodeBlock code={ORGANIZE_CODE} />
      <p>
        The queue verifies every move from ChatGPT's loaded Project label, with the destination
        Project page as a fallback. Adaptive pacing starts from <code>--interval 60</code> with
        jitter. After three successful moves it reduces the base interval by 20%, down to{" "}
        <code>--min-interval 15</code>; a ChatGPT "Too many requests" response increases the base
        interval by 50%, up to <code>--max-interval 180</code>, and waits for the{" "}
        <code>--cooldown 600</code>. The learned pace is persisted across pause/resume. Pass{" "}
        <code>--no-adaptive</code> for the old fixed/random interval behavior.
      </p>
      <p>
        <code>bridge chat organize pause</code> writes a persisted pause request; an active queue
        finishes only its current UI operation, notices the request within one second of a delay,
        and releases its lock. <code>bridge chat organize resume</code> selects the latest queue,
        clears the pause marker, and reconstructs the original plan from persisted state. Use{" "}
        <code>--queue &lt;fingerprintOrPath&gt;</code> when more than one queue exists.
      </p>
      <p>
        Rate limits and closed browser sessions do not consume move attempts. When pending work
        reaches zero, the queue automatically runs the orphan scanner to the stable end of ChatGPT
        history (eight unchanged bottom passes; it errors rather than returning a partial
        inventory). The final audit reports remaining intentional/unplanned orphans and any planned
        Conversation that is still loose; still-loose planned Conversations are automatically
        retried up to <code>--max-attempts</code>. Progress is persisted under{" "}
        <code>.bridge/chat-organization-queues/</code>, so an agent does not need to keep watching.
        Use <code>--restart</code> only to intentionally replay the full plan, and{" "}
        <code>--no-verify</code> only when the completion audit is intentionally unnecessary.{" "}
        <code>--json</code> keeps summaries on stdout and progress on stderr.
      </p>
    </DocsSection>
  </DocsPageLayout>
);
