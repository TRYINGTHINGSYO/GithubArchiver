import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGithubRepository,
  GITHUB_REMOTE_POLICY,
} from "./adapters/github.js";
import { listAgentDescriptors } from "./agents/registry.js";
import { CursorRunner } from "./cursor.js";
import { GptClient } from "./gpt.js";
import {
  installMarketplacePlugin,
  listMarketplace,
} from "./marketplace.js";
import { loadMetrics, summarizeMetrics } from "./metrics.js";
import {
  buildProjectIndex,
  defaultSearchRoots,
  detectProjectsFromTask,
  parseKnownProjects,
} from "./projects.js";
import {
  formatRecoverySummary,
  listRecoverableSessions,
} from "./recovery.js";
import {
  loadRegistry,
  upsertProject,
} from "./registry/projects.js";
import { PRODUCT_NAME, RelaySession } from "./relay.js";
import { scaffoldProject } from "./scaffold/engine.js";
import { TEMPLATE_CATALOG } from "./scaffold/templates.js";
import type { ProjectTemplateId, ScaffoldRequest } from "./scaffold/types.js";
import type { RelaySnapshot } from "./types.js";
import { PACKAGE_VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

export interface ServerOptions {
  port: number;
  openaiApiKey: string;
  openaiModel: string;
  cursorAgentBin: string;
  cursorApiKey?: string;
  defaultMaxRounds: number;
  publicDir?: string;
  knownProjects?: Record<string, string>;
  searchRoots?: string[];
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

export function createRelayServer(options: ServerOptions) {
  const publicDir = options.publicDir ?? PUBLIC_DIR;
  const knownProjects = options.knownProjects ?? parseKnownProjects();
  const searchRoots = options.searchRoots ?? defaultSearchRoots();

  let session = new RelaySession({
    gpt: new GptClient({
      apiKey: options.openaiApiKey,
      model: options.openaiModel,
    }),
    cursor: new CursorRunner({
      agentBin: options.cursorAgentBin,
      apiKey: options.cursorApiKey,
    }),
  });

  const sseClients = new Set<ServerResponse>();
  const broadcast = (snapshot: RelaySnapshot) => {
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of sseClients) client.write(data);
  };
  session.subscribe(broadcast);

  const resetSession = () => {
    session = new RelaySession({
      gpt: new GptClient({
        apiKey: options.openaiApiKey,
        model: options.openaiModel,
      }),
      cursor: new CursorRunner({
        agentBin: options.cursorAgentBin,
        apiKey: options.cursorApiKey,
      }),
    });
    session.subscribe(broadcast);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const { pathname } = url;
      const method = req.method ?? "GET";

      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          product: PRODUCT_NAME,
          version: PACKAGE_VERSION,
          hasOpenAiKey: Boolean(options.openaiApiKey),
          openaiModel: options.openaiModel,
          cursorAgentBin: options.cursorAgentBin,
          defaultMaxRounds: options.defaultMaxRounds,
          orchestrator: true,
          standalone: true,
        });
        return;
      }

      if (method === "GET" && pathname === "/api/templates") {
        sendJson(res, 200, { templates: TEMPLATE_CATALOG });
        return;
      }

      if (method === "GET" && pathname === "/api/projects") {
        const registry = await loadRegistry();
        sendJson(res, 200, { projects: registry.projects });
        return;
      }

      if (method === "POST" && pathname === "/api/projects/register") {
        const body = (await readJson(req)) as {
          name?: string;
          path?: string;
          lastTask?: string;
        };
        if (!body.name?.trim() || !body.path?.trim()) {
          sendJson(res, 400, { error: "name and path are required" });
          return;
        }
        const entry = await upsertProject({
          name: body.name.trim(),
          path: body.path.trim(),
          lastTask: body.lastTask,
        });
        sendJson(res, 200, { project: entry });
        return;
      }

      if (method === "POST" && pathname === "/api/projects/create") {
        const body = (await readJson(req)) as Partial<ScaffoldRequest>;
        if (!body.name?.trim() || !body.destination?.trim()) {
          sendJson(res, 400, { error: "name and destination are required" });
          return;
        }
        const result = await scaffoldProject({
          name: body.name.trim(),
          description: body.description?.trim() || body.brief?.trim() || body.name,
          destination: body.destination.trim(),
          template: (body.template as ProjectTemplateId) || "blank",
          packageManager: body.packageManager || "npm",
          initGit: body.initGit !== false,
          createGithubRepo: Boolean(body.createGithubRepo),
          githubVisibility: body.githubVisibility || "private",
          githubOwner: body.githubOwner,
          brief: body.brief,
        });
        if (result.ok && result.destinationPath) {
          await upsertProject({
            name: body.name.trim(),
            path: result.destinationPath,
            lastTask: "Project created",
          });
        }
        sendJson(res, result.ok ? 201 : 400, {
          ...result,
          githubPolicy: GITHUB_REMOTE_POLICY,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/projects/github-create") {
        const body = (await readJson(req)) as {
          approved?: boolean;
          owner?: string;
          name?: string;
          visibility?: "private" | "public";
          cwd?: string;
          push?: boolean;
        };
        if (!body.approved) {
          sendJson(res, 403, {
            error: "Remote repository creation requires explicit approval",
            policy: GITHUB_REMOTE_POLICY,
          });
          return;
        }
        if (!body.owner || !body.name || !body.cwd) {
          sendJson(res, 400, { error: "owner, name, and cwd are required" });
          return;
        }
        const result = await createGithubRepository({
          owner: body.owner,
          name: body.name,
          visibility: body.visibility || "private",
          cwd: body.cwd,
          push: body.push !== false,
        });
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (method === "GET" && pathname === "/api/agents") {
        const cursor = new CursorRunner({
          agentBin: options.cursorAgentBin,
          apiKey: options.cursorApiKey,
        });
        sendJson(res, 200, {
          agents: await listAgentDescriptors(cursor),
          default: "cursor",
        });
        return;
      }

      if (method === "GET" && pathname === "/api/marketplace") {
        sendJson(res, 200, { plugins: await listMarketplace() });
        return;
      }

      if (method === "POST" && pathname === "/api/marketplace/install") {
        const body = (await readJson(req)) as { id?: string };
        if (!body.id?.trim()) {
          sendJson(res, 400, { error: "id is required" });
          return;
        }
        const result = await installMarketplacePlugin(body.id.trim());
        sendJson(res, result.ok ? 200 : 404, result);
        return;
      }

      if (method === "POST" && pathname === "/api/retry-graph") {
        const body = (await readJson(req)) as { nodeId?: string };
        if (!body.nodeId?.trim()) {
          sendJson(res, 400, { error: "nodeId is required" });
          return;
        }
        try {
          session.retryGraphNode(body.nodeId.trim());
          sendJson(res, 200, session.snapshot());
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/api/state") {
        sendJson(res, 200, session.snapshot());
        return;
      }

      if (method === "GET" && pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify(session.snapshot())}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (method === "POST" && pathname === "/api/detect-project") {
        const body = (await readJson(req)) as { task?: string };
        const task = body.task?.trim() || "";
        if (!task) {
          sendJson(res, 400, { error: "task is required" });
          return;
        }
        const index = await buildProjectIndex({
          known: knownProjects,
          searchRoots,
        });
        sendJson(res, 200, {
          matches: detectProjectsFromTask(task, index),
          indexSize: Object.keys(index).length,
        });
        return;
      }

      if (method === "POST" && pathname === "/api/start") {
        const body = (await readJson(req)) as {
          projectPath?: string;
          task?: string;
          maxRounds?: number;
          requirePlanApproval?: boolean;
          supervisorEnabled?: boolean;
          autoVerify?: boolean;
          browserVerify?: boolean;
        };
        const snap = session.snapshot();
        if (
          [
            "planning",
            "awaiting_plan",
            "running",
            "paused",
            "awaiting_approval",
            "awaiting_user",
            "verifying",
            "supervising",
          ].includes(snap.status)
        ) {
          sendJson(res, 409, { error: "Orchestrator already active" });
          return;
        }
        if (!options.openaiApiKey) {
          sendJson(res, 400, {
            error: "OPENAI_API_KEY is not set. Copy .env.example to .env first.",
          });
          return;
        }

        let projectPath = body.projectPath?.trim() || "";
        const task = body.task?.trim() || "";
        if (!projectPath && task) {
          const index = await buildProjectIndex({
            known: knownProjects,
            searchRoots,
          });
          const matches = detectProjectsFromTask(task, index);
          if (matches[0] && matches[0].confidence >= 0.75) {
            projectPath = matches[0].path;
          }
        }

        resetSession();
        if (projectPath) {
          void upsertProject({
            name: projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath,
            path: projectPath,
            lastTask: task,
          });
        }
        sendJson(res, 202, { ok: true, projectPath });
        void session
          .start({
            projectPath,
            task,
            maxRounds: body.maxRounds || options.defaultMaxRounds,
            openaiApiKey: options.openaiApiKey,
            openaiModel: options.openaiModel,
            cursorAgentBin: options.cursorAgentBin,
            cursorApiKey: options.cursorApiKey,
            requirePlanApproval: body.requirePlanApproval !== false,
            supervisorEnabled: body.supervisorEnabled !== false,
            autoVerify: body.autoVerify !== false,
            browserVerify: Boolean(body.browserVerify),
          })
          .catch((err) => console.error("[foundry] start failed:", err));
        return;
      }

      if (method === "POST" && pathname === "/api/pause") {
        session.pause();
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "POST" && pathname === "/api/resume") {
        session.resume();
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "POST" && pathname === "/api/stop") {
        await session.stop();
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "POST" && pathname === "/api/approve") {
        const body = (await readJson(req)) as {
          approved?: boolean;
          scope?: "once" | "run";
        };
        session.resolveApproval(
          Boolean(body.approved),
          body.scope === "run" ? "run" : "once",
        );
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "POST" && pathname === "/api/approve-plan") {
        const body = (await readJson(req)) as { approved?: boolean };
        session.resolvePlan(Boolean(body.approved));
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "POST" && pathname === "/api/answer") {
        const body = (await readJson(req)) as { reply?: string };
        session.answerQuestion(body.reply ?? "");
        sendJson(res, 200, session.snapshot());
        return;
      }
      if (method === "GET" && pathname === "/api/rollback-preview") {
        try {
          const preview = await session.previewRollback();
          sendJson(res, 200, preview);
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (method === "POST" && pathname === "/api/rollback") {
        const result = await session.rollback();
        sendJson(res, result.ok ? 200 : 400, {
          ...result,
          state: session.snapshot(),
        });
        return;
      }
      if (method === "POST" && pathname === "/api/follow-up-task") {
        const body = (await readJson(req)) as { selected?: string[] };
        try {
          const task = session.buildFollowUpTask(body.selected ?? []);
          sendJson(res, 200, {
            task,
            projectPath: session.snapshot().projectPath,
            note: "Start this as a new run — it will not continue the completed task.",
          });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      // Legacy endpoint — intentionally disabled (follow-ups are new runs only)
      if (method === "POST" && pathname === "/api/continue-improvements") {
        sendJson(res, 400, {
          error:
            "Follow-ups must start as a new run. Use /api/follow-up-task then /api/start.",
        });
        return;
      }

      if (method === "GET" && pathname === "/api/recovery") {
        const sessions = await listRecoverableSessions();
        sendJson(res, 200, {
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            projectName: s.projectName,
            projectPath: s.projectPath,
            task: s.task,
            round: s.round,
            maxRounds: s.maxRounds,
            status: s.status,
            updatedAt: s.updatedAt,
            summary: formatRecoverySummary(s),
          })),
        });
        return;
      }

      // Crash recovery (distinct from pause/resume at /api/resume)
      if (method === "POST" && pathname === "/api/recover") {
        const body = (await readJson(req)) as { sessionId?: string };
        if (!body.sessionId) {
          sendJson(res, 400, { error: "sessionId is required" });
          return;
        }
        const snap = session.snapshot();
        if (
          [
            "planning",
            "awaiting_plan",
            "running",
            "paused",
            "awaiting_approval",
            "awaiting_user",
            "verifying",
            "supervising",
          ].includes(snap.status)
        ) {
          sendJson(res, 409, { error: "Orchestrator already active" });
          return;
        }
        resetSession();
        sendJson(res, 202, { ok: true, sessionId: body.sessionId });
        void session.resumeRecovered(body.sessionId).catch((err) => {
          console.error("[foundry] recover failed:", err);
        });
        return;
      }

      if (method === "GET" && pathname === "/api/metrics") {
        const tasks = await loadMetrics();
        sendJson(res, 200, summarizeMetrics(tasks));
        return;
      }

      if (method === "GET") {
        const rel =
          pathname === "/"
            ? "index.html"
            : pathname.replace(/^\/+/, "").replace(/\.\./g, "");
        const filePath = path.join(publicDir, rel);
        if (!filePath.startsWith(publicDir)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        try {
          const data = await readFile(filePath);
          res.writeHead(200, { "Content-Type": contentType(filePath) });
          res.end(data);
          return;
        } catch {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
      }

      sendJson(res, 405, { error: "Method not allowed" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return {
    server,
    getSession: () => session,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port, "127.0.0.1", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of sseClients) client.end();
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
