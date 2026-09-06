## Skill invocation

Cursor discovers skills under `.cursor/skills/`. Before any task:

1. Check whether a Superpowers skill applies (read its `description` in frontmatter).
2. Read the full skill: `.cursor/skills/<skill-name>/SKILL.md`
3. Announce "Using [skill] to [purpose]" and follow the skill exactly.

Do not rely on memory — skills evolve. Always read the current `SKILL.md`.

## Subagent dispatch

Use the `Task` tool with an appropriate `subagent_type`:

| Skill action | Cursor tool |
| --- | --- |
| Dispatch explore/search work | `Task` with `subagent_type: "explore"` |
| General implementation/review | `Task` with `subagent_type: "generalPurpose"` |
| Code review (Bugbot) | `Task` with `subagent_type: "bugbot"` (explicit user request) |
| Security review | `Task` with `subagent_type: "security-review"` (explicit user request) |

When a skill says "dispatch a subagent per task", use `Task` once per task and wait for the result before continuing.

## File and shell operations

| Skill action | Cursor tool |
| --- | --- |
| Read files | `Read` |
| Edit files | `StrReplace` / `Write` |
| Search codebase | `Grep` / `Glob` |
| Run commands | `Shell` |
| Track multi-step work | `TodoWrite` |

## Git worktrees

`using-git-worktrees` and `finishing-a-development-branch` use normal git commands via `Shell`. Detect environment first:

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
```

On cloud agents, prefer feature branches and PRs per cloud task instructions when the repo is initialized.

## Cloud agent notes

- Project skills live in `.cursor/skills/` (synced from `vendor/superpowers/skills/`).
- Session bootstrap runs via `.cursor/hooks.json` → `superpowers-session-start.cmd`.
- If hooks do not run, the always-apply rule `.cursor/rules/superpowers.mdc` and `.cursor/CLOUD.md` still require skill checks.
