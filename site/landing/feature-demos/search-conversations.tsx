import { DemoCard, shownFrom, TypedText } from "@site/landing/feature-demos/demo-parts.tsx";
import { ShellPrompt, TerminalWindow } from "@site/landing/terminal-window.tsx";

const BEAT_TIMES_MS = [300, 1500, 1900, 2300, 3300];

export const SearchConversationsDemo = () => (
  <DemoCard
    title="Search your conversations"
    text="Search titles and message content from the terminal. Matches come back as JSON."
    cardIndex={1}
    loopMs={8000}
    beatTimesMs={BEAT_TIMES_MS}
  >
    <TerminalWindow title="bridge chat search" className="fd-window">
      <div class="term fd-term">
        <span class="fd-line">
          <ShellPrompt />
          <TypedText
            beat={1}
            durationMs={900}
            text={'bridge chat search "invoice" --json'}
            isCommand
          />
        </span>
        <div class="fd-results">
          <div class="fd-result fd-at" {...shownFrom(2)}>
            Acme <mark>invoice</mark> March
          </div>
          <div class="fd-result fd-at" {...shownFrom(3)}>
            <mark>Invoice</mark> template for freelancers
          </div>
          <div class="fd-result fd-at" {...shownFrom(4)}>
            Refund for an unpaid <mark>invoice</mark>
          </div>
        </div>
        <pre class="fd-json fd-at" {...shownFrom(5)}>
          {"[{ "}
          <span class="tk-flag">"id"</span>: <span class="tk-value">"a41c…"</span>,{"\n  "}
          <span class="tk-flag">"title"</span>: <span class="tk-value">"Acme invoice March"</span>,
          {"\n  "}
          <span class="tk-flag">"provider"</span>: <span class="tk-value">"chatgpt"</span>, …{" "}
          {"}, …]"}
        </pre>
      </div>
    </TerminalWindow>
  </DemoCard>
);
