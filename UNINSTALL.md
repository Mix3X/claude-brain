# Désinstaller claude-mem proprement

À faire **après** avoir migré la mémoire (`migrate/`) et vérifié que claude-nas-mem marche.

## 1. Tuer le worker + nettoyer (réutilise ton script rescue)

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\hooks\claude-mem-rescue.ps1"
```

## 2. Désactiver / désinstaller le plugin

```powershell
claude plugin disable claude-mem@thedotmack
# puis, si dispo dans ta version :
claude plugin uninstall claude-mem@thedotmack
```

Sinon, retire-le manuellement de `~/.claude/settings.json` :

```json
"enabledPlugins": {
  "caveman@caveman": true
}
```

(supprime la ligne `"claude-mem@thedotmack": true`)

## 3. Retirer le hook de réparation devenu inutile

Dans `~/.claude/settings.json`, supprime le bloc hook qui appelle
`claude-mem-port-guard.ps1` (plus de worker 37777 à garder). Garde les hooks caveman.

## 4. Vérifier qu'il ne reste aucun process

```powershell
Get-CimInstance Win32_Process -Filter "Name='bun.exe' OR Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'claude-mem|worker-service|chroma' } |
  Select-Object ProcessId, CommandLine
```

Doit ne rien renvoyer.

## 5. Données (optionnel)

Une fois la migration validée, tu peux archiver puis supprimer l'ancien dossier :

```powershell
Compress-Archive "$env:USERPROFILE\.claude-mem" "$env:USERPROFILE\claude-mem-backup.zip"
# Remove-Item "$env:USERPROFILE\.claude-mem" -Recurse -Force   # seulement après backup + validation
```

Les scripts `claude-mem-port-guard.ps1` / `claude-mem-rescue.ps1` peuvent rester dans
`~/.claude/hooks/` (inertes) ou être supprimés.
