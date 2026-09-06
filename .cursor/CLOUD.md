# Cloud agent context (persona-system)

Cloud and self-hosted Cursor workers should load this file plus `.cursor/rules/superpowers.mdc`.

## Superpowers

| Skill | Path | When to use |
| --- | --- | --- |
| using-superpowers | `.cursor/skills/using-superpowers/SKILL.md` | Every session — skill discovery and mandatory invocation rules |
| brainstorming | `.cursor/skills/brainstorming/SKILL.md` | Before creative work: features, components, behavior changes |
| writing-plans | `.cursor/skills/writing-plans/SKILL.md` | Spec/requirements ready, before coding |
| executing-plans | `.cursor/skills/executing-plans/SKILL.md` | Written plan to execute with review checkpoints |
| subagent-driven-development | `.cursor/skills/subagent-driven-development/SKILL.md` | Execute plan tasks in-session via subagents |
| test-driven-development | `.cursor/skills/test-driven-development/SKILL.md` | Before implementation code |
| systematic-debugging | `.cursor/skills/systematic-debugging/SKILL.md` | Bugs, test failures, unexpected behavior |
| verification-before-completion | `.cursor/skills/verification-before-completion/SKILL.md` | Before claiming done or opening PR |
| using-git-worktrees | `.cursor/skills/using-git-worktrees/SKILL.md` | Isolated feature workspace |
| finishing-a-development-branch | `.cursor/skills/finishing-a-development-branch/SKILL.md` | Implementation complete — merge/PR/cleanup |
| requesting-code-review | `.cursor/skills/requesting-code-review/SKILL.md` | Before merge — verify requirements |
| receiving-code-review | `.cursor/skills/receiving-code-review/SKILL.md` | Processing review feedback |
| dispatching-parallel-agents | `.cursor/skills/dispatching-parallel-agents/SKILL.md` | 2+ independent parallel tasks |
| writing-skills | `.cursor/skills/writing-skills/SKILL.md` | Authoring or editing skills |

**Routing:** Feature/design requests → `brainstorming` first. Bugs → `systematic-debugging` first. Implementation → `test-driven-development`. See `.cursor/skills/using-superpowers/references/cursor-tools.md` for Cursor `Task` / tool mapping.

**Hooks:** `.cursor/hooks.json` runs `superpowers-session-start.cmd` at `sessionStart` to inject `using-superpowers` context.

**Updates:** `powershell -File scripts/update-superpowers.ps1` or `bash scripts/install-superpowers.sh`
