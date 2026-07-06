# Viewer web du brain sur TrueNAS SCALE

Le `docker-compose.yml` racine definit un service `nasmem-web` avec `build: .`, mais
**Custom App TrueNAS ne build pas depuis les sources**. On lance donc l'image Node
officielle et on monte le code source du repo — aucune image a publier.

App **separee** de `nasmem-db` (on ne touche pas a la base qui tourne). Le viewer se
connecte au Postgres via l'IP du NAS (port 5432 deja expose par nasmem-db).

## 1. Dataset + sources
Cree le dataset `/mnt/Apps/claude-brain` puis copie-y le repo (au minimum `src/`
et `package.json`) — via SMB depuis un PC client, ou `git clone` en SSH.

## 2. Custom App
Apps -> Discover Apps -> **Custom App** -> **Install via YAML**.
- Application Name : `nasmem-web`
- Colle `deploy/truenas-web.yaml` (remplace `<MOT_DE_PASSE_NAS>` par le mot de passe
  Postgres, le meme que `nasmem-db`).
- Install. Logs -> `claude-brain viewer -> http://0.0.0.0:8787`.

## 3. Acces
http://192.168.1.28:8787 — projets, sessions, observations, resumes, recherche.

## Notes
- `npm install` (juste `pg`, JS pur) tourne au 1er demarrage et persiste dans le
  `node_modules` du volume monte -> redemarrages instantanes.
- Mise a jour du code : recopie `src/` sur le dataset et redemarre l'app.
- Le hook `hooks/session-start.js` derive le lien du viewer depuis `pgHost` (`:8787`),
  ou de `viewerUrl` si defini dans `~/.claude-brain/config.json`.
