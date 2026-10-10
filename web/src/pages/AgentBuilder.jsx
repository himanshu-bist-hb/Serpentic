import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtMs } from "../api.js";
import { Avatar, COLORS, INDIAN_NAMES, Icon, Md, Spinner, Status, Switch, transliterate, useApp, useLoad } from "../components/ui.jsx";

const LANGS = ["English", "Hindi", "Hinglish", "Tamil", "Telugu", "Bengali", "Marathi", "Gujarati", "Kannada", "Malayalam", "Punjabi"];
const BLANK = {
  name: "", dev: "", role: "", projectId: "", color: COLORS[0], description: "", prompt: "", promptEdited: false,
  connectors: [], model: "claude-sonnet-5-5", language: "English", requireApproval: false, memory: false, status: "draft",
};

const sections = (md) => {
  const out = [];
  let cur = null;
  for (const line of md.split("\n")) {
    const m = line.match(/^##\s+(.+)/);
    if (m) { cur = { title: m[1].trim(), body: [] }; out.push(cur); }
    else if (cur) cur.body.push(line);
    else if (line.trim()) { cur = { title: "Prompt", body: [line] }; out.push(cur); }
  }
  return out.map((s) => ({ ...s, body: s.body.join("\n").trim() }));
};

function randomNames(n = 6, skip = "") {
  const pool = INDIAN_NAMES.filter(([x]) => x !== skip);
  return pool.sort(() => Math.random() - 0.5).slice(0, n);
}

export default function AgentBuilder() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const { toast, refresh, settings } = useApp();
  const [f, setF] = useState(BLANK);
  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [mode, setMode] = useState("preview");
  const [copied, setCopied] = useState(false);
  const [suggest, setSuggest] = useState(() => randomNames());
  const [test, setTest] = useState({ input: "", busy: false, result: null, error: null });
  const dirty = useRef(false);

  const [projects] = useLoad(() => api.get("/api/projects"), []);
  const [conns] = useLoad(() => api.get("/api/connectors"), []);

  useEffect(() => {
    if (isNew) return;
    api.get(`/api/agents/${id}`).then((a) => { setF({ ...BLANK, ...a, projectId: a.projectId || "" }); setLoaded(true); })
      .catch(() => { toast("Agent not found", true); nav("/agents"); });
  }, [id]); // eslint-disable-line

  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const autoRole = useRef("");
  const set = (patch) => { dirty.current = true; setF((x) => ({ ...x, ...patch })); };
  const display = f.name.trim() || "your agent";
  const secs = useMemo(() => sections(f.prompt), [f.prompt]);
  const selected = (conns || []).filter((c) => f.connectors.includes(c.id));
  const toolTotal = selected.reduce((n, c) => n + (c.tools?.length || 0), 0);
  const tokens = Math.round(f.prompt.length / 4);

  const pickName = ([n, d]) => set({ name: n, dev: d });
  const toggleConn = (cid) => set({ connectors: f.connectors.includes(cid) ? f.connectors.filter((x) => x !== cid) : [...f.connectors, cid] });

  const generate = async () => {
    if (f.prompt && f.promptEdited && !confirm("This replaces the prompt you edited. Continue?")) return;
    setGenerating(true); setGenError(null);
    try {
      const { prompt, role } = await api.post("/api/agents/generate-prompt", {
        name: f.name, role: f.role, description: f.description, connectors: f.connectors, model: f.model, language: f.language,
      });
      // Fill the job title from the request unless the user typed their own.
      const patch = { prompt, promptEdited: false };
      if (role && (!f.role.trim() || f.role === autoRole.current)) { patch.role = role; autoRole.current = role; }
      set(patch);
      setMode("preview");
    } catch (e) { setGenError(e.message); } finally { setGenerating(false); }
  };

  const save = async (status) => {
    if (!f.name.trim()) return toast("Give the agent a name first.", true);
    if (status === "live" && !f.prompt.trim()) return toast("Write or generate a prompt before publishing.", true);
    setSaving(true);
    const body = { ...f, projectId: f.projectId || null, dev: f.dev || transliterate(f.name), status: status || f.status };
    try {
      const saved = isNew ? await api.post("/api/agents", body) : await api.put(`/api/agents/${id}`, body);
      dirty.current = false;
      toast(status === "live" ? `${saved.name} is live` : "Draft saved");
      refresh();
      if (isNew) nav(`/agents/${saved.id}`, { replace: true }); else setF({ ...BLANK, ...saved, projectId: saved.projectId || "" });
    } catch (e) { toast(e.message, true); } finally { setSaving(false); }
  };

  const runTest = async (e) => {
    e.preventDefault();
    setTest((t) => ({ ...t, busy: true, result: null, error: null }));
    try {
      const result = await api.post("/api/agents/test-run", { agentId: isNew ? undefined : id, agent: { ...f, projectId: f.projectId || null }, input: test.input });
      setTest((t) => ({ ...t, busy: false, result }));
    } catch (err) { setTest((t) => ({ ...t, busy: false, error: err.message })); }
  };

  const copy = async () => { await navigator.clipboard.writeText(f.prompt).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  if (!loaded) return <div className="page"><div className="muted">Loading…</div></div>;
  const project = projects?.find((p) => p.id === f.projectId);

  return (
    <main className="page wide">
      <section className="head">
        <div>
          <div className="row"><Link to="/agents" className="hint">← Agents</Link>{!isNew && <Link to={`/chat/${id}`} className="btn sm accent" style={{ marginLeft: 8 }}><Icon n="chat" size={14} />Chat with {f.name}</Link>}</div>
          <h1 style={{ marginTop: 6 }}>{isNew ? "New agent" : f.name || "Edit agent"}</h1>
          <p>Name it, say what it should do in plain words, and choose the MCP servers it can use.</p>
        </div>
        <div className="steps" aria-label="Sections">
          {["Identity", "Instructions", "Connectors", "Behaviour"].map((s, i) => (
            <a key={s} className="step-chip" href={`#sec-${i + 1}`}><i>{i + 1}</i>{s}</a>
          ))}
        </div>
      </section>

      <div className="builder">
        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          {/* 1 Identity */}
          <section id="sec-1" className="card sec">
            <div><span className="sec-n">01</span><h2 className="sec-title">Identity</h2><p className="hint">Any name works. Indian names keep a large fleet easy to tell apart.</p></div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <div className="field">
                <label htmlFor="an">Agent name</label>
                <input id="an" className="in" value={f.name} maxLength={30} onChange={(e) => set({ name: e.target.value, dev: transliterate(e.target.value) })} placeholder="Aarav" />
                {f.dev && <span className="hint">{f.dev}</span>}
                <div className="name-chips" aria-label="Name suggestions">
                  {suggest.map(([n, d]) => <button type="button" key={n} className="name-chip" onClick={() => pickName([n, d])}>{n} <span className="muted">{d}</span></button>)}
                  <button type="button" className="name-chip" onClick={() => setSuggest(randomNames(6, f.name))} aria-label="Shuffle names"><Icon n="refresh" size={12} /></button>
                </div>
              </div>
              <div className="field"><label htmlFor="ar">Job title</label><input id="ar" className="in" value={f.role} onChange={(e) => set({ role: e.target.value })} placeholder="Flight Scout" /><span className="hint">Filled in from your request when you generate the prompt. You can edit it.</span></div>
              <div className="field"><label htmlFor="ap">Project</label>
                <select id="ap" className="sel" value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                  <option value="">No project</option>{(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div className="field"><span className="lbl" id="colour">Avatar colour</span>
                <div className="swatches" role="group" aria-labelledby="colour">
                  {COLORS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={c} aria-pressed={f.color === c} onClick={() => set({ color: c })} />)}
                </div></div>
            </div>
          </section>

          {/* 2 Instructions */}
          <section id="sec-2" className="card sec">
            <div><span className="sec-n">02</span><h2 className="sec-title">Instructions</h2><p className="hint">Write it the way you would say it. The LLM turns it into a structured prompt that you can edit.</p></div>
            <div className="field">
              <label htmlFor="ad">What should {display} do?</label>
              <textarea id="ad" className="ta" rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Search for the cheapest flights for me, and tell me if the price is good." />
              <span className="hint">One or two sentences is enough. Pick connectors below first so the prompt names the right tools.</span>
            </div>
            <div className="row wrap">
              <button className="btn accent" onClick={generate} disabled={generating || !f.description.trim()}>
                {generating ? <><Spinner />Writing…</> : <><Icon n="sparkle" size={16} />{f.prompt ? "Regenerate prompt" : "Generate structured prompt"}</>}
              </button>
              
            </div>
            {genError && <div className="err" role="alert">{genError}</div>}

            {(f.prompt || mode === "edit") && (
              <div className="prompt-box">
                <div className="prompt-bar">
                  <div className="row"><b style={{ fontSize: 13.5 }}>Structured prompt</b><span className={`tag`}>{f.promptEdited ? "Edited by you" : "Generated"}</span></div>
                  <div className="row">
                    <div className="seg" role="group" aria-label="View">
                      <button aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Preview</button>
                      <button aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>Edit</button>
                    </div>
                    <button className="btn sm" onClick={copy}><Icon n="copy" size={14} />{copied ? "Copied" : "Copy"}</button>
                  </div>
                </div>
                {mode === "preview" ? (
                  secs.map((s, i) => (
                    <div className="psec" key={s.title + i}>
                      <span className="num">{String(i + 1).padStart(2, "0")}</span><h4>{s.title}</h4>
                      <div className="body"><Md text={s.body} /></div>
                    </div>
                  ))
                ) : (
                  <textarea className="prompt-edit" aria-label="Prompt text" value={f.prompt} spellCheck={false}
                    placeholder="Write the whole prompt yourself, or press Generate above to start from a draft."
                    onChange={(e) => set({ prompt: e.target.value, promptEdited: true })} />
                )}
                <div className="prompt-bar" style={{ borderTop: "1px solid var(--line-2)", borderBottom: 0 }}>
                  <span className="hint tnum">{secs.length} sections · ≈ {tokens} tokens</span>
                  <span className="hint">Inputs written as {"{{variable}}"} show up in workflows.</span>
                </div>
              </div>
            )}
            {!f.prompt && mode !== "edit" && <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setMode("edit")}>Or write the prompt yourself</button>}
          </section>

          {/* 3 Connectors */}
          <section id="sec-3" className="card sec">
            <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div><span className="sec-n">03</span><h2 className="sec-title">Connectors</h2><p className="hint">Pick the MCP servers {display} may call. Only their tools are shown to the model.</p></div>
              <Link className="btn sm" to="/connectors"><Icon n="plus" size={14} />Activate more</Link>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
              {(conns || []).filter((c) => c.active || f.connectors.includes(c.id)).map((c) => (
                <button type="button" key={c.id} className="conn-pick" aria-pressed={f.connectors.includes(c.id)} onClick={() => toggleConn(c.id)}>
                  <span className="check">{f.connectors.includes(c.id) && <Icon n="check" size={13} sw={3} style={{ color: "#fff" }} />}</span>
                  <span className="grow">
                    <span className="row" style={{ justifyContent: "space-between" }}><b>{c.name}</b><span className="hint tnum">{c.tools?.length ?? 0} tools</span></span>{!c.active && <span className="hint" style={{ color: "var(--red)" }}>Not active</span>}
                    <span className="hint mono" style={{ display: "block" }}>{c.kind === "custom" ? "custom" : `engine=${c.engine}`}</span>
                  </span>
                </button>
              ))}
            </div>
            <div>
              <div className="lbl">Tools {display} can call · {toolTotal}</div>
              {(conns || []).every((c) => !c.active) ? <p className="note" style={{ marginTop: 8 }}>No connectors are active yet. <Link to="/connectors">Activate one with its SerpApi key →</Link></p> : selected.length === 0 ? <p className="hint" style={{ marginTop: 6 }}>No servers selected. {display} will answer from the conversation only.</p> : (
                <div className="tools" style={{ marginTop: 8 }}>{selected.flatMap((c) => (c.tools || []).map((t) => <span key={c.id + t.name} className="tag mono" title={t.description}>{t.name}<span className="muted"> · {c.name}</span></span>))}</div>
              )}
            </div>
          </section>

          {/* 4 Behaviour */}
          <section id="sec-4" className="card sec">
            <div><span className="sec-n">04</span><h2 className="sec-title">Behaviour</h2><p className="hint">How {display} thinks, replies and hands work back to you.</p></div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
              <div className="field"><span className="lbl">Model</span><div className="in" style={{ display: "flex", alignItems: "center" }}>GPT-5</div><span className="hint">All agents run on GPT-5.</span></div>
              <div className="field"><label htmlFor="al">Reply language</label>
                <select id="al" className="sel" value={f.language} onChange={(e) => set({ language: e.target.value })}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
                <span className="hint">Added to the prompt's output rules.</span></div>
            </div>
            <div>
              <div className="toggle-row"><div><b>Ask for approval before sharing results</b><div className="hint">In workflows, the step pauses in Approvals until you sign off. Test runs skip this.</div></div><Switch checked={f.requireApproval} onChange={(v) => set({ requireApproval: v })} label="Require approval" /></div>
              <div className="toggle-row"><div><b>Remember past requests</b><div className="hint">Keeps the last 20 requests as context for follow-ups.</div></div><Switch checked={f.memory} onChange={(v) => set({ memory: v })} label="Remember past requests" /></div>
            </div>
          </section>

          <div className="savebar">
            <span className="hint">Publishing makes <b>{display}</b> available as a step in any workflow.</span>
            <div className="row">
              <button className="btn" disabled={saving} onClick={() => save(f.status === "live" ? "live" : "draft")}>{f.status === "live" ? "Save changes" : "Save draft"}</button>
              {f.status !== "live" && <button className="btn ink" disabled={saving} onClick={() => save("live")}>Publish agent</button>}
            </div>
          </div>
        </div>

        {/* Preview */}
        <aside className="sticky" aria-label="Preview">
          <div className="card pad col" style={{ gap: 14 }}>
            <div className="row"><span className="eyebrow grow">Preview</span><Status s={f.status} /></div>
            <div className="row" style={{ gap: 14 }}>
              <Avatar name={f.name || "?"} color={f.color} size="lg" />
              <div><div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.01em" }}>{f.name || "Unnamed"} <span className="muted" style={{ fontWeight: 400, fontSize: 16 }}>{f.dev}</span></div>
                <div className="hint">{f.role || "No job title"}{project && ` · ${project.name}`}</div></div>
            </div>
            <div><span className="eyebrow">Can call</span>
              <div className="tools" style={{ marginTop: 6 }}>{selected.length ? selected.map((c) => <span className="tag" key={c.id}>{c.name}</span>) : <span className="hint">No connectors yet</span>}</div></div>
            <div className="hint">Replies in {f.language}{f.requireApproval ? " · asks for approval before sharing" : ""}</div>
          </div>

          <form className="card pad col" style={{ gap: 12 }} onSubmit={runTest}>
            <div className="row"><b className="grow">Test run</b><span className="tag">Uses real searches</span></div>
            <label className="sr-only" htmlFor="tt" style={{ position: "absolute", left: -9999 }}>Test message</label>
            <textarea id="tt" className="ta" rows={3} value={test.input} onChange={(e) => setTest({ ...test, input: e.target.value })} placeholder="Cheapest flights from Delhi to Bengaluru next Friday, 1 adult" />
            <button className="btn ink" disabled={test.busy || !test.input.trim() || !f.name.trim()}>{test.busy ? <><Spinner />Running…</> : <><Icon n="play" size={14} />Run test</>}</button>
            {test.error && <div className="err" role="alert">{test.error}</div>}
            {test.result && (
              <div className="col" style={{ gap: 10 }}>
                {test.result.toolCalls.map((t, i) => (
                  <div className="toolcall" key={i}><Icon n="bolt" size={13} /><span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.server} · {t.tool}</span><span>{fmtMs(t.ms)}</span>{t.isError && <span style={{ color: "var(--red)" }}>failed</span>}</div>
                ))}
                <div className="out-box"><Md text={test.result.text} /></div>
                <span className="hint">{test.result.toolCalls.length} tool call{test.result.toolCalls.length === 1 ? "" : "s"} · {fmtMs(test.result.ms)}</span>
              </div>
            )}
          </form>
        </aside>
      </div>
    </main>
  );
}
