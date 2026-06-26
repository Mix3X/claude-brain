# Installation manuelle (fallback)

Normalement utilise `install.ps1` (voir README). Ce fichier décrit le câblage manuel si tu
préfères, ou pour comprendre ce que fait le script.

## 1. Dépendances + config
```powershell
cd claude-brain
npm install
```
Crée `C:\Users\<toi>\.claude-brain\config.json` :
```json
{
  "pg": "postgres://nasmem:TON_MOT_DE_PASSE@192.168.1.28:5432/nasmem",
  "embed": false,
  "machine": "PC-CARPE"
}
```
Teste : `node src\ping.js`

## 2. Serveur MCP
```powershell
claude mcp add brain --scope user -- node "C:\Users\<toi>\claude-brain\src\mcp-server.js"
claude mcp list   # doit montrer brain
```

## 3. Hooks dans ~/.claude/settings.json
Ajoute (en fusionnant avec l'existant), `<toi>` = ton compte :
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\<toi>\\claude-brain\\hooks\\session-start.js\"", "timeout": 10, "statusMessage": "Loading brain..." } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\<toi>\\claude-brain\\hooks\\capture-prompt.js\"", "timeout": 8 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Users\\<toi>\\claude-brain\\hooks\\session-end.js\"", "timeout": 10 } ] }
    ]
  }
}
```
Valide : `Get-Content "$env:USERPROFILE\.claude\settings.json" -Raw | ConvertFrom-Json | Out-Null; "JSON OK"`

## Robustesse
Hooks = `node` one-shot, aucun port, aucun worker, aucun sous-Claude. NAS injoignable →
deadline interne 5-6 s, la session continue, seule cette capture est sautée.
