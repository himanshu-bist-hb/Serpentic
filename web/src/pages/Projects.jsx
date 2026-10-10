import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ago } from "../api.js";
import { Avatar, Empty, Icon, Menu, Modal, Status, useApp, useLoad } from "../components/ui.jsx";

function ProjectForm({ project, onClose, onSaved }) {
  const { toast, refresh } = useApp();
  const [f, setF] = useState({ name: project?.name || "", description: project?.description || "", status: project?.status || "active" });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      project ? await api.put(`/api/projects/${project.id}`, f) : await api.post("/api/projects", f);
      refresh(); onSaved();
    } catch (err) { toast(err.message, true); setBusy(false); }
  };
  return (
    <Modal title={project ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={save} className="col" style={{ gap: 16 }}>
        <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="in" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Travel Desk" required /></div>
        <div className="field"><label htmlFor="pd">What is it for?</label><textarea id="pd" className="ta" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Plans trips end to end…" /></div>
        {project && <div className="field"><label htmlFor="ps">Status</label>
          <select id="ps" className="sel" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option></select></div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn ink" disabled={busy}>{project ? "Save" : "Create project"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const { toast, refresh } = useApp();
  const [list, reload] = useLoad(() => api.get("/api/projects"), []);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(null); // null | "new" | project
  const shown = (list || []).filter((p) => filter === "all" || p.status === filter);
  const n = (s) => (list || []).filter((p) => p.status === s).length;

  const remove = async (p) => {
    if (!confirm(`Delete “${p.name}”? Its agents and workflows are kept but detached.`)) return;
    await api.del(`/api/projects/${p.id}`);
    toast("Project deleted"); refresh(); reload();
  };

  return (
    <main className="page">
      <section className="head">
        <div><h1>Projects</h1><p>Group agents and workflows around one goal. Each project keeps its own runs and approvals.</p></div>
        <button className="btn ink" onClick={() => setForm("new")}><Icon n="plus" size={16} />New project</button>
      </section>
      <div className="pills" role="tablist">
        {[["all", "All", (list || []).length], ["active", "Active", n("active")], ["paused", "Paused", n("paused")], ["draft", "Draft", n("draft")]].map(([k, l, c]) => (
          <button key={k} role="tab" className="pill" aria-selected={filter === k} onClick={() => setFilter(k)}>{l} <span className="c">{c}</span></button>
        ))}
      </div>
      {!list ? <div className="muted">Loading…</div> : shown.length === 0 ? (
        <Empty title="No projects here" action={<button className="btn ink" onClick={() => setForm("new")}>New project</button>}>A project holds the agents and workflows for one goal, such as planning trips.</Empty>
      ) : (
        <div className="grid g3">
          {shown.map((p) => (
            <article key={p.id} className="card acard">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow"><h2 className="sec-title">{p.name}</h2><span className="hint">Updated {ago(p.updatedAt)}</span></div>
                <Status s={p.status} />
                <Menu items={[{ label: "Edit", onClick: () => setForm(p) }, { label: "Delete", danger: true, onClick: () => remove(p) }]} />
              </div>
              <p className="muted" style={{ minHeight: 42, textWrap: "pretty" }}>{p.description || "No description yet."}</p>
              {p.agents.length > 0 && <div className="row"><div className="stack">{p.agents.slice(0, 5).map((a) => <Avatar key={a.id} agent={a} size="sm" />)}</div><span className="hint">{p.agents.map((a) => a.name).slice(0, 3).join(", ")}{p.agents.length > 3 && ` +${p.agents.length - 3}`}</span></div>}
              {p.connectors.length > 0 && <div className="tools">{p.connectors.map((c) => <span key={c} className="tag">{c}</span>)}</div>}
              <div className="meta">
                <div><b className="tnum">{p.agentCount}</b>agent{p.agentCount === 1 ? "" : "s"}</div>
                <div><b className="tnum">{p.workflowCount}</b>workflow{p.workflowCount === 1 ? "" : "s"}</div>
                <div><b className="tnum">{p.runsWeek}</b>runs this week</div>
              </div>
              <div className="row">
                <Link className="btn sm" to={`/agents?project=${p.id}`}>Agents</Link>
                <Link className="btn sm" to={`/workflows?project=${p.id}`}>Workflows</Link>
              </div>
            </article>
          ))}
        </div>
      )}
      {form && <ProjectForm project={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
    </main>
  );
}
