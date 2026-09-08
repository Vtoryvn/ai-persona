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
let jobStream = null;
let expandedPersonaId = null;
const personaCards = new Map();
const personaEvents = new Map();

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

function renderCheckboxes(containerId) {
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

function formatEvent(event) {
  if (event.type === "tool") return `⚙ ${event.name || event.message || "tool"}`;
  if (event.type === "thought") return event.text || "";
  if (event.type === "status") return event.message || "";
  if (event.type === "result") return "✓ Hoàn thành đánh giá";
  if (event.type === "error") return `✗ ${event.message || "Lỗi"}`;
  return event.message || event.type;
}

function renderEventList(listEl, events) {
  listEl.innerHTML = "";
  const recent = (events || []).filter((e) => e.type !== "screenshot").slice(-60);
  for (const event of recent) {
    const li = document.createElement("li");
    li.className = `event ${event.type}`;
    li.textContent = formatEvent(event);
    listEl.appendChild(li);
  }
  listEl.scrollTop = listEl.scrollHeight;
}

function setStreamImage(imgEl, emptyEl, mime, data) {
  if (!data || data === "[omitted]") return;
  imgEl.src = `data:${mime};base64,${data}`;
  imgEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
}

function updateCardStatus(card, status) {
  card.dataset.status = status;
  const badge = card.querySelector(".persona-card-status");
  if (!badge) return;
  badge.textContent = status;
  badge.className = `persona-card-status ${status}`;
}

function createPersonaCard(personaId, personaName) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "persona-card";
  card.dataset.personaId = personaId;
  card.dataset.status = "pending";
  card.innerHTML = `
    <header class="persona-card-head">
      <strong class="persona-card-name">${personaName || personaId}</strong>
      <span class="persona-card-status pending">pending</span>
    </header>
    <div class="persona-card-screen">
      <img alt="Stream ${personaName || personaId}" class="persona-card-stream hidden" />
      <div class="persona-card-empty">Đang chờ VM...</div>
    </div>
    <p class="persona-card-action">Chưa có hành động</p>
  `;
  card.addEventListener("click", () => openPersonaDetail(personaId));
  personaCards.set(personaId, card);
  personaEvents.set(personaId, []);
  return card;
}

function buildPersonaGrid(personaIds) {
  const grid = document.getElementById("persona-grid");
  grid.innerHTML = "";
  personaCards.clear();
  personaEvents.clear();
  expandedPersonaId = null;

  for (const personaId of personaIds) {
    const persona = allPersonas.find((p) => p.id === personaId);
    grid.appendChild(createPersonaCard(personaId, persona?.name || personaId));
  }

  document.getElementById("persona-detail").classList.add("hidden");
  document.getElementById("session-grid-close").classList.add("hidden");
  grid.classList.remove("hidden");
}

function updateCardAction(personaId, text) {
  const card = personaCards.get(personaId);
  if (!card || !text) return;
  const actionEl = card.querySelector(".persona-card-action");
  actionEl.textContent = text;
  actionEl.classList.toggle("live", card.dataset.status === "running");
}

function updateCardFrame(personaId, mime, data) {
  const card = personaCards.get(personaId);
  if (!card) return;
  const img = card.querySelector(".persona-card-stream");
  const empty = card.querySelector(".persona-card-empty");
  setStreamImage(img, empty, mime, data);
}

function appendPersonaEvent(personaId, event) {
  if (event.type === "screenshot") return;
  const events = personaEvents.get(personaId) || [];
  events.push(event);
  personaEvents.set(personaId, events);

  const action = formatEvent(event);
  updateCardAction(personaId, action);

  if (expandedPersonaId === personaId) {
    renderDetailFromState(personaId);
  }
}

function renderDetailFromState(personaId) {
  const card = personaCards.get(personaId);
  const sessionEvents = personaEvents.get(personaId) || [];
  const img = document.getElementById("detail-stream");
  const empty = document.getElementById("detail-stream-empty");
  const cardImg = card?.querySelector(".persona-card-stream");

  document.getElementById("detail-persona-name").textContent =
    card?.querySelector(".persona-card-name")?.textContent || personaId;
  document.getElementById("detail-persona-meta").textContent =
    card?.dataset.status === "running" ? "Agent đang chạy" : card?.dataset.status || "";

  if (cardImg?.src) {
    img.src = cardImg.src;
    img.classList.remove("hidden");
    empty.classList.add("hidden");
  }

  const lastThought = [...sessionEvents].reverse().find((e) => e.type === "thought" && e.text);
  document.getElementById("detail-thought").textContent = lastThought?.text || "";
  renderEventList(document.getElementById("detail-events"), sessionEvents);
}

function openPersonaDetail(personaId) {
  expandedPersonaId = personaId;
  document.getElementById("persona-grid").classList.add("hidden");
  document.getElementById("persona-detail").classList.remove("hidden");
  document.getElementById("session-grid-close").classList.remove("hidden");
  renderDetailFromState(personaId);
}

function closePersonaDetail() {
  expandedPersonaId = null;
  document.getElementById("persona-detail").classList.add("hidden");
  document.getElementById("persona-grid").classList.remove("hidden");
  document.getElementById("session-grid-close").classList.add("hidden");
}

function handleStreamMessage(message) {
  if (message.type === "snapshot" && message.job?.sessions) {
    for (const [personaId, session] of Object.entries(message.job.sessions)) {
      const card = personaCards.get(personaId);
      if (!card) continue;
      updateCardStatus(card, session.status);
      if (session.lastAction) updateCardAction(personaId, session.lastAction);
      if (session.screenshot?.data && session.screenshot.data !== "[omitted]") {
        updateCardFrame(personaId, session.screenshot.mime, session.screenshot.data);
      }
      if (session.events?.length) {
        personaEvents.set(
          personaId,
          session.events.filter((e) => e.type !== "screenshot"),
        );
      }
    }
    if (expandedPersonaId) renderDetailFromState(expandedPersonaId);
    return;
  }

  if (message.type === "frame") {
    updateCardFrame(message.personaId, message.mime, message.data);
    if (expandedPersonaId === message.personaId) {
      setStreamImage(
        document.getElementById("detail-stream"),
        document.getElementById("detail-stream-empty"),
        message.mime,
        message.data,
      );
    }
    return;
  }

  if (message.type === "event") {
    appendPersonaEvent(message.personaId, message.event);
    return;
  }

  if (message.type === "persona") {
    const card = personaCards.get(message.personaId);
    if (card) updateCardStatus(card, message.status);
    if (message.error) updateCardAction(message.personaId, `✗ ${message.error}`);
    if (expandedPersonaId === message.personaId) {
      document.getElementById("detail-persona-meta").textContent = message.error || message.status;
    }
    return;
  }

  if (message.type === "job") {
    if (message.status) setJobBadge(message.status);
    return;
  }

  if (message.type === "log" && message.line) {
    jobLog.textContent += (jobLog.textContent.endsWith("\n") || !jobLog.textContent ? "" : "\n") + message.line;
    jobLog.scrollTop = jobLog.scrollHeight;
  }
}

function connectJobStream(jobId) {
  if (jobStream) {
    jobStream.close();
    jobStream = null;
  }

  jobStream = new EventSource(`/api/ops/jobs/${jobId}/stream`);
  jobStream.onmessage = (evt) => {
    try {
      handleStreamMessage(JSON.parse(evt.data));
    } catch {
      // ignore malformed events
    }
  };
  jobStream.onerror = () => {
    jobStream?.close();
    jobStream = null;
  };
}

async function pollJob(jobId, options = {}) {
  const { useStream = false, personaIds = [] } = options;
  activeJobId = jobId;
  setJobBadge("running");
  if (pollTimer) clearInterval(pollTimer);

  if (useStream) {
    buildPersonaGrid(personaIds);
    document.getElementById("session-view").classList.remove("hidden");
    connectJobStream(jobId);
  }

  const tick = async () => {
    const job = await api(`/api/ops/jobs/${jobId}`);
    if (!useStream) {
      jobLog.textContent = job.logs.join("\n") || "Đang chạy...";
    } else if (!jobLog.textContent || jobLog.textContent === "Chưa có tác vụ.") {
      jobLog.textContent = job.logs.join("\n") || "Đang chạy...";
    }
    jobLog.scrollTop = jobLog.scrollHeight;
    setJobBadge(job.status);

    if (job.status === "completed" || job.status === "failed") {
      clearInterval(pollTimer);
      pollTimer = null;
      activeJobId = null;
      jobStream?.close();
      jobStream = null;

      if (job.type === "health" && job.result?.results) {
        showHealthResults(job.result.results);
      }
    }
  };

  await tick();
  pollTimer = setInterval(tick, 3000);
}

async function startJob(path, body, options = {}) {
  if (activeJobId) {
    if (!confirm("Đang có job chạy. Bắt đầu job mới?")) return null;
  }
  jobLog.textContent = "";
  const response = await api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  await pollJob(response.jobId, {
    useStream: options.useStream,
    personaIds: response.personaIds || body?.personaIds || [],
  });
  return response.jobId;
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

async function loadLlmBadge() {
  try {
    const cfg = await api("/api/config/llm");
    if (!cfg.ok) throw new Error(cfg.error || "LLM chưa cấu hình");
    llmBadge.className = "llm-badge ok";
    llmBadge.innerHTML = `<strong>LLM</strong> ${cfg.model}<br /><span>${cfg.baseUrl}</span><span> ${cfg.apiKeyMasked}</span>`;
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
  renderCheckboxes("ops-persona-checks");
  renderCheckboxes("eval-persona-checks");
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
  showView("eval");
  const personaIds = getCheckedIds("eval-persona-checks");
  await startJob(
    "/api/ops/eval",
    {
      prompt: document.getElementById("eval-prompt").value.trim(),
      personaIds,
    },
    { useStream: true, personaIds },
  );
});

document.getElementById("session-grid-close").addEventListener("click", closePersonaDetail);

newBtn.addEventListener("click", createPersona);

loadLlmBadge();
refreshList();
