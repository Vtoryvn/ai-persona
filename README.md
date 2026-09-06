# Persona System

Persona AI agents (Approach B): mỗi persona = Fly.io VM + Chrome DevTools MCP + LLM OpenAI-compatible.

## Setup

LLM config nằm trong **`.env` của project này** (copy từ Lumen một lần):

```bash
cp .env.example .env
# Chỉnh LLM_BASE_URL, LLM_API_KEY, LLM_MODEL trong .env
npm install && npm run build && npm test
```

## Persona Console (UI)

```bash
npm run ui   # http://localhost:8787
```

Tạo/sửa persona, chỉnh **instructions / system prompt** → lưu vào `personas/*.yaml`.

## Deploy + sync secrets

```bash
npm run persona -- deploy
npm run persona -- sync-secrets   # đẩy LLM_* từ .env local lên Fly
```

## Evaluate sản phẩm

```bash
npm run persona -- eval \
  --url https://your-product.com \
  --username demo \
  --password secret
```

Báo cáo: `artifacts/evaluations/<timestamp>/report.md`

## Docs

- `docs/superpowers/specs/2026-09-06-persona-ai-agent-system-design.md`
