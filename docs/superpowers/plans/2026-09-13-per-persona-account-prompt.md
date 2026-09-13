# Per-Persona Account Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators enter a freeform account prompt per persona when starting an eval so parallel agents use distinct login instructions and avoid account conflicts.

**Architecture:** Console collects `personaAccountPrompts` map → `POST /api/ops/eval` → `runEval()` merges shared prompt + per-persona account text in `dispatchMission()` → unchanged runner receives distinct `mission.prompt` per persona.

**Tech Stack:** Node 20+, TypeScript, Fastify console, orchestrator eval pipeline, Node built-in test runner

**Spec:** `docs/superpowers/specs/2026-09-13-per-persona-account-prompt-design.md`

## Global Constraints

- Account input style: **freeform text only** (Option A) — no structured username/password UI
- Merge header (verbatim): `## Tài khoản riêng cho agent này`
- Backward compatible: missing or empty `personaAccountPrompts` → behavior unchanged
- Out of scope: CLI, persona YAML defaults, runner/agent changes, unique-account validation
- UI copy in Vietnamese, consistent with existing Console eval tab
- Do not log credential text in new job log lines

---

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `orchestrator/src/eval-prompt.ts` | Create | Pure `mergeEvalPrompt()` function |
| `orchestrator/src/eval-prompt.test.ts` | Create | Unit tests for merge semantics |
| `orchestrator/src/eval.ts` | Modify | `EvalOptions.personaAccountPrompts`, use merge in `dispatchMission` |
| `orchestrator/src/index.ts` | Modify | Re-export `mergeEvalPrompt` |
| `orchestrator/package.json` | Modify | Add `"test": "node --import tsx --test src/**/*.test.ts"` |
| `packages/console/src/ops-routes.ts` | Modify | Extend `EvalBody`, pass map to `runEval` |
| `packages/console/public/index.html` | Modify | Helper text + container for persona eval rows |
| `packages/console/public/app.js` | Modify | Render rows, collect map on submit |
| `packages/console/public/styles.css` | Modify | Styles for eval persona rows + account textarea |

---

### Task 1: Prompt merge helper (orchestrator)

**Files:**
- Create: `orchestrator/src/eval-prompt.ts`
- Create: `orchestrator/src/eval-prompt.test.ts`
- Modify: `orchestrator/package.json`

**Interfaces:**
- Produces: `export function mergeEvalPrompt(basePrompt: string, accountPrompt?: string): string`

- [ ] **Step 1: Write the failing test**

Create `orchestrator/src/eval-prompt.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { mergeEvalPrompt } from "./eval-prompt.js";

test("mergeEvalPrompt returns trimmed base when account absent", () => {
  assert.equal(mergeEvalPrompt("  Vào example.com  "), "Vào example.com");
});

test("mergeEvalPrompt appends account section when account provided", () => {
  const result = mergeEvalPrompt("Vào example.com", "Đăng nhập user-a@test.com / pass123");
  assert.equal(
    result,
    "Vào example.com\n\n## Tài khoản riêng cho agent này\nĐăng nhập user-a@test.com / pass123",
  );
});

test("mergeEvalPrompt ignores whitespace-only account", () => {
  assert.equal(mergeEvalPrompt("Vào example.com", "   \n  "), "Vào example.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @persona-system/orchestrator`  
Expected: FAIL — cannot find module `./eval-prompt.js`

- [ ] **Step 3: Add test script and implement helper**

In `orchestrator/package.json` scripts:

```json
"test": "node --import tsx --test src/**/*.test.ts"
```

Create `orchestrator/src/eval-prompt.ts`:

```typescript
export function mergeEvalPrompt(basePrompt: string, accountPrompt?: string): string {
  const base = basePrompt.trim();
  const account = accountPrompt?.trim();
  if (!account) return base;
  return `${base}\n\n## Tài khoản riêng cho agent này\n${account}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @persona-system/orchestrator`  
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/eval-prompt.ts orchestrator/src/eval-prompt.test.ts orchestrator/package.json
git commit -m "feat(orchestrator): add mergeEvalPrompt for per-persona account text"
```

---

### Task 2: Wire merge into eval dispatch

**Files:**
- Modify: `orchestrator/src/eval.ts`
- Modify: `orchestrator/src/index.ts`

**Interfaces:**
- Consumes: `mergeEvalPrompt` from `./eval-prompt.js`
- Produces: `EvalOptions.personaAccountPrompts?: Record<string, string>`

- [ ] **Step 1: Extend EvalOptions**

In `orchestrator/src/eval.ts`, add to `EvalOptions`:

```typescript
personaAccountPrompts?: Record<string, string>;
```

Add import:

```typescript
import { mergeEvalPrompt } from "./eval-prompt.js";
```

- [ ] **Step 2: Use merge in dispatchMission**

Replace direct `prompt: options.prompt` in the POST body with:

```typescript
const prompt = mergeEvalPrompt(
  options.prompt,
  options.personaAccountPrompts?.[persona.id],
);
```

Use `prompt` in the body object (and ensure `missionResult` artifacts reflect merged text via runner response — no extra change needed if runner echoes input prompt).

- [ ] **Step 3: Export helper from package index**

In `orchestrator/src/index.ts`:

```typescript
export { mergeEvalPrompt } from "./eval-prompt.js";
```

- [ ] **Step 4: Build orchestrator**

Run: `npm run build -w @persona-system/orchestrator`  
Expected: PASS, no TypeScript errors

- [ ] **Step 5: Run tests**

Run: `npm run test -w @persona-system/orchestrator && npm test`  
Expected: all workspace tests PASS

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/eval.ts orchestrator/src/index.ts
git commit -m "feat(orchestrator): merge per-persona account prompts at dispatch"
```

---

### Task 3: Console API pass-through

**Files:**
- Modify: `packages/console/src/ops-routes.ts`

**Interfaces:**
- Consumes: `EvalOptions.personaAccountPrompts`
- Produces: HTTP body field `personaAccountPrompts?: Record<string, string>` on `POST /api/ops/eval`

- [ ] **Step 1: Extend EvalBody interface**

```typescript
interface EvalBody extends PersonaIdsBody {
  prompt: string;
  productUrl?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  personaAccountPrompts?: Record<string, string>;
}
```

- [ ] **Step 2: Pass to runEval**

In the `runJob` callback for `/api/ops/eval`, add:

```typescript
personaAccountPrompts: body.personaAccountPrompts,
```

- [ ] **Step 3: Build console**

Run: `npm run build -w @persona-system/console`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/console/src/ops-routes.ts
git commit -m "feat(console): accept personaAccountPrompts on eval API"
```

---

### Task 4: Console eval UI

**Files:**
- Modify: `packages/console/public/index.html`
- Modify: `packages/console/public/app.js`
- Modify: `packages/console/public/styles.css`

**Interfaces:**
- Consumes: `allPersonas` list from `/api/personas`
- Produces: POST body `{ prompt, personaIds, personaAccountPrompts? }`

- [ ] **Step 1: Update index.html eval section**

Below `#eval-prompt`, add helper paragraph:

```html
<p class="meta eval-hint">Prompt tài khoản riêng cho từng persona bên dưới — mỗi agent nên dùng tài khoản khác nhau khi chạy song song.</p>
```

Replace `<div id="eval-persona-checks" class="check-grid"></div>` with:

```html
<div id="eval-persona-rows" class="eval-persona-rows"></div>
```

- [ ] **Step 2: Replace renderCheckboxes for eval with renderEvalPersonaRows**

In `app.js`, add:

```javascript
function renderEvalPersonaRows() {
  const container = document.getElementById("eval-persona-rows");
  container.innerHTML = "";
  for (const p of allPersonas) {
    const row = document.createElement("div");
    row.className = "eval-persona-row";
    row.dataset.personaId = p.id;
    row.innerHTML = `
      <label class="eval-persona-head check-item">
        <input type="checkbox" class="eval-persona-check" value="${p.id}" checked />
        <span>${p.name} <span class="meta">${p.id}</span></span>
      </label>
      <label class="eval-account-label meta">Prompt tài khoản (tùy chọn)</label>
      <textarea class="eval-account-prompt" rows="2" placeholder="Đăng nhập user-a@test.com / pass123 — mỗi persona nên dùng tài khoản khác nhau"></textarea>
    `;
    container.appendChild(row);
  }
}

function getEvalSubmitPayload() {
  const personaIds = [];
  const personaAccountPrompts = {};
  for (const row of document.querySelectorAll(".eval-persona-row")) {
    const check = row.querySelector(".eval-persona-check");
    if (!check?.checked) continue;
    personaIds.push(check.value);
    const account = row.querySelector(".eval-account-prompt")?.value.trim();
    if (account) personaAccountPrompts[check.value] = account;
  }
  return {
    prompt: document.getElementById("eval-prompt").value.trim(),
    personaIds,
    personaAccountPrompts: Object.keys(personaAccountPrompts).length
      ? personaAccountPrompts
      : undefined,
  };
}
```

In `refreshList()`, call `renderEvalPersonaRows()` instead of `renderCheckboxes("eval-persona-checks")` (keep ops checkboxes unchanged).

- [ ] **Step 3: Update eval form submit handler**

Replace submit body construction with:

```javascript
const body = getEvalSubmitPayload();
await startJob("/api/ops/eval", body, { useStream: true, personaIds: body.personaIds });
```

- [ ] **Step 4: Add CSS**

In `styles.css`:

```css
.eval-persona-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.eval-persona-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.65rem 0.75rem;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.eval-persona-head {
  margin: 0;
}

.eval-account-label {
  margin: 0;
}

.eval-account-prompt {
  width: 100%;
  min-height: 3rem;
  resize: vertical;
  font: inherit;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: inherit;
}

.eval-hint {
  margin: 0.35rem 0 0.75rem;
}
```

- [ ] **Step 5: Manual smoke check**

Run console locally (`npm run ui:dev` — user starts manually). On tab **Đánh giá**:

1. Confirm each persona row shows checkbox + account textarea
2. Enter distinct account prompts for two personas
3. Submit eval and confirm network payload includes `personaAccountPrompts`

- [ ] **Step 6: Full build + test**

Run: `npm run build && npm test`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/console/public/index.html packages/console/public/app.js packages/console/public/styles.css
git commit -m "feat(console): per-persona account prompt inputs on eval form"
```

---

## Plan self-review

| Spec requirement | Task |
| --- | --- |
| `personaAccountPrompts` map on API | Task 3 |
| `mergeEvalPrompt` semantics | Task 1 |
| `dispatchMission` per-persona merge | Task 2 |
| Console UI rows + textareas | Task 4 |
| Unit tests | Task 1 |
| Backward compatibility | Tasks 1–2 (empty map → base only) |
| Out of scope items untouched | No tasks added for CLI/YAML/runner |

No placeholders remain. Type name `personaAccountPrompts` is consistent across EvalBody, EvalOptions, and UI payload.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-13-per-persona-account-prompt.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration  
2. **Inline Execution** — implement all tasks in this session with checkpoints

Which approach do you want?
