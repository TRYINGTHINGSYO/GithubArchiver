export type ProjectTemplateId =
  | "web-app"
  | "api-service"
  | "desktop"
  | "cli"
  | "automation"
  | "static-site"
  | "discord-bot"
  | "data-pipeline"
  | "blank"
  | "custom";

export interface ScaffoldRequest {
  name: string;
  description: string;
  destination: string;
  template: ProjectTemplateId;
  packageManager?: "npm" | "pnpm" | "yarn";
  initGit?: boolean;
  /** Remote GitHub create — always requires later approval */
  createGithubRepo?: boolean;
  githubVisibility?: "private" | "public";
  githubOwner?: string;
  /** Natural language brief for custom structure */
  brief?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface ScaffoldPlan {
  name: string;
  template: ProjectTemplateId;
  files: ScaffoldFile[];
  installCommand: string;
  verifyCommands: string[];
  notes: string[];
}

export interface ScaffoldResult {
  ok: boolean;
  stagingPath: string;
  destinationPath?: string;
  filesCreated: number;
  gitInitialized: boolean;
  initialCommit: boolean;
  installOk: boolean;
  verifySummary: string;
  message: string;
  pendingGithub?: {
    owner: string;
    name: string;
    visibility: "private" | "public";
    cwd: string;
  };
  error?: string;
}
