import type { Command } from "commander";
import {
  addWorkspaceOptions,
  createPositiveIntegerOption,
  createYesOption,
  runWithSettings,
  runWithWords,
} from "@/terminal/cli/cli-options.ts";
import type {
  ChatCommandSettings,
  ChatOrganizationSettings,
  ProjectCommandSettings,
  TaskCommandSettings,
} from "@/terminal/cli/cli-types.ts";
import {
  runChatArchive,
  runChatList,
  runChatMove,
  runChatRename,
  runChatSearch,
} from "@/terminal/commands/chats/chat-commands.ts";
import {
  runChatOrganize,
  runChatOrganizePause,
  runChatOrganizeResume,
  runChatOrganizeStatus,
} from "@/terminal/commands/chats/chat-organize-commands.ts";
import {
  runProjectCreate,
  runProjectDelete,
  runProjectList,
  runProjectRename,
} from "@/terminal/commands/project-commands.ts";
import { runTaskCreate, runTaskList } from "@/terminal/commands/task-commands.ts";

const QUEUE_OPTION = "--queue <pathOrFingerprint>";
const QUEUE_DESCRIPTION = "Select a queue instead of the latest one";
const CHAT_ID_OPTION = "--id <id...>";

// The ChatGPT Project, Conversation and Scheduled task commands.
export class WorkspaceCommands {
  register = (program: Command): void => {
    this.registerProjects(program);
    this.registerChats(program);
    this.registerTasks(program);
  };

  private registerProjects = (program: Command): void => {
    const project = program
      .command("project")
      .description("Manage ChatGPT Projects (ChatGPT only)");

    addWorkspaceOptions(project.command("list"))
      .description("List ChatGPT Projects")
      .action(runWithSettings<ProjectCommandSettings>(runProjectList));
    addWorkspaceOptions(project.command("create <name...>"))
      .description("Create a ChatGPT Project")
      .option("--instructions <text>", "Optional project instructions")
      .action(runWithWords<ProjectCommandSettings>(runProjectCreate));
    addWorkspaceOptions(project.command("rename <name...>"))
      .description("Rename a ChatGPT Project")
      .option("--to <newName>", "New project name")
      .action(runWithWords<ProjectCommandSettings>(runProjectRename));
    addWorkspaceOptions(project.command("delete <name...>"))
      .description("Delete a ChatGPT Project (permanently deletes its chats)")
      .addOption(createYesOption("Confirm deletion"))
      .action(runWithWords<ProjectCommandSettings>(runProjectDelete));
  };

  private registerChats = (program: Command): void => {
    const chat = program
      .command("chat")
      .description("List or organize ChatGPT conversations (ChatGPT only)");

    addWorkspaceOptions(chat.command("list"))
      .description(
        "List the conversations shown in the ChatGPT sidebar (may include Project chats)",
      )
      .option(
        "--orphans",
        "List every loose conversation outside all Projects, read from the full ChatGPT history",
      )
      .action(runWithSettings<ChatCommandSettings>(runChatList));
    addWorkspaceOptions(chat.command("search <query...>"))
      .description("Search ChatGPT conversation history")
      .addOption(createPositiveIntegerOption("--limit <count>", "Maximum results (default: 20)"))
      .option("--open", "Open the best match in the browser")
      .action(runWithWords<ChatCommandSettings>(runChatSearch));
    addWorkspaceOptions(chat.command("move [idOrTitle...]"))
      .description("Move one or more conversations into a Project")
      .option("--project <name>", "Destination project name")
      .option(CHAT_ID_OPTION, "Move several conversations by id in one session")
      .action(runWithWords<ChatCommandSettings>(runChatMove));
    addWorkspaceOptions(chat.command("rename [idOrTitle...]"))
      .description("Rename one ChatGPT conversation")
      .option("--title <title>", "New conversation title")
      .option(CHAT_ID_OPTION, "Rename the conversation with this id (one id only)")
      .action(runWithWords<ChatCommandSettings>(runChatRename));
    addWorkspaceOptions(chat.command("archive [idOrTitle...]"))
      .description("Archive one or more conversations (reversible — hides from the sidebar)")
      .option(CHAT_ID_OPTION, "Archive several conversations by id in one session")
      .action(runWithWords<ChatCommandSettings>(runChatArchive));
    this.registerOrganize(chat);
  };

  private addPacingOptions = (command: Command): Command => {
    return command
      .option(
        "--interval <secondsOrRange>",
        "Initial seconds between UI operations, fixed or random range such as 60-90 (default: 60)",
      )
      .option("--no-adaptive", "Keep the initial interval instead of adapting to success/limits")
      .addOption(
        createPositiveIntegerOption(
          "--min-interval <seconds>",
          "Fastest adaptive base interval (default: 15)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--max-interval <seconds>",
          "Slowest adaptive base interval (default: 180)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--speed-up-after <count>",
          "Successful moves before reducing the adaptive interval (default: 3)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--cooldown <seconds>",
          "Seconds to wait after rate limiting (default: 600)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--max-attempts <count>",
          "Attempts per Conversation before failing (default: 4)",
        ),
      )
      .option("--no-verify", "Skip the exhaustive orphan scan when the queue finishes");
  };

  private registerOrganize = (chat: Command): void => {
    const organize = this.addPacingOptions(addWorkspaceOptions(chat.command("organize")))
      .description("Run a resumable, rate-safe Conversation organization queue")
      .option(
        "--plan <fileOrJson>",
        "JSON array of {conversation, project} tasks (inline, @file, or a path)",
      )
      .option("--restart", "Restart this plan instead of resuming its persisted queue")
      .option("--dry-run", "Validate and show the queue without opening Chrome or writing state")
      .action(runWithSettings<ChatOrganizationSettings>(runChatOrganize));

    addWorkspaceOptions(organize.command("status"))
      .description("Show the latest organization queue state and adaptive pace")
      .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
      .action(runWithSettings<ChatOrganizationSettings>(runChatOrganizeStatus));
    addWorkspaceOptions(organize.command("pause"))
      .description("Pause the latest queue after its active UI operation")
      .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
      .action(runWithSettings<ChatOrganizationSettings>(runChatOrganizePause));
    this.addPacingOptions(addWorkspaceOptions(organize.command("resume")))
      .description("Resume the latest persisted organization queue")
      .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
      .action(runWithSettings<ChatOrganizationSettings>(runChatOrganizeResume));
  };

  private registerTasks = (program: Command): void => {
    const task = program
      .command("task")
      .description("List or schedule ChatGPT Tasks (ChatGPT only)");

    addWorkspaceOptions(task.command("list"))
      .description("List ChatGPT Scheduled tasks")
      .action(runWithSettings<TaskCommandSettings>(runTaskList));
    addWorkspaceOptions(task.command("create <prompt...>"))
      .description("Schedule a task via natural language")
      .option("--every <spec>", "Recurring cadence (e.g. day, or weekday at 9am)")
      .option("--at <spec>", "One-off run time (e.g. tomorrow at 9am)")
      .action(runWithWords<TaskCommandSettings>(runTaskCreate));
  };
}
