# claude-brain

Mémoire partagée multi-machines pour Claude Code, stockée sur ton NAS.

Remplace le plugin `claude-mem@thedotmack` par une archi simple, robuste et concurrent-safe :

- **Postgres + pgvector** dans un conteneur sur le NAS = source unique de vérité.
- **Serveur MCP stdio** (`brain`) lancé localement par chaque Claude Code, se connecte au Postgres du NAS.
- **Hooks de capture** fail-safe : aucun port, aucun worker persistant, aucun sous-Claude. Ne bloquent jamais la session.

Outils MCP exposés : `memory_search`, `memory_add`, `memory_context`.

## Pourquoi pas juste mettre la base sur un partage NAS ?

SQLite (WAL) + chroma **ne fonctionnent pas** sur un filesystem réseau (SMB/NFS) : locking
cassé → corruption. La seule archi correcte en multi-machine est un serveur de base de
données auquel les clients parlent par le réseau. C'est ce que fait claude-brain.

## Bugs de claude-mem éliminés

| Bug | Cause | Ici |
|---|---|---|
| `Failed to start worker` | worker zombie squatte le port 37777 | aucun worker, aucun port |
| Empilement bun/node, PC qui rame | loop lazy-spawn 15 s | hooks one-shot, exit immédiat |
| `SDK session poisoned` + SIGKILL | sous-Claude SDK qui plante | aucun sous-process LLM |
| WAL SQLite local | SQLite sous charge concurrente | Postgres, vrai SGBD concurrent |

---

## Installation rapide (nouvelle machine)

Le NAS doit déjà tourner (voir "Déploiement NAS" plus bas). Sur la machine cliente :

```powershell
gh repo clone Mix3X/claude-brain
cd claude-brain
pwsh -File install.ps1 -NasIp 192.168.1.28
```

Le mot de passe NAS est **demandé en saisie sécurisée** (jamais en argument, jamais dans
l'historique shell).

`install.ps1` fait tout : `npm install`, écrit `~/.claude-brain/config.json`, enregistre le
serveur MCP `brain`, câble les hooks dans `~/.claude/settings.json` (idempotent, avec backup),
et teste la connexion au NAS. Options :

- `-Machine PC-2` : nom de la machine (défaut = nom Windows)
- `-Embed` : active la recherche sémantique (nécessite `npm install @huggingface/transformers`)
- `-ApiKey 'sk-ant-...'` : active le résumeur LLM (Sonnet) — voir ci-dessous
- `-DisableClaudeMem` : désactive un plugin claude-mem résiduel

Redémarre Claude Code à la fin. Vérifie avec `/mcp` que `brain` est connecté.

## Résumeur LLM (observations distillées, optionnel)

Comme claude-mem, claude-brain peut distiller chaque session en **observations durables**
via Claude Sonnet — sans le sous-process SDK fragile. À la fin de session, le hook `Stop`
stocke un résumé heuristique instantané (toujours), puis lance **en arrière-plan détaché**
un appel direct à l'API Messages (Sonnet) qui range 1-6 observations réutilisables. Robuste :
un seul appel, timeout 25 s, échec → log dans `~/.claude-brain/summarize.log`, jamais de
retry ni de boucle, jamais de blocage de session.

Activation : `-ApiKey` à l'install, ou dans `config.json` :

```json
{ "summarize": true, "summarizeModel": "claude-sonnet-4-6", "anthropicApiKey": "sk-ant-..." }
```

(aussi lisible via la variable d'env `ANTHROPIC_API_KEY`). Coût = 1 appel Sonnet par session,
facturé sur ta clé API (séparé de l'abonnement Claude Code).

---

## Déploiement NAS (une seule fois)

### TrueNAS SCALE (ElectricEel/Fangtooth)
Apps → Discover Apps → **Custom App** → **Install via YAML**, colle `deploy/truenas-app.yaml`
(change le mot de passe avant). Détails : `deploy/TRUENAS.md`.

### Docker générique
```bash
docker compose up -d
```

Puis, depuis un PC client, applique le schéma et migre :

```powershell
node src/setup.js                       # crée les tables + index sur le NAS
node migrate/import-pg.js memories.jsonl  # (optionnel) importe une mémoire claude-mem migrée
```

---

## Migration depuis claude-mem (une fois)

```powershell
python migrate/export-sqlite.py "$env:USERPROFILE\.claude-mem\claude-mem.db" memories.jsonl
node migrate/import-pg.js memories.jsonl
```

L'import est idempotent (dé-duplication par hash) : tu peux le relancer sans créer de doublons.

## Désinstaller claude-mem

Voir `UNINSTALL.md`.

## Recherche sémantique (optionnel)

Par défaut : full-text Postgres (zéro dépendance lourde, robuste). Pour le sémantique :

```powershell
npm install @huggingface/transformers   # modèle all-MiniLM-L6-v2 (384 dim), local, hors ligne
```

`"embed": true` dans `config.json`, puis `node migrate/backfill-embeddings.js` pour vectoriser
l'historique. Index HNSW pgvector déjà prêt côté NAS.

## Fichiers de config

`~/.claude-brain/config.json` (jamais commité — contient le mot de passe NAS) :

```json
{
  "pg": "postgres://nasmem:****@192.168.1.28:5432/nasmem",
  "embed": false,
  "machine": "PC-CARPE"
}
```
