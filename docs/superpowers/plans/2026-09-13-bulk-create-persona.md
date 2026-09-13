# Bulk Create Persona Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators create many personas at once via a compact table with shared defaults (viewport, locale, region, rubric) while entering unique instructions per row.

**Architecture:** Shared `buildPersonaFromBulkRow()` merges defaults + row → `POST /api/personas/bulk` validates and saves each YAML → Console bulk panel collects rows and displays created/skipped/errors summary.

**Tech Stack:** Node 20+, TypeScript, Zod, Fastify console, `@persona-system/shared`, Node built-in test runner

**Spec:** `docs/superpowers/specs/2026-09-13-bulk-create-persona-design.md`

## Global Constraints

- Per-row required fields: **id, name, description, instructions**
- Shared defaults pre-filled: viewport `1280x720`, locale `vi-VN`, fly region `sin`, rubric `clarity` + `usability`
- Fly app auto: `persona-{id}` — not editable in v1
- Existing persona files: **skip**, never overwrite
- UI copy in Vietnamese
- Single-persona flow must remain unchanged
- Out of scope: import file, AI generate, auto-deploy, per-row fly.app override

---

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/shared/src/bulk-persona.ts` | Create | `buildPersonaFromBulkRow`, types |
| `packages/shared/src/bulk-persona.test.ts` | Create | Unit tests |
| `packages/shared/src/index.ts` | Modify | Export bulk helpers |
| `packages/console/src/server.ts` | Modify | `POST /api/personas/bulk` |
| `packages/console/public/index.html` | Modify | Bulk panel markup + buttons |
| `packages/console/public/app.js` | Modify | Bulk panel logic, submit, paste IDs |
| `packages/console/public/styles.css` | Modify | Bulk table + defaults panel styles |

---

### Task 1: Bulk merge helper (shared)

**Files:**
- Create: `packages/shared/src/bulk-persona.ts`
- Create: `packages/shared/src/bulk-persona.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:

```typescript
export interface BulkPersonaRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface BulkPersonaDefaults {
  browser?: { viewport?: string; locale?: string };
  fly?: { region?: string };
  evaluation?: { rubric?: string[]; output_format?: "json" };
}

export function buildPersonaFromBulkRow(
  row: BulkPersonaRow,
  defaults?: BulkPersonaDefaults,
): PersonaConfig;

export function findDuplicateBulkIds(rows: BulkPersonaRow[]): string[];
```

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/bulk-persona.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonaFromBulkRow, findDuplicateBulkIds } from "./bulk-persona.js";

test("buildPersonaFromBulkRow applies defaults and derives fly app", () => {
  const persona = buildPersonaFromBulkRow(
    {
      id: "skeptic",
      name: "Skeptic",
      description: "Hoài nghi",
      instructions: "Bạn là người dùng hoài nghi...",
    },
    {},
  );
  assert.equal(persona.id, "skeptic");
  assert.equal(persona.fly.app, "persona-skeptic");
  assert.equal(persona.browser?.viewport, "1280x720");
  assert.equal(persona.browser?.locale, "vi-VN");
  assert.equal(persona.fly.region, "sin");
  assert.deepEqual(persona.evaluation?.rubric, ["clarity", "usability"]);
});

test("buildPersonaFromBulkRow uses provided defaults", () => {
  const persona = buildPersonaFromBulkRow(
    {
      id: "mobile",
      name: "Mobile",
      description: "Mobile user",
      instructions: "Instructions...",
    },
    {
      browser: { viewport: "390x844", locale: "en-US" },
      fly: { region: "nrt" },
      evaluation: { rubric: ["mobile_fit"], output_format: "json" },
    },
  );
  assert.equal(persona.browser?.viewport, "390x844");
  assert.equal(persona.fly.region, "nrt");
  assert.deepEqual(persona.evaluation?.rubric, ["mobile_fit"]);
});

test("findDuplicateBulkIds returns repeated ids", () => {
  assert.deepEqual(
    findDuplicateBulkIds([
      { id: "a", name: "A", description: "d", instructions: "i" },
      { id: "b", name: "B", description: "d", instructions: "i" },
      { id: "a", name: "A2", description: "d", instructions: "i" },
    ]),
    ["a"],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @persona-system/shared`  
Expected: FAIL — module not found

- [ ] **Step 3: Implement helper**

Create `packages/shared/src/bulk-persona.ts`:

```typescript
import { personaConfigSchema, type PersonaConfig } from "./schemas.js";

export interface BulkPersonaRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export interface BulkPersonaDefaults {
  browser?: { viewport?: string; locale?: string };
  fly?: { region?: string };
  evaluation?: { rubric?: string[]; output_format?: "json" };
}

export function buildPersonaFromBulkRow(
  row: BulkPersonaRow,
  defaults: BulkPersonaDefaults = {},
): PersonaConfig {
  return personaConfigSchema.parse({
    id: row.id.trim(),
    name: row.name.trim(),
    description: row.description.trim(),
    instructions: row.instructions,
    evaluation: {
      rubric: defaults.evaluation?.rubric?.length
        ? defaults.evaluation.rubric
        : ["clarity", "usability"],
      output_format: "json",
    },
    browser: {
      viewport: defaults.browser?.viewport ?? "1280x720",
      locale: defaults.browser?.locale ?? "vi-VN",
    },
    fly: {
      app: `persona-${row.id.trim()}`,
      region: defaults.fly?.region ?? "sin",
    },
  });
}

export function findDuplicateBulkIds(rows: BulkPersonaRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) continue;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}
```

Export from `packages/shared/src/index.ts`:

```typescript
export {
  buildPersonaFromBulkRow,
  findDuplicateBulkIds,
  type BulkPersonaRow,
  type BulkPersonaDefaults,
} from "./bulk-persona.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @persona-system/shared`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bulk-persona.ts packages/shared/src/bulk-persona.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add buildPersonaFromBulkRow for bulk persona create"
```

---

### Task 2: Bulk API endpoint

**Files:**
- Modify: `packages/console/src/server.ts`

**Interfaces:**
- Consumes: `buildPersonaFromBulkRow`, `findDuplicateBulkIds`, `loadPersonaFile`, `savePersonaFile`, `personaFilePath`
- Produces: `POST /api/personas/bulk` → `BulkCreatePersonasResult`

- [ ] **Step 1: Add bulk route**

After existing `POST /api/personas`, add:

```typescript
app.post<{ Body: { defaults?: BulkPersonaDefaults; personas?: BulkPersonaRow[] } }>(
  "/api/personas/bulk",
  async (request, reply) => {
    const rows = request.body?.personas ?? [];
    if (!rows.length) {
      return reply.code(400).send({ error: "personas_required" });
    }

    const defaults = request.body?.defaults ?? {};
    const duplicateIds = new Set(findDuplicateBulkIds(rows));
    const created: string[] = [];
    const skipped: { id: string; reason: "persona_exists" }[] = [];
    const errors: { id: string; reason: string; details?: unknown }[] = [];

    for (const row of rows) {
      const id = row.id?.trim();
      if (!id) {
        errors.push({ id: row.id ?? "", reason: "missing_id" });
        continue;
      }
      if (duplicateIds.has(id)) {
        errors.push({ id, reason: "duplicate_in_request" });
        continue;
      }

      let config;
      try {
        config = buildPersonaFromBulkRow(row, defaults);
      } catch (error) {
        errors.push({
          id,
          reason: "invalid_persona",
          details: error instanceof Error ? error.message : error,
        });
        continue;
      }

      try {
        await loadPersonaFile(personaFilePath(personasDir, config.id));
        skipped.push({ id: config.id, reason: "persona_exists" });
        continue;
      } catch {
        // new
      }

      await savePersonaFile(personasDir, config);
      created.push(config.id);
    }

    const status = created.length ? 201 : 200;
    return reply.code(status).send({ created, skipped, errors });
  },
);
```

Add imports from `@persona-system/shared`.

- [ ] **Step 2: Build console**

Run: `npm run build -w @persona-system/console && npm run build -w @persona-system/shared`  
Expected: PASS

- [ ] **Step 3: Manual API smoke (optional)**

```bash
curl -s -X POST http://localhost:8787/api/personas/bulk \
  -H 'Content-Type: application/json' \
  -d '{"personas":[{"id":"test-bulk-a","name":"A","description":"d","instructions":"i"}]}'
```

Expected: `created: ["test-bulk-a"]` then delete test file manually.

- [ ] **Step 4: Commit**

```bash
git add packages/console/src/server.ts
git commit -m "feat(console): add POST /api/personas/bulk endpoint"
```

---

### Task 3: Bulk panel UI

**Files:**
- Modify: `packages/console/public/index.html`
- Modify: `packages/console/public/app.js`
- Modify: `packages/console/public/styles.css`

**Interfaces:**
- Consumes: `POST /api/personas/bulk`
- Produces: bulk panel visible/hidden; submit payload `{ defaults, personas }`

- [ ] **Step 1: Add HTML — bulk button and panel**

In sidebar, change:

```html
<button id="new-persona" class="btn primary view-personas-only">+ Persona mới</button>
```

To:

```html
<div class="persona-create-actions view-personas-only">
  <button id="new-persona" class="btn primary">+ Persona mới</button>
  <button id="bulk-persona" class="btn">Tạo hàng loạt</button>
</div>
```

In `#view-personas`, after `#empty-state`, add hidden panel:

```html
<div id="bulk-persona-panel" class="bulk-persona-panel hidden">
  <header class="editor-header">
    <div>
      <h2>Tạo persona hàng loạt</h2>
      <p>Cài đặt chung áp dụng cho tất cả dòng. Instructions phải nhập riêng từng persona.</p>
    </div>
    <button type="button" id="bulk-persona-cancel" class="btn">Hủy</button>
  </header>
  <section class="bulk-defaults">
    <h3 class="bulk-section-title">Cài đặt chung</h3>
    <div class="grid">
      <label>Viewport <input id="bulk-default-viewport" value="1280x720" /></label>
      <label>Locale <input id="bulk-default-locale" value="vi-VN" /></label>
      <label>Fly region <input id="bulk-default-region" value="sin" /></label>
    </div>
    <label>Rubric mặc định (mỗi dòng một tiêu chí)
      <textarea id="bulk-default-rubric" rows="2">clarity
usability</textarea>
    </label>
  </section>
  <div class="bulk-row-actions">
    <button type="button" id="bulk-add-row" class="btn">+ Thêm dòng</button>
    <button type="button" id="bulk-paste-ids" class="btn">Dán danh sách ID</button>
  </div>
  <div id="bulk-persona-rows" class="bulk-persona-rows"></div>
  <div class="actions">
    <button type="button" id="bulk-persona-save" class="btn primary">Lưu persona</button>
  </div>
  <p id="bulk-status" class="status"></p>
</div>
```

- [ ] **Step 2: Implement app.js bulk logic**

Add functions:

```javascript
function slugifyId(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

function createBulkRow(initial = {}) {
  const row = document.createElement("div");
  row.className = "bulk-persona-row";
  const id = initial.id ?? "";
  row.innerHTML = `
    <label>ID *<input class="bulk-field-id" value="${id}" pattern="[a-z0-9-]+" required />
      <span class="meta bulk-fly-app">Fly: persona-${id || "…"}</span></label>
    <label>Tên *<input class="bulk-field-name" value="${initial.name ?? ""}" required /></label>
    <label>Mô tả *<input class="bulk-field-description" value="${initial.description ?? ""}" required /></label>
    <label>Instructions *<textarea class="bulk-field-instructions" rows="3" required>${initial.instructions ?? ""}</textarea></label>
    <button type="button" class="btn bulk-remove-row" title="Xóa dòng">✕</button>
  `;
  row.querySelector(".bulk-field-id").addEventListener("input", (e) => {
    const slug = slugifyId(e.target.value);
    row.querySelector(".bulk-fly-app").textContent = `Fly: persona-${slug || "…"}`;
  });
  row.querySelector(".bulk-remove-row").addEventListener("click", () => {
    row.remove();
    if (!document.querySelector(".bulk-persona-row")) addBulkRow();
  });
  return row;
}

function addBulkRow(initial) {
  document.getElementById("bulk-persona-rows").appendChild(createBulkRow(initial));
}

function showBulkPanel(show) {
  document.getElementById("bulk-persona-panel").classList.toggle("hidden", !show);
  formEl.classList.add("hidden");
  emptyEl.classList.toggle("hidden", show);
  if (show && !document.querySelector(".bulk-persona-row")) addBulkRow();
}

function readBulkDefaults() {
  const rubric = document.getElementById("bulk-default-rubric").value
    .split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    browser: {
      viewport: document.getElementById("bulk-default-viewport").value.trim() || "1280x720",
      locale: document.getElementById("bulk-default-locale").value.trim() || "vi-VN",
    },
    fly: { region: document.getElementById("bulk-default-region").value.trim() || "sin" },
    evaluation: { rubric: rubric.length ? rubric : ["clarity", "usability"], output_format: "json" },
  };
}

function readBulkRows() {
  return [...document.querySelectorAll(".bulk-persona-row")].map((row) => ({
    id: slugifyId(row.querySelector(".bulk-field-id").value),
    name: row.querySelector(".bulk-field-name").value.trim(),
    description: row.querySelector(".bulk-field-description").value.trim(),
    instructions: row.querySelector(".bulk-field-instructions").value,
  }));
}

function validateBulkRows(rows) {
  for (const row of rows) {
    if (!row.id || !row.name || !row.description || !row.instructions.trim()) {
      return "Mỗi dòng cần đủ ID, tên, mô tả và instructions.";
    }
  }
  return "";
}

async function saveBulkPersonas() {
  const rows = readBulkRows();
  const err = validateBulkRows(rows);
  if (err) {
    document.getElementById("bulk-status").textContent = err;
    document.getElementById("bulk-status").className = "status error";
    return;
  }
  const body = { defaults: readBulkDefaults(), personas: rows };
  const result = await api("/api/personas/bulk", { method: "POST", body: JSON.stringify(body) });
  const parts = [];
  if (result.created?.length) parts.push(`Đã tạo: ${result.created.join(", ")}`);
  if (result.skipped?.length) {
    parts.push(`Bỏ qua (đã tồn tại): ${result.skipped.map((s) => s.id).join(", ")}`);
  }
  if (result.errors?.length) {
    parts.push(`Lỗi: ${result.errors.map((e) => `${e.id} (${e.reason})`).join("; ")}`);
  }
  document.getElementById("bulk-status").textContent = parts.join(" · ") || "Không có thay đổi.";
  document.getElementById("bulk-status").className = `status ${result.created?.length ? "ok" : "error"}`;
  if (result.created?.length) {
    await refreshList();
    showBulkPanel(false);
    emptyEl.classList.remove("hidden");
  }
}
```

Wire event listeners:

```javascript
document.getElementById("bulk-persona").addEventListener("click", () => showBulkPanel(true));
document.getElementById("bulk-persona-cancel").addEventListener("click", () => {
  showBulkPanel(false);
  emptyEl.classList.remove("hidden");
});
document.getElementById("bulk-add-row").addEventListener("click", () => addBulkRow());
document.getElementById("bulk-paste-ids").addEventListener("click", () => {
  const raw = prompt("Dán danh sách ID (mỗi dòng một id):", "");
  if (!raw) return;
  for (const line of raw.split("\n")) {
    const id = slugifyId(line);
    if (id) addBulkRow({ id });
  }
});
document.getElementById("bulk-persona-save").addEventListener("click", () => {
  saveBulkPersonas().catch((e) => {
    document.getElementById("bulk-status").textContent = e.message;
    document.getElementById("bulk-status").className = "status error";
  });
});
```

Update `createPersona` to call `showBulkPanel(false)` before opening single form.

- [ ] **Step 3: Add CSS**

```css
.persona-create-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.bulk-persona-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.bulk-section-title {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}

.bulk-defaults {
  padding: 0.75rem 1rem;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.bulk-row-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.bulk-persona-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bulk-persona-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 2fr auto;
  gap: 0.5rem;
  align-items: start;
  padding: 0.75rem;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.bulk-persona-row label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.bulk-fly-app {
  margin-top: 0.15rem;
}

.bulk-remove-row {
  align-self: center;
  padding: 0.35rem 0.55rem;
}

@media (max-width: 900px) {
  .bulk-persona-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Update save button label dynamically**

Before submit in `saveBulkPersonas`, set:

```javascript
document.getElementById("bulk-persona-save").textContent = `Lưu ${rows.length} persona`;
```

Call on row add/remove.

- [ ] **Step 5: Full build and test**

Run: `npm run build && npm test`  
Expected: PASS

- [ ] **Step 6: Manual UI check**

User runs `npm run ui:dev` manually. Verify:

1. **Tạo hàng loạt** opens panel with defaults
2. Add 2 rows, paste IDs, save → sidebar updates
3. Re-save with same id → skipped message

- [ ] **Step 7: Commit**

```bash
git add packages/console/public/index.html packages/console/public/app.js packages/console/public/styles.css
git commit -m "feat(console): bulk persona create panel and table UI"
```

---

## Plan self-review

| Spec requirement | Task |
| --- | --- |
| Shared defaults | Task 3 UI + Task 1 merge |
| Per-row id/name/description/instructions | Task 3 |
| fly.app = persona-{id} | Task 1 |
| Skip existing | Task 2 |
| duplicate_in_request | Task 1 + Task 2 |
| Paste ID list | Task 3 |
| Vietnamese copy | Task 3 |
| Single create unchanged | Task 3 (hide bulk when single create) |

No placeholders. Type names consistent: `BulkPersonaRow`, `BulkPersonaDefaults`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-13-bulk-create-persona.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task  
2. **Inline Execution** — implement in this session

Which approach do you want?
