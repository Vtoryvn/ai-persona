# Install or refresh Superpowers in this project.
# Vendors obra/superpowers, syncs skills to .cursor/skills/, and verifies hooks.
param(
    [string]$Version = "main",
    [switch]$SkipClone
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vendor = Join-Path $Root "vendor\superpowers"
$SkillsSrc = Join-Path $Vendor "skills"
$SkillsDst = Join-Path $Root ".cursor\skills"

function Sync-Skills {
    if (-not (Test-Path $SkillsSrc)) {
        throw "Skills source not found: $SkillsSrc"
    }
    New-Item -ItemType Directory -Force -Path $SkillsDst | Out-Null
    robocopy $SkillsSrc $SkillsDst /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
    # Re-apply project-specific Cursor tool mapping after mirror sync
    $CursorTools = @"
## Skill invocation

Cursor discovers skills under ``.cursor/skills/``. Before any task:

1. Check whether a Superpowers skill applies (read its ``description`` in frontmatter).
2. Read the full skill: ``.cursor/skills/<skill-name>/SKILL.md``
3. Announce "Using [skill] to [purpose]" and follow the skill exactly.

Do not rely on memory — skills evolve. Always read the current ``SKILL.md``.

## Subagent dispatch

Use the ``Task`` tool with an appropriate ``subagent_type``:

| Skill action | Cursor tool |
| --- | --- |
| Dispatch explore/search work | ``Task`` with ``subagent_type: "explore"`` |
| General implementation/review | ``Task`` with ``subagent_type: "generalPurpose"`` |
| Code review (Bugbot) | ``Task`` with ``subagent_type: "bugbot"`` (explicit user request) |
| Security review | ``Task`` with ``subagent_type: "security-review"`` (explicit user request) |

When a skill says "dispatch a subagent per task", use ``Task`` once per task and wait for the result before continuing.

## File and shell operations

| Skill action | Cursor tool |
| --- | --- |
| Read files | ``Read`` |
| Edit files | ``StrReplace`` / ``Write`` |
| Search codebase | ``Grep`` / ``Glob`` |
| Run commands | ``Shell`` |
| Track multi-step work | ``TodoWrite`` |

## Git worktrees

``using-git-worktrees`` and ``finishing-a-development-branch`` use normal git commands via ``Shell``. Detect environment first:

``````bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
``````

On cloud agents, prefer feature branches and PRs per cloud task instructions when the repo is initialized.

## Cloud agent notes

- Project skills live in ``.cursor/skills/`` (synced from ``vendor/superpowers/skills/``).
- Session bootstrap runs via ``.cursor/hooks.json`` → ``superpowers-session-start.cmd``.
- If hooks do not run, the always-apply rule ``.cursor/rules/superpowers.mdc`` and ``.cursor/CLOUD.md`` still require skill checks.
"@
    $CursorToolsPath = Join-Path $SkillsDst "using-superpowers\references\cursor-tools.md"
    New-Item -ItemType Directory -Force -Path (Split-Path $CursorToolsPath) | Out-Null
    Set-Content -Path $CursorToolsPath -Value $CursorTools -Encoding UTF8
}

if (-not $SkipClone) {
    if (Test-Path $Vendor) {
        Write-Host "Updating vendor/superpowers..."
        git -C $Vendor fetch --depth 1 origin $Version
        git -C $Vendor checkout $Version
        git -C $Vendor pull --ff-only origin $Version 2>$null
        if ($LASTEXITCODE -ne 0) {
            git -C $Vendor reset --hard "origin/$Version"
        }
    } else {
        Write-Host "Cloning obra/superpowers ($Version)..."
        New-Item -ItemType Directory -Force -Path (Split-Path $Vendor) | Out-Null
        git clone --depth 1 --branch $Version https://github.com/obra/superpowers.git $Vendor
    }
}

Sync-Skills

# Verify hook
$Hook = Join-Path $Root ".cursor\hooks\superpowers-session-start.cmd"
if (-not (Test-Path $Hook)) {
    throw "Missing hook wrapper: $Hook"
}

Write-Host "Superpowers installed."
Write-Host "  Vendor:  $Vendor"
Write-Host "  Skills:  $SkillsDst"
Write-Host "  Hooks:   $(Join-Path $Root '.cursor\hooks.json')"
Write-Host "  Rules:   $(Join-Path $Root '.cursor\rules\superpowers.mdc')"
Write-Host "  Cloud:   $(Join-Path $Root '.cursor\CLOUD.md')"
