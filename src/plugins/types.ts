import type { ApprovalPolicy } from "../config.js";

export interface PluginVerifyCommand {
  name: string;
  command: string;
}

export interface PluginContext {
  projectPath: string;
  approval: ApprovalPolicy;
  signal?: AbortSignal;
}

export interface PluginVerifyResult {
  ok: boolean;
  summary: string;
  commands?: PluginVerifyCommand[];
  output?: string;
}

export interface OrchestratorPlugin {
  id: string;
  name: string;
  description?: string;
  /** Auto-enable when no explicit plugin list is configured */
  autoDetect?(projectPath: string): Promise<boolean>;
  /** Extra verify commands contributed by this plugin */
  verifyCommands?(ctx: PluginContext): Promise<PluginVerifyCommand[]>;
  /** Optional custom verify step (beyond shell commands) */
  verify?(ctx: PluginContext): Promise<PluginVerifyResult | null>;
}
