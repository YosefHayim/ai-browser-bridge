import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";

const ARENA_MODES = [
  { mode: "Direct (default)", token: "direct", url: "/code/direct", note: "one model" },
  {
    mode: "Battle Mode",
    token: "battle",
    url: "/code",
    note: "Option A/B (dual reply when both finish)",
  },
  { mode: "Agent Mode", token: "agent", url: "/agent", note: "agent shell (best-effort)" },
  { mode: "Side by Side", token: "side / sbs", url: "/text/side-by-side", note: "pick two models" },
];

const ARENA_CODE = `bridge chrome start --provider arena
bridge ask --provider arena "build a todo app"                          # Direct + Max
bridge ask --provider arena --model glm-5.1 "reply with pong"           # pick a model
bridge ask --provider arena --model battle "compare two approaches"     # dual Option A/B
bridge ask --provider arena --model direct/gemini-3-flash "hello"       # mode + model`;

export const ArenaDetails = () => (
  <DocsSection title="Arena.ai support">
    <p>
      The bridge drives <a href="https://arena.ai/code/direct">Arena</a> (LMSYS) with a dedicated
      adapter for the mode menu and model picker:
    </p>
    <table class="docs-table">
      <thead>
        <tr>
          <th>Mode</th>
          <th>
            <code>--model</code> token
          </th>
          <th>URL</th>
        </tr>
      </thead>
      <tbody>
        {ARENA_MODES.map((row) => (
          <tr key={row.token}>
            <td>{row.mode}</td>
            <td>
              <code>{row.token}</code>
            </td>
            <td>
              <code>{row.url}</code>: {row.note}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <CodeBlock code={ARENA_CODE} />
    <p>
      Model search matches the in-UI picker (Search models + Text/Code/Image/Search tabs). Battle
      turns on Code Arena can take minutes (full site builds); raise <code>--timeout</code> if
      needed. No MCP connector on Arena.
    </p>
  </DocsSection>
);
