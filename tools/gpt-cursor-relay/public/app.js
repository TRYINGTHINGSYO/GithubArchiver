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
  changedFiles: document.getElementById("changedFiles"),
  costDetail: document.getElementById("costDetail"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  detectBtn: document.getElementById("detectBtn"),
  detectResult: document.getElementById("detectResult"),
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
  improvementsPanel: document.getElementById("improvementsPanel"),
  improvementsList: document.getElementById("improvementsList"),
  continueImprovementsBtn: document.getElementById("continueImprovementsBtn"),
};

const saved = JSON.parse(localStorage.getItem("gpt-cursor-relay") || "{}");
if (saved.projectPath) els.projectPath.value = saved.projectPath;
if (saved.task) els.task.value = saved.task;
if (saved.maxRounds) els.maxRounds.value = saved.maxRounds;

function persist() {
  localStorage.setItem(
    "gpt-cursor-relay",
    JSON.stringify({
      projectPath: els.projectPath.value,
      task: els.task.value,
      maxRounds: Number(els.maxRounds.value) || 12,
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
  switch (kind) {
    case "added":
      return "+";
    case "removed":
      return "-";
    case "modified":
      return "~";
    case "untracked":
      return "?";
    default:
      return "•";
  }
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
        const head = `${kindGlyph(file.kind)} ${escapeHtml(file.path)}  (+${file.additions}/-${file.deletions})`;
        const body = (file.lines || [])
          .map((line) => {
            const cls = line.type || "ctx";
            return `<div class="diff-line ${cls}">${escapeHtml(line.text)}</div>`;
          })
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

  const cost = state.cost || {};
  els.costMetric.textContent = `$${(cost.totalUsd ?? 0).toFixed(2)}`;
  els.costDetail.textContent = (cost.rounds || []).length
    ? [
        ...(cost.rounds || []).map(
          (r) =>
            `Round ${r.round}\nGPT: $${(r.gptUsd ?? 0).toFixed(4)} (${r.gptTokens ?? 0} tok)\nCursor: ~${r.cursorTokens ?? 0} tokens`,
        ),
        `Total:\nGPT $${(cost.totalUsd ?? 0).toFixed(4)} · Cursor ~${cost.cursorTokens ?? 0} tok`,
      ].join("\n\n")
    : "(none yet)";

  const active = ["running", "paused", "awaiting_approval", "awaiting_user"].includes(
    state.status,
  );
  els.startBtn.disabled = active;
  els.pauseBtn.disabled = state.status !== "running";
  els.resumeBtn.disabled = state.status !== "paused";
  els.stopBtn.disabled = !active;
  els.projectPath.disabled = active;
  els.task.disabled = active;
  els.maxRounds.disabled = active;
  els.detectBtn.disabled = active;

  els.gptLive.textContent = state.live?.gpt || "(waiting)";
  els.cursorLive.textContent = state.live?.cursor || "(waiting)";
  els.cursorActivity.textContent = state.live?.cursorActivity
    ? `· ${state.live.cursorActivity}`
    : "";
  els.gptLiveHint.textContent =
    state.status === "running" && state.live?.gpt ? "· streaming" : "";
  els.gptLive.scrollTop = els.gptLive.scrollHeight;
  els.cursorLive.scrollTop = els.cursorLive.scrollHeight;

  els.stopReason.textContent = state.stopReason ? `stop: ${state.stopReason}` : "";

  els.log.innerHTML = (state.logs || [])
    .map((entry) => {
      const round = entry.round != null ? ` r${entry.round}` : "";
      const head = `${entry.ts.slice(11, 19)} [${entry.source}${round}]`;
      return `<div class="src-${entry.source}"><strong>${escapeHtml(head)}</strong>\n${escapeHtml(entry.text)}\n</div>`;
    })
    .join("\n");
  els.log.scrollTop = els.log.scrollHeight;

  els.summary.textContent =
    state.summary || state.error || "(not finished yet)";

  const files = state.changedFiles || [];
  els.changedFiles.textContent = files.length
    ? files.map((f) => `${kindGlyph(f.kind || "other")} ${f.path}`).join("\n")
    : "(none yet)";

  renderDiff(git);

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
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

els.detectBtn.addEventListener("click", async () => {
  persist();
  try {
    const data = await post("/api/detect-project", {
      task: els.task.value.trim(),
    });
    const best = data.matches?.[0];
    if (!best) {
      els.detectResult.textContent = "No project match — set the folder path manually.";
      return;
    }
    els.detectResult.textContent = `Detected: ${best.name} (${Math.round(best.confidence * 100)}%) — ${best.reason}`;
    els.projectPath.value = best.path;
    persist();
  } catch (err) {
    alert(err.message);
  }
});

els.startBtn.addEventListener("click", async () => {
  persist();
  try {
    // Auto-detect if folder blank
    if (!els.projectPath.value.trim() && els.task.value.trim()) {
      const data = await post("/api/detect-project", {
        task: els.task.value.trim(),
      });
      const best = data.matches?.[0];
      if (best) {
        const ok = confirm(
          `Detected:\n✓ ${best.name}\n\n${best.path}\n\nRun?`,
        );
        if (!ok) return;
        els.projectPath.value = best.path;
        els.detectResult.textContent = `Using ${best.name}`;
        persist();
      }
    }

    await post("/api/start", {
      projectPath: els.projectPath.value.trim(),
      task: els.task.value.trim(),
      maxRounds: Number(els.maxRounds.value) || 12,
    });
  } catch (err) {
    alert(err.message);
  }
});

els.pauseBtn.addEventListener("click", () => post("/api/pause").catch(alert));
els.resumeBtn.addEventListener("click", () => post("/api/resume").catch(alert));
els.stopBtn.addEventListener("click", () => post("/api/stop").catch(alert));
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

for (const el of [els.projectPath, els.task, els.maxRounds]) {
  el.addEventListener("change", persist);
}

const bootstrap = await fetch("/api/health").then((r) => r.json());
if (!els.maxRounds.value) els.maxRounds.value = bootstrap.defaultMaxRounds;
if (!bootstrap.hasOpenAiKey) {
  els.summary.textContent =
    "OPENAI_API_KEY is missing. Copy tools/gpt-cursor-relay/.env.example to .env";
}

const state = await fetch("/api/state").then((r) => r.json());
render(state);

const events = new EventSource("/api/events");
events.onmessage = (event) => {
  render(JSON.parse(event.data));
};
