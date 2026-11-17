import { DemoCard, shownFrom, TypedText } from "@site/landing/feature-demos/demo-parts.tsx";
import { TerminalWindow } from "@site/landing/terminal-window.tsx";

const BEAT_TIMES_MS = [300, 1300, 2300, 3200, 4000, 5400, 6400];

const CHECKPOINT_ID = "2026-11-15T10-42-07-123Z-before-3f9a1c0e";

export function PermissionCheckpointsDemo() {
  return (
    <DemoCard
      title="Permission modes and checkpoints"
      text="Pick read-only, ask or auto. Every patch gets a checkpoint you can restore."
      cardIndex={3}
      loopMs={9000}
      beatTimesMs={BEAT_TIMES_MS}
    >
      <TerminalWindow title="bridge prompt" className="fd-window">
        <div class="term fd-term">
          <span class="fd-line">
            <span class="p">/</span>
            <TypedText beat={1} durationMs={500} text="permissions" />
          </span>
          <div class="fd-segments">
            <span class="fd-segment" {...shownFrom(0, 2)}>
              read-only
            </span>
            <span class="fd-segment" {...shownFrom(2, 3)}>
              ask
            </span>
            <span class="fd-segment" {...shownFrom(3)}>
              auto
            </span>
          </div>
          <div class="fd-patch fd-at" {...shownFrom(4)}>
            <span class="tk-sub">apply_patch</span> <span class="tk-value">src/app.ts</span>
            <span class="fd-code">
              <span class="fd-stack">
                <span class="fd-at" {...shownFrom(0, 4)}>
                  retries = 1
                </span>
                <span class="fd-at fd-added" {...shownFrom(4, 7)}>
                  retries = 3
                </span>
                <span class="fd-at" {...shownFrom(7)}>
                  retries = 1
                </span>
              </span>
            </span>
          </div>
          <span class="fd-line fd-at" {...shownFrom(5)}>
            <span class="fd-chip">{`checkpoint ${CHECKPOINT_ID}`}</span>
          </span>
          <span class="fd-line fd-at" {...shownFrom(6)}>
            <span class="p">/</span>restore <span class="fd-ellipsis">{CHECKPOINT_ID}</span>
          </span>
          <span class="fd-line fd-at fd-restored" {...shownFrom(7)}>
            Restored checkpoint: 1 restored, 0 removed.
          </span>
        </div>
      </TerminalWindow>
    </DemoCard>
  );
}
