# Persona System

Persona AI agents (Approach B): mỗi persona = Fly.io VM + Chrome DevTools MCP + LLM OpenAI-compatible.

## LLM config (từ Lumen)

Persona-system **tự đọc LLM env từ project Lumen** (mặc định `../lumen/.env.local`):

- `OPENAI_BASE_URL` → `LLM_BASE_URL`
- `OPENAI_API_KEY` → `LLM_API_KEY`
- `MODEL` (hoặc mặc định `gpt-4o`)

Override bằng `LUMEN_PROJECT_PATH` hoặc set trực tiếp `LLM_*` trong `.env`.

```bash
cp .env.example .env
npm install && npm run build && npm test
```

Sync secrets lên Fly sau khi Lumen đã cấu hình:

```bash
npm run persona -- sync-secrets
```

## Persona Console (UI)

Web UI để **tạo persona mới** và **chỉnh instructions / system prompt**:

```bash
npm run ui
# http://localhost:8787
```

- Sidebar: danh sách persona
- Form: ID, tên, mô tả, instructions, rubric, Fly/viewport
- Lưu trực tiếp vào `personas/*.yaml`

## Deploy (Fly.io)

```bash
npm run persona -- deploy
npm run persona -- sync-secrets   # LLM từ Lumen → Fly secrets
```

## Evaluate sản phẩm (auth user/pass)

```bash
npm run persona -- eval \
  --url https://your-product.com \
  --username demo \
  --password secret

npm run persona -- list
```

Báo cáo: `artifacts/evaluations/<timestamp>/report.md`

## Personas mặc định

`first-timer`, `power-user`, `skeptic`, `mobile-native`, `accessibility`

## Docs

- `docs/superpowers/specs/2026-09-06-persona-ai-agent-system-design.md`
- `docs/superpowers/plans/2026-09-06-persona-system-implementation-plan.md`
