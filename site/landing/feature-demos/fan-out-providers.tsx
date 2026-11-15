import { BrandIcon } from "@site/landing/brand-icons.tsx";
import {
  DemoCard,
  DemoWindow,
  shownFrom,
  TypedText,
} from "@site/landing/feature-demos/demo-parts.tsx";

interface FanOutReply {
  provider: string;
  colorVariable: string;
  text: string;
  streamMs: number;
  streamBeat: number;
  okBeat: number;
}

const REPLIES: FanOutReply[] = [
  {
    provider: "claude",
    colorVariable: "--c-claude",
    text: "Add the index before the backfill.",
    streamMs: 1800,
    streamBeat: 4,
    okBeat: 7,
  },
  {
    provider: "deepseek",
    colorVariable: "--c-deepseek",
    text: "Run the backfill in small batches.",
    streamMs: 2300,
    streamBeat: 5,
    okBeat: 8,
  },
  {
    provider: "duck",
    colorVariable: "--accent-text",
    text: "Lock the table only for the rename.",
    streamMs: 2000,
    streamBeat: 6,
    okBeat: 9,
  },
];

const BEAT_TIMES_MS = [300, 900, 1500, 1800, 2100, 2400, 4000, 4700, 5100];

export const FanOutProvidersDemo = () => (
  <DemoCard
    title="Ask several providers at once"
    text="List providers after --provider and get every reply back, keyed by provider."
    cardIndex={2}
    loopMs={8000}
    beatTimesMs={BEAT_TIMES_MS}
  >
    <DemoWindow label="terminal">
      <div class="term fd-term">
        <span class="fd-line">
          <span class="p">$</span> <TypedText beat={1} durationMs={400} text="bridge ask \" />
        </span>
        <span class="fd-line">
          {"  "}
          <TypedText beat={2} durationMs={800} text="--provider claude,deepseek,duck \" />
        </span>
        <span class="fd-line">
          {"  "}
          <TypedText beat={3} durationMs={600} text={'--json "Review this migration"'} />
        </span>
        <div class="fd-replies">
          {REPLIES.map((reply) => (
            <div class="fd-reply" key={reply.provider}>
              <span class="fd-reply-head">
                <b class="fd-provider" style={`color:var(${reply.colorVariable})`}>
                  <BrandIcon name={reply.provider} size={12} />
                  {reply.provider}
                </b>
                <span class="ok fd-at" {...shownFrom(reply.okBeat)}>
                  ok: true
                </span>
              </span>
              <TypedText
                beat={reply.streamBeat}
                durationMs={reply.streamMs}
                text={reply.text}
                className="fd-reply-text"
              />
            </div>
          ))}
        </div>
      </div>
    </DemoWindow>
  </DemoCard>
);
