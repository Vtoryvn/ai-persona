# Persona System

Persona AI agents (Approach B): mỗi persona = Fly.io VM + Chrome DevTools MCP + LLM OpenAI-compatible (custom `LLM_BASE_URL`).

## Setup

```bash
cp .env.example .env
npm install
npm run build
npm test
```

## Deploy (Fly.io)

Mỗi persona có app riêng trong `personas/*.yaml` (`fly.app`).

```bash
fly secrets set -a persona-first-timer \
  LLM_API_KEY=... \
  LLM_BASE_URL=https://your-api/v1 \
  LLM_MODEL=your-model \
  RUNNER_AUTH_TOKEN=optional

npm run persona -- deploy
npm run persona -- deploy --personas first-timer,skeptic
```

## Evaluate sản phẩm (auth user/pass)

```bash
npm run persona -- eval \
  --url https://your-product.com \
  --username demo \
  --password secret \
  --focus "Onboarding"

npm run persona -- list
```

Báo cáo: `artifacts/evaluations/<timestamp>/report.md`

## Personas

- `first-timer`, `power-user`, `skeptic`, `mobile-native`, `accessibility`

## Docs

- `docs/superpowers/specs/2026-09-06-persona-ai-agent-system-design.md`
- `docs/superpowers/plans/2026-09-06-persona-system-implementation-plan.md`
