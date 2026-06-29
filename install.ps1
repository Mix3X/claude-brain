#requires -Version 7.0
<#
  claude-brain — one-shot installer for a Claude Code machine.

  Connects this machine to the shared brain (Postgres+pgvector on the NAS):
    - npm install
    - writes ~/.claude-brain/config.json
    - registers the `brain` MCP server (user scope)
    - wires SessionStart / UserPromptSubmit / Stop hooks into ~/.claude/settings.json (idempotent)
    - pings the NAS to verify
  Optionally disables a leftover claude-mem plugin.

  Run from the repo root after cloning:
    pwsh -File install.ps1 -NasIp 192.168.1.28
  The NAS password is prompted securely (never passed on the command line).
  Enable the LLM distiller by adding -ApiKey 'sk-ant-...' (Sonnet).

  All settings.json / config.json writes are backed up first. Re-running is safe.
#>
param(
  [Parameter(Mandatory = $true)][string]$NasIp,
  [string]$Machine = $env:COMPUTERNAME,
  [string]$NasUser = "nasmem",
  [string]$NasDb   = "nasmem",
  [int]$NasPort    = 5432,
  [switch]$Embed,
  [string]$ApiKey,
  [string]$SummarizeModel = "claude-sonnet-4-6",
  [switch]$DisableClaudeMem
)

$ErrorActionPreference = "Stop"

# NAS password: prompt securely, never on the command line.
$sec = Read-Host "Mot de passe Postgres NAS (user '$NasUser')" -AsSecureString
$NasPassword = [System.Net.NetworkCredential]::new('', $sec).Password
if ([string]::IsNullOrEmpty($NasPassword)) { throw "Mot de passe vide." }
$repo = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $node) { throw "node introuvable dans le PATH. Installe Node.js >= 20." }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw "claude CLI introuvable." }

Write-Host "== claude-brain installer ==" -ForegroundColor Cyan
Write-Host "repo : $repo"
Write-Host "node : $node"

# 1) deps
Write-Host "`n[1/5] npm install..." -ForegroundColor Yellow
Push-Location $repo
npm install --no-audit --no-fund | Out-Null
Pop-Location

# 2) local config
Write-Host "[2/5] config.json..." -ForegroundColor Yellow
$cfgDir = Join-Path $env:USERPROFILE ".claude-brain"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfgPath = Join-Path $cfgDir "config.json"
if (Test-Path $cfgPath) { Copy-Item $cfgPath "$cfgPath.bak" -Force }
$cfg = [ordered]@{
  pgHost     = $NasIp
  pgPort     = $NasPort
  pgUser     = $NasUser
  pgPassword = $NasPassword
  pgDatabase = $NasDb
  embed      = [bool]$Embed
  machine    = $Machine
}
if ($ApiKey) {
  $cfg.summarize = $true
  $cfg.summarizeModel = $SummarizeModel
  $cfg.anthropicApiKey = $ApiKey
}
($cfg | ConvertTo-Json) | Set-Content $cfgPath -Encoding utf8
Write-Host "  -> $cfgPath (machine=$Machine, summarize=$([bool]$ApiKey))"

# 3) MCP server (idempotent: remove then add)
Write-Host "[3/5] MCP server 'brain'..." -ForegroundColor Yellow
claude mcp remove brain --scope user 2>$null | Out-Null
claude mcp add brain --scope user -- node "$repo\src\mcp-server.js" | Out-Null

# 4) hooks in settings.json (idempotent merge)
Write-Host "[4/5] hooks settings.json..." -ForegroundColor Yellow
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.brain-bak" -Force
  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $settingsPath) | Out-Null
  $settings = @{}
}
if (-not $settings.ContainsKey("hooks")) { $settings["hooks"] = @{} }

function Add-BrainHook($settings, $eventName, $script, $timeout, $statusMessage) {
  $cmd = "`"$node`" `"$repo\hooks\$script`""
  if (-not $settings["hooks"].ContainsKey($eventName)) { $settings["hooks"][$eventName] = @() }
  $existing = $settings["hooks"][$eventName]
  # already wired? (match by script filename anywhere in this event)
  foreach ($grp in $existing) {
    foreach ($h in $grp["hooks"]) {
      if ($h["command"] -and $h["command"].Contains($script)) { return }
    }
  }
  $entry = @{ type = "command"; command = $cmd; timeout = $timeout }
  if ($statusMessage) { $entry["statusMessage"] = $statusMessage }
  $settings["hooks"][$eventName] = @($existing) + @(@{ hooks = @($entry) })
}

Add-BrainHook $settings "SessionStart"     "session-start.js" 10 "Loading brain..."
Add-BrainHook $settings "UserPromptSubmit" "capture-prompt.js" 8  $null
Add-BrainHook $settings "Stop"             "session-end.js"   10 $null

# 5) optional: drop claude-mem
if ($DisableClaudeMem -and $settings.ContainsKey("enabledPlugins")) {
  $ep = $settings["enabledPlugins"]
  if ($ep -is [hashtable] -and $ep.ContainsKey("claude-mem@thedotmack")) {
    $ep.Remove("claude-mem@thedotmack")
    Write-Host "  -> claude-mem plugin disabled"
  }
}

($settings | ConvertTo-Json -Depth 100) | Set-Content $settingsPath -Encoding utf8
# validate
Get-Content $settingsPath -Raw | ConvertFrom-Json | Out-Null
Write-Host "  -> settings.json patched + valid"

# 6) ping
Write-Host "[5/5] ping NAS..." -ForegroundColor Yellow
Push-Location $repo
node src\ping.js
Pop-Location

Write-Host "`nOK. Redemarre Claude Code pour activer les hooks + l'MCP 'brain'." -ForegroundColor Green
