import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";

const FLOW_ASK_CODE = `bridge chrome start --provider flow    # sign in to Google; account needs Flow access (AI Pro/Ultra)
bridge ask --provider flow "a cat surfing a neon wave, cinematic, 8s"
bridge ask --provider flow "same scene, dawn light" --attach ref1.png ref2.png   # up to 3 ingredients`;

const FLOW_ASSETS_CODE = `bridge flow clips                        # list clips in the current project (id + fetchable URL)
bridge flow download                     # download every clip's mp4 to <repo>/.bridge/downloads/flow
bridge flow reuse   --id <clipId>        # add a clip back to the prompt as input ("Add to prompt")
bridge flow extend  --id <clipId>        # add a clip to a scene (Flow's "Add to scene")
bridge flow rename  --id <clipId> --name "hero shot"
bridge flow delete  --id <clipId> --yes  # move a clip to Flow Trash (recoverable)
bridge flow ingredients                  # list reference images attached to the prompt
bridge flow ingredient-remove --id <mediaId>   # detach one ingredient
bridge flow ingredient-clear             # detach every ingredient
bridge flow projects                     # list projects
bridge flow project-rename --name "Launch teaser"
bridge flow project-delete --yes         # permanently delete the current project`;

export const FlowDetails = () => (
  <>
    <DocsSection title="Google Flow support">
      <p>
        The bridge can also drive <a href="https://labs.google/fx/tools/flow">Google Labs Flow</a>,
        Google's Veo-powered AI video studio, with the same Playwright/CDP pattern. Flow is
        different in kind from the chat providers: it is a <strong>generation</strong> surface, so a
        "reply" is a rendered <strong>clip</strong> and attachments are <strong>ingredients</strong>{" "}
        (reference images).
      </p>
      <CodeBlock code={FLOW_ASK_CODE} />
      <p>
        Beyond generating, the bridge drives Flow's full <strong>asset lifecycle</strong> through{" "}
        <code>bridge flow</code> subcommands (each attaches to your current Flow project tab; add{" "}
        <code>--json</code> for machine-readable output):
      </p>
      <CodeBlock code={FLOW_ASSETS_CODE} />
      <p>
        Destructive verbs (<code>delete</code>, <code>project-delete</code>) require{" "}
        <code>--yes</code>; clip delete moves to Flow's recoverable Trash.
      </p>
      <p>
        Agents without shell access get the same lifecycle as <strong>flow_* MCP tools</strong> over{" "}
        <code>bridge serve</code>: <code>flow_list_clips</code>, <code>flow_download_clips</code>,{" "}
        <code>flow_reuse_clip</code>, <code>flow_extend_clip</code>, <code>flow_rename_clip</code>,{" "}
        <code>flow_delete_clip</code>, <code>flow_list_ingredients</code>,{" "}
        <code>flow_remove_ingredient</code>, <code>flow_clear_ingredients</code>,{" "}
        <code>flow_list_projects</code>, <code>flow_rename_project</code>,{" "}
        <code>flow_delete_project</code>. Destructive tools (<code>flow_delete_clip</code>,{" "}
        <code>flow_delete_project</code>) require <code>confirm: true</code>.
      </p>
    </DocsSection>
    <DocsSection title="What works on Flow">
      <ul>
        <li>Terminal-driven shot prompts that trigger Veo generation</li>
        <li>
          <strong>Ingredients</strong>: attach up to three reference images to a prompt, and list /
          remove / clear already-attached ones
        </li>
        <li>
          A captured <strong>clip reference</strong> (video <code>src</code> / download href)
          returned as the reply, so an agent gets a pointer to the result
        </li>
        <li>
          <strong>Asset CRUD</strong>: list / download / rename / delete clips, extend or reuse a
          clip, manage prompt ingredients, and list / rename / delete projects, as{" "}
          <code>bridge flow ...</code> CLI commands <strong>and</strong> <code>flow_*</code> MCP
          tools over <code>bridge serve</code>
        </li>
        <li>Reuses the same shared bridge profile / debug-port model as every provider</li>
      </ul>
    </DocsSection>
    <DocsSection title="What does not work on Flow (today)">
      <ul>
        <li>
          <strong>MCP connector</strong>, <strong>/task</strong>, <strong>/connector</strong>,{" "}
          <strong>/mcp</strong>: Flow has no connector UI, so the MCP server and Cloudflare tunnel
          are skipped (same as Gemini).
        </li>
        <li>
          <strong>Stop / mid-render controls</strong>: cancelling a Veo render in flight is not
          wired yet.
        </li>
      </ul>
      <p>
        Flow requires a <strong>Google AI Pro/Ultra</strong> plan. Because Veo renders take minutes,{" "}
        <code>--provider flow</code> waits far longer for a response than the chat providers do.
      </p>
      <p>
        <strong>Selector maintenance:</strong> Flow's selectors were <strong>LIVE-VERIFIED</strong>{" "}
        against a signed-in project editor. If Google changes the UI, recapture with{" "}
        <code>node scripts/dev/captureProviderSelectors.mjs</code>, then update{" "}
        <a href="https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/provider-settings.ts">
          <code>src/provider-settings.ts</code>
        </a>
        ; generation lives in{" "}
        <a href="https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/providers/flow/flow-page.ts">
          <code>src/providers/flow/flow-page.ts</code>
        </a>{" "}
        and asset CRUD in{" "}
        <a href="https://github.com/YosefHayim/ai-browser-bridge/blob/main/src/providers/flow/flow-assets.ts">
          <code>src/providers/flow/flow-assets.ts</code>
        </a>
        .
      </p>
    </DocsSection>
  </>
);
