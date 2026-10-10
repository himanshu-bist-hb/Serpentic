import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ago, fmtMs } from "../api.js";
import { Avatar, Icon, Md, Spinner, Status, Switch, useApp } from "../components/ui.jsx";
import { PhotoGrid } from "../components/Media.jsx";

const W = 270, H = 120;
const KINDS = {
  trigger: { label: "Trigger", icon: "bolt", bg: "#0D0F14", fg: "#F5A524" },
  agent: { label: "Agent", icon: "agents", bg: "#ECE8FF", fg: "#4327D6" },
  condition: { label: "Condition", icon: "branch", bg: "#E4F0FF", fg: "#1D5FD1" },
  approval: { label: "Approval", icon: "approvals", bg: "#FFF3DC", fg: "#9A5B00" },
  output: { label: "Output", icon: "flag", bg: "#E6F5EE", fg: "#0F7A55" },
};
const OPS = [["not_empty", "is not empty"], ["contains", "contains"], ["not_contains", "does not contain"], ["equals", "equals"], ["gt", "is greater than"], ["lt", "is less than"]];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
const nid = () => "n_" + Math.random().toString(36).slice(2, 8);

const portY = (n, branch) => n.y + H * (n.type === "condition" ? (branch === "no" ? 0.72 : 0.36) : 0.5);
const curve = (x1, y1, x2, y2) => { const d = Math.max(60, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`; };

function wouldCycle(edges, from, to) {
  const seen = new Set(), stack = [to];
  while (stack.length) {
    const n = stack.pop();
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    edges.filter((e) => e.from === n).forEach((e) => stack.push(e.to));
  }
  return false;
}

function tidy(nodes, edges) {
  const depth = {};
  const visit = (id, d) => { if ((depth[id] ?? -1) >= d) return; depth[id] = d; edges.filter((e) => e.from === id).forEach((e) => visit(e.to, d + 1)); };
  nodes.filter((n) => !edges.some((e) => e.to === n.id)).forEach((n) => visit(n.id, 0));
  const cols = {};
  nodes.forEach((n) => (cols[depth[n.id] ?? 0] ||= []).push(n));
  const out = {};
  Object.entries(cols).forEach(([d, col]) => {
    const total = col.length * (H + 40) - 40;
    col.forEach((n, i) => (out[n.id] = { x: 40 + d * (W + 70), y: 320 - total / 2 + i * (H + 40) }));
  });
  return nodes.map((n) => ({ ...n, ...out[n.id] }));
}

/* ------------------------------------------------------------------ */
export default function WorkflowEditor({ id }) {
  const nav = useNavigate();
  const { toast, refresh } = useApp();
  const [wf, setWf] = useState(null);
  const [agents, setAgents] = useState([]);
  const [all, setAll] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState(null); // {t:'node'|'edge', id}
  const [view, setView] = useState({ x: 20, y: 0, k: 1 });
  const [drag, setDrag] = useState(null); // live connection: {from, branch, x, y}
  const [saving, setSaving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState(null);
  const [starting, setStarting] = useState(false);
  const canvasRef = useRef();
  const wfRef = useRef(), viewRef = useRef(view);
  wfRef.current = wf; viewRef.current = view;

  const load = useCallback(async () => {
    try {
      const [w, a, list] = await Promise.all([api.get(`/api/workflows/${id}`), api.get("/api/agents"), api.get("/api/workflows")]);
      setWf(w); setAgents(a); setAll(list);
    } catch { toast("Workflow not found", true); nav("/workflows"); }
  }, [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const loadedId = wf?.id;
  useEffect(() => { if (loadedId) fit(); }, [loadedId]); // eslint-disable-line

  const patch = (fn) => { setWf((w) => ({ ...w, ...fn(w) })); setDirty(true); };
  const updateNode = (nodeId, fn) => patch((w) => ({ nodes: w.nodes.map((n) => (n.id === nodeId ? fn(n) : n)) }));
  const setData = (nodeId, d) => updateNode(nodeId, (n) => ({ ...n, data: { ...n.data, ...d } }));

  /* ---------- view ---------- */
  function fit(nodes = wfRef.current?.nodes || []) {
    const el = canvasRef.current;
    if (!el || !nodes.length) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const bw = Math.max(...xs) + W - Math.min(...xs), bh = Math.max(...ys) + H - Math.min(...ys);
    const k = Math.min(1, (el.clientWidth - 60) / bw, (el.clientHeight - 60) / bh);
    setView({ k, x: (el.clientWidth - bw * k) / 2 - Math.min(...xs) * k, y: (el.clientHeight - bh * k) / 2 - Math.min(...ys) * k });
  }
  const zoom = (f, cx, cy) => setView((v) => {
    const el = canvasRef.current, rect = el.getBoundingClientRect();
    const px = cx ?? rect.width / 2, py = cy ?? rect.height / 2;
    const k = Math.min(1.5, Math.max(0.4, v.k * f));
    return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
  });
  const toPlane = (cx, cy) => {
    const r = canvasRef.current.getBoundingClientRect(), v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); }
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wf === null]); // eslint-disable-line

  /* ---------- pointer interactions ---------- */
  const startPan = (e) => {
    if (e.target.closest("[data-node]") || e.target.closest("path")) return;
    setSel(null);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvasRef.current.classList.add("panning");
    const move = (ev) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => { canvasRef.current?.classList.remove("panning"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const startDragNode = (e, node) => {
    if (e.target.closest(".port") || e.button !== 0) return;
    e.stopPropagation();
    setSel({ t: "node", id: node.id });
    const start = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y };
    let moved = false;
    const move = (ev) => {
      const k = viewRef.current.k;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      updateNode(node.id, (n) => ({ ...n, x: Math.round(start.nx + (ev.clientX - start.x) / k), y: Math.round(start.ny + (ev.clientY - start.y) / k) }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const startConnect = (e, node, branch) => {
    e.stopPropagation(); e.preventDefault();
    const p = toPlane(e.clientX, e.clientY);
    setDrag({ from: node.id, branch, x: p.x, y: p.y });
    const move = (ev) => { const q = toPlane(ev.clientX, ev.clientY); setDrag((d) => d && { ...d, x: q.x, y: q.y }); };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setDrag(null);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-node]")?.dataset.node;
      if (target) connect(node.id, target, branch);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  function connect(from, to, branch) {
    const w = wfRef.current;
    const tn = w.nodes.find((n) => n.id === to);
    if (from === to || tn?.type === "trigger") return toast("A step can't connect back to itself or into the trigger.", true);
    if (w.edges.some((e) => e.from === from && e.to === to && (e.branch || null) === (branch || null))) return;
    if (wouldCycle(w.edges, from, to)) return toast("That would make a loop. Workflows run one way.", true);
    patch((x) => ({ edges: [...x.edges, { id: "e_" + Math.random().toString(36).slice(2, 8), from, to, ...(branch ? { branch } : {}) }] }));
  }

  const removeSel = useCallback(() => {
    if (!sel) return;
    if (sel.t === "edge") patch((w) => ({ edges: w.edges.filter((e) => e.id !== sel.id) }));
    else {
      const n = wfRef.current.nodes.find((x) => x.id === sel.id);
      if (n?.type === "trigger") return toast("The trigger can't be removed.", true);
      patch((w) => ({ nodes: w.nodes.filter((x) => x.id !== sel.id), edges: w.edges.filter((e) => e.from !== sel.id && e.to !== sel.id) }));
    }
    setSel(null);
  }, [sel]); // eslint-disable-line

  useEffect(() => {
    const k = (e) => {
      if (/input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") removeSel();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [removeSel]);

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const addNode = (type) => {
    const el = canvasRef.current;
    const c = toPlane(el.getBoundingClientRect().left + el.clientWidth / 2, el.getBoundingClientRect().top + el.clientHeight / 2);
    const jitter = (wf.nodes.length % 4) * 24;
    const data = { agent: {}, condition: { title: "Check result", source: "prev", op: "contains", value: "" }, approval: { title: "Review before continuing", note: "" }, output: { title: "Final result" } }[type];
    const node = { id: nid(), type, x: Math.round(c.x - W / 2 + jitter), y: Math.round(c.y - H / 2 + jitter), data };
    patch((w) => ({ nodes: [...w.nodes, node] }));
    setSel({ t: "node", id: node.id });
  };

  /* ---------- persistence & running ---------- */
  const save = async (extra = {}) => {
    setSaving(true);
    try {
      const w = await api.put(`/api/workflows/${id}`, { name: wf.name, nodes: wf.nodes, edges: wf.edges, ...extra });
      setWf(w); setDirty(false); refresh();
      return w;
    } catch (e) { toast(e.message, true); return null; } finally { setSaving(false); }
  };
  const publish = async () => {
    const problems = validate(wf, agents);
    if (problems.length) return toast(problems[0], true);
    if (await save({ publish: true })) toast("Published");
  };

  const startRun = async (e) => {
    e?.preventDefault();
    if (!prompt.trim()) return toast("Write what you want the workflow to do.", true);
    const problems = validate(wf, agents);
    if (problems.length) return toast(problems[0], true);
    setStarting(true);
    try {
      if (dirty && !(await save())) return;
      const r = await api.post(`/api/workflows/${id}/run`, { input: { prompt: prompt.trim() } });
      setRun(r); setHistOpen(false);
    } catch (err) { toast(err.message, true); } finally { setStarting(false); }
  };

  useEffect(() => {
    if (!run || !["running", "waiting"].includes(run.status)) return;
    const t = setInterval(async () => {
      try { const r = await api.get(`/api/runs/${run.id}`); setRun(r); if (!["running", "waiting"].includes(r.status)) refresh(); } catch {}
    }, run.status === "waiting" ? 3000 : 1000);
    return () => clearInterval(t);
  }, [run?.id, run?.status]); // eslint-disable-line

  const openHistory = async () => {
    setHistOpen(!histOpen); setRunOpen(true);
    if (!histOpen) setHistory(await api.get(`/api/runs?workflowId=${id}&limit=15`));
  };

  const nodesById = useMemo(() => Object.fromEntries((wf?.nodes || []).map((n) => [n.id, n])), [wf]);
  if (!wf) return <div className="page"><div className="muted">Loading…</div></div>;

  const stepOf = (nodeId) => run?.steps?.[nodeId];
  const selNode = sel?.t === "node" ? nodesById[sel.id] : null;
  const agentOf = (n) => agents.find((a) => a.id === n.data?.agentId);
  const titleOf = (n) => (n.type === "agent" ? agentOf(n)?.name || "Choose an agent" : n.data?.title || KINDS[n.type].label);
  const subOf = (n) => (n.type === "agent" ? agentOf(n)?.role || "No agent selected" : n.type === "trigger" ? "Your prompt" : n.type === "condition" ? `${OPS.find((o) => o[0] === n.data?.op)?.[1] || ""} ${n.data?.value || ""}` : n.type === "approval" ? "You decide" : n.data?.subtitle || "Run result");
  const agentCount = wf.nodes.filter((n) => n.type === "agent").length;

  return (
    <main className="page wide" style={{ gap: 18 }}>
      <section className="head">
        <div>
          <Link to="/workflows" className="hint">← Workflows</Link>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <input className="in" aria-label="Workflow name" value={wf.name} onChange={(e) => patch(() => ({ name: e.target.value }))}
              style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", border: "1px solid transparent", background: "transparent", width: Math.max(14, wf.name.length + 2) + "ch", maxWidth: "70vw", padding: "0 6px", marginLeft: -6 }} />
            <Status s={wf.status} label={wf.status === "live" ? `Live · v${wf.version}` : undefined} />
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{wf.nodes.length} steps · {agentCount} agent{agentCount === 1 ? "" : "s"} · {dirty ? <b style={{ color: "var(--amber-d)" }}>Unsaved changes</b> : `Saved ${ago(wf.updatedAt)}`}</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={openHistory}><Icon n="history" size={16} />Run history</button>
          <button className="btn" onClick={() => setRunOpen(!runOpen || histOpen)}><Icon n="play" size={16} />Test run</button>
          <button className="btn" onClick={() => save()} disabled={saving || !dirty}>{saving ? <Spinner /> : "Save"}</button>
          <button className="btn ink" onClick={publish} disabled={saving}>Publish changes</button>
        </div>
      </section>

      <div className="pills" role="tablist" aria-label="Workflows">
        {all.map((w) => <button key={w.id} role="tab" className="pill" aria-selected={w.id === id} onClick={() => (dirty && !confirm("Leave without saving?") ? null : nav(`/workflows/${w.id}`))}>{w.name}</button>)}
        <button className="pill" onClick={() => nav("/workflows")}><Icon n="plus" size={14} />New</button>
      </div>

      <div className="wf-wrap">
        <div className="card canvas-card">
          <div className="canvas-tools">
            <span className="eyebrow">Add</span>
            {["agent", "condition", "approval", "output"].map((t) => (
              <button key={t} className="btn sm" onClick={() => addNode(t)}><Icon n={KINDS[t].icon} size={14} />{KINDS[t].label}</button>
            ))}
            <button className="btn sm" onClick={() => { patch((w) => ({ nodes: tidy(w.nodes, w.edges) })); setTimeout(() => fit(), 0); }}><Icon n="tidy" size={14} />Tidy</button>
            <div className="zoom">
              <button className="btn sm icon" aria-label="Zoom out" onClick={() => zoom(0.85)}><Icon n="minus" size={14} /></button>
              <span className="mono tnum" style={{ minWidth: 44, textAlign: "center", fontSize: 12 }}>{Math.round(view.k * 100)}%</span>
              <button className="btn sm icon" aria-label="Zoom in" onClick={() => zoom(1.18)}><Icon n="plus" size={14} /></button>
              <button className="btn sm icon" aria-label="Fit to screen" onClick={() => fit()}><Icon n="fit" size={14} /></button>
            </div>
          </div>
          <div className="canvas" ref={canvasRef} onPointerDown={startPan}>
            <div className="plane" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              <svg className="edges" aria-hidden="true">
                {wf.edges.map((e) => {
                  const a = nodesById[e.from], b = nodesById[e.to];
                  if (!a || !b) return null;
                  const x1 = a.x + W, y1 = portY(a, e.branch), x2 = b.x, y2 = b.y + H / 2;
                  const d = curve(x1, y1, x2, y2);
                  const done = stepOf(e.from)?.status === "succeeded" && (a.type !== "condition" || stepOf(e.from).branch === e.branch);
                  return (
                    <g key={e.id} onClick={(ev) => { ev.stopPropagation(); setSel({ t: "edge", id: e.id }); }}>
                      <path className="edge-hit" d={d} />
                      <path className={`edge-path ${sel?.id === e.id ? "sel" : ""} ${done ? "live" : ""}`} d={d} />
                      {e.branch && <text x={x1 + 22} y={y1 - 6} fontSize="10" className="mono" fill={e.branch === "yes" ? "#0F7A55" : "#B3302A"}>{e.branch}</text>}
                    </g>
                  );
                })}
                {drag && nodesById[drag.from] && <path className="edge-path" style={{ strokeDasharray: "5 4", stroke: "#5B3DF5" }} d={curve(nodesById[drag.from].x + W, portY(nodesById[drag.from], drag.branch), drag.x, drag.y)} />}
              </svg>

              {wf.nodes.map((n) => {
                const k = KINDS[n.type], st = stepOf(n.id), ag = n.type === "agent" ? agentOf(n) : null;
                return (
                  <div key={n.id} data-node={n.id} className={`node ${sel?.id === n.id ? "sel" : ""} ${st ? "st-" + st.status : ""}`}
                    style={{ left: n.x, top: n.y, width: W, height: H }} onPointerDown={(e) => startDragNode(e, n)} role="button" tabIndex={0}
                    aria-label={`${k.label}: ${titleOf(n)}`} onKeyDown={(e) => { if (e.key === "Enter") setSel({ t: "node", id: n.id }); }}>
                    {n.type !== "trigger" && <span className="port in" data-port="in" />}
                    <div className="row" style={{ justifyContent: "space-between", height: 16 }}>
                      <span className="eyebrow" style={{ fontSize: 10.5 }}>{k.label}</span>
                      {st && st.status !== "pending" ? <Status s={st.status} label={st.ms ? fmtMs(st.ms) : undefined} /> : null}
                    </div>
                    <div className="row">
                      {ag ? <Avatar agent={ag} /> : <span className="ico" style={{ background: k.bg, color: k.fg }}><Icon n={k.icon} size={18} /></span>}
                      <span className="grow col" style={{ lineHeight: 1.3 }}>
                        <b style={{ fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleOf(n)}</b>
                        <span className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subOf(n)}</span>
                      </span>
                    </div>
                    <div className="tools" style={{ height: 24, overflow: "hidden", flexWrap: "nowrap" }}>
                      {ag?.connectorNames.slice(0, 3).map((c) => <span className="tag" key={c}>{c}</span>)}
                      {n.type === "approval" && <span className="tag">Pauses the run</span>}
                      {n.type === "condition" && <span className="tag">yes / no</span>}
                      {n.type === "trigger" && <span className="tag">Prompt</span>}
                    </div>
                    {n.type === "condition" ? (
                      <>
                        <span className="port out yes" title="If true" onPointerDown={(e) => startConnect(e, n, "yes")} /><span className="port-lbl" style={{ top: "36%" }}>yes</span>
                        <span className="port out no" title="If false" onPointerDown={(e) => startConnect(e, n, "no")} /><span className="port-lbl" style={{ top: "72%" }}>no</span>
                      </>
                    ) : n.type !== "output" && <span className="port out" title="Drag to another step" onPointerDown={(e) => startConnect(e, n)} />}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="canvas-tools" style={{ borderTop: "1px solid var(--line-2)", borderBottom: 0 }}>
            <span className="hint">Drag a step's right dot onto another step to connect them. Drag the background to pan, Ctrl + scroll to zoom, Delete removes the selection.</span>
          </div>
        </div>

        {/* Inspector */}
        <aside className="card insp" aria-label="Step settings">
          {sel?.t === "edge" ? (
            <>
              <b>Connection</b>
              <p className="hint">{titleOf(nodesById[wf.edges.find((e) => e.id === sel.id)?.from] || { type: "output", data: {} })} → {titleOf(nodesById[wf.edges.find((e) => e.id === sel.id)?.to] || { type: "output", data: {} })}</p>
              <button className="btn danger" onClick={removeSel}><Icon n="trash" size={16} />Remove connection</button>
            </>
          ) : selNode ? (
            <NodeInspector node={selNode} wf={wf} agents={agents} setData={(d) => setData(selNode.id, d)} titleOf={titleOf} onRemove={removeSel} step={stepOf(selNode.id)} />
          ) : (
            <>
              <b>Workflow</b>
              <p className="hint">Select a step to edit it. Each step receives the output of the steps connected to it and passes its own output on.</p>
              <div className="col" style={{ gap: 8 }}>
                {Object.entries(KINDS).map(([k, v]) => <div key={k} className="row"><span className="ico" style={{ width: 28, height: 28, borderRadius: 8, background: v.bg, color: v.fg, display: "grid", placeItems: "center" }}><Icon n={v.icon} size={15} /></span><span className="hint"><b style={{ color: "var(--ink)" }}>{v.label}</b> · {{ trigger: "starts the run with a form", agent: "does the work using its MCP tools", condition: "sends the flow down yes or no", approval: "pauses until you approve", output: "the final result" }[k]}</span></div>)}
              </div>
            </>
          )}
        </aside>
      </div>

      {runOpen && (
        <section className="card pad col" style={{ gap: 16 }} aria-label="Test run">
          {histOpen ? (
            <>
              <div className="row"><h2 className="sec-title grow">Run history</h2><button className="btn sm" onClick={() => setHistOpen(false)}>Close</button></div>
              {history.length === 0 ? <p className="muted">No runs yet.</p> : history.map((r) => (
                <button key={r.id} className="run-step" style={{ background: "none", border: 0, textAlign: "left", width: "100%" }} onClick={() => { setRun(r); setHistOpen(false); }}>
                  <Status s={r.status} /><span className="grow"><span className="ellipsis" style={{ display: "block" }}>{r.input?.prompt || Object.values(r.input || {}).join(" · ") || "No input"}</span></span><span className="hint">{ago(r.createdAt)}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="row"><h2 className="sec-title grow">Test run</h2><button className="btn sm" onClick={() => { setRunOpen(false); setRun(null); }}>Close</button></div>
              <form onSubmit={startRun} className="col" style={{ gap: 12 }}>
                <div className="field">
                  <label htmlFor="wf-prompt">What should this workflow do?</label>
                  <textarea id="wf-prompt" className="ta" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) startRun(e); }}
                    placeholder="Plan a 3 day weekend trip from Delhi to Goa next month under ₹30,000: cheapest flights, good hotels and things to do." />
                  <span className="hint">Just describe it in plain words. Every agent receives your request and the output of the agents connected before it.</span>
                </div>
                <div className="row"><button className="btn ink" disabled={starting || run?.status === "running"}>{starting ? <Spinner /> : <Icon n="play" size={14} />}Run workflow</button>
                  <span className="hint">Ctrl+Enter to run · uses real searches from your connectors' plans.</span></div>
              </form>
              {run && <RunView run={run} nodes={nodesById} titleOf={titleOf} />}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function validate(wf, agents) {
  const out = [];
  if (!wf.nodes.some((n) => n.type === "trigger")) out.push("Add a trigger step.");
  for (const n of wf.nodes) {
    if (n.type === "agent" && !agents.some((a) => a.id === n.data?.agentId)) out.push("Choose an agent for every agent step.");
    if (n.type !== "trigger" && !wf.edges.some((e) => e.to === n.id)) out.push(`“${n.data?.title || KINDS[n.type].label}” isn't connected to anything before it.`);
  }
  return [...new Set(out)];
}

/* ---------------- run view ---------------- */
function SummaryCard({ run }) {
  const { toast } = useApp();
  const md = run.output || "";
  const m = md.match(/^#\s+(.+)$/m);
  const title = m ? m[1].trim() : "Combined summary";
  const body = m ? md.replace(m[0], "").trim() : md;
  const copy = async () => { await navigator.clipboard.writeText(md).catch(() => {}); toast("Summary copied"); };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${title.replace(/[^\w]+/g, "-").toLowerCase().slice(0, 50) || "summary"}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const st = run.stats;
  return (
    <article className="summary" aria-label="Combined summary">
      <header className="summary-h">
        <div className="row" style={{ gap: 8 }}><Icon n="sparkle" size={16} /><span className="eyebrow" style={{ color: "#C9BFFF" }}>Combined summary</span></div>
        <h2>{title}</h2>
        <div className="row wrap" style={{ gap: 8 }}>
          {st && <>
            <span className="sum-chip">{st.agents} agent{st.agents === 1 ? "" : "s"}</span>
            <span className="sum-chip">{st.toolCalls} search{st.toolCalls === 1 ? "" : "es"}</span>
            <span className="sum-chip">{fmtMs(st.ms)}</span>
          </>}
          <span className="grow" />
          <button className="btn sm sum-btn" onClick={copy}><Icon n="copy" size={14} />Copy</button>
          <button className="btn sm sum-btn" onClick={download}><Icon n="file" size={14} />Download .md</button>
        </div>
      </header>
      <div className="summary-b">
        <Md text={body} />
        {run.images?.length > 0 && <div style={{ marginTop: 16 }}><div className="eyebrow" style={{ marginBottom: 8 }}>Photos found</div><PhotoGrid urls={run.images} /></div>}
      </div>
    </article>
  );
}

function RunView({ run, nodes, titleOf }) {
  const order = Object.keys(run.steps).filter((id) => nodes[id]);
  const done = order.filter((id) => ["succeeded", "skipped", "failed"].includes(run.steps[id].status)).length;
  const writing = order.some((id) => nodes[id].type === "output" && run.steps[id].status === "running");
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap">
        <b>Run</b><Status s={run.status} />
        <span className="hint tnum">{done} of {order.length} steps</span>
        {run.status === "waiting" && <Link to="/approvals" className="btn sm accent">Review approval →</Link>}
      </div>
      {run.input?.prompt && <blockquote className="prompt-echo">{run.input.prompt}</blockquote>}

      <div className="pipe" aria-label="Progress">
        {order.map((nid) => {
          const s = run.steps[nid], n = nodes[nid];
          return <span key={nid} className={`pipe-i s-${s.status}`} title={`${titleOf(n)}: ${s.status}`}>{s.status === "running" ? <Spinner size={12} /> : <i />}{titleOf(n)}</span>;
        })}
      </div>

      {writing && !run.output && <div className="summary-wait"><Spinner />Writing the combined summary…</div>}
      {run.output && ["succeeded", "failed"].includes(run.status) && <SummaryCard run={run} />}

      <details className="steps-detail" open={!run.output}>
        <summary>Step details</summary>
        {order.map((nid) => {
          const s = run.steps[nid], n = nodes[nid];
          if (s.status === "pending" || s.status === "skipped") return <div className="run-step" key={nid}><Status s={s.status} /><span className="muted">{titleOf(n)}</span></div>;
          return (
            <div className="run-step" key={nid}>
              <div style={{ width: 90, flex: "none" }}><Status s={s.status} /></div>
              <div className="grow col" style={{ gap: 6, minWidth: 0 }}>
                <div className="row"><b>{titleOf(n)}</b><span className="hint">{KINDS[n.type].label}{s.ms ? ` · ${fmtMs(s.ms)}` : ""}</span></div>
                {(s.tools || s.toolCalls || []).map((t, i) => <div className="toolcall" key={i}>{t.running ? <Spinner size={12} /> : <Icon n="bolt" size={12} />}<span className="grow">{(t.server ? `${t.server} · ` : "") + String(t.tool || "").replace(/^[\w-]+?__/, "")}</span>{t.ms != null && <span>{fmtMs(t.ms)}</span>}</div>)}
                {s.error && <div className="err">{s.error}</div>}
                {s.warning && <div className="note">{s.warning}</div>}
                {s.output && !["trigger", "output"].includes(n.type) && <div className="out-box"><Md text={s.output} /></div>}
                {s.status === "waiting" && <span className="hint">Waiting for your approval.</span>}
              </div>
            </div>
          );
        })}
      </details>
    </div>
  );
}

/* ---------------- inspector ---------------- */
function NodeInspector({ node, wf, agents, setData, titleOf, onRemove, step }) {
  const d = node.data || {};
  const incoming = wf.edges.filter((e) => e.to === node.id).map((e) => wf.nodes.find((n) => n.id === e.from)).filter(Boolean);
  const trigger = wf.nodes.find((n) => n.type === "trigger");
  const k = KINDS[node.type];
  return (
    <>
      <div className="row"><span className="ico" style={{ width: 32, height: 32, borderRadius: 9, background: k.bg, color: k.fg, display: "grid", placeItems: "center" }}><Icon n={k.icon} size={16} /></span><b>{k.label} step</b></div>

      {node.type === "agent" && (
        <>
          <div className="field"><label htmlFor="i-ag">Agent</label>
            <select id="i-ag" className="sel" value={d.agentId || ""} onChange={(e) => setData({ agentId: e.target.value })}>
              <option value="">Choose an agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}{a.status !== "live" ? ` (${a.status})` : ""}</option>)}
            </select></div>
          {agents.find((a) => a.id === d.agentId) && <Link className="btn sm" to={`/agents/${d.agentId}`}>Open agent</Link>}
          <div className="field"><label htmlFor="i-msg">Extra instruction (optional)</label>
            <textarea id="i-msg" className="ta" rows={3} value={d.message || ""} onChange={(e) => setData({ message: e.target.value })} placeholder="Focus on the cheapest {{to}} option" />
            <span className="hint">Use {"{{prompt}}"} for your original prompt or {"{{prev}}"} for the previous step's output.</span></div>
        </>
      )}

      {node.type === "trigger" && (
        <>
          <div className="field"><label htmlFor="i-t">Title</label><input id="i-t" className="in" value={d.title || ""} onChange={(e) => setData({ title: e.target.value })} /></div>
          <span className="hint">The workflow starts from a prompt you type each time you run it. Every agent gets that prompt, plus the outputs of the agents connected before it.</span>
        </>
      )}

      {node.type === "condition" && (
        <>
          <div className="field"><label htmlFor="i-cn">Name</label><input id="i-cn" className="in" value={d.title || ""} onChange={(e) => setData({ title: e.target.value })} /></div>
          <div className="field"><label htmlFor="i-cs">Look at</label>
            <select id="i-cs" className="sel" value={d.source || "prev"} onChange={(e) => setData({ source: e.target.value })}>
              <option value="prev">The previous step's output</option><option value="prompt">Your original prompt</option>
            </select></div>
          <div className="field"><label htmlFor="i-co">If it</label>
            <select id="i-co" className="sel" value={d.op || "not_empty"} onChange={(e) => setData({ op: e.target.value })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          {d.op !== "not_empty" && <div className="field"><label htmlFor="i-cv">Value</label><input id="i-cv" className="in" value={d.value || ""} onChange={(e) => setData({ value: e.target.value })} /></div>}
          <span className="hint">Connect the green “yes” dot and the red “no” dot to different steps. Only the matching path runs.</span>
        </>
      )}

      {node.type === "approval" && (
        <>
          <div className="field"><label htmlFor="i-at">Title</label><input id="i-at" className="in" value={d.title || ""} onChange={(e) => setData({ title: e.target.value })} /></div>
          <div className="field"><label htmlFor="i-an">Note for the reviewer</label><textarea id="i-an" className="ta" rows={3} value={d.note || ""} onChange={(e) => setData({ note: e.target.value })} /></div>
          <span className="hint">The run stops here until you approve it on the Approvals page.</span>
        </>
      )}

      {node.type === "output" && (
        <>
          <div className="field"><label htmlFor="i-ot">Title</label><input id="i-ot" className="in" value={d.title || ""} onChange={(e) => setData({ title: e.target.value })} /></div>
          <div className="toggle-row" style={{ borderTop: 0, padding: 0 }}>
            <div><b>Write a combined summary</b><div className="hint">GPT-5 turns every agent's output into one polished report with highlights and a recommendation.</div></div>
            <Switch checked={d.summary !== false} onChange={(v) => setData({ summary: v })} label="Write a combined summary" />
          </div>
        </>
      )}

      <div>
        <div className="lbl">Receives</div>
        {incoming.length ? incoming.map((n) => <div key={n.id} className="tag" style={{ margin: "6px 6px 0 0" }}>{titleOf(n)}</div>) : <span className="hint">{node.type === "trigger" ? "The form values you enter when running." : "Nothing connected yet."}</span>}
      </div>

      {step && step.status !== "pending" && (
        <div><div className="lbl">Last run</div><div className="row" style={{ marginTop: 6 }}><Status s={step.status} />{step.ms && <span className="hint">{fmtMs(step.ms)}</span>}</div></div>
      )}
      {node.type !== "trigger" && <button className="btn danger" onClick={onRemove}><Icon n="trash" size={16} />Remove step</button>}
    </>
  );
}
