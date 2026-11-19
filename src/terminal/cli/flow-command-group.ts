import type { Command } from "commander";
import {
  addBrowserCommandOptions,
  createYesOption,
  runWithSettings,
} from "@/terminal/cli/cli-options.ts";
import type { FlowCommandSettings } from "@/terminal/cli/cli-types.ts";
import {
  runFlowClips,
  runFlowDelete,
  runFlowDownload,
  runFlowExtend,
  runFlowGenerate,
  runFlowIngredientClear,
  runFlowIngredientRemove,
  runFlowIngredients,
  runFlowProjectDelete,
  runFlowProjectRename,
  runFlowProjects,
  runFlowRename,
  runFlowReuse,
} from "@/terminal/commands/flow-commands.ts";

const CLIP_ID_OPTION = "--id <clipId...>";
const FLOW_DOWNLOAD_DESCRIPTION = "Output directory (default: <repo>/.bridge/downloads/flow)";

// The `bridge flow` commands for Google Flow clips, ingredients and projects.
export class FlowCommands {
  register = (program: Command): void => {
    const flow = program
      .command("flow")
      .description("Manage Google Flow clips, ingredients & projects (Flow only)");

    this.registerClipCommands(flow);
    this.registerIngredientCommands(flow);
    this.registerProjectCommands(flow);
  };

  private createFlowCommand = (flow: Command, name: string, description: string): Command => {
    return addBrowserCommandOptions(flow.command(name)).description(description);
  };

  private registerClipCommands = (flow: Command): void => {
    this.createFlowCommand(flow, "clips", "List clips in the current Flow project").action(
      runWithSettings<FlowCommandSettings>(runFlowClips),
    );
    this.createFlowCommand(flow, "download", "Download clip mp4s (all, or --id <clipId...>)")
      .option(CLIP_ID_OPTION, "Specific clip id(s); omit to download every clip")
      .option("--out <dir>", FLOW_DOWNLOAD_DESCRIPTION)
      .action(runWithSettings<FlowCommandSettings>(runFlowDownload));
    this.createFlowCommand(
      flow,
      "generate",
      "Generate a Veo clip from a Start keyframe + prompt (image-to-video)",
    )
      .option("--start <imagePath>", "Start keyframe image (image-to-video)")
      .option("--prompt <text>", "Shot / motion prompt")
      .option("--out <dir>", "Download directory (default: <repo>/.bridge/downloads/flow)")
      .action(runWithSettings<FlowCommandSettings>(runFlowGenerate));
    this.createFlowCommand(flow, "delete", "Move a clip to Flow Trash (recoverable)")
      .option(CLIP_ID_OPTION, "Clip id to trash")
      .addOption(createYesOption("Confirm the delete"))
      .action(runWithSettings<FlowCommandSettings>(runFlowDelete));
    this.createFlowCommand(flow, "rename", "Rename a clip")
      .option(CLIP_ID_OPTION, "Clip id to rename")
      .option("--name <text>", "New clip name")
      .action(runWithSettings<FlowCommandSettings>(runFlowRename));
    this.createFlowCommand(flow, "extend", "Add a clip to a scene (Flow extend)")
      .option(CLIP_ID_OPTION, "Clip id to extend")
      .action(runWithSettings<FlowCommandSettings>(runFlowExtend));
    this.createFlowCommand(flow, "reuse", "Add a clip back to the prompt as input")
      .option(CLIP_ID_OPTION, "Clip id to reuse")
      .action(runWithSettings<FlowCommandSettings>(runFlowReuse));
  };

  private registerProjectCommands = (flow: Command): void => {
    this.createFlowCommand(flow, "projects", "List Flow projects").action(
      runWithSettings<FlowCommandSettings>(runFlowProjects),
    );
    this.createFlowCommand(flow, "project-rename", "Rename the current Flow project")
      .option("--name <text>", "New project name")
      .action(runWithSettings<FlowCommandSettings>(runFlowProjectRename));
    this.createFlowCommand(flow, "project-delete", "Delete the current Flow project (permanent)")
      .addOption(createYesOption("Confirm the delete"))
      .action(runWithSettings<FlowCommandSettings>(runFlowProjectDelete));
  };

  private registerIngredientCommands = (flow: Command): void => {
    this.createFlowCommand(
      flow,
      "ingredients",
      "List reference images attached to the current prompt",
    ).action(runWithSettings<FlowCommandSettings>(runFlowIngredients));
    this.createFlowCommand(flow, "ingredient-remove", "Detach one prompt ingredient")
      .option("--id <mediaId...>", "Ingredient media id to remove")
      .action(runWithSettings<FlowCommandSettings>(runFlowIngredientRemove));
    this.createFlowCommand(
      flow,
      "ingredient-clear",
      "Detach every ingredient from the current prompt",
    ).action(runWithSettings<FlowCommandSettings>(runFlowIngredientClear));
  };
}
