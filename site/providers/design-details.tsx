import { CodeBlock, DocsSection } from "@site/docs/docs-blocks.tsx";

const DESIGN_CODE = `bridge chrome start --provider design            # sign in at claude.ai
bridge design catalog                            # templates, models + effort levels, design systems
bridge design projects --query launch            # list / search projects (--design-systems for design systems)
bridge design model --model "Sonnet 4.6" --effort Low   # pick model (incl. More models) + effort; --project for a project
bridge design create --template Slides --prompt "our Q3 launch" --model "Haiku 4.5" --effort Low
bridge design send --project <id> --message "make the title bolder" --model "Sonnet 4.6" --attach brief.md
bridge design read --project <id>                # Conversations + latest messages (what you wrote, what Claude replied)
bridge design new-conversation --project <id>
bridge design rename-conversation --project <id> --conversation <cid> --title "Logo pass"
bridge design files --project <id>
bridge design put --project <id> --file hero.png --dir assets   # add, or replace the same path
bridge design rm --project <id> --path assets/old.png --yes
bridge design download --project <id>            # project files to <repo>/.bridge/downloads/design/<id>
bridge design export --project <id>              # the project .zip
bridge design share --project <id> --access workspace --permission comment
bridge design rename --project <id> --name "Launch deck"
bridge design duplicate --project <id>
bridge design favorite --project <id>              # --off removes the star
bridge design use-design-systems --project <id> --design-system <dsid>   # --none clears them
bridge design delete --project <id> --yes
bridge design state                              # where Claude Design is, busy tabs, available actions`;

export function DesignDetails() {
  return (
    <DocsSection title="Claude Design support">
      <p>
        The bridge drives <a href="https://claude.ai/design">Claude Design</a>, Claude's project
        workspace for slides, prototypes, and documents, from your signed-in bridge Chrome. Reads
        and project/file changes use the app's own requests instead of the UI; turns, templates, and
        model/effort go through the real UI, one tab per project.
      </p>
      <CodeBlock code={DESIGN_CODE} />
      <p>
        Add <code>--json</code> to any verb for machine-readable output. <code>send</code> and{" "}
        <code>create</code> wait for Claude's reply (<code>--timeout</code>, default 600 s);{" "}
        <code>--no-wait</code> returns while the turn runs and <code>--auto-decide</code> answers
        clarifying questions with "Decide for me". A model or effort choice also becomes your Claude
        Design default, exactly as when you pick it in the UI.
      </p>
      <p>
        Agents get the same surface as <strong>design_* MCP tools</strong> over{" "}
        <code>bridge serve</code>: <code>design_state</code>, <code>design_list_projects</code>,{" "}
        <code>design_catalog</code>, <code>design_choose_model</code>,{" "}
        <code>design_list_files</code>, <code>design_read_conversation</code>,{" "}
        <code>design_open_project</code>, <code>design_create_project</code>,{" "}
        <code>design_send</code>, <code>design_new_conversation</code>,{" "}
        <code>design_rename_conversation</code>, <code>design_update_project</code>,{" "}
        <code>design_duplicate_project</code>, <code>design_delete_project</code>,{" "}
        <code>design_put_files</code>, <code>design_remove_files</code>,{" "}
        <code>design_download</code>, <code>design_share</code>. Destructive tools (
        <code>design_delete_project</code>, <code>design_remove_files</code>) require{" "}
        <code>confirm: true</code>; local paths must stay inside the target repo.
      </p>
      <p>
        <strong>Left to you in the UI:</strong> Publish as artifact, Send to Claude Code,
        PNG/video/PDF/PowerPoint export, partner app exports, comments, and version restore;{" "}
        <code>design state</code> lists them. Design is not a Fan-out provider: a Fan-out tab closes
        when its task ends, which would cancel the turn.
      </p>
    </DocsSection>
  );
}
