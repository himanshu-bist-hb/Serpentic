import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtMs } from "../api.js";
import { Avatar, Icon, Md, Spinner, useApp } from "../components/ui.jsx";
import { Gallery, Lightbox } from "../components/Media.jsx";

const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md,.csv,.tsv,.json,.log,.xml,.html,.yaml,.yml";
const MAX_FILE = 15 * 1024 * 1024;

const clock = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function dayLabel(iso) {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}
function listTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? clock(iso) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const readB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error(`Couldn't read ${file.name}`));
  r.readAsDataURL(file);
});

/* ---------------------------------------------------------------- */
function Attachments({ list, onOpen, mine }) {
  const imgs = list.filter((a) => a.kind === "image");
  const docs = list.filter((a) => a.kind === "doc");
  return (
    <div className="col" style={{ gap: 6, alignItems: mine ? "flex-end" : "flex-start" }}>
      {imgs.length > 0 && <Gallery urls={imgs.map((a) => `/api/files/${a.id}`)} onOpen={onOpen} />}
      {docs.map((a) => (
        <a key={a.id} className="doc-chip" href={`/api/files/${a.id}`} download={a.name}>
          <Icon n="file" size={18} /><span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span><span className="hint">{size(a.size)}</span>
        </a>
      ))}
    </div>
  );
}

function Tools({ tools, running }) {
  const [open, setOpen] = useState(false);
  if (!tools?.length) return null;
  const done = tools.filter((t) => !t.running);
  const failed = done.filter((t) => t.isError).length;
  return (
    <div className="tool-sum">
      <button className="tool-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {running ? <Spinner size={13} /> : <Icon n="bolt" size={13} />}
        <span>{running ? "Working" : `Used ${tools.length} tool${tools.length === 1 ? "" : "s"}`}{failed ? ` · ${failed} failed` : ""}</span>
        <Icon n="chevron" size={13} />
      </button>
      {(open || running) && (
        <div className="col" style={{ gap: 4, marginTop: 6 }}>
          {tools.map((t, i) => (
            <div className="toolcall" key={i}>
              {t.running ? <Spinner size={12} /> : <Icon n={t.isError ? "x" : "check"} size={12} style={{ color: t.isError ? "var(--red)" : "var(--green)" }} />}
              <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.server ? `${t.server} · ` : ""}{String(t.tool).replace(/^[\w-]+?__/, "")}</span>
              {t.ms != null && <span>{fmtMs(t.ms)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ m, agent, onOpen }) {
  const mine = m.role === "user";
  if (mine) {
    return (
      <div className="msg mine">
        <div className="col" style={{ alignItems: "flex-end", gap: 6, maxWidth: "min(640px, 85%)" }}>
          {m.attachments?.length > 0 && <Attachments list={m.attachments} onOpen={onOpen} mine />}
          {m.text && <div className="bubble-me">{m.text}</div>}
          <span className="hint mono" style={{ fontSize: 11 }}>{clock(m.at)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="msg">
      <Avatar agent={agent} size="sm" />
      <div className="col" style={{ gap: 6, maxWidth: "min(760px, 90%)", minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 13 }}>{agent.name}</b><span className="hint mono" style={{ fontSize: 11 }}>{clock(m.at)}</span></div>
        {m.tools?.length > 0 && <Tools tools={m.tools} running={m.status === "running"} />}
        {m.status === "running" && !m.text && <div className="bubble-ai typing" aria-label={`${agent.name} is typing`}><i /><i /><i /></div>}
        {m.status === "error" && <div className="err" role="alert">{m.error}</div>}
        {m.text && <div className="bubble-ai"><Md text={m.text} /></div>}
        {m.images?.length > 0 && <Gallery urls={m.images} onOpen={onOpen} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
export default function Chat() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const { toast } = useApp();
  const [agents, setAgents] = useState(null);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]); // { file, name, size, preview }
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lb, setLb] = useState(null);
  const [conns, setConns] = useState([]);
  const endRef = useRef(), scroller = useRef(), fileInput = useRef(), box = useRef();
  const stick = useRef(true);

  const agent = agents?.find((a) => a.id === agentId);
  const running = msgs.some((m) => m.status === "running");

  const loadList = useCallback(async () => {
    const [a, s, c] = await Promise.all([api.get("/api/agents"), api.get("/api/chats"), api.get("/api/connectors")]);
    setAgents(a); setSummary(Object.fromEntries(s.map((x) => [x.agentId, x]))); setConns(c);
  }, []);
  useEffect(() => { loadList().catch(() => {}); const t = setInterval(() => loadList().catch(() => {}), 5000); return () => clearInterval(t); }, [loadList]);

  // Open the first agent by default (most recent conversation first).
  useEffect(() => {
    if (agentId || !agents?.length) return;
    const recent = [...agents].sort((a, b) => (summary[b.id]?.last?.at || "").localeCompare(summary[a.id]?.last?.at || ""))[0];
    nav(`/chat/${recent.id}`, { replace: true });
  }, [agentId, agents]); // eslint-disable-line

  const loadMsgs = useCallback(async (id) => {
    const r = await api.get(`/api/chats/${id}`);
    setMsgs(r.messages); setLoadedFor(id);
  }, []);
  useEffect(() => { setMsgs([]); setLoadedFor(null); setText(""); setFiles([]); stick.current = true; if (agentId) loadMsgs(agentId).catch(() => {}); }, [agentId, loadMsgs]);
  useEffect(() => {
    if (!agentId || !running) return;
    const t = setInterval(() => loadMsgs(agentId).catch(() => {}), 900);
    return () => clearInterval(t);
  }, [agentId, running, loadMsgs]);

  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);
  const onScroll = () => { const el = scroller.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };

  useEffect(() => { if (box.current) { box.current.style.height = "auto"; box.current.style.height = Math.min(box.current.scrollHeight, 180) + "px"; } }, [text]);
  useEffect(() => { if (agent && !running) box.current?.focus(); }, [agentId, running]); // eslint-disable-line

  const addFiles = (list) => {
    const next = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { toast(`${f.name} is larger than 15 MB`, true); continue; }
      next.push({ file: f, name: f.name || "pasted-image.png", size: f.size, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    setFiles((cur) => [...cur, ...next].slice(0, 6));
  };
  const onPaste = (e) => { const imgs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/")); if (imgs.length) { e.preventDefault(); addFiles(imgs); } };
  const onDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); };

  const send = async (override) => {
    const body = (override ?? text).trim();
    if ((!body && !files.length) || sending || running || !agent) return;
    setSending(true);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readB64(f.file) })));
      const r = await api.post(`/api/chats/${agent.id}/messages`, { text: body, attachments });
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setMsgs(r.messages); setText(""); setFiles([]); stick.current = true;
      loadList();
    } catch (e) { toast(e.message, true); } finally { setSending(false); }
  };

  const clear = async () => {
    if (!confirm(`Clear your whole conversation with ${agent.name}? This can't be undone.`)) return;
    try { await api.del(`/api/chats/${agent.id}`); setMsgs([]); loadList(); } catch (e) { toast(e.message, true); }
  };

  const list = useMemo(() => (agents || [])
    .filter((a) => `${a.name} ${a.role} ${a.dev}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (summary[b.id]?.last?.at || "").localeCompare(summary[a.id]?.last?.at || "") || a.name.localeCompare(b.name)), [agents, summary, filter]);

  const inactive = agent ? (agent.connectors || []).map((id) => conns.find((c) => c.id === id)).filter((c) => c && !c.active) : [];
  const groups = [];
  for (const m of msgs) {
    const label = dayLabel(m.at);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(m);
  }
  const suggestions = agent ? ["What can you help me with?", agent.description].filter(Boolean).slice(0, 2) : [];

  const openLb = (urls, i) => setLb({ urls, i });

  return (
    <div className={`chat-shell ${agentId ? "has-thread" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
      {/* ---------- agent list ---------- */}
      <aside className="chat-list" aria-label="Agents">
        <div className="chat-list-h">
          <h1>Chat</h1>
          <label className="search" style={{ flex: "none", minWidth: 0, width: "100%", height: 38 }}>
            <Icon n="search" size={15} />
            <input type="search" aria-label="Find an agent" placeholder="Find an agent" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="chat-items">
          {!agents ? <div className="muted" style={{ padding: 16 }}>Loading…</div> : list.length === 0 ? (
            <div className="muted" style={{ padding: 16 }}>{agents.length ? "No agents match." : <>No agents yet. <Link to="/agents/new">Create one →</Link></>}</div>
          ) : list.map((a) => {
            const s = summary[a.id];
            return (
              <button key={a.id} className={`chat-item ${a.id === agentId ? "active" : ""}`} onClick={() => nav(`/chat/${a.id}`)} aria-current={a.id === agentId ? "true" : undefined}>
                <span className="presence-wrap"><Avatar agent={a} /><i className={`presence ${a.status}`} title={a.status} /></span>
                <span className="grow col" style={{ minWidth: 0, textAlign: "left" }}>
                  <span className="row" style={{ justifyContent: "space-between", gap: 6 }}><b className="ellipsis">{a.name}</b><span className="hint mono" style={{ fontSize: 11 }}>{listTime(s?.last?.at)}</span></span>
                  {a.role && <span className="ellipsis" style={{ fontSize: 12, fontWeight: 500, color: a.color || "var(--accent-d)" }}>{a.role}</span>}
                  {(s?.running || s?.last) && <span className="hint ellipsis">{s.running ? <span style={{ color: "var(--accent-d)" }}>typing…</span> : `${s.last.role === "user" ? "You: " : ""}${s.last.text}`}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ---------- thread ---------- */}
      <section className="chat-thread" aria-label="Conversation">
        {!agent ? (
          <div className="chat-empty">{agents && !agents.length ? "Create an agent to start chatting." : agentId && agents ? "Agent not found." : "Select an agent to start a conversation."}</div>
        ) : (
          <>
            <header className="chat-head">
              <button className="btn icon back" aria-label="Back to agents" onClick={() => nav("/chat")}><Icon n="arrow" style={{ transform: "scaleX(-1)" }} /></button>
              <span className="presence-wrap"><Avatar agent={agent} /><i className={`presence ${agent.status}`} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 15.5 }}>{agent.name}</b><span className="muted">{agent.dev}</span></div>
                <div className="hint ellipsis">{agent.role}{agent.connectorNames.length ? ` · ${agent.connectorNames.join(", ")}` : " · answers from conversation only"}</div>
              </div>
              <Link className="btn sm" to={`/agents/${agent.id}`}><Icon n="edit" size={14} />Edit agent</Link>
              <button className="btn sm" onClick={clear} disabled={!msgs.length || running}><Icon n="trash" size={14} />Clear</button>
            </header>

            {inactive.length > 0 && (
              <div className="note" style={{ margin: "12px 20px 0" }}>
                {agent.name} needs {inactive.map((c) => c.name).join(", ")} to be active. <Link to="/connectors">Add the SerpApi key →</Link>
              </div>
            )}

            <div className="chat-msgs" ref={scroller} onScroll={onScroll}>
              {loadedFor !== agentId ? <div className="muted" style={{ padding: 20 }}>Loading…</div> : msgs.length === 0 ? (
                <div className="chat-intro">
                  <Avatar agent={agent} size="lg" />
                  <h2>{agent.name}</h2>
                  <p className="muted">{agent.role}{agent.description ? ` · ${agent.description}` : ""}</p>
                  <p className="hint">Ask in plain words. You can attach photos, PDFs, Word and text files{agent.connectorNames.length ? ", and I'll use my connectors to search" : ""}.</p>
                  <div className="row wrap" style={{ justifyContent: "center" }}>
                    {suggestions.map((s) => <button key={s} className="name-chip" onClick={() => send(s)} disabled={inactive.length > 0}>{s}</button>)}
                  </div>
                </div>
              ) : groups.map((g) => (
                <div key={g.label}>
                  <div className="day"><span>{g.label}</span></div>
                  {g.items.map((m) => <Message key={m.id} m={m} agent={agent} onOpen={openLb} />)}
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div className="composer-wrap">
              {files.length > 0 && (
                <div className="pending">
                  {files.map((f, i) => (
                    <span className="pend" key={i}>
                      {f.preview ? <img src={f.preview} alt="" /> : <Icon n="file" size={18} />}
                      <span className="ellipsis" style={{ maxWidth: 140 }}>{f.name}</span>
                      <button aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><Icon n="x" size={13} /></button>
                    </span>
                  ))}
                </div>
              )}
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <input ref={fileInput} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                <button type="button" className="btn icon" aria-label="Attach photos or documents" title="Attach photos or documents" onClick={() => fileInput.current.click()} disabled={files.length >= 6}><Icon n="paperclip" /></button>
                <textarea ref={box} rows={1} value={text} placeholder={`Message ${agent.name}`} aria-label={`Message ${agent.name}`} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
                <button className="btn accent icon" aria-label="Send" disabled={sending || running || (!text.trim() && !files.length)}>{sending || running ? <Spinner /> : <Icon n="send" />}</button>
              </form>
              <span className="hint" style={{ textAlign: "center", fontSize: 11.5 }}>Enter to send · Shift+Enter for a new line · drop files anywhere · replies use real searches from your SerpApi plan</span>
            </div>
          </>
        )}
        {dragging && agent && <div className="drop" aria-hidden="true"><Icon n="image" size={30} /><b>Drop to attach</b><span>Photos, PDF, Word or text files</span></div>}
      </section>
      {lb && <Lightbox urls={lb.urls} index={lb.i} onClose={() => setLb(null)} onIndex={(i) => setLb({ ...lb, i })} />}
    </div>
  );
}
