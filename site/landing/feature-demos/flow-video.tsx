import {
  DemoCard,
  DemoWindow,
  shownFrom,
  TypedText,
} from "@site/landing/feature-demos/demo-parts.tsx";

const BEAT_TIMES_MS = [300, 800, 1300, 2200, 5400, 6200, 7000];

export const FlowVideoDemo = () => (
  <DemoCard
    title="Generate video with Flow"
    text="Send a prompt to Google Flow, then download the clips into .bridge/ in your repo."
    cardIndex={5}
    loopMs={10000}
    beatTimesMs={BEAT_TIMES_MS}
  >
    <DemoWindow label="terminal">
      <div class="term fd-term">
        <span class="fd-line">
          <span class="p">$</span>{" "}
          <TypedText beat={1} durationMs={450} text="bridge ask --provider flow \" />
        </span>
        <span class="fd-line">
          {"  "}
          <TypedText beat={2} durationMs={450} text={'"a cat surfing a neon wave,'} />
        </span>
        <span class="fd-line">
          {"   "}
          <TypedText beat={3} durationMs={400} text={'cinematic, 8s"'} />
        </span>
        <div class="fd-flow-row">
          <div class="fd-frame fd-at" {...shownFrom(5)}>
            <span class="fd-play" />
          </div>
          <div class="fd-flow-side">
            <span class="fd-progress-label">
              <span class="fd-at" {...shownFrom(4, 5)}>
                Flow is generating
              </span>
              <span class="fd-at ok" {...shownFrom(5)}>
                Clip ready
              </span>
            </span>
            <span class="fd-progress fd-at" {...shownFrom(4)}>
              <i class="fd-progress-fill" {...shownFrom(4)} />
            </span>
          </div>
        </div>
        <span class="fd-line">
          <span class="p">$</span>{" "}
          <TypedText beat={6} durationMs={500} text="bridge flow download" />
        </span>
        <span class="fd-line fd-at k" {...shownFrom(7)}>
          <span class="fd-ellipsis">.bridge/downloads/flow/&lt;clipId&gt;.mp4</span>
        </span>
      </div>
    </DemoWindow>
  </DemoCard>
);
