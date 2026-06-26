#!/usr/bin/env python
"""Export a claude-mem SQLite DB to a portable JSONL for import into Postgres.

Usage:
    python export-sqlite.py <claude-mem.db> <out.jsonl>

Stdlib only (sqlite3 + json). One JSON object per line:
    {"project","kind","session_id","content","metadata","created_at"}
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone


def iso(epoch, fallback):
    if epoch:
        try:
            return datetime.fromtimestamp(epoch / 1000 if epoch > 1e12 else epoch,
                                          tz=timezone.utc).isoformat()
        except Exception:
            pass
    return fallback or None


def join_nonempty(*parts):
    return "\n".join(p.strip() for p in parts if p and p.strip())


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    db_path, out_path = sys.argv[1], sys.argv[2]
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    n = 0
    with open(out_path, "w", encoding="utf-8") as out:
        # --- observations ---
        for r in con.execute("SELECT * FROM observations"):
            content = join_nonempty(
                f"# {r['title']}" if r["title"] else "",
                r["subtitle"], r["narrative"], r["text"], r["facts"],
            )
            if not content:
                continue
            rec = {
                "project": r["project"],
                "kind": "observation",
                "session_id": r["memory_session_id"],
                "content": content,
                "metadata": {
                    "type": r["type"],
                    "concepts": r["concepts"],
                    "files_read": r["files_read"],
                    "files_modified": r["files_modified"],
                    "prompt_number": r["prompt_number"],
                    "model": r["generated_by_model"],
                },
                "created_at": iso(r["created_at_epoch"], r["created_at"]),
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n += 1

        # --- session_summaries ---
        for r in con.execute("SELECT * FROM session_summaries"):
            content = join_nonempty(
                f"Requête: {r['request']}" if r["request"] else "",
                f"Investigué: {r['investigated']}" if r["investigated"] else "",
                f"Appris: {r['learned']}" if r["learned"] else "",
                f"Terminé: {r['completed']}" if r["completed"] else "",
                f"Suite: {r['next_steps']}" if r["next_steps"] else "",
                f"Notes: {r['notes']}" if r["notes"] else "",
            )
            if not content:
                continue
            rec = {
                "project": r["project"],
                "kind": "summary",
                "session_id": r["memory_session_id"],
                "content": content,
                "metadata": {
                    "files_read": r["files_read"],
                    "files_edited": r["files_edited"],
                    "prompt_number": r["prompt_number"],
                },
                "created_at": iso(r["created_at_epoch"], r["created_at"]),
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n += 1

        # --- user_prompts (project resolved via sdk_sessions) ---
        q = """
            SELECT up.prompt_text, up.created_at, up.created_at_epoch,
                   up.content_session_id, s.project
            FROM user_prompts up
            JOIN sdk_sessions s ON s.content_session_id = up.content_session_id
        """
        for r in con.execute(q):
            txt = (r["prompt_text"] or "").strip()
            if len(txt) < 3:
                continue
            rec = {
                "project": r["project"],
                "kind": "prompt",
                "session_id": r["content_session_id"],
                "content": txt,
                "metadata": {},
                "created_at": iso(r["created_at_epoch"], r["created_at"]),
            }
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n += 1

    con.close()
    print(f"exported {n} records -> {out_path}")


if __name__ == "__main__":
    main()
