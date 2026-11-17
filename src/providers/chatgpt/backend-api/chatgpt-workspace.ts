import type { Page } from "playwright";
import { ChatGptChatApi } from "@/providers/chatgpt/backend-api/chatgpt-chat-api.ts";
import { ChatGptChatMenu } from "@/providers/chatgpt/backend-api/chatgpt-chat-menu.ts";
import { ChatGptProjectMenu } from "@/providers/chatgpt/backend-api/chatgpt-project-menu.ts";
import { listChatGptProjects } from "@/providers/chatgpt/backend-api/chatgpt-projects-api.ts";
import { readScheduledTasks } from "@/providers/chatgpt/backend-api/chatgpt-scheduled-tasks.ts";
import type {
  ArchiveChatVerdict,
  DeleteProjectVerdict,
  MoveChatVerdict,
  RenamedChat,
  RenameProjectVerdict,
  WorkspaceProject,
  WorkspaceTask,
} from "@/providers/chatgpt/backend-api/chatgpt-workspace-types.ts";

export class ChatGptWorkspace {
  private readonly projectMenu: ChatGptProjectMenu;
  private readonly chatMenu: ChatGptChatMenu;
  private readonly chatApi: ChatGptChatApi;

  constructor(private readonly page: Page) {
    this.projectMenu = new ChatGptProjectMenu(page);
    this.chatMenu = new ChatGptChatMenu(page);
    this.chatApi = new ChatGptChatApi(page);
  }

  listProjects = async (): Promise<WorkspaceProject[]> => {
    const projects = await listChatGptProjects(this.page);
    return projects.map((project) => ({ name: project.name }));
  };

  createProject = (name: string): Promise<WorkspaceProject> => this.projectMenu.createProject(name);

  renameProject = (project: string, name: string): Promise<RenameProjectVerdict> =>
    this.projectMenu.renameProject(project, name);

  deleteProject = (project: string): Promise<DeleteProjectVerdict> =>
    this.projectMenu.deleteProject(project);

  moveChatToProject = (
    chat: string,
    project: string,
    projectId: string,
  ): Promise<MoveChatVerdict> => this.chatApi.moveChatToProject(chat, project, projectId);

  renameChat = (chat: string, title: string): Promise<RenamedChat> =>
    this.chatApi.renameChat(chat, title);

  archiveChat = (chat: string): Promise<ArchiveChatVerdict> => this.chatMenu.archiveChat(chat);

  listTasks = (): Promise<WorkspaceTask[]> => readScheduledTasks(this.page);
}
