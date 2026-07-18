const els = {
  projectPath: document.getElementById("projectPath"),
  projectName: document.getElementById("projectName"),
  task: document.getElementById("task"),
  maxRounds: document.getElementById("maxRounds"),
  status: document.getElementById("status"),
  roundLabel: document.getElementById("roundLabel"),
  gitMetric: document.getElementById("gitMetric"),
  costMetric: document.getElementById("costMetric"),
  log: document.getElementById("log"),
  summary: document.getElementById("summary"),
  costDetail: document.getElementById("costDetail"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  rollbackBtn: document.getElementById("rollbackBtn"),
  detectBtn: document.getElementById("detectBtn"),
  detectResult: document.getElementById("detectResult"),
  flagPlan: document.getElementById("flagPlan"),
  flagSupervisor: document.getElementById("flagSupervisor"),
  flagVerify: document.getElementById("flagVerify"),
  flagBrowser: document.getElementById("flagBrowser"),
  planPanel: document.getElementById("planPanel"),
  planText: document.getElementById("planText"),
  approvePlanBtn: document.getElementById("approvePlanBtn"),
  rejectPlanBtn: document.getElementById("rejectPlanBtn"),
  approvalPanel: document.getElementById("approvalPanel"),
  approvalReason: document.getElementById("approvalReason"),
  approvalInstruction: document.getElementById("approvalInstruction"),
  approveBtn: document.getElementById("approveBtn"),
  denyBtn: document.getElementById("denyBtn"),
  questionPanel: document.getElementById("questionPanel"),
  questionText: document.getElementById("questionText"),
  userReply: document.getElementById("userReply"),
  answerBtn: document.getElementById("answerBtn"),
  gptLive: document.getElementById("gptLive"),
  cursorLive: document.getElementById("cursorLive"),
  cursorActivity: document.getElementById("cursorActivity"),
  gptLiveHint: document.getElementById("gptLiveHint"),
  diffView: document.getElementById("diffView"),
  diffStat: document.getElementById("diffStat"),
  stopReason: document.getElementById("stopReason"),
  gitIntel: document.getElementById("gitIntel"),
  verifyPanel: document.getElementById("verifyPanel"),
  workersPanel: document.getElementById("workersPanel"),
  stylePanel: document.getElementById("stylePanel"),
  improvementsPanel: document.getElementById("improvementsPanel"),
  improvementsList: document.getElementById("improvementsList"),
  continueImprovementsBtn: document.getElementById("continueImprovementsBtn"),
  timelinePanel: document.getElementById("timelinePanel"),
  metricsPanel: document.getElementById("metricsPanel"),
  recoveryPanel: document.getElementById("recoveryPanel"),
  graphPanel: document.getElementById("graphPanel"),
  graphView: document.getElementById("graphView"),
  graphProgress: document.getElementById("graphProgress"),
  agentsPanel: document.getElementById("agentsPanel"),
  marketplacePanel: document.getElementById("marketplacePanel"),
  productTitle: document.getElementById("productTitle"),
};

const STORAGE_KEY = "foundry";
const saved = JSON.parse(
  localStorage.getItem(STORAGE_KEY) ||
    localStorage.getItem("gpt-cursor-relay") ||
    "{}",
);
if (saved.projectPath) els.projectPath.value = saved.projectPath;
if (saved.task) els.task.value = saved.task;
if (saved.maxRounds) els.maxRounds.value = saved.maxRounds;
if (typeof saved.flagPlan === "boolean") els.flagPlan.checked = saved.flagPlan;
if (typeof saved.flagSupervisor === "boolean") {
  els.flagSupervisor.checked = saved.flagSupervisor;
}
if (typeof saved.flagVerify === "boolean") els.flagVerify.checked = saved.flagVerify;
if (typeof saved.flagBrowser === "boolean") els.flagBrowser.checked = saved.flagBrowser;

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      projectPath: els.projectPath.value,
      task: els.task.value,
      maxRounds: Number(els.maxRounds.value) || 12,
      flagPlan: els.flagPlan.checked,
      flagSupervisor: els.flagSupervisor.checked,
      flagVerify: els.flagVerify.checked,
      flagBrowser: els.flagBrowser.checked,
    }),
  );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function kindGlyph(kind) {
  return (
    { added: "+", removed: "-", modified: "~", untracked: "?", renamed: "~" }[
      kind
    ] || "•"
  );
}

function graphMark(status) {
  return (
    {
      passed: "✓",
      failed: "✗",
      running: "●",
      verifying: "●",
      ready: "○",
      blocked: "■",
      skipped: "–",
      pending: "·",
    }[status] || "·"
  );
}

function renderGraph(graph) {
  if (!graph || !graph.nodes?.length) {
    els.graphPanel.classList.add("hidden");
    return;
  }
  els.graphPanel.classList.remove("hidden");
  const p = graph.progress || {};
  els.graphProgress.textContent = `${p.passed ?? 0}/${p.total ?? 0} passed` +
    (p.failed ? ` · ${p.failed} failed` : "") +
    (p.blocked ? ` · ${p.blocked} blocked` : "") +
    (p.complete ? " · complete" : "");
  els.graphView.innerHTML = graph.nodes
    .map((n) => {
      const deps = n.dependsOn?.length ? ` ← ${n.dependsOn.join(", ")}` : "";
      const err = n.error ? `<div class="graph-meta">${escapeHtml(n.error)}</div>` : "";
      const retry =
        n.status === "failed"
          ? `<button type="button" data-retry="${escapeHtml(n.id)}" class="ghost">Retry</button>`
          : "";
      return `<div class="graph-node ${escapeHtml(n.status)}">
        <span class="graph-mark">${graphMark(n.status)}</span>
        <div>
          <div class="graph-title">${escapeHtml(n.id)} · ${escapeHtml(n.title)}</div>
          <div class="graph-meta">${escapeHtml(n.status)}${escapeHtml(deps)}${n.role ? ` · ${escapeHtml(n.role)}` : ""}</div>
          ${err}
        </div>
        ${retry}
      </div>`;
    })
    .join("");
  els.graphView.querySelectorAll("[data-retry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      post("/api/retry-graph", { nodeId: btn.getAttribute("data-retry") }).catch(
        (err) => alert(err.message),
      );
    });
  });
}

function renderDiff(git) {
  if (!git || (!git.diffFiles?.length && !git.files?.length)) {
    els.diffView.textContent = "(no changes yet)";
    els.diffStat.textContent = "—";
    return;
  }
  els.diffStat.textContent = `${git.files?.length ?? 0} files · +${git.additions ?? 0} -${git.deletions ?? 0}`;
  if (git.diffFiles?.length) {
    els.diffView.innerHTML = git.diffFiles
      .map((file) => {
        const head = `${kindGlyph(file.kind)} ${escapeHtml(file.path)} (+${file.additions}/-${file.deletions})`;
        const body = (file.lines || [])
          .map(
            (line) =>
              `<div class="diff-line ${line.type || "ctx"}">${escapeHtml(line.text)}</div>`,
          )
          .join("");
        return `<div class="diff-file"><div class="diff-file-head">${head}</div>${body}</div>`;
      })
      .join("");
    return;
  }
  els.diffView.innerHTML = git.files
    .map(
      (f) =>
        `<div class="diff-line meta">${kindGlyph(f.kind)} ${escapeHtml(f.path)}</div>`,
    )
    .join("");
}

function render(state) {
  els.status.textContent = state.status;
  els.status.className = `status ${state.status}`;
  els.roundLabel.textContent = `${state.round} / ${state.maxRounds}`;
  els.projectName.textContent = state.projectName || "—";

  const git = state.git;
  els.gitMetric.textContent = git
    ? `${git.files?.length ?? 0} files · +${git.additions ?? 0}/-${git.deletions ?? 0}`
    : "0 files";
  els.costMetric.textContent = `$${(state.cost?.totalUsd ?? 0).toFixed(2)}`;

  const active = [
    "planning",
    "awaiting_plan",
    "running",
    "paused",
    "awaiting_approval",
    "awaiting_user",
    "verifying",
    "supervising",
  ].includes(state.status);
  els.startBtn.disabled = active;
  els.pauseBtn.disabled = !["running", "verifying"].includes(state.status);
  els.resumeBtn.disabled = state.status !== "paused";
  els.stopBtn.disabled = !active;
  els.rollbackBtn.disabled = !state.canRollback;
  els.projectPath.disabled = active;
  els.task.disabled = active;
  els.maxRounds.disabled = active;
  els.detectBtn.disabled = active;

  els.gptLive.textContent = state.live?.gpt || "(waiting)";
  els.cursorLive.textContent = state.live?.cursor || "(waiting)";
  els.cursorActivity.textContent = state.live?.cursorActivity
    ? `· ${state.live.cursorActivity}`
    : "";
  els.gptLive.scrollTop = els.gptLive.scrollHeight;
  els.cursorLive.scrollTop = els.cursorLive.scrollHeight;
  els.stopReason.textContent = state.stopReason ? `stop: ${state.stopReason}` : "";

  if (state.gitIntel) {
    els.gitIntel.textContent = [
      state.gitIntel.theme,
      "",
      ...(state.gitIntel.bullets || []),
      "",
      `Risk: ${state.gitIntel.risk}`,
      `Breaking changes: ${state.gitIntel.breakingChanges}`,
      `Migration: ${state.gitIntel.migration}`,
    ].join("\n");
  } else {
    els.gitIntel.textContent = "(none yet)";
  }

  els.verifyPanel.textContent = state.verification?.summary || "(none yet)";
  els.workersPanel.textContent = state.workers?.length
    ? state.workers
        .map(
          (w) =>
            `[${w.role}] ok=${w.ok} files=${w.filesChanged.length}\n${w.summary.slice(0, 400)}`,
        )
        .join("\n\n")
    : "(none)";

  const style = state.memory?.style;
  els.stylePanel.textContent = style?.prefers?.length
    ? [
        ...style.prefers.map((p) => `✓ ${p}`),
        ...(style.avoids || []).map((a) => `✗ avoid ${a}`),
      ].join("\n")
    : "(none yet)";

  const cost = state.cost || {};
  els.costDetail.textContent = (cost.rounds || []).length
    ? [
        ...(cost.rounds || []).map(
          (r) =>
            `Round ${r.round}\nGPT: $${(r.gptUsd ?? 0).toFixed(4)}\nCursor: ~${r.cursorTokens ?? 0} tok`,
        ),
        `Total: $${(cost.totalUsd ?? 0).toFixed(4)}`,
      ].join("\n\n")
    : "(none yet)";

  els.log.innerHTML = (state.logs || [])
    .map((entry) => {
      const round = entry.round != null ? ` r${entry.round}` : "";
      const head = `${entry.ts.slice(11, 19)} [${entry.source}${round}]`;
      return `<div class="src-${entry.source}"><strong>${escapeHtml(head)}</strong>\n${escapeHtml(entry.text)}\n</div>`;
    })
    .join("\n");
  els.log.scrollTop = els.log.scrollHeight;

  els.summary.textContent = state.summary || state.error || "(not finished yet)";
  renderDiff(git);

  els.timelinePanel.textContent = (state.timeline || []).length
    ? state.timeline
        .slice(-40)
        .map((e) => `${e.ts.slice(11, 19)}  ${e.message}`)
        .join("\n")
    : "(no events yet)";

  if (state.productName && els.productTitle) {
    els.productTitle.textContent = state.productName;
  }

  renderGraph(state.taskGraph);

  if (state.status === "awaiting_plan" && state.pendingPlan) {
    const p = state.pendingPlan;
    els.planPanel.classList.remove("hidden");
    const graphLines = state.taskGraph?.nodes?.length
      ? [
          "",
          "Task graph:",
          ...state.taskGraph.nodes.map((n) => {
            const deps = n.dependsOn?.length ? ` ← ${n.dependsOn.join(", ")}` : "";
            return `${graphMark(n.status)} ${n.id} ${n.title}${deps}`;
          }),
        ]
      : [];
    els.planText.textContent = [
      p.title,
      "",
      ...p.steps.map((s) => {
        const deps = s.dependsOn?.length ? ` (after ${s.dependsOn.join(", ")})` : "";
        return `${s.id}. ${s.title}${deps}\n   ${s.detail}`;
      }),
      ...graphLines,
      "",
      `Estimated: ${p.estimatedMinutes} minutes`,
      `Files likely touched: ${p.filesLikelyTouched?.join(", ") || "(unspecified)"}`,
      `Risk: ${p.risk}`,
      p.notes ? `Notes: ${p.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    els.planPanel.classList.add("hidden");
  }

  if (state.status === "awaiting_approval" && state.pendingApproval) {
    els.approvalPanel.classList.remove("hidden");
    els.approvalReason.textContent = state.pendingApproval.reason;
    els.approvalInstruction.textContent = state.pendingApproval.instruction;
  } else {
    els.approvalPanel.classList.add("hidden");
  }

  if (state.status === "awaiting_user" && state.pendingQuestion) {
    els.questionPanel.classList.remove("hidden");
    els.questionText.textContent = state.pendingQuestion;
  } else {
    els.questionPanel.classList.add("hidden");
  }

  const improvements = state.nextImprovements || [];
  if (state.status === "completed" && improvements.length) {
    els.improvementsPanel.classList.remove("hidden");
    els.improvementsList.innerHTML = improvements
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  } else {
    els.improvementsPanel.classList.add("hidden");
  }
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

els.detectBtn.addEventListener("click", async () => {
  persist();
  try {
    const data = await post("/api/detect-project", { task: els.task.value.trim() });
    const best = data.matches?.[0];
    if (!best) {
      els.detectResult.textContent = "No project match — set the folder path manually.";
      return;
    }
    els.detectResult.textContent = `Detected: ${best.name} (${Math.round(best.confidence * 100)}%)`;
    els.projectPath.value = best.path;
    persist();
  } catch (err) {
    alert(err.message);
  }
});

els.startBtn.addEventListener("click", async () => {
  persist();
  try {
    if (!els.projectPath.value.trim() && els.task.value.trim()) {
      const data = await post("/api/detect-project", {
        task: els.task.value.trim(),
      });
      const best = data.matches?.[0];
      if (best) {
        const ok = confirm(`Detected:\n✓ ${best.name}\n\n${best.path}\n\nRun?`);
        if (!ok) return;
        els.projectPath.value = best.path;
        persist();
      }
    }
    await post("/api/start", {
      projectPath: els.projectPath.value.trim(),
      task: els.task.value.trim(),
      maxRounds: Number(els.maxRounds.value) || 12,
      requirePlanApproval: els.flagPlan.checked,
      supervisorEnabled: els.flagSupervisor.checked,
      autoVerify: els.flagVerify.checked,
      browserVerify: els.flagBrowser.checked,
    });
  } catch (err) {
    alert(err.message);
  }
});

els.pauseBtn.addEventListener("click", () => post("/api/pause").catch(alert));
els.resumeBtn.addEventListener("click", () => post("/api/resume").catch(alert));
els.stopBtn.addEventListener("click", () => post("/api/stop").catch(alert));
els.rollbackBtn.addEventListener("click", async () => {
  if (!confirm("Undo last autonomous run? This runs git reset --hard + clean.")) {
    return;
  }
  try {
    const result = await post("/api/rollback");
    alert(result.message || "Rolled back");
  } catch (err) {
    alert(err.message);
  }
});
els.approvePlanBtn.addEventListener("click", () =>
  post("/api/approve-plan", { approved: true }).catch(alert),
);
els.rejectPlanBtn.addEventListener("click", () =>
  post("/api/approve-plan", { approved: false }).catch(alert),
);
els.approveBtn.addEventListener("click", () =>
  post("/api/approve", { approved: true }).catch(alert),
);
els.denyBtn.addEventListener("click", () =>
  post("/api/approve", { approved: false }).catch(alert),
);
els.answerBtn.addEventListener("click", () =>
  post("/api/answer", { reply: els.userReply.value })
    .then(() => {
      els.userReply.value = "";
    })
    .catch(alert),
);
els.continueImprovementsBtn.addEventListener("click", () =>
  post("/api/continue-improvements").catch(alert),
);

for (const el of [
  els.projectPath,
  els.task,
  els.maxRounds,
  els.flagPlan,
  els.flagSupervisor,
  els.flagVerify,
  els.flagBrowser,
]) {
  el.addEventListener("change", persist);
}

const bootstrap = await fetch("/api/health").then((r) => r.json());
if (bootstrap.product && els.productTitle) {
  els.productTitle.textContent = bootstrap.product;
}
if (!bootstrap.hasOpenAiKey) {
  els.summary.textContent =
    "OPENAI_API_KEY is missing. Run: foundry setup  (or copy tools/foundry/.env.example)";
}

async function refreshMetricsAndRecovery() {
  try {
    const metrics = await fetch("/api/metrics").then((r) => r.json());
    els.metricsPanel.textContent = [
      `Tasks: ${metrics.tasks}`,
      `Success rate: ${Math.round((metrics.successRate || 0) * 100)}%`,
      `Avg rounds: ${(metrics.averageRounds || 0).toFixed(1)}`,
      `Avg cost: $${(metrics.averageCostUsd || 0).toFixed(4)}`,
      `Verify failures: ${metrics.verifyFailures || 0}`,
      "",
      "Stop reasons:",
      ...Object.entries(metrics.stopReasons || {}).map(
        ([k, v]) => `• ${k}: ${v}`,
      ),
    ].join("\n");
  } catch {
    els.metricsPanel.textContent = "(metrics unavailable)";
  }

  try {
    const data = await fetch("/api/recovery").then((r) => r.json());
    const sessions = data.sessions || [];
    if (!sessions.length) {
      els.recoveryPanel.innerHTML = "<em>No crashed sessions to recover.</em>";
      return;
    }
    const top = sessions[0];
    els.recoveryPanel.innerHTML = `
      <strong>Recovered session available</strong>
      <pre class="code" style="max-height:160px;overflow:auto">${escapeHtml(top.summary)}</pre>
      <button id="resumeBtnSession" type="button" class="ok">Resume</button>
    `;
    document.getElementById("resumeBtnSession")?.addEventListener("click", () => {
      post("/api/recover", { sessionId: top.sessionId }).catch(alert);
    });
  } catch {
    els.recoveryPanel.textContent = "";
  }
}

async function refreshAgentsAndMarketplace() {
  try {
    const data = await fetch("/api/agents").then((r) => r.json());
    els.agentsPanel.textContent = (data.agents || [])
      .map((a) => `${a.available ? "✓" : "·"} ${a.displayName}\n  ${a.notes}`)
      .join("\n");
  } catch {
    els.agentsPanel.textContent = "(agents unavailable)";
  }
  try {
    const data = await fetch("/api/marketplace").then((r) => r.json());
    els.marketplacePanel.textContent = (data.plugins || [])
      .map(
        (p) =>
          `${p.installed ? "✓" : "·"} ${p.name} [${p.category}] v${p.version}\n  ${p.description}`,
      )
      .join("\n");
  } catch {
    els.marketplacePanel.textContent = "(marketplace unavailable)";
  }
}

render(await fetch("/api/state").then((r) => r.json()));
await refreshMetricsAndRecovery();
await refreshAgentsAndMarketplace();
const events = new EventSource("/api/events");
events.onmessage = (event) => {
  render(JSON.parse(event.data));
};
setInterval(refreshMetricsAndRecovery, 15000);
