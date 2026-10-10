import { useEffect, useState } from "react";
import { api, ago } from "../api.js";
import { Empty, Icon, Md, Status, useApp, useLoad } from "../components/ui.jsx";

function Card({ ap, onDone }) {
  const { toast, refresh } = useApp();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = ap.status === "pending";

  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/api/approvals/${ap.id}/decide`, { decision, comment });
      toast(decision === "approve" ? "Approved. The run is continuing." : "Rejected. The run was stopped.");
      refresh(); onDone();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };

  return (
    <article className="card approval">
      <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="row"><h2 className="sec-title">{ap.title}</h2><Status s={ap.status} /></div>
          <span className="hint">{ap.workflowName} · requested {ago(ap.createdAt)}{ap.decidedAt && ` · decided ${ago(ap.decidedAt)}`}</span>
        </div>
      </div>
      {ap.note && <p className="muted">{ap.note}</p>}
      <div className="out-box"><Md text={ap.content || "(empty)"} /></div>
      {pending ? (
        <>
          <div className="field"><label htmlFor={`c-${ap.id}`}>Note for the next step (optional)</label>
            <input id={`c-${ap.id}`} className="in" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: prefer the morning flight" /></div>
          <div className="row">
            <button className="btn accent" disabled={busy} onClick={() => decide("approve")}><Icon n="check" size={16} />Approve and continue</button>
            <button className="btn danger" disabled={busy} onClick={() => decide("reject")}><Icon n="x" size={16} />Reject</button>
          </div>
        </>
      ) : ap.comment ? <p className="hint">Note: {ap.comment}</p> : null}
    </article>
  );
}

export default function Approvals() {
  const [tab, setTab] = useState("pending");
  const [list, reload] = useLoad(() => api.get("/api/approvals"), []);
  useEffect(() => { const t = setInterval(reload, 4000); return () => clearInterval(t); }, [reload]);
  const shown = (list || []).filter((a) => (tab === "pending" ? a.status === "pending" : a.status !== "pending"));
  const pendingN = (list || []).filter((a) => a.status === "pending").length;

  return (
    <main className="page">
      <section className="head">
        <div><h1>Approvals</h1><p>Workflow steps that need your sign-off stop here. Approve to let the run continue, or reject to stop it.</p></div>
      </section>
      <div className="pills" role="tablist">
        <button role="tab" className="pill" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>Waiting <span className="c">{pendingN}</span></button>
        <button role="tab" className="pill" aria-selected={tab === "done"} onClick={() => setTab("done")}>Decided</button>
      </div>
      {!list ? <div className="muted">Loading…</div> : shown.length === 0 ? (
        <Empty title={tab === "pending" ? "Nothing is waiting for you" : "No decisions yet"}>
          Add an Approval step to a workflow, or switch on “Ask for approval before sharing results” on an agent.
        </Empty>
      ) : (
        <div className="col" style={{ gap: 16 }}>{shown.map((a) => <Card key={a.id} ap={a} onDone={reload} />)}</div>
      )}
    </main>
  );
}
