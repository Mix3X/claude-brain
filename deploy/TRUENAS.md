# Déploiement sur TrueNAS SCALE (ElectricEel / Fangtooth)

Postgres + pgvector via Apps > Custom App. Une seule fois.

## 1. Pool des Apps
Menu **Apps**. Si premier déploiement, choisis le **pool** de stockage des apps.

## 2. Custom App via YAML
1. **Apps** → **Discover Apps** (haut droite) → **Custom App** → bascule **Install via YAML**.
2. **Application Name** : `nasmem-db`.
3. Colle `deploy/truenas-app.yaml` (change `POSTGRES_PASSWORD` avant).
4. **Install**. Attends le statut **Running** (Logs → `database system is ready to accept connections`).

## 3. Schéma + migration (depuis un PC client)
```powershell
cd claude-brain
npm install
# config locale pointant le NAS :
#   ~/.claude-brain/config.json  ->  { "pg": "postgres://nasmem:PASS@NAS_IP:5432/nasmem", "embed": false, "machine": "PC" }
node src\setup.js                          # crée tables + index HNSW/GIN
node src\ping.js                           # doit afficher pgvector: installed
node migrate\import-pg.js memories.jsonl   # (optionnel) importe la mémoire claude-mem migrée
```

## Stockage
Le YAML utilise un volume Docker géré par TrueNAS (sous le dataset des apps → snapshoté avec).
Pour un dataset dédié explicite (backup séparé), remplace le bloc `volumes` par un host path :

```yaml
    volumes:
      - /mnt/POOL/apps/nasmem/pgdata:/var/lib/postgresql/data
```
(crée le dataset `apps/nasmem/pgdata` d'abord ; l'image officielle ajuste les permissions au init).

## Sauvegarde
- Snapshots ZFS du dataset des apps = backup complet de la mémoire.
- Dump logique ponctuel : `docker exec nasmem-db pg_dump -U nasmem nasmem > brain.sql`
