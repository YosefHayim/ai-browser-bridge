export type WorkspaceProject = {
  name: string;
};

export type RenameProjectVerdict = {
  project: string;
  renamedTo: string;
  renamed: boolean;
  reason?: string;
};

export type DeleteProjectVerdict = {
  project: string;
  deleted: boolean;
  reason?: string;
};

export type MoveChatVerdict = {
  chat: string;
  project: string;
  moved: boolean;
  alreadyFiled?: boolean;
  rateLimited?: boolean;
  reason?: string;
};

export type ArchiveChatVerdict = {
  chat: string;
  archived: boolean;
  reason?: string;
};

export type WorkspaceTask = {
  title: string;
  schedule?: string;
};

export type RenamedChat = {
  id: string;
  title: string;
};
