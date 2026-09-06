const listEl = document.getElementById("persona-list");
const formEl = document.getElementById("persona-form");
const emptyEl = document.getElementById("empty-state");
const llmBadge = document.getElementById("llm-badge");
const statusEl = document.getElementById("status");
const newBtn = document.getElementById("new-persona");
const deleteBtn = document.getElementById("delete-persona");

let selectedId = null;
let isNew = false;

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
  if (!res.ok) {
    const msg = data.error || data.message || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
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
  const rubric = fields.rubric.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

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

async function loadLlmBadge() {
  try {
    const cfg = await api("/api/config/llm");
    if (!cfg.ok) throw new Error(cfg.error || "LLM chưa cấu hình");
    llmBadge.className = "llm-badge ok";
    llmBadge.innerHTML = `
      <strong>LLM</strong> ${cfg.model}<br />
      <span>${cfg.baseUrl}</span><br />
      <span>${cfg.apiKeyMasked}</span><br />
      <span>Nguồn: ${cfg.source}</span>
    `;
  } catch (error) {
    llmBadge.className = "llm-badge error";
    llmBadge.textContent = error.message;
  }
}

async function refreshList(activeId = selectedId) {
  const personas = await api("/api/personas");
  listEl.innerHTML = "";
  for (const p of personas) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = activeId === p.id ? "active" : "";
    btn.innerHTML = `${p.name}<span class="meta">${p.id} · ${p.flyApp}</span>`;
    btn.addEventListener("click", () => selectPersona(p.id));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

async function selectPersona(id) {
  isNew = false;
  selectedId = id;
  const persona = await api(`/api/personas/${id}`);
  personaToForm(persona);
  showForm(true);
  deleteBtn.classList.remove("hidden");
  setStatus("");
  await refreshList(id);
}

async function createPersona() {
  const id = prompt("ID persona mới (vd: budget-buyer):", "");
  if (!id) return;
  const slug = id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!slug) return;

  isNew = true;
  selectedId = slug;
  const template = await api(`/api/personas/template/${slug}`);
  personaToForm(template);
  showForm(true);
  deleteBtn.classList.add("hidden");
  setStatus("Persona mới — chỉnh instructions rồi bấm Lưu.", "ok");
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
      await api(`/api/personas/${payload.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setStatus("Đã lưu.", "ok");
    }
    selectedId = payload.id;
    document.getElementById("form-title").textContent = payload.name;
    document.getElementById("form-subtitle").textContent = payload.description;
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
    setStatus("Đã xóa.", "ok");
    await refreshList();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

newBtn.addEventListener("click", createPersona);

loadLlmBadge();
refreshList();
