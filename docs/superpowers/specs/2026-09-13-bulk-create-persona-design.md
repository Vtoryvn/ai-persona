# Bulk Create Persona — Design Spec

**Date:** 2026-09-13  
**Status:** Approved (2026-09-13)  
**Repo:** persona-system  
**Workflow:** Superpowers (brainstorming → writing-plans → executing-plans)

---

## Approved decisions (2026-09-13)

- **Input style:** Option D — compact table with per-row fields + shared defaults
- **Per-row required:** `id`, `name`, `description`, `instructions` (instructions always customized)
- **Shared defaults:** viewport, locale, fly region, default rubric — set once for all rows
- **Fly app:** auto-derived as `persona-{id}` — not editable in v1
- **Conflict policy:** skip existing persona ids (no overwrite)
- **Scope:** Console UI + bulk API only (no YAML import, no AI generate, no auto-deploy)

---

## 1. Problem Statement

Creating multiple personas today requires repeating the single-persona flow: prompt for one ID, open form, re-enter viewport/locale/fly region defaults, save, repeat. Operators setting up parallel eval agents need several personas quickly; only **instructions** vary meaningfully while browser and Fly settings stay the same.

**Success criteria:**

- Create N personas in one action from a compact table
- Shared defaults applied automatically; operator only fills id, name, description, instructions per row
- Existing personas are never overwritten
- Clear summary of created / skipped / failed rows
- Single-persona create/edit flow remains unchanged

---

## 2. Context (Current System)

| Component | Current behavior |
| --- | --- |
| Create one | Sidebar **+ Persona mới** → `prompt()` for id → template → full form → `POST /api/personas` |
| Template | `defaultPersonaConfig(id)` — generic instructions/rubric |
| Persist | `savePersonaFile()` writes `personas/{id}.yaml` |
| Validation | `personaConfigSchema` (Zod) on full `PersonaConfig` |
| Bulk | Not supported |

Relevant files:

- `packages/console/src/server.ts` — persona CRUD API
- `packages/shared/src/personas.ts` — load/save, `defaultPersonaConfig`
- `packages/console/public/index.html`, `app.js`, `styles.css` — persona editor UI

---

## 3. Proposed Design

### 3.1 UX — Bulk panel

Entry point: new button **「Tạo hàng loạt」** next to **「+ Persona mới」** on the Personas tab.

Panel replaces or overlays the empty state / sits above list (toggle visibility):

```
┌─ Cài đặt chung (mặc định) ─────────────────────────────┐
│ Viewport [1280x720]  Locale [vi-VN]  Region [sin]       │
│ Rubric mặc định (mỗi dòng một tiêu chí)                 │
│ [clarity] [usability]                                   │
└─────────────────────────────────────────────────────────┘

| ID * | Tên * | Mô tả * | Instructions * | ✕ |
|------|-------|---------|----------------|---|
| ...  | ...   | ...     | textarea       |   |

[+ Thêm dòng]  [Dán danh sách ID]

[Lưu N persona]  [Hủy]
```

**Shared defaults (editable, pre-filled):**

| Field | Default |
| --- | --- |
| `browser.viewport` | `1280x720` |
| `browser.locale` | `vi-VN` |
| `fly.region` | `sin` |
| `evaluation.rubric` | `clarity`, `usability` (one per line in textarea) |
| `evaluation.output_format` | `json` (fixed, hidden) |
| `fly.app` | `persona-{id}` per row (computed, shown as meta under ID input) |

**Per-row fields:**

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Pattern `[a-z0-9-]+`, slugified on blur |
| `name` | yes | Display name |
| `description` | yes | Short role summary |
| `instructions` | yes | System prompt — always operator-authored |
| Remove row | — | ✕ button; minimum 1 row while panel open |

**「Dán danh sách ID」:** modal or inline prompt — paste newline-separated slugs → append rows with id filled, other fields empty, fly app meta shown.

**「Hủy」:** close bulk panel, restore normal empty/form view.

**After save:** show status summary (Vietnamese), refresh sidebar list, close bulk panel. Skipped ids listed with reason `đã tồn tại`.

### 3.2 API

New endpoint:

```
POST /api/personas/bulk
```

Request body:

```typescript
interface BulkPersonaDefaults {
  browser?: { viewport?: string; locale?: string };
  fly?: { region?: string };
  evaluation?: { rubric?: string[]; output_format?: "json" };
}

interface BulkPersonaRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

interface BulkCreatePersonasBody {
  defaults?: BulkPersonaDefaults;
  personas: BulkPersonaRow[];
}
```

Response `201` (partial success allowed):

```typescript
interface BulkCreatePersonasResult {
  created: string[];
  skipped: { id: string; reason: "persona_exists" }[];
  errors: { id: string; reason: string; details?: unknown }[];
}
```

**Server merge logic** (per row):

```typescript
function buildPersonaConfig(row: BulkPersonaRow, defaults: BulkPersonaDefaults): PersonaConfig {
  return personaConfigSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    evaluation: {
      rubric: defaults.evaluation?.rubric ?? ["clarity", "usability"],
      output_format: "json",
    },
    browser: {
      viewport: defaults.browser?.viewport ?? "1280x720",
      locale: defaults.browser?.locale ?? "vi-VN",
    },
    fly: {
      app: `persona-${row.id}`,
      region: defaults.fly?.region ?? "sin",
    },
  });
}
```

**Processing rules:**

1. Reject entire request if `personas` is empty → HTTP 400
2. For each row: if file exists → `skipped`; if validation fails → `errors`; else `savePersonaFile` → `created`
3. HTTP 201 if at least one created; HTTP 200 if all skipped/errors (optional — prefer 201 whenever any success)
4. Duplicate ids **within the same request**: last row wins for validation, but detect duplicates and add to `errors` with reason `duplicate_in_request`

### 3.3 Shared module

Extract merge helper to `@persona-system/shared` for testability:

```typescript
export function buildPersonaFromBulkRow(
  row: BulkPersonaRow,
  defaults?: BulkPersonaDefaults,
): PersonaConfig;
```

Used by console bulk handler and unit tests.

### 3.4 Out of scope (v1)

- Per-row fly.app override
- YAML/JSON file import
- LLM-generated persona sets
- Auto-deploy after bulk create
- Overwriting existing personas
- Bulk delete or bulk edit

---

## 4. Error Handling

| Case | Behavior |
| --- | --- |
| Empty `personas` array | HTTP 400 `{ error: "personas_required" }` |
| Row id already on disk | `skipped`, no write |
| Invalid id pattern / Zod fail | `errors` with flattened details |
| Duplicate id in same payload | `errors` for duplicate rows |
| All rows skipped/errored | HTTP 200/422 with empty `created`, full report in body |

Client shows combined Vietnamese summary; does not close panel if all failed (so user can fix).

---

## 5. Testing Strategy

| Layer | Test |
| --- | --- |
| Unit | `buildPersonaFromBulkRow` — defaults applied, fly.app derived, rubric fallback |
| Unit | duplicate id detection helper (if extracted) |
| Integration | optional: supertest on `POST /api/personas/bulk` with temp dir |
| Manual | Create 3 rows, one existing id → verify 2 created, 1 skipped, YAML files on disk |

Test file: `packages/shared/src/bulk-persona.test.ts`

---

## 6. Security & Data

- Same trust model as single `POST /api/personas` (local console, no auth in v1)
- Instructions may contain sensitive evaluation guidance — same as existing persona files
- No credentials in bulk defaults

---

## 7. Acceptance Checklist

- [ ] **Tạo hàng loạt** opens bulk panel with shared defaults pre-filled
- [ ] Table supports add row, remove row, paste ID list
- [ ] Each row requires id, name, description, instructions before submit
- [ ] `POST /api/personas/bulk` creates YAML files with merged config
- [ ] Existing ids skipped with clear feedback
- [ ] Sidebar refreshes with new personas
- [ ] Single-persona create/edit unchanged
- [ ] `npm test` and `npm run build` pass

---

## 8. Relationship to Other Work

Independent from **per-persona account prompt** eval feature (`docs/superpowers/specs/2026-09-13-per-persona-account-prompt-design.md`). May be implemented in parallel or sequence; no shared code beyond existing persona save/load.
