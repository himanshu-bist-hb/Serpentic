import { useState } from "react";
import { api } from "../api.js";
import { Avatar, Empty, Icon, Modal, Spinner, Status, useApp, useLoad } from "../components/ui.jsx";

function AddServer({ onClose, onAdded }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: "", url: "", token: "", desc: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.post("/api/connectors", f); toast(`${f.name} registered`); onAdded(); }
    catch (err) { toast(err.message, true); setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Register your own MCP server" onClose={onClose}>
      <p className="hint">Point to the URL of an MCP server that speaks Streamable HTTP. Serpentic reads its tools so agents can use them.</p>
      <form onSubmit={submit} className="col" style={{ gap: 14 }}>
        <div className="field"><label htmlFor="sn">Name</label><input id="sn" className="in" autoFocus required value={f.name} onChange={set("name")} placeholder="Pine Labs Payments" /></div>
        <div className="field"><label htmlFor="su">Server URL</label><input id="su" className="in mono" required value={f.url} onChange={set("url")} placeholder="https://your-project.vercel.app/pinelabs-payments/mcp" /></div>
        <div className="field"><label htmlFor="st">Bearer token (optional)</label><input id="st" className="in mono" type="password" autoComplete="off" value={f.token} onChange={set("token")} /></div>
        <div className="field"><label htmlFor="sd">Description (optional)</label><input id="sd" className="in" value={f.desc} onChange={set("desc")} /></div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn ink" disabled={busy}>{busy ? <><Spinner />Connecting…</> : "Register"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Inline key form used both to activate a catalog connector and to replace an active one's key. */
function KeyForm({ c, label, onDone, onCancel }) {
  const { toast, refresh } = useApp();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/api/connectors/${c.id}/key`, { key });
      toast(`${c.name} is active`);
      refresh(); onDone();
    } catch (err) { toast(err.message, true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="row" style={{ flexWrap: "wrap" }}>
      <input className="in mono" style={{ fontSize: 13, flex: "1 1 180px", width: "auto" }} type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
        autoFocus aria-label={`SerpApi key for ${c.name}`} placeholder="SerpApi key" value={key} onChange={(e) => setKey(e.target.value)} />
      <button type="button" className="btn icon" aria-label={show ? "Hide key" : "Show key"} onClick={() => setShow(!show)}><Icon n="eye" size={16} /></button>
      <button className="btn ink" disabled={busy || !key.trim()}>{busy ? <Spinner /> : label}</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export default function Connectors() {
  const { toast, refresh } = useApp();
  const [list, reload] = useLoad(() => api.get("/api/connectors"), []);
  const [tab, setTab] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // id of the card with an open key form
  const [testing, setTesting] = useState({});
  const [results, setResults] = useState({});
  const [open, setOpen] = useState(null);

  const test = async (c) => {
    setTesting((t) => ({ ...t, [c.id]: true }));
    const r = await api.post(`/api/connectors/${c.id}/test`).catch((e) => ({ ok: false, error: e.message }));
    setResults((x) => ({ ...x, [c.id]: r }));
    setTesting((t) => ({ ...t, [c.id]: false }));
    return r;
  };

  const all = list || [];
  const active = all.filter((c) => c.active);
  const catalog = all.filter((c) => !c.active && (tab === "all" || c.group === tab));

  const testAll = async () => {
    const rs = await Promise.all(active.map(test));
    toast(`${rs.filter((r) => r.ok).length} of ${rs.length} connectors healthy`, rs.some((r) => !r.ok));
  };
  const deactivate = async (c) => {
    if (!confirm(`Remove ${c.name} from your active connectors? ${c.kind === "custom" ? "" : "Its key is deleted. "}Agents using it will stop working until you add it again.`)) return;
    await api.del(`/api/connectors/${c.id}${c.kind === "custom" ? "" : "/key"}`);
    toast(`${c.name} removed`); refresh(); reload();
  };
  const activateKeyless = async (c) => {
    await api.put(`/api/connectors/${c.id}/key`, {});
    toast(`${c.name} is active`); refresh(); reload();
  };

  const Tools = ({ c }) => (
    <div className="tools">
      {(open === c.id ? c.tools : c.tools?.slice(0, 3))?.map((t) => <span key={t.name} className="tag mono" title={t.description}>{t.name}</span>)}
      {c.tools?.length > 3 && <button className="tag" style={{ border: 0, cursor: "pointer" }} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "less" : `+${c.tools.length - 3}`}</button>}
    </div>
  );

  return (
    <main className="page">
      <section className="head">
        <div><h1>Connectors</h1><p>Each connector has its own SerpApi key. Activate the ones you need from the catalog; agents can only use active connectors.</p></div>
        <button className="btn ink" onClick={() => setAdding(true)}><Icon n="plus" size={16} />Register MCP server</button>
      </section>

      {/* ---------- Active ---------- */}
      <section className="col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ justifyContent: "space-between" }}>
          <div><h2 className="sec-title">Active connectors <span className="muted tnum" style={{ fontWeight: 400 }}>{active.length}</span></h2>
            <span className="hint">Health check validates the key and loads the tools. It costs no search credits.</span></div>
          {active.length > 0 && <button className="btn" onClick={testAll}><Icon n="refresh" size={16} />Health check all</button>}
        </div>

        {!list ? <div className="muted">Loading…</div> : active.length === 0 ? (
          <Empty title="No active connectors yet">Pick a connector from the catalog below and add its SerpApi key to activate it.</Empty>
        ) : (
          <div className="grid g3">
            {active.map((c) => {
              const r = results[c.id];
              const st = r ? (r.ok ? "healthy" : "error") : c.status;
              const acct = r?.account || c.account;
              return (
                <article className="card ccard" key={c.id}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div className="grow"><b style={{ fontSize: 16 }}>{c.name}</b><div className="mono hint">{c.kind === "custom" ? "custom" : `engine=${c.engine}`}</div></div>
                    <Status s={st} label={st === "healthy" ? "Healthy" : st === "active" ? "Active" : undefined} />
                  </div>
                  <p className="muted" style={{ textWrap: "pretty" }}>{c.desc}</p>
                  <Tools c={c} />

                  {c.serp && (editing === c.id ? (
                    <KeyForm c={c} label="Save key" onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
                  ) : (
                    <div className="row">
                      <Icon n="key" size={15} /><code className="mono grow" style={{ fontSize: 12.5, padding: "6px 10px", background: "var(--chip)", borderRadius: 8, overflow: "hidden", textOverflow: "ellipsis" }}>{c.keyMasked}</code>
                      <button className="btn sm" onClick={() => setEditing(c.id)}>Replace key</button>
                    </div>
                  ))}
                  {acct && <span className="hint tnum">{acct.plan} · {acct.left?.toLocaleString()} of {acct.limit?.toLocaleString()} searches left</span>}
                  {r && <span className={r.ok ? "hint" : "err"} role={r.ok ? undefined : "alert"}>{r.ok ? `Healthy: ${r.tools} tools loaded in ${r.ms}ms` : r.error}</span>}

                  <div className="row" style={{ marginTop: "auto" }}>
                    {c.usedBy.length ? <><div className="stack">{c.usedBy.slice(0, 4).map((u) => <Avatar key={u.id} name={u.name} color={u.color} size="sm" />)}</div><span className="hint">Used by {c.usedBy.length}</span></> : <span className="hint">Not used yet</span>}
                    <div className="grow" />
                    <button className="btn sm" disabled={testing[c.id]} onClick={() => test(c)}>{testing[c.id] ? <Spinner size={14} /> : "Health check"}</button>
                    <button className="btn sm danger" onClick={() => deactivate(c)}>Remove</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- Catalog ---------- */}
      <section className="col" style={{ gap: 14 }}>
        <div className="row wrap" style={{ justifyContent: "space-between" }}>
          <div><h2 className="sec-title">Catalog</h2><span className="hint">SerpApi MCP servers you can activate. Each needs its own key.</span></div>
          <div className="pills" role="tablist">
            {[["all", "All"], ["Travel", "Travel"], ["Daily", "Daily use"]].map(([k, l]) => (
              <button key={k} role="tab" className="pill" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
        </div>
        {list && catalog.length === 0 ? <Empty title="Everything here is active">Nothing left in this part of the catalog.</Empty> : (
          <div className="grid g3">
            {catalog.map((c) => (
              <article className="card ccard" key={c.id}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div className="grow"><b style={{ fontSize: 16 }}>{c.name}</b><div className="mono hint">engine={c.engine}</div></div>
                  <Status s="needs_key" label={c.serp ? "Needs key" : "Ready to activate"} />
                </div>
                <p className="muted" style={{ textWrap: "pretty" }}>{c.desc}</p>
                <Tools c={c} />
                <div style={{ marginTop: "auto" }}>
                  {editing === c.id ? (
                    <KeyForm c={c} label="Activate" onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
                  ) : c.serp ? (
                    <button className="btn sm" onClick={() => setEditing(c.id)}><Icon n="key" size={14} />Add key to activate</button>
                  ) : (
                    <button className="btn sm" onClick={() => activateKeyless(c)}><Icon n="plus" size={14} />Activate</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {adding && <AddServer onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); reload(); }} />}
    </main>
  );
}
