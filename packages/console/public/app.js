const listEl = document.getElementById("persona-list");
const formEl = document.getElementById("persona-form");
const emptyEl = document.getElementById("empty-state");
const llmBadge = document.getElementById("llm-badge");
const statusEl = document.getElementById("status");
const newBtn = document.getElementById("new-persona");
const deleteBtn = document.getElementById("delete-persona");
const jobLog = document.getElementById("job-log");
const jobBadge = document.getElementById("job-status-badge");

let selectedId = null;
let isNew = false;
let allPersonas = [];
let activeJobId = null;
let pollTimer = null;

const fields = {
  id: document.getElementById("field-id"),
  name: document.getElementById("field-name"),
  description: document.getElementById("field-description"),
  instructions: document.getElementById("field-instructions"),
  rubric: document.getElementById("field-rubric"),
  viewport: document.getElementById("field-viewport"),
  locale: document.getElementById("field-locale"),
  flyApp: document.getElementById("field-fly-app"),
  flyRegion: document.getElementById("field-fly-region"),
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function showView(name) {
  for (const btn of document.querySelectorAll(".nav-btn")) {
    btn.classList.toggle("active", btn.dataset.view === name);
  }
  document.getElementById("view-personas").classList.toggle("hidden", name !== "personas");
  document.getElementById("view-ops").classList.toggle("hidden", name !== "ops");
  document.getElementById("view-eval").classList.toggle("hidden", name !== "eval");
  for (const el of document.querySelectorAll(".view-personas-only")) {
    el.classList.toggle("hidden", name !== "personas");
  }
}

function personaToForm(persona) {
  fields.id.value = persona.id;
  fields.id.readOnly = !isNew;
  fields.name.value = persona.name;
  fields.description.value = persona.description;
  fields.instructions.value = persona.instructions;
  fields.rubric.value = (persona.evaluation?.rubric || []).join("\n");
  fields.viewport.value = persona.browser?.viewport || "1280x720";
  fields.locale.value = persona.browser?.locale || "vi-VN";
  fields.flyApp.value = persona.fly?.app || `persona-${persona.id}`;
  fields.flyRegion.value = persona.fly?.region || "sin";
  document.getElementById("form-title").textContent = persona.name;
  document.getElementById("form-subtitle").textContent = persona.description;
}

function formToPersona() {
  const rubric = fields.rubric.value.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    id: fields.id.value.trim(),
    name: fields.name.value.trim(),
    description: fields.description.value.trim(),
    instructions: fields.instructions.value,
    evaluation: { rubric, output_format: "json" },
    browser: {
      viewport: fields.viewport.value.trim() || "1280x720",
      locale: fields.locale.value.trim() || "vi-VN",
    },
    fly: {
      app: fields.flyApp.value.trim(),
      region: fields.flyRegion.value.trim() || "sin",
    },
  };
}

function showForm(show) {
  formEl.classList.toggle("hidden", !show);
  emptyEl.classList.toggle("hidden", show);
}

function renderCheckboxes(containerId, prefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (const p of allPersonas) {
    const label = document.createElement("label");
    label.className = "check-item";
    label.innerHTML = `<input type="checkbox" value="${p.id}" checked /> ${p.name} <span class="meta">${p.flyApp}</span>`;
    container.appendChild(label);
  }
}

function getCheckedIds(containerId) {
  return [...document.querySelectorAll(`#${containerId} input:checked`)].map((el) => el.value);
}

function setJobBadge(status) {
  jobBadge.textContent = status;
  jobBadge.className = `badge ${status}`;
}

async function pollJob(jobId) {
  activeJobId = jobId;
  setJobBadge("running");
  if (pollTimer) clearInterval(pollTimer);

  const tick = async () => {
    const job = await api(`/api/ops/jobs/${jobId}`);
    jobLog.textContent = job.logs.join("\n") || "Đang chạy...";
    jobLog.scrollTop = jobLog.scrollHeight;
    setJobBadge(job.status);

    if (job.status === "completed" || job.status === "failed") {
      clearInterval(pollTimer);
      pollTimer = null;
      activeJobId = null;

      if (job.type === "health" && job.result?.results) {
        showHealthResults(job.result.results);
      }
      if (job.type === "eval" && job.status === "completed" && job.result?.reportPath) {
        showEvalReport(job.result);
      }
    }
  };

  await tick();
  pollTimer = setInterval(tick, 1500);
}

async function startJob(path, body) {
  if (activeJobId) {
    if (!confirm("Đang có job chạy. Bắt đầu job mới?")) return null;
  }
  const { jobId } = await api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  await pollJob(jobId);
  return jobId;
}

function showHealthResults(results) {
  const box = document.getElementById("health-results");
  box.classList.remove("hidden");
  box.innerHTML = results
    .map(
      (r) =>
        `<div class="health-row ${r.ok ? "ok" : "err"}"><strong>${r.name}</strong> ${r.ok ? "✓ Online" : "✗ " + (r.error || "offline")} <span class="meta">${r.url}</span></div>`,
    )
    .join("");
}

function showEvalReport(result) {
  const box = document.getElementById("eval-report");
  box.classList.remove("hidden");
  const runId = result.runDir.split(/[/\\]/).pop();
  box.innerHTML = `
    <p class="ok">Hoàn tất — ${result.results.length - result.failed}/${result.results.length} thành công</p>
    <button type="button" class="btn" id="load-report-btn">Xem báo cáo</button>
    <pre id="report-content" class="report-pre hidden"></pre>
  `;
  document.getElementById("load-report-btn").addEventListener("click", async () => {
    const report = await api(`/api/ops/runs/${runId}/report`);
    const pre = document.getElementById("report-content");
    pre.textContent = report.content;
    pre.classList.remove("hidden");
  });
}

async function loadLlmBadge() {
  try {
    const cfg = await api("/api/config/llm");
    if (!cfg.ok) throw new Error(cfg.error || "LLM chưa cấu hình");
    llmBadge.className = "llm-badge ok";
    llmBadge.innerHTML = `<strong>LLM</strong> ${cfg.model}<br /><span>${cfg.baseUrl}</span><br /><span>${cfg.apiKeyMasked}</span>`;
  } catch (error) {
    llmBadge.className = "llm-badge error";
    llmBadge.textContent = error.message;
  }
}

async function refreshList(activeId = selectedId) {
  allPersonas = await api("/api/personas");
  listEl.innerHTML = "";
  for (const p of allPersonas) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = activeId === p.id ? "active" : "";
    btn.innerHTML = `${p.name}<span class="meta">${p.id} · ${p.flyApp}</span>`;
    btn.addEventListener("click", () => selectPersona(p.id));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
  renderCheckboxes("ops-persona-checks", "ops");
  renderCheckboxes("eval-persona-checks", "eval");
}

async function selectPersona(id) {
  isNew = false;
  selectedId = id;
  const persona = await api(`/api/personas/${id}`);
  personaToForm(persona);
  showForm(true);
  deleteBtn.classList.remove("hidden");
  setStatus("");
  showView("personas");
  await refreshList(id);
}

async function createPersona() {
  const id = prompt("ID persona mới (vd: budget-buyer):", "");
  if (!id) return;
  const slug = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!slug) return;
  isNew = true;
  selectedId = slug;
  personaToForm(await api(`/api/personas/template/${slug}`));
  showForm(true);
  deleteBtn.classList.add("hidden");
  setStatus("Persona mới — chỉnh instructions rồi bấm Lưu.", "ok");
  showView("personas");
  await refreshList(slug);
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = formToPersona();
  try {
    if (isNew) {
      await api("/api/personas", { method: "POST", body: JSON.stringify(payload) });
      isNew = false;
      fields.id.readOnly = true;
      deleteBtn.classList.remove("hidden");
      setStatus("Đã tạo persona.", "ok");
    } else {
      await api(`/api/personas/${payload.id}`, { method: "PUT", body: JSON.stringify(payload) });
      setStatus("Đã lưu.", "ok");
    }
    selectedId = payload.id;
    await refreshList(selectedId);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!selectedId || isNew) return;
  if (!confirm(`Xóa persona "${selectedId}"?`)) return;
  try {
    await api(`/api/personas/${selectedId}`, { method: "DELETE" });
    selectedId = null;
    showForm(false);
    await refreshList();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

document.getElementById("ops-select-all").addEventListener("click", () => {
  for (const el of document.querySelectorAll("#ops-persona-checks input")) el.checked = true;
});

document.getElementById("ops-deploy").addEventListener("click", () => {
  startJob("/api/ops/deploy", { personaIds: getCheckedIds("ops-persona-checks") });
});

document.getElementById("ops-sync").addEventListener("click", () => {
  startJob("/api/ops/sync-secrets", { personaIds: getCheckedIds("ops-persona-checks") });
});

document.getElementById("ops-health").addEventListener("click", () => {
  document.getElementById("health-results").classList.add("hidden");
  startJob("/api/ops/health", { personaIds: getCheckedIds("ops-persona-checks") });
});

document.getElementById("eval-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  document.getElementById("eval-report").classList.add("hidden");
  await startJob("/api/ops/eval", {
    productUrl: document.getElementById("eval-url").value.trim(),
    username: document.getElementById("eval-user").value.trim() || undefined,
    password: document.getElementById("eval-pass").value || undefined,
    loginUrl: document.getElementById("eval-login-url").value.trim() || undefined,
    focus: document.getElementById("eval-focus").value.trim() || undefined,
    personaIds: getCheckedIds("eval-persona-checks"),
  });
});

newBtn.addEventListener("click", createPersona);

loadLlmBadge();
refreshList();
