import {
  DemoCard,
  DemoWindow,
  shownFrom,
  TypedText,
} from "@site/landing/feature-demos/demo-parts.tsx";
import { ShellPrompt, TerminalWindow } from "@site/landing/terminal-window.tsx";

interface Move {
  title: string;
  projectIndex: number;
  moveBeat: number;
}

const PROJECTS = ["Yoga App", "Invoices & Purchases"];

const MOVES: Move[] = [
  { title: "Yoga app onboarding", projectIndex: 0, moveBeat: 4 },
  { title: "Acme invoice March", projectIndex: 1, moveBeat: 5 },
  { title: "Pose library schema", projectIndex: 0, moveBeat: 6 },
  { title: "Laptop receipt", projectIndex: 1, moveBeat: 8 },
  { title: "Class timer bug", projectIndex: 0, moveBeat: 9 },
  { title: "Domain renewal", projectIndex: 1, moveBeat: 10 },
];

const BEAT_TIMES_MS = [300, 900, 1700, 2100, 2700, 3300, 3500, 4100, 4700, 5300, 5500, 6300, 6700];

// Sidebar geometry in px, kept in step with .fd-chat-row, .fd-folder and .fd-chats-head.
const CHAT_ROW_HEIGHT = 26;
const FOLDER_HEIGHT = 30;
const CHATS_HEAD_BLOCK = 34;

const readFlyDistance = (rowIndex: number, projectIndex: number): number => {
  const folderCountBelowTarget = PROJECTS.length - 1 - projectIndex;
  const targetCenter = -(
    CHATS_HEAD_BLOCK +
    folderCountBelowTarget * FOLDER_HEIGHT +
    FOLDER_HEIGHT / 2
  );
  const rowCenter = rowIndex * CHAT_ROW_HEIGHT + CHAT_ROW_HEIGHT / 2;
  return targetCenter - rowCenter;
};

const readFolderMoves = (projectIndex: number): Move[] =>
  MOVES.filter((move) => move.projectIndex === projectIndex);

const FolderIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
  >
    <title>Project</title>
    <path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5h6.4a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <title>Verified</title>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </svg>
);

const FolderCount = ({ projectIndex }: { projectIndex: number }) => {
  const folderMoves = readFolderMoves(projectIndex);
  const counts = [0, ...folderMoves.map((_, index) => index + 1)];

  return (
    <span class="fd-count">
      {counts.map((count, index) => {
        const startBeat = index === 0 ? 0 : (folderMoves[index - 1]?.moveBeat ?? 0);
        const endBeat = folderMoves[index]?.moveBeat;
        return (
          <b class="fd-at fd-bump" key={count} {...shownFrom(startBeat, endBeat)}>
            {count}
          </b>
        );
      })}
    </span>
  );
};

const PaceValue = ({ value, start, end }: { value: string; start: number; end?: number }) => (
  <b class="fd-at fd-pace-value" {...shownFrom(start, end)}>
    {value}
  </b>
);

export const OrganizeConversationsDemo = () => (
  <DemoCard
    title="Sort conversations into Projects"
    text="Give it a plan file. It moves each conversation, checks that it landed, and slows down when ChatGPT says too many requests."
    cardIndex={0}
    loopMs={10000}
    beatTimesMs={BEAT_TIMES_MS}
    isWide
  >
    <div class="fd-organize">
      <DemoWindow label="ChatGPT">
        <div class="fd-sidebar">
          <div class="fd-side-head">Projects</div>
          {PROJECTS.map((project, projectIndex) => (
            <div class="fd-folder" key={project}>
              <FolderIcon />
              <span class="fd-ellipsis">{project}</span>
              <FolderCount projectIndex={projectIndex} />
            </div>
          ))}
          <div class="fd-side-head fd-chats-head">Chats</div>
          <div class="fd-chat-list">
            {MOVES.map((move, rowIndex) => (
              <div
                class="fd-chat-row fd-fly"
                key={move.title}
                style={`--fly-y:${readFlyDistance(rowIndex, move.projectIndex)}px`}
                data-at="0"
                data-until={String(move.moveBeat)}
              >
                <span class="fd-ellipsis">{move.title}</span>
              </div>
            ))}
          </div>
        </div>
      </DemoWindow>
      <TerminalWindow title="bridge chat organize" className="fd-window">
        <div class="term fd-term">
          <span class="fd-line">
            <ShellPrompt />
            <TypedText beat={1} durationMs={600} text="bridge chat organize \" isCommand />
          </span>
          <span class="fd-line">
            {"  "}
            <TypedText beat={2} durationMs={700} text="--plan @organization-plan.json" isCommand />
          </span>
          <div class="fd-moves">
            {MOVES.map((move) => (
              <span
                class="fd-line fd-at fd-move"
                key={move.title}
                style="transition-delay:0.5s"
                {...shownFrom(move.moveBeat)}
              >
                <span class="ok">
                  <CheckIcon />
                </span>
                <span class="fd-ellipsis">
                  {move.title} <span class="k">{`to ${PROJECTS[move.projectIndex]}`}</span>
                </span>
              </span>
            ))}
          </div>
          <span class="fd-line fd-at" {...shownFrom(3)}>
            <span class="k">interval </span>
            <span class="fd-pace">
              <PaceValue value="60s" start={3} end={7} />
              <PaceValue value="48s" start={7} end={11} />
              <PaceValue value="38s" start={11} end={13} />
              <PaceValue value="58s" start={13} />
            </span>
          </span>
          <span class="fd-line fd-warn fd-at" {...shownFrom(12)}>
            Too many requests. Paused for 600s.
          </span>
        </div>
      </TerminalWindow>
    </div>
  </DemoCard>
);
