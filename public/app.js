const $ = (id) => document.getElementById(id);

const els = {
  productTitle: $("productTitle"),
  status: $("status"),
  trustLabel: $("trustLabel"),
  landing: $("landing"),
  workspace: $("workspace"),
  modeCreate: $("modeCreate"),
  modeOpen: $("modeOpen"),
  modeResume: $("modeResume"),
  createPanel: $("createPanel"),
  resumePanel: $("resumePanel"),
  newName: $("newName"),
  newDesc: $("newDesc"),
  newDest: $("newDest"),
  newTemplate: $("newTemplate"),
  newGit: $("newGit"),
  newGithub: $("newGithub"),
  newGhOwner: $("newGhOwner"),
  createProjectBtn: $("createProjectBtn"),
  cancelCreateBtn: $("cancelCreateBtn"),
  createResult: $("createResult"),
  githubApprove: $("githubApprove"),
  githubApproveDetail: $("githubApproveDetail"),
  githubCreatePush: $("githubCreatePush"),
  githubLocalOnly: $("githubLocalOnly"),
  githubCancel: $("githubCancel"),
  landingRecovery: $("landingRecovery"),
  cancelResumeBtn: $("cancelResumeBtn"),
  backLanding: $("backLanding"),
  projectName: $("projectName"),
  taskDisplay: $("taskDisplay"),
  statusDetail: $("statusDetail"),
  progressLabel: $("progressLabel"),
  currentAction: $("currentAction"),
  costMetric: $("costMetric"),
  elapsedLabel: $("elapsedLabel"),
  agentsStrip: $("agentsStrip"),
  task: $("task"),
  projectPath: $("projectPath"),
  maxRounds: $("maxRounds"),
  startBtn: $("startBtn"),
  pauseBtn: $("pauseBtn"),
  resumeBtn: $("resumeBtn"),
  stopBtn: $("stopBtn"),
  detectBtn: $("detectBtn"),
  detectResult: $("detectResult"),
  flagPlan: $("flagPlan"),
  flagSupervisor: $("flagSupervisor"),
  flagVerify: $("flagVerify"),
  flagBrowser: $("flagBrowser"),
  actionBanner: $("actionBanner"),
  actionBannerLead: $("actionBannerLead"),
  actionEffects: $("actionEffects"),
  actionAgent: $("actionAgent"),
  actionCwd: $("actionCwd"),
  actionPolicy: $("actionPolicy"),
  actionRisk: $("actionRisk"),
  actionCommand: $("actionCommand"),
  questionBlock: $("questionBlock"),
  questionText: $("questionText"),
  userReply: $("userReply"),
  planBlock: $("planBlock"),
  planText: $("planText"),
  approveOnceBtn: $("approveOnceBtn"),
  approveRunBtn: $("approveRunBtn"),
  denyBtn: $("denyBtn"),
  approvePlanBtn: $("approvePlanBtn"),
  rejectPlanBtn: $("rejectPlanBtn"),
  answerBtn: $("answerBtn"),
  notifySound: $("notifySound"),
  completionReport: $("completionReport"),
  reportResult: $("reportResult"),
  reportChanged: $("reportChanged"),
  reportRisk: $("reportRisk"),
  reportConfidence: $("reportConfidence"),
  reportVerify: $("reportVerify"),
  reportEvidence: $("reportEvidence"),
  reportChanges: $("reportChanges"),
  viewChangesBtn: $("viewChangesBtn"),
  rollbackBtn: $("rollbackBtn"),
  rollbackPreview: $("rollbackPreview"),
  followUpsPanel: $("followUpsPanel"),
  followUpsList: $("followUpsList"),
  startFollowUpBtn: $("startFollowUpBtn"),
  graphProgress: $("graphProgress"),
  graphView: $("graphView"),
  gptLive: $("gptLive"),
  cursorLive: $("cursorLive"),
  cursorActivity: $("cursorActivity"),
  contextPanel: $("contextPanel"),
  recoveryPanel: $("recoveryPanel"),
  metricsPanel: $("metricsPanel"),
  diffView: $("diffView"),
  diffStat: $("diffStat"),
  gitIntel: $("gitIntel"),
  verifyPanel: $("verifyPanel"),
  workersPanel: $("workersPanel"),
  timelinePanel: $("timelinePanel"),
  log: $("log"),
  stopReason: $("stopReason"),
  costDetail: $("costDetail"),
  stylePanel: $("stylePanel"),
  agentsPanel: $("agentsPanel"),
  marketplacePanel: $("marketplacePanel"),
  credentialHint: $("credentialHint"),
};

let pendingGithub = null;

function showLanding() {
  els.landing?.classList.remove("hidden");
  els.workspace?.classList.add("hidden");
  els.createPanel?.classList.add("hidden");
  els.resumePanel?.classList.add("hidden");
  els.githubApprove?.classList.add("hidden");
  pendingGithub = null;
}

function showWorkspace() {
  els.landing?.classList.add("hidden");
  els.workspace?.classList.remove("hidden");
}

function showCreatePanel() {
  els.createPanel?.classList.remove("hidden");
  els.resumePanel?.classList.add("hidden");
}

async function loadTemplates() {
  if (!els.newTemplate) return;
  try {
    const data = await fetch("/api/templates").then((r) => r.json());
    const templates = data.templates || [];
    els.newTemplate.innerHTML = templates
      .map(
        (t) =>
          `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)} — ${escapeHtml(t.description)}</option>`,
      )
      .join("");
  } catch {
    els.newTemplate.innerHTML =
      '<option value="blank">Blank project</option><option value="web-app">Web application</option>';
  }
}

async function renderLandingRecovery() {
  if (!els.landingRecovery) return;
  try {
    const data = await fetch("/api/recovery").then((r) => r.json());
    const sessions = data.sessions || [];
    if (!sessions.length) {
      els.landingRecovery.innerHTML = "<em>No recoverable sessions.</em>";
      return;
    }
    els.landingRecovery.innerHTML = sessions
      .slice(0, 5)
      .map(
        (s, i) => `
        <div class="recovery-card">
          <pre class="code">${escapeHtml(s.summary || s.sessionId)}</pre>
          <button type="button" class="ok resume-session" data-id="${escapeHtml(s.sessionId)}" data-i="${i}">Resume</button>
        </div>`,
      )
      .join("");
    els.landingRecovery.querySelectorAll(".resume-session").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await post("/api/recover", { sessionId: btn.dataset.id });
        showWorkspace();
      });
    });
  } catch {
    els.landingRecovery.innerHTML = "<em>Could not load sessions.</em>";
  }
}

els.modeCreate?.addEventListener("click", () => {
  showCreatePanel();
  loadTemplates();
});

els.modeOpen?.addEventListener("click", () => {
  showWorkspace();
});

els.modeResume?.addEventListener("click", () => {
  els.resumePanel?.classList.remove("hidden");
  els.createPanel?.classList.add("hidden");
  renderLandingRecovery();
});

els.cancelCreateBtn?.addEventListener("click", showLanding);
els.cancelResumeBtn?.addEventListener("click", showLanding);
els.backLanding?.addEventListener("click", showLanding);

els.createProjectBtn?.addEventListener("click", async () => {
  const name = els.newName?.value.trim();
  const destination = els.newDest?.value.trim();
  if (!name || !destination) {
    alert("Name and destination folder are required");
    return;
  }
  els.createResult?.classList.remove("hidden");
  els.createResult.textContent = "Creating project…";
  els.githubApprove?.classList.add("hidden");
  try {
    const res = await fetch("/api/projects/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: els.newDesc?.value.trim() || name,
        brief: els.newDesc?.value.trim() || name,
        destination,
        template: els.newTemplate?.value || "blank",
        initGit: els.newGit?.checked !== false,
        createGithubRepo: Boolean(els.newGithub?.checked),
        githubOwner: els.newGhOwner?.value.trim() || undefined,
        githubVisibility: "private",
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      els.createResult.textContent = data.message || data.error || "Create failed";
      return;
    }
    const lines = [
      data.message,
      `Files created: ${data.filesCreated}`,
      `Git initialized: ${data.gitInitialized ? "yes" : "no"}`,
      `Initial commit: ${data.initialCommit ? "yes" : "no"}`,
      data.verifySummary || "",
    ].filter(Boolean);
    els.createResult.textContent = lines.join("\n");
    if (data.destinationPath) {
      els.projectPath.value = data.destinationPath;
      persist();
    }
    if (data.pendingGithub) {
      pendingGithub = data.pendingGithub;
      els.githubApprove?.classList.remove("hidden");
      els.githubApproveDetail.textContent = [
        `GitHub repository: ${pendingGithub.owner}/${pendingGithub.name}`,
        `Visibility: ${pendingGithub.visibility || "private"}`,
        `Initial branch: main`,
        `Local path: ${pendingGithub.cwd}`,
        "",
        data.githubPolicy || "",
      ].join("\n");
    } else {
      showWorkspace();
    }
  } catch (err) {
    els.createResult.textContent = err.message || String(err);
  }
});

els.githubCreatePush?.addEventListener("click", async () => {
  if (!pendingGithub) return;
  try {
    const res = await fetch("/api/projects/github-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: true,
        owner: pendingGithub.owner,
        name: pendingGithub.name,
        visibility: pendingGithub.visibility || "private",
        cwd: pendingGithub.cwd,
        push: true,
      }),
    });
    const data = await res.json();
    els.createResult.textContent = [
      els.createResult.textContent,
      "",
      data.ok
        ? `GitHub: ${data.url || "created"}`
        : `GitHub failed: ${data.message || data.error}`,
    ].join("\n");
    if (data.ok) {
      els.githubApprove?.classList.add("hidden");
      pendingGithub = null;
      showWorkspace();
    }
  } catch (err) {
    alert(err.message);
  }
});

els.githubLocalOnly?.addEventListener("click", () => {
  els.githubApprove?.classList.add("hidden");
  pendingGithub = null;
  if (els.createResult) {
    els.createResult.textContent += "\nGitHub repository: Not created — local only";
  }
  showWorkspace();
});

els.githubCancel?.addEventListener("click", () => {
  els.githubApprove?.classList.add("hidden");
  pendingGithub = null;
});

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
if (typeof saved.notifySound === "boolean") els.notifySound.checked = saved.notifySound;

let lastNeedsAction = false;
let elapsedTimer = null;

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
      notifySound: els.notifySound.checked,
    }),
  );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatElapsed(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return m ? `${m}m ${r}s` : `${r}s`;
}

function formatDuration(ms) {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return formatElapsed(ms);
}

function graphMark(status) {
  return (
    {
      passed: "✓",
      failed: "✕",
      running: "●",
      verifying: "●",
      ready: "○",
      blocked: "■",
      skipped: "–",
      pending: "○",
    }[status] || "·"
  );
}

function activeStatuses(status) {
  return [
    "planning",
    "awaiting_plan",
    "running",
    "paused",
    "awaiting_approval",
    "awaiting_user",
    "verifying",
    "supervising",
  ].includes(status);
}

function notifyActionNeeded() {
  if (!els.notifySound.checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 180);
  } catch {
    // ignore
  }
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    new Notification("Foundry needs you", {
      body: "Approval or input required",
    });
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("hidden", p.id !== `tab-${name}`);
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

function renderAgentsStrip(state) {
  const chips = [];
  chips.push({
    label: "Planner",
    state:
      state.status === "planning" || state.status === "awaiting_plan"
        ? "active"
        : state.round > 0 || state.pendingPlan || state.taskGraph
          ? "done"
          : "wait",
  });
  if (state.taskGraph?.nodes?.length) {
    for (const n of state.taskGraph.nodes.slice(0, 6)) {
      chips.push({
        label: n.role || n.title.slice(0, 18),
        state:
          n.status === "running" || n.status === "verifying"
            ? "active"
            : n.status === "passed" || n.status === "skipped"
              ? "done"
              : "wait",
      });
    }
  } else if (state.workers?.length) {
    for (const w of state.workers) {
      chips.push({
        label: w.role,
        state: w.ok ? "done" : "active",
      });
    }
  } else {
    chips.push({
      label: "Coding agent",
      state: ["running", "verifying", "supervising"].includes(state.status)
        ? "active"
        : state.status === "completed"
          ? "done"
          : "wait",
    });
  }
  chips.push({
    label: "Reviewer",
    state:
      state.status === "verifying"
        ? "active"
        : state.verification
          ? "done"
          : "wait",
  });
  els.agentsStrip.innerHTML = chips
    .map(
      (c) =>
        `<span class="agent-chip ${c.state}">${c.state === "done" ? "✓" : c.state === "active" ? "●" : "○"} ${escapeHtml(c.label)}</span>`,
    )
    .join("");
}

function renderActionBanner(state) {
  const needsApproval = state.status === "awaiting_approval" && state.pendingApproval;
  const needsPlan = state.status === "awaiting_plan" && state.pendingPlan;
  const needsUser = state.status === "awaiting_user" && state.pendingQuestion;
  const needs = Boolean(needsApproval || needsPlan || needsUser);

  if (needs && !lastNeedsAction) notifyActionNeeded();
  lastNeedsAction = needs;

  document.body.classList.toggle("needs-user", needs);
  els.actionBanner.classList.toggle("hidden", !needs);

  els.approveOnceBtn.classList.toggle("hidden", !needsApproval);
  els.approveRunBtn.classList.toggle("hidden", !needsApproval);
  els.denyBtn.classList.toggle("hidden", !(needsApproval || needsPlan));
  els.approvePlanBtn.classList.toggle("hidden", !needsPlan);
  els.rejectPlanBtn.classList.toggle("hidden", !needsPlan);
  els.answerBtn.classList.toggle("hidden", !needsUser);
  els.questionBlock.classList.toggle("hidden", !needsUser);
  els.planBlock.classList.toggle("hidden", !needsPlan);

  if (needsApproval) {
    const a = state.pendingApproval;
    els.actionBannerLead.textContent =
      a.requestedBy || "An agent"
        ? `${a.requestedBy || "Agent"} wants to proceed with a sensitive operation`
        : a.reason;
    els.actionEffects.innerHTML = (a.effects?.length ? a.effects : [a.reason])
      .map((e) => `<li>${escapeHtml(e)}</li>`)
      .join("");
    els.actionAgent.textContent = a.requestedBy || "Coding agent";
    els.actionCwd.textContent = a.workingDirectory || state.projectPath || "—";
    els.actionPolicy.textContent = a.policy || a.reason;
    els.actionRisk.textContent = (a.risk || "medium").toUpperCase();
    els.actionCommand.textContent = a.command || a.instruction || "";
  } else if (needsPlan) {
    const p = state.pendingPlan;
    els.actionBannerLead.textContent = `Approve plan: ${p.title}`;
    els.actionEffects.innerHTML = p.steps
      .map(
        (s) =>
          `<li>${escapeHtml(s.id)}. ${escapeHtml(s.title)}${s.dependsOn?.length ? ` ← ${s.dependsOn.join(", ")}` : ""}</li>`,
      )
      .join("");
    els.actionAgent.textContent = "Planner";
    els.actionCwd.textContent = state.projectPath || "—";
    els.actionPolicy.textContent = "Plan approval required";
    els.actionRisk.textContent = (p.risk || "medium").toUpperCase();
    els.actionCommand.textContent = "";
    els.planText.textContent = [
      p.title,
      "",
      ...p.steps.map((s) => `${s.id}. ${s.title}\n   ${s.detail}`),
      "",
      `Estimated: ${p.estimatedMinutes} min · Risk: ${p.risk}`,
    ].join("\n");
  } else if (needsUser) {
    els.actionBannerLead.textContent = "Foundry needs your input";
    els.actionEffects.innerHTML = "";
    els.actionAgent.textContent = "Supervisor";
    els.actionCwd.textContent = state.projectPath || "—";
    els.actionPolicy.textContent = "needs_user";
    els.actionRisk.textContent = "—";
    els.actionCommand.textContent = "";
    els.questionText.textContent = state.pendingQuestion;
  }
}

function renderGraph(graph) {
  if (!graph?.nodes?.length) {
    els.graphView.innerHTML = "<p class='hint'>No task graph for this run yet.</p>";
    els.graphProgress.textContent = "";
    return;
  }
  const p = graph.progress || {};
  els.graphProgress.textContent = `${p.passed ?? 0}/${p.total ?? 0} passed` +
    (p.failed ? ` · ${p.failed} failed` : "") +
    (p.complete ? " · complete" : "");
  els.graphView.innerHTML = graph.nodes
    .map((n) => {
      const deps = n.dependsOn?.length ? `Depends on ${n.dependsOn.join(", ")}` : "No prerequisites";
      const dur = n.durationMs != null ? formatDuration(n.durationMs) : "";
      const files = n.filesChanged?.length
        ? `${n.filesChanged.length} file(s) changed`
        : "";
      const worker = n.workerLabel ? `Worker: ${n.workerLabel}` : "";
      const action =
        n.status === "running" || n.status === "verifying"
          ? n.currentAction || "Working…"
          : n.status === "pending" || n.status === "ready"
            ? n.status === "ready"
              ? "Ready"
              : "Waiting on prerequisites"
            : n.verifySummary || n.error || "";
      const retry =
        n.status === "failed"
          ? `<div class="graph-actions">
              <button type="button" data-retry="${escapeHtml(n.id)}">Retry</button>
            </div>`
          : "";
      return `<div class="graph-node ${escapeHtml(n.status)}">
        <span class="graph-mark">${graphMark(n.status)}</span>
        <div>
          <div class="graph-title">${escapeHtml(n.title)}</div>
          <div class="graph-meta">${escapeHtml([dur, worker, files, deps].filter(Boolean).join(" · "))}</div>
          <div class="graph-meta">${escapeHtml(action)}</div>
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
        const head = `${file.path} (+${file.additions}/-${file.deletions})`;
        const body = (file.lines || [])
          .map(
            (line) =>
              `<div class="diff-line ${line.type || "ctx"}">${escapeHtml(line.text)}</div>`,
          )
          .join("");
        return `<div class="diff-file"><div class="diff-file-head">${escapeHtml(head)}</div>${body}</div>`;
      })
      .join("");
    return;
  }
  els.diffView.innerHTML = git.files
    .map((f) => `<div class="diff-line meta">${escapeHtml(f.path)}</div>`)
    .join("");
}

function renderCompletion(state) {
  const done = state.status === "completed" && state.runReport;
  els.completionReport.classList.toggle("hidden", !done && state.status !== "completed");
  if (state.status !== "completed") {
    els.completionReport.classList.add("hidden");
    return;
  }
  els.completionReport.classList.remove("hidden");
  const r = state.runReport;
  els.reportResult.textContent = r?.result || state.summary || "Task complete.";
  els.reportChanged.textContent = r
    ? `${r.filesChanged} files · +${r.additions} / -${r.deletions}`
    : `${state.git?.files?.length ?? 0} files`;
  els.reportRisk.textContent = (r?.risk || state.gitIntel?.risk || "—").toString();
  els.reportConfidence.textContent = r
    ? `${r.confidence}% — ${r.confidenceSummary}`
    : "—";
  els.reportVerify.innerHTML = (r?.verificationLines || [])
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join("") || "<li>(none)</li>";
  els.reportEvidence.innerHTML = (r?.evidence || [])
    .map(
      (e) =>
        `<li>${e.ok ? "✓" : "⚠"} ${escapeHtml(e.label)}${e.note ? ` — ${escapeHtml(e.note)}` : ""}</li>`,
    )
    .join("") || "<li>(none)</li>";
  els.reportChanges.innerHTML = (r?.importantChanges || [])
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join("") || "<li>(see Changes tab)</li>";

  const followUps = state.followUps || state.nextImprovements || [];
  if (followUps.length) {
    els.followUpsPanel.classList.remove("hidden");
    els.followUpsList.innerHTML = followUps
      .map(
        (item, i) =>
          `<li><label><input type="checkbox" data-fu="${i}" /> ${escapeHtml(item)}</label></li>`,
      )
      .join("");
  } else {
    els.followUpsPanel.classList.add("hidden");
  }
}

function render(state) {
  if (state.productName) els.productTitle.textContent = state.productName;
  els.status.textContent = state.status;
  els.status.className = `status ${state.status}`;
  els.trustLabel.textContent = state.trustLabel || state.trustLevel || "Safe edits";
  els.projectName.textContent = state.projectName || "—";
  els.taskDisplay.textContent = state.task || els.task.value || "—";
  els.statusDetail.textContent = state.currentAction || state.status;
  els.currentAction.textContent = state.currentAction || "—";
  els.costMetric.textContent = `$${(state.cost?.totalUsd ?? 0).toFixed(2)}`;
  els.elapsedLabel.textContent = formatElapsed(state.elapsedMs);

  const g = state.taskGraph?.progress;
  if (g) {
    els.progressLabel.textContent = `${g.passed} of ${g.total} tasks complete`;
  } else {
    els.progressLabel.textContent = `Round ${state.round} / ${state.maxRounds}`;
  }

  const active = activeStatuses(state.status);
  els.startBtn.disabled = active;
  els.pauseBtn.disabled = !["running", "verifying"].includes(state.status);
  els.resumeBtn.disabled = state.status !== "paused";
  els.stopBtn.disabled = !active;
  els.rollbackBtn.disabled = !state.canRollback;
  els.projectPath.disabled = active;
  els.task.disabled = active;
  els.maxRounds.disabled = active;
  els.detectBtn.disabled = active;

  renderAgentsStrip(state);
  renderActionBanner(state);
  renderGraph(state.taskGraph);
  renderDiff(state.git);
  renderCompletion(state);

  els.gptLive.textContent = state.live?.gpt || "(waiting)";
  els.cursorLive.textContent = state.live?.cursor || "(waiting)";
  els.cursorActivity.textContent = state.live?.cursorActivity
    ? `· ${state.live.cursorActivity}`
    : "";
  els.stopReason.textContent = state.stopReason ? `stop: ${state.stopReason}` : "";

  if (state.contextBudget) {
    const b = state.contextBudget;
    els.contextPanel.textContent = [
      "Context estimate (approx tokens)",
      `Task and plan       ${b.taskTokens}`,
      `Relevant memory     ${b.codeTokens}`,
      `Git diff            ${b.diffTokens}`,
      `Previous rounds     ${b.historyTokens}`,
      `Logs                ${b.logTokens}`,
      `Total               ${b.totalTokens}`,
    ].join("\n");
  } else {
    els.contextPanel.textContent = "(shown after a completed turn)";
  }

  els.gitIntel.textContent = state.gitIntel
    ? [
        state.gitIntel.theme,
        "",
        ...(state.gitIntel.bullets || []),
        "",
        `Risk: ${state.gitIntel.risk}`,
      ].join("\n")
    : "(none yet)";
  els.verifyPanel.textContent = state.verification?.summary || "(none yet)";
  els.workersPanel.textContent = state.workers?.length
    ? state.workers
        .map(
          (w) =>
            `[${w.role}] ok=${w.ok} files=${w.filesChanged.length}\n${w.summary.slice(0, 400)}`,
        )
        .join("\n\n")
    : "(none)";
  els.timelinePanel.textContent = (state.timeline || []).length
    ? state.timeline
        .slice(-50)
        .map((e) => `${e.ts.slice(11, 19)}  ${e.message}`)
        .join("\n")
    : "(no events yet)";

  els.log.innerHTML = (state.logs || [])
    .map((entry) => {
      const round = entry.round != null ? ` r${entry.round}` : "";
      const head = `${entry.ts.slice(11, 19)} [${entry.source}${round}]`;
      return `<div><strong>${escapeHtml(head)}</strong>\n${escapeHtml(entry.text)}\n</div>`;
    })
    .join("\n");
  els.log.scrollTop = els.log.scrollHeight;

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

  const style = state.memory?.style;
  els.stylePanel.textContent = style?.prefers?.length
    ? [
        ...style.prefers.map((p) => `✓ ${p}`),
        ...(style.avoids || []).map((a) => `✗ avoid ${a}`),
      ].join("\n")
    : "(none yet)";

  if (state.credentialStoreLabel) {
    els.credentialHint.textContent = `Credentials: ${state.credentialStoreLabel}`;
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
      const data = await post("/api/detect-project", { task: els.task.value.trim() });
      const best = data.matches?.[0];
      if (best) {
        const ok = confirm(`Detected:\n✓ ${best.name}\n\n${best.path}\n\nRun?`);
        if (!ok) return;
        els.projectPath.value = best.path;
        persist();
      }
    }
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
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

els.approveOnceBtn.addEventListener("click", () =>
  post("/api/approve", { approved: true, scope: "once" }).catch(alert),
);
els.approveRunBtn.addEventListener("click", () =>
  post("/api/approve", { approved: true, scope: "run" }).catch(alert),
);
els.denyBtn.addEventListener("click", async () => {
  try {
    const snap = await fetch("/api/state").then((r) => r.json());
    if (snap.status === "awaiting_plan") {
      await post("/api/approve-plan", { approved: false });
    } else {
      await post("/api/approve", { approved: false });
    }
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
els.answerBtn.addEventListener("click", () =>
  post("/api/answer", { reply: els.userReply.value })
    .then(() => {
      els.userReply.value = "";
    })
    .catch(alert),
);

els.viewChangesBtn.addEventListener("click", () => switchTab("changes"));

els.rollbackBtn.addEventListener("click", async () => {
  try {
    const preview = await fetch("/api/rollback-preview").then((r) => r.json());
    if (preview.error) throw new Error(preview.error);
    els.rollbackPreview.classList.remove("hidden");
    els.rollbackPreview.textContent = preview.summary || JSON.stringify(preview, null, 2);
    if (!confirm(`${preview.summary}\n\nProceed with rollback?`)) return;
    const result = await post("/api/rollback");
    alert(result.message || "Rolled back");
  } catch (err) {
    alert(err.message);
  }
});

els.startFollowUpBtn.addEventListener("click", async () => {
  const selected = [...els.followUpsList.querySelectorAll("input[data-fu]:checked")].map(
    (el) => el.parentElement.textContent.trim(),
  );
  if (!selected.length) {
    alert("Select at least one follow-up");
    return;
  }
  try {
    const data = await post("/api/follow-up-task", { selected });
    els.task.value = data.task;
    if (data.projectPath) els.projectPath.value = data.projectPath;
    persist();
    alert("Follow-up loaded as a new task. Press Start to begin a separate run.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    alert(err.message);
  }
});

for (const el of [
  els.projectPath,
  els.task,
  els.maxRounds,
  els.flagPlan,
  els.flagSupervisor,
  els.flagVerify,
  els.flagBrowser,
  els.notifySound,
]) {
  el.addEventListener("change", persist);
}

const bootstrap = await fetch("/api/health").then((r) => r.json());
if (bootstrap.product) els.productTitle.textContent = bootstrap.product;
if (!bootstrap.hasOpenAiKey) {
  els.taskDisplay.textContent = "Set API key via foundry setup (locally encrypted credential file)";
}

async function refreshSidePanels() {
  try {
    const metrics = await fetch("/api/metrics").then((r) => r.json());
    els.metricsPanel.textContent = [
      `Tasks: ${metrics.tasks}`,
      `Success rate: ${Math.round((metrics.successRate || 0) * 100)}%`,
      `Avg rounds: ${(metrics.averageRounds || 0).toFixed(1)}`,
      `Avg cost: $${(metrics.averageCostUsd || 0).toFixed(4)}`,
    ].join("\n");
  } catch {
    els.metricsPanel.textContent = "(metrics unavailable)";
  }
  try {
    const data = await fetch("/api/recovery").then((r) => r.json());
    const sessions = data.sessions || [];
    if (!sessions.length) {
      els.recoveryPanel.innerHTML = "<em>No crashed sessions.</em>";
    } else {
      const top = sessions[0];
      els.recoveryPanel.innerHTML = `
        <strong>Recoverable session</strong>
        <pre class="code" style="max-height:120px">${escapeHtml(top.summary)}</pre>
        <button id="recoverBtn" type="button" class="ok">Resume</button>`;
      $("recoverBtn")?.addEventListener("click", () => {
        post("/api/recover", { sessionId: top.sessionId }).catch(alert);
      });
    }
  } catch {
    els.recoveryPanel.textContent = "";
  }
  try {
    const data = await fetch("/api/agents").then((r) => r.json());
    els.agentsPanel.textContent = (data.agents || [])
      .map((a) => `${a.available ? "✓" : "·"} ${a.displayName}\n  ${a.notes}`)
      .join("\n");
  } catch {
    els.agentsPanel.textContent = "(unavailable)";
  }
  try {
    const data = await fetch("/api/marketplace").then((r) => r.json());
    els.marketplacePanel.textContent = (data.plugins || [])
      .map((p) => `${p.installed ? "✓" : "·"} ${p.name} — ${p.description}`)
      .join("\n");
  } catch {
    els.marketplacePanel.textContent = "(unavailable)";
  }
}

render(await fetch("/api/state").then((r) => r.json()));
await refreshSidePanels();
const events = new EventSource("/api/events");
events.onmessage = (event) => {
  render(JSON.parse(event.data));
};
setInterval(refreshSidePanels, 15000);
elapsedTimer = setInterval(async () => {
  try {
    const s = await fetch("/api/state").then((r) => r.json());
    if (activeStatuses(s.status)) {
      els.elapsedLabel.textContent = formatElapsed(s.elapsedMs);
    }
  } catch {
    // ignore
  }
}, 1000);
