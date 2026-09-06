# persona-system Worker — Agent Instructions

Private cloud worker workspace for **persona-system**.

## Identity

| Field | Value |
| --- | --- |
| Worker name | `persona-system` |
| Workspace | `C:\Users\ADMIN\Project\persona-system` |

## Superpowers

This worker uses [Superpowers](https://github.com/obra/superpowers) for agent methodology (brainstorming, TDD, debugging, plan execution).

| Component | Location |
| --- | --- |
| Skills | `.cursor/skills/` (synced from `vendor/superpowers/`) |
| Hooks | `.cursor/hooks.json` → `sessionStart` injects `using-superpowers` |
| Rules | `.cursor/rules/superpowers.mdc` (always apply) |
| Cloud context | `.cursor/CLOUD.md` |

Install or refresh:

```powershell
powershell -File scripts/install-superpowers.ps1
```

Linux / WSL / cloud agent:

```bash
bash scripts/install-superpowers.sh
```

Update to latest upstream:

```powershell
powershell -File scripts/update-superpowers.ps1
```

Cloud agents on persona-system: skills and hooks load from `.cursor/` in this repo. If skills do not auto-trigger, start the message with `@.cursor/CLOUD.md`.

## Worker start

```powershell
agent worker start --name "persona-system" --worker-dir "C:\Users\ADMIN\Project\persona-system"
```

Use `agent worker debug --worker-dir "C:\Users\ADMIN\Project\persona-system" --name "persona-system"` to verify auth before starting.
