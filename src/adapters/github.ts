/**
 * GitHub repository adapter (optional remote creation).
 * Creating remotes / pushing ALWAYS requires explicit user approval upstream.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GithubCreateRequest {
  owner: string;
  name: string;
  visibility: "private" | "public";
  cwd: string;
  push?: boolean;
}

export interface GithubCreateResult {
  ok: boolean;
  url?: string;
  message: string;
}

async function whichGh(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "where" : "which",
      ["gh"],
    );
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Create a GitHub repository via `gh`. Caller must have already obtained approval.
 */
export async function createGithubRepository(
  req: GithubCreateRequest,
): Promise<GithubCreateResult> {
  const gh = await whichGh();
  if (!gh) {
    return {
      ok: false,
      message:
        "GitHub CLI (gh) not installed. Create the repo manually or install gh.",
    };
  }

  const fullName = `${req.owner}/${req.name}`;
  const args = [
    "repo",
    "create",
    fullName,
    req.visibility === "private" ? "--private" : "--public",
    "--source",
    ".",
    "--remote",
    "origin",
  ];
  if (req.push !== false) args.push("--push");

  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      cwd: req.cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      ok: true,
      url: `https://github.com/${fullName}`,
      message: (stdout || stderr || `Created ${fullName}`).trim(),
    };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      message: e.stderr || e.message || String(err),
    };
  }
}

export const GITHUB_REMOTE_POLICY =
  "Creating a repository, pushing, changing visibility, or deleting a remote requires explicit approval.";
