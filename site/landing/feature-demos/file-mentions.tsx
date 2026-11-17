import { DemoCard, shownFrom, TypedText } from "@site/landing/feature-demos/demo-parts.tsx";
import { TerminalWindow } from "@site/landing/terminal-window.tsx";

const BEAT_TIMES_MS = [300, 1300, 1900, 2700, 3400, 4000];

const FILE_SUGGESTIONS = [
  "src/terminal/tui/shell/app.tsx",
  "src/repo-files/file-mentions.ts",
  "src/repo-files/file-mentions.test.ts",
];

const PICKED_FILE = FILE_SUGGESTIONS[1];

const NEVER_SHOWN = { "data-at": "99", "data-until": "100" };

const readPickWindow = (itemIndex: number) => {
  if (itemIndex === 0) return shownFrom(3, 4);
  if (itemIndex === 1) return shownFrom(4, 5);
  return NEVER_SHOWN;
};

export const FileMentionsDemo = () => (
  <DemoCard
    title="Mention files with @"
    text="Type @ to pick a repo file. It is expanded into the prompt before the chat sees it."
    cardIndex={4}
    loopMs={8000}
    beatTimesMs={BEAT_TIMES_MS}
  >
    <TerminalWindow title="bridge prompt" className="fd-window">
      <div class="term fd-term">
        <span class="fd-line">
          <span class="p">&gt;</span>{" "}
          <TypedText beat={1} durationMs={800} text="refactor the CLI input flow in" />
        </span>
        <span class="fd-line">
          {"  "}
          <span class="fd-stack">
            <span class="fd-at" {...shownFrom(0, 4)}>
              <TypedText beat={2} durationMs={400} text="@src/" />
            </span>
            <span class="fd-at fd-mention" {...shownFrom(4)}>
              {`@${PICKED_FILE}`}
            </span>
          </span>
        </span>
        <div class="fd-lower">
          <div class="fd-stack">
            <div class="fd-menu fd-at" {...shownFrom(3, 5)}>
              {FILE_SUGGESTIONS.map((file, index) => (
                <span class="fd-menu-item" key={file}>
                  <span class="fd-at fd-menu-pick" {...readPickWindow(index)} />
                  <span class="fd-ellipsis">{file}</span>
                </span>
              ))}
            </div>
            <div class="fd-expanded fd-at" {...shownFrom(5)}>
              <span class="k fd-ellipsis">{`${PICKED_FILE} inlined`}</span>
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      </div>
    </TerminalWindow>
  </DemoCard>
);
