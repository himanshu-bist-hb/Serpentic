import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ago, pct, successRate } from "../api.js";
import { Avatar, Empty, Icon, Menu, Status, useApp, useLoad } from "../components/ui.jsx";

export default function Agents() {
  const { toast, refresh } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [agents, reload] = useLoad(() => api.get("/api/agents"), []);
  const [projects] = useLoad(() => api.get("/api/projects"), []);
  const [conns] = useLoad(() => api.get("/api/connectors"), []);
  const [status, setStatus] = useState("all");
  const project = params.get("project") || "all";
  const [connector, setConnector] = useState("all");

  const list = (agents || []).filter((a) =>
    (status === "all" || a.status === status) && (project === "all" || a.projectId === project) && (connector === "all" || a.connectors.includes(connector)));
  const n = (s) => (agents || []).filter((a) => a.status === s).length;
  const pname = (id) => projects?.find((p) => p.id === id)?.name;

  const setProject = (v) => { const p = new URLSearchParams(params); v === "all" ? p.delete("project") : p.set("project", v); setParams(p); };
  const setState = async (a, s) => { await api.put(`/api/agents/${a.id}`, { status: s }); toast(`${a.name} is now ${s}`); refresh(); reload(); };
  const remove = async (a) => {
    if (!confirm(`Delete ${a.name}?`)) return;
    try { await api.del(`/api/agents/${a.id}`); toast(`${a.name} deleted`); refresh(); reload(); } catch (e) { toast(e.message, true); }
  };

  return (
    <main className="page">
      <section className="head">
        <div><h1>Agents</h1><p>Each agent has a name, one clear job and the SerpAPI MCP servers it is allowed to call.</p></div>
        <Link className="btn ink" to="/agents/new"><Icon n="plus" size={16} />Create agent</Link>
      </section>
      <div className="row wrap" style={{ justifyContent: "space-between" }}>
        <div className="pills" role="tablist">
          {[["all", "All", (agents || []).length], ["live", "Live", n("live")], ["paused", "Paused", n("paused")], ["draft", "Draft", n("draft")]].map(([k, l, c]) => (
            <button key={k} role="tab" className="pill" aria-selected={status === k} onClick={() => setStatus(k)}>{l} <span className="c">{c}</span></button>
          ))}
        </div>
        <div className="row">
          <select className="sel" style={{ width: 170 }} aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>{(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="sel" style={{ width: 170 }} aria-label="Connector" value={connector} onChange={(e) => setConnector(e.target.value)}>
            <option value="all">Any connector</option>{(conns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!agents ? <div className="muted">Loading…</div> : list.length === 0 ? (
        <Empty title={agents.length ? "No agents match these filters" : "No agents yet"} action={<Link className="btn ink" to="/agents/new">Create agent</Link>}>
          Name an agent, describe its job in a sentence, and pick the MCP servers it can use.
        </Empty>
      ) : (
        <div className="grid g3">
          {list.map((a) => (
            <article className="card acard" key={a.id}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Avatar agent={a} />
                <Link to={`/chat/${a.id}`} className="grow" style={{ color: "inherit" }} title={`Chat with ${a.name}`}>
                  <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 16 }}>{a.name}</b><span className="muted" style={{ fontSize: 14 }}>{a.dev}</span></div>
                  <span className="hint">{a.role}{pname(a.projectId) && ` · ${pname(a.projectId)}`}</span>
                </Link>
                <Status s={a.status} />
                <Menu items={[
                  { label: "Chat", onClick: () => nav(`/chat/${a.id}`) },
                  { label: "Edit", onClick: () => nav(`/agents/${a.id}`) },
                  a.status === "live" ? { label: "Pause", onClick: () => setState(a, "paused") } : { label: "Make live", onClick: () => setState(a, "live") },
                  { label: "Delete", danger: true, onClick: () => remove(a) },
                ]} />
              </div>
              <p className="muted" style={{ textWrap: "pretty", minHeight: 42 }}>{a.description || "No description."}</p>
              <div className="tools">{a.connectorNames.length ? a.connectorNames.map((c) => <span className="tag" key={c}>{c}</span>) : <span className="tag">No connectors</span>}</div>
              <div className="meta">
                <div><b className="tnum">{a.runs}</b>Runs</div>
                <div><b className="tnum">{pct(successRate(a))}</b>Success</div>
                <div><b>{a.lastRunAt ? ago(a.lastRunAt) : "–"}</b>Last run</div>
              </div>
              <div className="row"><Link className="btn sm accent" to={`/chat/${a.id}`}><Icon n="chat" size={14} />Chat</Link><Link className="btn sm" to={`/agents/${a.id}`}><Icon n="edit" size={14} />Edit</Link></div>
              {!a.prompt && <div className="note">Setup incomplete: <Link to={`/agents/${a.id}`}>write its prompt →</Link></div>}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
