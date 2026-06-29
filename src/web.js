// claude-brain web viewer. Browse projects, sessions, observations, summaries, prompts.
// Run: node src/web.js   -> http://127.0.0.1:8787
// Env: BRAIN_WEB_PORT (default 8787), BRAIN_WEB_HOST (default 127.0.0.1; set 0.0.0.0 to expose on LAN/NAS)
import http from "node:http";
import { query, closePool } from "./db.js";
import { search } from "./store.js";

const PORT = Number(process.env.BRAIN_WEB_PORT || 8787);
const HOST = process.env.BRAIN_WEB_HOST || "127.0.0.1";

const json = (res, data, code = 200) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const api = {
  async stats() {
    const k = await query("SELECT kind, count(*)::int n FROM memories GROUP BY kind");
    const p = await query("SELECT count(*)::int n FROM projects");
    const s = await query("SELECT count(DISTINCT session_id)::int n FROM memories WHERE session_id IS NOT NULL");
    return { kinds: Object.fromEntries(k.rows.map((r) => [r.kind, r.n])), projects: p.rows[0].n, sessions: s.rows[0].n };
  },
  async projects() {
    const r = await query(
      `SELECT p.name, count(*)::int n, max(m.created_at) last
       FROM memories m JOIN projects p ON p.id=m.project_id
       GROUP BY p.name ORDER BY last DESC NULLS LAST`
    );
    return r.rows;
  },
  async memories(q) {
    if (q.q) {
      const rows = await search({ q: q.q, project: q.project || null, kinds: q.kind ? [q.kind] : null, limit: 100 });
      return rows;
    }
    const where = [], params = [];
    if (q.project) { params.push(q.project); where.push(`p.name=$${params.length}`); }
    if (q.kind) { params.push(q.kind); where.push(`m.kind=$${params.length}`); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    params.push(Math.min(Number(q.limit) || 100, 500));
    const lp = `$${params.length}`;
    params.push(Number(q.offset) || 0);
    const op = `$${params.length}`;
    const r = await query(
      `SELECT m.id, m.kind, p.name project, m.session_id, m.machine, m.content, m.created_at
       FROM memories m JOIN projects p ON p.id=m.project_id
       ${w} ORDER BY m.created_at DESC LIMIT ${lp} OFFSET ${op}`,
      params
    );
    return r.rows;
  },
  async sessions(q) {
    const params = [];
    let w = "WHERE m.session_id IS NOT NULL";
    if (q.project) { params.push(q.project); w += ` AND p.name=$${params.length}`; }
    const r = await query(
      `SELECT m.session_id, p.name project, min(m.created_at) started, max(m.created_at) ended,
              count(*)::int n,
              count(*) FILTER (WHERE m.kind='observation')::int obs,
              count(*) FILTER (WHERE m.kind='summary')::int summ,
              count(*) FILTER (WHERE m.kind='prompt')::int prompts,
              (SELECT content FROM memories mm WHERE mm.session_id=m.session_id AND mm.kind='prompt'
                 ORDER BY mm.created_at ASC LIMIT 1) first_prompt
       FROM memories m JOIN projects p ON p.id=m.project_id
       ${w}
       GROUP BY m.session_id, p.name ORDER BY started DESC LIMIT 300`,
      params
    );
    return r.rows;
  },
  async session(q) {
    const r = await query(
      `SELECT m.id, m.kind, p.name project, m.machine, m.content, m.metadata, m.created_at
       FROM memories m JOIN projects p ON p.id=m.project_id
       WHERE m.session_id=$1 ORDER BY m.created_at ASC`,
      [q.id]
    );
    return r.rows;
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(HTML); }
    if (u.pathname.startsWith("/api/")) {
      const name = u.pathname.slice(5);
      if (!api[name]) return json(res, { error: "not found" }, 404);
      const q = Object.fromEntries(u.searchParams);
      return json(res, await api[name](q));
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`claude-brain viewer -> http://${HOST === "0.0.0.0" ? "<this-host>" : HOST}:${PORT}`);
});
process.on("SIGINT", async () => { await closePool().catch(() => {}); process.exit(0); });

const HTML = String.raw`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>claude-brain</title>
<style>
:root{--bg:#0e1116;--panel:#161b22;--panel2:#1c232c;--bd:#2a3340;--tx:#d7dde5;--mut:#8a93a0;--acc:#6aa3ff;
--obs:#f5a86a;--summ:#7ad19a;--prompt:#9aa0ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,sans-serif;background:var(--bg);color:var(--tx)}
header{display:flex;align-items:center;gap:16px;padding:10px 16px;border-bottom:1px solid var(--bd);background:var(--panel);position:sticky;top:0;z-index:5}
header b{font-size:16px}header .stat{color:var(--mut);font-size:12px}
.wrap{display:flex;min-height:calc(100vh - 49px)}
aside{width:240px;border-right:1px solid var(--bd);padding:10px;overflow:auto;background:var(--panel)}
aside h3{margin:8px 6px;font-size:11px;text-transform:uppercase;color:var(--mut);letter-spacing:.05em}
.proj{padding:6px 8px;border-radius:6px;cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.proj:hover{background:var(--panel2)}.proj.on{background:#243044;color:#fff}.proj .c{color:var(--mut);font-size:12px}
main{flex:1;padding:14px 18px;overflow:auto}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.tab{padding:6px 12px;border:1px solid var(--bd);border-radius:20px;cursor:pointer;color:var(--mut)}
.tab.on{background:var(--acc);border-color:var(--acc);color:#06101f;font-weight:600}
input[type=search]{flex:1;min-width:200px;background:var(--panel2);border:1px solid var(--bd);color:var(--tx);padding:8px 12px;border-radius:8px}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.card .meta{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--mut);margin-bottom:6px;flex-wrap:wrap}
.badge{padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#06101f}
.b-observation{background:var(--obs)}.b-summary{background:var(--summ)}.b-prompt{background:var(--prompt)}
.content{white-space:pre-wrap;word-break:break-word}
.content h1,.content .t{font-size:14px;font-weight:600;margin:0 0 4px;color:#fff}
.sess{cursor:pointer}.sess:hover{border-color:var(--acc)}
.sub{color:var(--mut);font-size:12px}.pill{background:var(--panel2);border:1px solid var(--bd);border-radius:8px;padding:1px 7px;font-size:11px;color:var(--mut)}
.empty{color:var(--mut);padding:40px;text-align:center}
.back{cursor:pointer;color:var(--acc);margin-bottom:12px;display:inline-block}
a{color:var(--acc)}
</style></head><body>
<header><b>🧠 claude-brain</b><span class="stat" id="stats">…</span></header>
<div class="wrap">
<aside><h3>Projets</h3><div id="projects"></div></aside>
<main>
  <div class="bar">
    <div class="tab on" data-tab="sessions">Sessions</div>
    <div class="tab" data-tab="observation">Observations</div>
    <div class="tab" data-tab="summary">Résumés</div>
    <div class="tab" data-tab="prompt">Prompts</div>
    <input type="search" id="q" placeholder="Recherche plein-texte / sémantique…">
  </div>
  <div id="list"></div>
</main>
</div>
<script>
const S={tab:'sessions',project:null,q:''};
const el=(h)=>{const d=document.createElement('div');d.innerHTML=h;return d.firstElementChild};
const esc=(s)=>(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fdate=(s)=>new Date(s).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});
async function get(p){const r=await fetch('/api/'+p);return r.json()}
function contentHtml(c){c=esc(c);c=c.replace(/^# (.+)$/m,'<div class="t">$1</div>');return c}

async function loadStats(){const s=await get('stats');
  document.getElementById('stats').textContent=
    s.projects+' projets · '+s.sessions+' sessions · '+(s.kinds.observation||0)+' obs · '+(s.kinds.summary||0)+' résumés · '+(s.kinds.prompt||0)+' prompts'}

async function loadProjects(){const ps=await get('projects');const box=document.getElementById('projects');
  box.innerHTML='';
  box.appendChild(mkProj({name:'— Tous —',n:'',_all:1}));
  ps.forEach(p=>box.appendChild(mkProj(p)))}
function mkProj(p){const d=el('<div class="proj'+((S.project===(p._all?null:p.name))?' on':'')+'"><span>'+esc(p.name)+'</span><span class="c">'+p.n+'</span></div>');
  d.onclick=()=>{S.project=p._all?null:p.name;render();highlightProj()};return d}
function highlightProj(){document.querySelectorAll('.proj').forEach(e=>e.classList.remove('on'))}

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{S.tab=t.dataset.tab;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));render()});
let qt;document.getElementById('q').oninput=(e)=>{clearTimeout(qt);qt=setTimeout(()=>{S.q=e.target.value.trim();render()},300)};

async function render(){const list=document.getElementById('list');list.innerHTML='<div class="empty">Chargement…</div>';
  const qp=new URLSearchParams();if(S.project)qp.set('project',S.project);
  if(S.q){qp.set('q',S.q);if(S.tab!=='sessions')qp.set('kind',S.tab);
    const rows=await get('memories?'+qp);return renderMemories(rows)}
  if(S.tab==='sessions'){const rows=await get('sessions?'+qp);return renderSessions(rows)}
  qp.set('kind',S.tab);const rows=await get('memories?'+qp);renderMemories(rows)}

function renderSessions(rows){const list=document.getElementById('list');
  if(!rows.length)return list.innerHTML='<div class="empty">Aucune session.</div>';
  list.innerHTML='';rows.forEach(s=>{
    const d=el('<div class="card sess"><div class="meta"><span class="pill">'+esc(s.project)+'</span>'+
      '<span>'+fdate(s.started)+'</span><span class="b-prompt badge">'+s.prompts+' prompts</span>'+
      '<span class="b-observation badge">'+s.obs+' obs</span><span class="b-summary badge">'+s.summ+' résumés</span></div>'+
      '<div class="content">'+contentHtml((s.first_prompt||'(session)').slice(0,240))+'</div></div>');
    d.onclick=()=>openSession(s.session_id);list.appendChild(d)})}

async function openSession(id){const list=document.getElementById('list');
  const rows=await get('session?id='+encodeURIComponent(id));
  list.innerHTML='';const back=el('<span class="back">← retour sessions</span>');back.onclick=render;list.appendChild(back);
  rows.forEach(r=>list.appendChild(card(r)))}

function renderMemories(rows){const list=document.getElementById('list');
  if(!rows.length)return list.innerHTML='<div class="empty">Rien.</div>';
  list.innerHTML='';rows.forEach(r=>list.appendChild(card(r)))}

function card(r){const score=(r.score!=null)?' · '+Number(r.score).toFixed(3):'';
  return el('<div class="card"><div class="meta"><span class="badge b-'+r.kind+'">'+r.kind+'</span>'+
    '<span class="pill">'+esc(r.project)+'</span><span>'+fdate(r.created_at)+'</span>'+
    (r.machine?'<span class="sub">'+esc(r.machine)+'</span>':'')+'<span class="sub">'+score+'</span></div>'+
    '<div class="content">'+contentHtml(r.content)+'</div></div>')}

loadStats();loadProjects();render();
</script></body></html>`;
