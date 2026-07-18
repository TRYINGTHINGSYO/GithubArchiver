const els = {
  projectPath: document.getElementById("projectPath"),
  task: document.getElementById("task"),
  maxRounds: document.getElementById("maxRounds"),
  status: document.getElementById("status"),
  roundLabel: document.getElementById("roundLabel"),
  log: document.getElementById("log"),
  summary: document.getElementById("summary"),
  changedFiles: document.getElementById("changedFiles"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  stopBtn: document.getElementById("stopBtn"),
  approvalPanel: document.getElementById("approvalPanel"),
  approvalReason: document.getElementById("approvalReason"),
  approvalInstruction: document.getElementById("approvalInstruction"),
  approveBtn: document.getElementById("approveBtn"),
  denyBtn: document.getElementById("denyBtn"),
  questionPanel: document.getElementById("questionPanel"),
  questionText: document.getElementById("questionText"),
  userReply: document.getElementById("userReply"),
  answerBtn: document.getElementById("answerBtn"),
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
      maxRounds: Number(els.maxRounds.value) || 8,
    }),
  );
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render(state) {
  els.status.textContent = state.status;
  els.status.className = `status ${state.status}`;
  els.roundLabel.textContent = `Round ${state.round} / ${state.maxRounds}`;

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

  els.log.innerHTML = state.logs
    .map((entry) => {
      const round = entry.round != null ? ` r${entry.round}` : "";
      const head = `${entry.ts.slice(11, 19)} [${entry.source}${round}]`;
      return `<div class="src-${entry.source}"><strong>${escapeHtml(head)}</strong>\n${escapeHtml(entry.text)}\n</div>`;
    })
    .join("\n");
  els.log.scrollTop = els.log.scrollHeight;

  els.summary.textContent = state.summary || state.error || "(not finished yet)";
  els.changedFiles.textContent = state.changedFiles?.length
    ? state.changedFiles.map((f) => `${f.status} ${f.path}`).join("\n")
    : "(none yet)";

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

els.startBtn.addEventListener("click", async () => {
  persist();
  try {
    await post("/api/start", {
      projectPath: els.projectPath.value.trim(),
      task: els.task.value.trim(),
      maxRounds: Number(els.maxRounds.value) || 8,
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
  post("/api/answer", { reply: els.userReply.value }).then(() => {
    els.userReply.value = "";
  }).catch(alert),
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
events.onerror = () => {
  // Browser will retry; keep last rendered state.
};
