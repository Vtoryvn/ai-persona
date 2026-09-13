# Per-Persona Account Prompt — Design Spec

**Date:** 2026-09-13  
**Status:** Approved (2026-09-13)  
**Repo:** persona-system  
**Workflow:** Superpowers (brainstorming → writing-plans → executing-plans)

---

## Approved decisions (2026-09-13)

- **Input style:** Option A — freeform text account prompt per persona (not structured username/password fields)
- **Prompt model:** Shared task prompt + optional per-persona account prompt merged at dispatch time
- **Scope:** Console UI + orchestrator API path only (no CLI changes, no persona YAML defaults, no runner/agent changes)
- **Backward compatibility:** Evals without `personaAccountPrompts` behave exactly as today

---

## 1. Problem Statement

When running evaluations with multiple AI personas **in parallel**, each persona uses an isolated Chrome VM but often must log into the **same product** with **different user accounts**. Today the Console exposes a single freeform eval prompt shared by all personas. Operators embed login instructions in that one textarea, causing every agent to use the same account and creating session conflicts (logout, concurrent edits, rate limits).

**Success criteria:**

- Operator can enter a **separate freeform account prompt** for each selected persona before starting an eval
- Each persona receives a merged mission prompt that includes its own account instructions
- Personas without an account prompt still run with only the shared task prompt
- No changes required to persona YAML or runner deployment for this feature

---

## 2. Context (Current System)

| Component | Current behavior |
| --- | --- |
| Console eval form | One `#eval-prompt` textarea + persona checkboxes |
| `POST /api/ops/eval` | Accepts `prompt`, optional shared `username`/`password`/`loginUrl`, `personaIds` |
| `runEval()` / `dispatchMission()` | Sends identical `options.prompt` to every persona runner |
| Runner `agent.ts` | User message = `mission.prompt` only; no per-persona merge today |
| Parallelism | `Promise.all` over selected personas — conflicts appear when accounts overlap |

Relevant files:

- `orchestrator/src/eval.ts` — mission dispatch
- `packages/console/src/ops-routes.ts` — eval API
- `packages/console/public/index.html`, `app.js`, `styles.css` — eval UI

---

## 3. Proposed Design

### 3.1 Data model

Add optional map on eval request / options:

```typescript
personaAccountPrompts?: Record<string, string>
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | `string` | yes | Shared task prompt (product URL, scenario, focus areas) |
| `personaIds` | `string[]` | no | Subset of personas to run; default all |
| `personaAccountPrompts` | `Record<string, string>` | no | Freeform login/account instructions keyed by persona id |

Rules:

- Keys must be persona ids (e.g. `"first-timer"`, `"power-user"`)
- Empty or whitespace-only values are ignored (treated as absent)
- Unknown persona ids in the map are ignored (no error)
- Shared `username` / `password` / `loginUrl` on `EvalBody` remain supported for CLI/backward compatibility; per-persona account prompt does not replace them in this iteration

### 3.2 Prompt merge semantics

Before POST `/missions`, orchestrator resolves the effective prompt per persona:

```typescript
function mergeEvalPrompt(basePrompt: string, accountPrompt?: string): string {
  const account = accountPrompt?.trim();
  if (!account) return basePrompt.trim();
  return `${basePrompt.trim()}\n\n## Tài khoản riêng cho agent này\n${account}`;
}
```

| Input | Output |
| --- | --- |
| Base only | Base trimmed |
| Base + account | Base + Vietnamese section header + account text |
| Account only (edge) | Still valid if base is non-empty (base required by API) |

The merged string becomes `mission.prompt` sent to the runner. Runner and agent code are unchanged.

### 3.3 Console UI

Replace the eval persona checkbox grid with a **persona eval list** — one row per persona:

| UI element | Behavior |
| --- | --- |
| Checkbox | Include persona in this eval run (default: checked) |
| Persona name + id meta | Label, same as today |
| Account prompt textarea | Optional; 2 rows; placeholder guides operator |
| Shared task prompt | Unchanged; stays above persona list |

On submit:

```json
{
  "prompt": "...",
  "personaIds": ["first-timer", "power-user"],
  "personaAccountPrompts": {
    "first-timer": "Đăng nhập user-a@test.com / pass123",
    "power-user": "Đăng nhập user-b@test.com / pass456"
  }
}
```

Only include map entries where the textarea has non-empty trimmed content. Omit the key entirely for personas with blank account prompts.

Copy (Vietnamese, consistent with existing Console):

- Section label: **Prompt tài khoản (tùy chọn)**
- Placeholder: `Đăng nhập user-a@test.com / pass123 — mỗi persona nên dùng tài khoản khác nhau`
- Helper under shared prompt: note that account prompts are per persona to avoid login conflicts

### 3.4 API

Extend `EvalBody` in `packages/console/src/ops-routes.ts`:

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

Pass `personaAccountPrompts` through to `runEval()`. No new HTTP routes.

### 3.5 Orchestrator

Extend `EvalOptions` in `orchestrator/src/eval.ts`:

```typescript
export interface EvalOptions {
  prompt: string;
  personasDir: string;
  personaIds?: string[];
  productUrl?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  personaAccountPrompts?: Record<string, string>;
  outDir?: string;
  onLog?: LogFn;
  onEvent?: EventFn;
}
```

In `dispatchMission()`:

```typescript
const accountPrompt = options.personaAccountPrompts?.[persona.id];
const prompt = mergeEvalPrompt(options.prompt, accountPrompt);
```

Export `mergeEvalPrompt` from orchestrator package for unit tests.

### 3.6 Out of scope

- Structured username/password/loginUrl per persona (Option B/C deferred)
- CLI `--accounts` JSON file
- Persisting account prompts in persona YAML
- Injecting `mission.auth` in runner (existing unused field)
- Showing merged prompt in job session UI (optional follow-up)
- Validating that accounts are unique across personas

---

## 4. Error Handling

| Case | Behavior |
| --- | --- |
| Missing shared `prompt` | HTTP 400 (unchanged) |
| No personas selected | HTTP 400 or empty run error (unchanged) |
| Account prompt for unchecked persona | Ignored if not in `personaIds`; UI only submits checked personas' fields |
| Extra keys in map | Ignored at merge time if persona not in run |

---

## 5. Testing Strategy

| Layer | Test |
| --- | --- |
| Unit | `mergeEvalPrompt` — base only, base+account, whitespace account ignored |
| Build | `npm run build` across workspaces |
| Manual | Console eval with 2+ personas, distinct account prompts, verify merged prompt in artifact JSON |

Test file: `orchestrator/src/eval-prompt.test.ts` (Node built-in test runner, same as `@persona-system/shared`).

---

## 6. Security Notes

- Account prompts may contain credentials; treat like existing eval prompt text
- Do not log full account prompts in job logs (only persona id start messages — unchanged)
- Artifacts `{personaId}.json` store `missionResult.prompt` which will include merged account section — same sensitivity as today

---

## 7. Acceptance Checklist

- [ ] Console shows per-persona optional account prompt textarea when personas exist
- [ ] Submit sends `personaAccountPrompts` map for non-empty fields only
- [ ] Each parallel persona receives a different merged `mission.prompt` when given different account prompts
- [ ] Eval without account prompts behaves identically to pre-change behavior
- [ ] `npm test` passes including new unit tests
- [ ] `npm run build` succeeds
