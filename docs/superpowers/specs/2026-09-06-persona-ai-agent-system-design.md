# Persona AI Agent System — Design Spec

**Date:** 2026-09-06  
**Status:** Approved (2026-09-06)  
**Repo:** persona-system  
**Workflow:** Superpowers (brainstorming → writing-plans → executing-plans)


## Approved decisions (2026-09-06)

- **Architecture:** Approach B — full agent per Fly.io VM (Chrome + MCP + LLM loop)
- **LLM:** OpenAI-compatible API via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`
- **Product auth:** Simple username/password in mission payload (`--username` / `--password` on orchestrator)

---

## 1. Problem Statement

Build a system where **3–5 distinct AI personas** can independently evaluate a web product through a real Chrome browser, each guided by **custom instructions** (role, goals, tone, evaluation rubric). Each persona runs in its **own Fly.io VM** with **Chrome DevTools MCP** for browser automation.

**Success criteria:**
- Define personas as data (YAML), not code forks
- Each persona has an isolated browser session on Fly.io
- Orchestrator can dispatch the same product URL to all personas and collect structured feedback
- Fits the existing Superpowers workflow in this repo (brainstorm → plan → execute → verify)

---

## 2. Context (Current Repo)

| Component | State |
| --- | --- |
| Superpowers skills/hooks | ✅ Installed in `.cursor/` |
| Persona definitions | ✅ `personas/*.yaml` |
| Fly.io deployment | ✅ `deploy/persona-runner` |
| Chrome DevTools MCP | ✅ via `chrome-devtools-mcp` in runner |
| Orchestrator | ✅ `orchestrator/` CLI |

Worker identity: `persona-system` (see `AGENTS.md`).

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  persona-system (orchestrator — this repo / Cursor worker)   │
│  • persona configs (YAML)                                    │
│  • evaluation missions                                       │
│  • aggregate reports                                         │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP (MCP Streamable HTTP) + mission API
       ┌───────┴───────┬───────────────┬───────────────┐
       ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐  ...
│ Fly VM      │ │ Fly VM      │ │ Fly VM      │
│ persona:    │ │ persona:    │ │ persona:    │
│ first-timer │ │ power-user  │ │ skeptic     │
│             │ │             │ │             │
│ Chrome      │ │ Chrome      │ │ Chrome      │
│ + CDP MCP   │ │ + CDP MCP   │ │ + CDP MCP   │
│ + agent     │ │ + agent     │ │ + agent     │
│   runner    │ │   runner    │ │   runner    │
└─────────────┘ └─────────────┘ └─────────────┘
```

**Evaluation flow:**
1. Operator provides `product_url` (+ optional focus: onboarding, pricing, mobile, etc.)
2. Orchestrator loads persona configs and creates a **mission** (shared URL + per-persona brief)
3. For each persona: wake Fly machine → agent runner connects to local `chrome-devtools-mcp` → navigates product → produces structured feedback
4. Orchestrator aggregates JSON feedback into a single report (markdown + JSON artifact)

---

## 4. Three Approaches (Trade-offs)

### Approach A — Remote MCP only (thin Fly VM)

Each Fly app runs **only** `chrome-devtools-mcp` in HTTP mode (`--http --headless`). The **orchestrator** (Cursor cloud agent in this repo) runs separate LLM turns per persona, calling each persona's MCP URL remotely.

| Pros | Cons |
| --- | --- |
| Simplest Fly image | Orchestrator holds all LLM context; heavy token use |
| One place to debug agents | Latency: orchestrator ↔ N remote MCPs |
| Easy to add personas (config only) | Fly MCP must be secured (auth token) |

**Best when:** You want to drive everything from Cursor and keep Fly machines dumb.

---

### Approach B — Full agent per VM (recommended)

Each Fly app runs: **Chrome + chrome-devtools-mcp + lightweight agent runner** (Node or Python). Runner receives mission via HTTP (`POST /missions`), uses LLM API + local MCP to evaluate, returns JSON.

| Pros | Cons |
| --- | --- |
| True isolation per persona | More complex Docker image |
| Parallel evaluations, no central bottleneck | LLM API key per app (Fly secrets) |
| Persona VM can scale independently | Slightly higher Fly cost (512MB–1GB each) |

**Best when:** You want 3–5 personas evaluating in parallel like real separate users.

---

### Approach C — One Fly app, multiple processes

Single Fly app with one machine; multiple Chrome profiles or sequential persona runs on shared VM.

| Pros | Cons |
| --- | --- |
| Lowest Fly cost | No true isolation (cookies/state leak) |
| One deploy | Personas cannot run fully parallel |
| | Weaker “different user” simulation |

**Not recommended** for product evaluation where persona independence matters.

---

### Recommendation: **Approach B**

Matches your goal: each persona = custom instructions + **own VM** + **own Chrome**. Orchestrator stays thin (dispatch + aggregate).

---

## 5. Component Design

### 5.1 Persona config (`personas/*.yaml`)

```yaml
id: first-timer
name: "Mai — First-time user"
description: Non-technical user trying the product for the first time

instructions: |
  You are Mai, 28, marketing coordinator. You are NOT technical.
  Evaluate clarity of onboarding, jargon, and whether you trust the product.
  Be honest and specific. Reference what you see on screen.

evaluation:
  rubric:
    - clarity
    - trust
    - ease_of_first_task
    - would_recommend
  output_format: json

browser:
  viewport: "390x844"
  locale: vi-VN

fly:
  app: persona-first-timer
  region: sin
```

Starter set (5 personas):

| ID | Role | Lens |
| --- | --- | --- |
| `first-timer` | Non-technical new user | Onboarding, jargon, trust |
| `power-user` | Developer / power user | Speed, shortcuts, depth |
| `skeptic` | Enterprise buyer | Pricing, security signals, credibility |
| `mobile-native` | Mobile-only user | Touch UX, responsive layout |
| `accessibility` | A11y-focused | Contrast, keyboard, screen reader hints |

### 5.2 Fly VM stack (`deploy/persona-runner/`)

**Docker image contents:**
- Google Chrome (headless-capable)
- `chrome-devtools-mcp@latest --http --headless --port 9223`
- Agent runner service (Fastify/Express or FastAPI):
  - `GET /health`
  - `POST /missions` — `{ url, instructions, rubric, focus? }`
  - Returns `{ persona_id, findings[], score{}, screenshots[]?, summary }`

**fly.toml (per persona app):**
- `memory = "1gb"`
- `[[vm]] size = "shared-cpu-1x"`
- `min_machines_running = 0` (scale to zero between evals) or `1` during active dev
- Secrets: `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, `MCP_AUTH_TOKEN`

### 5.3 Orchestrator (`orchestrator/`)

```bash
pnpm persona eval --url https://your-product.com --focus onboarding
pnpm persona eval --url https://your-product.com --persona skeptic
pnpm persona deploy --persona all
```

Outputs: `artifacts/evaluations/<timestamp>/report.md` + `feedback.json`

### 5.4 Superpowers integration

| Phase | Skill |
| --- | --- |
| Design (this doc) | brainstorming |
| Implementation plan | writing-plans |
| Build Fly + orchestrator | executing-plans |
| Tests | test-driven-development |
| Done gate | verification-before-completion |

---

## 6. Chrome DevTools MCP on Fly.io

```bash
npx chrome-devtools-mcp@latest --http --headless --port 9223 --viewport 1280x720
```

**Fly considerations:**
- Chrome container flags (`--no-sandbox`, adequate `/dev/shm`)
- Agent runner connects to `http://127.0.0.1:9223/mcp` on same machine
- Optional noVNC sidecar for debugging

---

## 7. Feedback Schema

```json
{
  "persona_id": "skeptic",
  "product_url": "https://example.com",
  "summary": "One paragraph in persona voice",
  "scores": {
    "clarity": 7,
    "trust": 5,
    "ease_of_first_task": 6,
    "would_recommend": 4
  },
  "findings": [
    {
      "severity": "high",
      "area": "pricing",
      "observation": "...",
      "suggestion": "..."
    }
  ]
}
```

---

## 8. Repository Layout

```
persona-system/
├── personas/
├── orchestrator/
├── deploy/persona-runner/
├── artifacts/evaluations/
└── docs/superpowers/specs/
```

---

## 9. Implementation Phases (after approval)

1. Persona data + JSON schema
2. Fly runner image (Docker + MCP + missions API)
3. Orchestrator CLI
4. End-to-end eval with real product URL
5. Auth, scale-to-zero, Superpowers skill doc

---

## 10. Open Questions

1. **LLM provider:** OpenAI, Anthropic, or Gemini?
2. **Fly org:** Existing Fly account or templates only until deploy?
3. **Auth flows:** Public URL only, or login-required products?
4. **Language:** Feedback in Vietnamese, English, or both?
5. **noVNC:** Watch live browser, or headless-only?

---

## 11. Approval Checklist

- [ ] Approach B approved
- [ ] Starter persona set approved
- [ ] LLM provider chosen
- [ ] Ready for writing-plans → implementation
