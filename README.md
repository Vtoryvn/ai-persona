# Persona System

## Persona Console (UI đầy đủ)

Một UI cho toàn bộ workflow:

```bash
npm install && npm run build
npm run ui   # http://localhost:8787
```

| Tab | Chức năng |
|---|---|
| **Personas** | Tạo/sửa instructions, rubric, Fly app |
| **Fly & Deploy** | Deploy → Sync LLM secrets → Check health |
| **Đánh giá** | Chạy eval sản phẩm (URL + user/pass) |

Panel **Tiến trình** ở dưới hiển thị log realtime (deploy có thể 15–30 phút lần đầu).

### Chuỗi bước trên UI

1. Tab **Personas** — chỉnh prompt nếu cần, **Lưu**
2. Tab **Fly & Deploy** — chọn 5 persona → **Deploy** → **Sync LLM secrets** → **Check health**
3. Tab **Đánh giá** — nhập URL + auth → **Chạy đánh giá** → xem báo cáo

`.env` local cần có `LLM_*` và `FLY_API_TOKEN` (hoặc `fly auth login`).

## CLI (tuỳ chọn)

```bash
npm run persona -- deploy
npm run persona -- sync-secrets
npm run persona -- eval --url https://... --username u --password p
```
