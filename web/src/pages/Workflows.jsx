import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ago } from "../api.js";
import { Avatar, Empty, Icon, Menu, Modal, Status, useApp, useLoad } from "../components/ui.jsx";
import WorkflowEditor from "./WorkflowEditor.jsx";

function NewWorkflow({ projects, defaultProject, onClose }) {
  const nav = useNavigate();
  const { toast, refresh } = useApp();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(defaultProject || "");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const w = await api.post("/api/workflows", { name, projectId: projectId || null });
      refresh(); nav(`/workflows/${w.id}`);
    } catch (err) { toast(err.message, true); setBusy(false); }
  };
  return (
    <Modal title="New workflow" onClose={onClose}>
      <form onSubmit={submit} className="col" style={{ gap: 16 }}>
        <div className="field"><label htmlFor="wn">Name</label><input id="wn" className="in" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekend Trip Planner" /></div>
        <div className="field"><label htmlFor="wp">Project</label>
          <select id="wp" className="sel" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn ink" disabled={busy}>Create and open</button></div>
      </form>
    </Modal>
  );
}

function List() {
  const { toast, refresh } = useApp();
  const [params] = useSearchParams();
  const [list, reload] = useLoad(() => api.get("/api/workflows"), []);
  const [projects] = useLoad(() => api.get("/api/projects"), []);
  const [agents] = useLoad(() => api.get("/api/agents"), []);
  const [adding, setAdding] = useState(false);
  const project = params.get("project");
  const shown = (list || []).filter((w) => !project || w.projectId === project);

  const remove = async (w) => {
    if (!confirm(`Delete “${w.name}”?`)) return;
    await api.del(`/api/workflows/${w.id}`); toast("Workflow deleted"); refresh(); reload();
  };

  return (
    <main className="page">
      <section className="head">
        <div><h1>Workflows</h1><p>Chain agents together: the answer of one step becomes the input of the next. Add conditions and approvals where you want control.</p></div>
        <button className="btn ink" onClick={() => setAdding(true)}><Icon n="plus" size={16} />New workflow</button>
      </section>
      {!list ? <div className="muted">Loading…</div> : shown.length === 0 ? (
        <Empty title="No workflows yet" action={<button className="btn ink" onClick={() => setAdding(true)}>New workflow</button>}>A workflow starts with a trigger form, runs your agents in order or in parallel, and ends with an output.</Empty>
      ) : (
        <div className="grid g3">
          {shown.map((w) => (
            <article key={w.id} className="card acard">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <Link to={`/workflows/${w.id}`} className="grow" style={{ color: "inherit" }}><h2 className="sec-title">{w.name}</h2>
                  <span className="hint">{projects?.find((p) => p.id === w.projectId)?.name || "No project"} · saved {ago(w.updatedAt)}</span></Link>
                <Status s={w.status} label={w.status === "live" ? `Live · v${w.version}` : undefined} />
                <Menu items={[{ label: "Delete", danger: true, onClick: () => remove(w) }]} />
              </div>
              <div className="row">
                <div className="stack">{w.agentIds.slice(0, 5).map((id) => { const a = agents?.find((x) => x.id === id); return a ? <Avatar key={id} agent={a} size="sm" /> : null; })}</div>
                <span className="hint">{w.stepCount} steps · {w.agentIds.length} agent{w.agentIds.length === 1 ? "" : "s"}</span>
              </div>
              <div className="meta">
                <div><b>{w.lastRun ? <Status s={w.lastRun.status} /> : "–"}</b>Last run</div>
                <div><b>{w.lastRun ? ago(w.lastRun.createdAt) : "–"}</b>When</div>
              </div>
              <Link className="btn sm" to={`/workflows/${w.id}`}>Open</Link>
            </article>
          ))}
        </div>
      )}
      {adding && <NewWorkflow projects={projects || []} defaultProject={project} onClose={() => setAdding(false)} />}
    </main>
  );
}

export default function Workflows() {
  const { id } = useParams();
  return id ? <WorkflowEditor key={id} id={id} /> : <List />;
}
