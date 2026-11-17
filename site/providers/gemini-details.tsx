import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";

const GEMINI_CODE = `bridge chrome start --provider gemini
bridge --provider gemini --repo /path/to/project
bridge ask "explain this repo" --provider gemini --repo /path/to/project`;

export function GeminiDetails() {
  return (
    <>
      <DocsSection title="Gemini web support">
        <p>
          The bridge can drive <strong>gemini.google.com</strong> from the terminal with the same
          Playwright/CDP pattern as ChatGPT:
        </p>
        <CodeBlock code={GEMINI_CODE} />
      </DocsSection>
      <DocsSection title="What works on Gemini web">
        <ul>
          <li>Terminal-driven prompts and captured replies</li>
          <li>
            <code>@file</code> mention expansion (read-only repo context inlined into prompts)
          </li>
          <li>Model detection/switching when the Gemini UI exposes a picker</li>
          <li>Reuses the same shared bridge profile/debug port model as every provider</li>
        </ul>
      </DocsSection>
      <DocsSection title="What does not work on Gemini web (today)">
        <ul>
          <li>
            <strong>MCP connector</strong>: gemini.google.com has no custom connector UI like
            ChatGPT, Claude, or Grok. The bridge skips the MCP server and Cloudflare tunnel when{" "}
            <code>--provider gemini</code>.
          </li>
          <li>
            <strong>
              <code>/task</code>, <code>/connector</code>, <code>/mcp</code>
            </strong>
            : these require live MCP tools; use ChatGPT, Claude, or Grok for those workflows.
          </li>
          <li>
            <strong>Attachment download</strong>: <code>bridge download</code> is ChatGPT-only for
            now.
          </li>
        </ul>
        <p>
          For full MCP on Gemini, use the official{" "}
          <a href="https://ai.google.dev/gemini-api/docs/function-calling">Gemini API Remote MCP</a>{" "}
          or{" "}
          <a href="https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md">
            Gemini CLI
          </a>{" "}
          instead of the browser UI.
        </p>
        <p>
          <strong>Selector maintenance:</strong> when Google changes the Gemini web UI, fix
          selectors only in{" "}
          <a href="https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/providers/gemini/gemini-page.ts">
            <code>src/providers/gemini/gemini-page.ts</code>
          </a>
          .
        </p>
      </DocsSection>
    </>
  );
}
