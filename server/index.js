import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, save, uid, now, encrypt, mask, decrypt, llmReady } from "./store.js";
import { createRequire } from "node:module";
import { allConnectors, findConnector, listTools, loadModule, BUILTIN, isActive, connectorKey, runWithKey } from "./connectors.js";
import { generatePrompt, runAgent, MODELS } from "./llm.js";
import { startWorkflow, decide, recoverRuns } from "./workflow.js";
import { seedIfEmpty, migrateWorkflows } from "./seed.js";
import { registerChat, recoverChats } from "./chat.js";

const app = express();
app.use(express.json({ limit: "40mb" })); // chat attachments arrive as base64
// Local single-user app: only accept requests that come from the machine itself.
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress || "";
  if (ip.includes("127.0.0.1") || ip === "::1" || ip.endsWith("::ffff:127.0.0.1")) return next();
  res.status(403).json({ error: "Local access only" });
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.code === "no_llm_key" ? 400 : e.status && e.status < 600 ? e.status : 500;
  res.status(status).json({ error: e.message, code: e.code });
});
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
const str = (v) => (typeof v === "string" ? v.trim() : "");

// ---------------- MCP endpoints ----------------
// Every built-in server is also a standalone MCP endpoint: POST http://127.0.0.1:8787/mcp/<server>
const { serve, setCors } = createRequire(import.meta.url)("./mcp/core.js");
app.get("/mcp", (req, res) => res.json({ servers: BUILTIN.map((b) => ({ name: b.key, endpoint: `http://${req.headers.host}/mcp/${b.key}`, summary: b.desc })) }));
app.all("/mcp/:key", (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!BUILTIN.some((b) => b.key === req.params.key)) return res.status(404).json({ error: "Unknown server" });
  const conn = findConnector(req.params.key);
  if (!isActive(conn)) return res.status(403).json({ error: `${conn.name} is not active. Add its key in Serpentic first.` });
  return runWithKey(conn, () => serve(loadModule(req.params.key), req, res));
});

// ---------------- settings & keys ----------------
const publicSettings = () => ({
  userName: db.settings.userName,
  llm: { ready: llmReady(), model: "GPT-5", deployment: db.settings.azureDeployment },
});

app.get("/api/settings", (req, res) => res.json(publicSettings()));

app.put("/api/settings", (req, res) => {
  const { userName, defaultModel, llmProvider: lp, azureEndpoint, azureDeployment, azureApiVersion } = req.body || {};
  if (["azure", "anthropic"].includes(lp)) db.settings.llmProvider = lp;
  if (typeof azureEndpoint === "string") db.settings.azureEndpoint = azureEndpoint.trim();
  if (typeof azureDeployment === "string" && azureDeployment.trim()) db.settings.azureDeployment = azureDeployment.trim();
  if (typeof azureApiVersion === "string" && azureApiVersion.trim()) db.settings.azureApiVersion = azureApiVersion.trim();
  if (typeof userName === "string") db.settings.userName = userName.trim().slice(0, 60);
  save();
  res.json(publicSettings());
});

let accountCache = { at: 0, key: "", data: null };
async function fetchAccount(key) {
  if (accountCache.key === key && Date.now() - accountCache.at < 30000) return accountCache.data;
  const r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error(j.error || `SerpApi returned HTTP ${r.status}`), { status: 400 });
  const data = {
    plan: j.plan_name, limit: j.searches_per_month, used: j.this_month_usage,
    left: j.plan_searches_left, hourlyLimit: j.account_rate_limit_per_hour, email: j.account_email,
  };
  accountCache = { at: Date.now(), key, data };
  return data;
}

// Account/plan info of the first active connector's key (used by the sidebar).
app.get("/api/account", wrap(async (req, res) => {
  const id = Object.keys(db.active).find((k) => db.active[k].key);
  if (!id) return res.json({ connected: false });
  try {
    res.json({ connected: true, ...(await fetchAccount(connectorKey({ id }))) });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
}));

// ---------------- connectors ----------------
function describeConnector(c, tools) {
  const usedBy = db.agents.filter((a) => (a.connectors || []).includes(c.id)).map((a) => ({ id: a.id, name: a.name, color: a.color }));
  const rec = db.active[c.id];
  const active = isActive(c);
  return {
    id: c.id, name: c.name, kind: c.kind, group: c.group, engine: c.engine, desc: c.desc, url: c.url, serp: c.serp,
    active, status: active ? "active" : "needs_key",
    keyMasked: rec?.key ? mask(decrypt(rec.key)) : null,
    account: rec?.account || null,
    tools: tools?.map((t) => ({ name: t.name, description: t.description })) || null, usedBy,
  };
}

app.get("/api/connectors", wrap(async (req, res) => {
  const list = [];
  for (const c of allConnectors()) {
    let tools = null;
    try { tools = await listTools(c); } catch {}
    const d = describeConnector(c, tools);
    if (c.kind === "custom" && !tools) d.status = "error";
    list.push(d);
  }
  res.json(list);
}));

// Activate (or replace the key of) a built-in connector. SerpApi-backed ones verify the key first.
app.put("/api/connectors/:id/key", wrap(async (req, res) => {
  const c = findConnector(req.params.id);
  if (!c || c.kind !== "builtin") return bad(res, "Not found", 404);
  const key = str(req.body?.key);
  const rec = { key: "", account: null };
  if (c.serp) {
    if (!key) return bad(res, `${c.name} needs a SerpApi key.`);
    rec.account = await fetchAccount(key); // rejects an invalid key before we store it
    rec.key = encrypt(key);
  }
  db.active[c.id] = rec;
  save();
  res.json(describeConnector(c, null));
}));

app.delete("/api/connectors/:id/key", (req, res) => {
  delete db.active[req.params.id];
  save();
  res.json({ ok: true });
});

// Health check for an active connector. Costs no search credits: it validates the key against
// SerpApi's account endpoint and loads the server's tools.
app.post("/api/connectors/:id/test", wrap(async (req, res) => {
  const c = findConnector(req.params.id);
  if (!c) return bad(res, "Not found", 404);
  if (!isActive(c)) return bad(res, "Activate this connector first.");
  const t0 = Date.now();
  try {
    const tools = await listTools(c, { fresh: true });
    let account = null;
    if (c.serp) {
      accountCache = { at: 0, key: "", data: null };
      account = await fetchAccount(connectorKey(c));
      db.active[c.id].account = account;
      save();
    }
    res.json({ ok: true, tools: tools.length, ms: Date.now() - t0, account });
  } catch (e) {
    res.json({ ok: false, error: e.message, ms: Date.now() - t0 });
  }
}));

app.post("/api/connectors", wrap(async (req, res) => {
  const name = str(req.body?.name), url = str(req.body?.url);
  if (!name || !/^https?:\/\//i.test(url)) return bad(res, "Give the server a name and an http(s) URL.");
  const rec = { id: uid("mcp_"), name, url, desc: str(req.body?.desc), token: encrypt(str(req.body?.token)), createdAt: now() };
  db.connectors.push(rec);
  try {
    await listTools(findConnector(rec.id), { fresh: true });
  } catch (e) {
    db.connectors.pop();
    return bad(res, `Could not read tools from that server: ${e.message}`);
  }
  save();
  res.status(201).json({ id: rec.id });
}));

app.delete("/api/connectors/:id", (req, res) => {
  const i = db.connectors.findIndex((c) => c.id === req.params.id);
  if (i < 0) return bad(res, "Only custom servers can be removed.", 404);
  db.connectors.splice(i, 1);
  for (const a of db.agents) a.connectors = (a.connectors || []).filter((id) => id !== req.params.id);
  save();
  res.json({ ok: true });
});

// ---------------- projects ----------------
const projectView = (p) => {
  const agents = db.agents.filter((a) => a.projectId === p.id);
  const workflows = db.workflows.filter((w) => w.projectId === p.id);
  const weekAgo = Date.now() - 7 * 864e5;
  const runsWeek = db.runs.filter((r) => r.projectId === p.id && new Date(r.createdAt) > weekAgo).length;
  const connectors = [...new Set(agents.flatMap((a) => a.connectors || []))]
    .map((id) => findConnector(id)?.name).filter(Boolean);
  return { ...p, agentCount: agents.length, workflowCount: workflows.length, runsWeek, connectors,
    agents: agents.map((a) => ({ id: a.id, name: a.name, color: a.color })) };
};

app.get("/api/projects", (req, res) => res.json(db.projects.map(projectView)));

app.post("/api/projects", (req, res) => {
  const name = str(req.body?.name);
  if (!name) return bad(res, "Project needs a name.");
  const p = { id: uid("prj_"), name, description: str(req.body?.description), status: "active", createdAt: now(), updatedAt: now() };
  db.projects.unshift(p);
  save();
  res.status(201).json(projectView(p));
});

app.put("/api/projects/:id", (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.id);
  if (!p) return bad(res, "Not found", 404);
  const { name, description, status } = req.body || {};
  if (str(name)) p.name = str(name);
  if (typeof description === "string") p.description = description.trim();
  if (["active", "paused", "draft"].includes(status)) p.status = status;
  p.updatedAt = now();
  save();
  res.json(projectView(p));
});

app.delete("/api/projects/:id", (req, res) => {
  db.projects = db.projects.filter((p) => p.id !== req.params.id);
  // Keep the work, just detach it.
  for (const x of [...db.agents, ...db.workflows]) if (x.projectId === req.params.id) x.projectId = null;
  save();
  res.json({ ok: true });
});

// ---------------- agents ----------------
const AGENT_FIELDS = ["name", "dev", "role", "projectId", "color", "description", "prompt", "promptEdited", "connectors",
  "model", "language", "requireApproval", "memory", "status"];

function pickAgent(body) {
  const out = {};
  for (const k of AGENT_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  if (out.connectors) out.connectors = out.connectors.filter((id) => findConnector(id));
  if (out.model && !MODELS.some((m) => m.id === out.model)) delete out.model;
  if (out.status && !["draft", "live", "paused"].includes(out.status)) delete out.status;
  return out;
}

const agentView = ({ history, ...a }) => ({
  ...a,
  connectorNames: (a.connectors || []).map((id) => findConnector(id)?.name).filter(Boolean),
});

app.get("/api/agents", (req, res) => res.json(db.agents.map(agentView)));
app.get("/api/agents/:id", (req, res) => {
  const a = db.agents.find((x) => x.id === req.params.id);
  a ? res.json(agentView(a)) : bad(res, "Not found", 404);
});

app.post("/api/agents", (req, res) => {
  const body = pickAgent(req.body || {});
  if (!str(body.name)) return bad(res, "Agent needs a name.");
  const a = {
    role: "", dev: "", color: "#5B3DF5", description: "", prompt: "", promptEdited: false, connectors: [], projectId: null,
    model: db.settings.defaultModel, language: "English", requireApproval: false, memory: false, status: "draft",
    ...body, id: uid("agt_"), runs: 0, ok: 0, lastRunAt: null, createdAt: now(), updatedAt: now(), history: [],
  };
  db.agents.unshift(a);
  save();
  res.status(201).json(agentView(a));
});

app.put("/api/agents/:id", (req, res) => {
  const a = db.agents.find((x) => x.id === req.params.id);
  if (!a) return bad(res, "Not found", 404);
  Object.assign(a, pickAgent(req.body || {}), { updatedAt: now() });
  save();
  res.json(agentView(a));
});

app.delete("/api/agents/:id", (req, res) => {
  const used = db.workflows.filter((w) => w.nodes.some((n) => n.data?.agentId === req.params.id)).map((w) => w.name);
  if (used.length) return bad(res, `Still used in: ${used.join(", ")}. Remove it from those workflows first.`, 409);
  db.agents = db.agents.filter((a) => a.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.post("/api/agents/generate-prompt", wrap(async (req, res) => {
  const b = req.body || {};
  if (!str(b.description)) return bad(res, "Say what the agent should do first.");
  const out = await generatePrompt({
    name: str(b.name), role: str(b.role), description: str(b.description),
    connectorIds: (b.connectors || []).filter((id) => findConnector(id)), model: b.model, language: b.language,
  });
  res.json(out);
}));

// Test run: works on a saved agent or on the unsaved draft from the builder.
app.post("/api/agents/test-run", wrap(async (req, res) => {
  const { agentId, agent: draft, input } = req.body || {};
  if (!str(input)) return bad(res, "Type a message to test with.");
  const saved = agentId && db.agents.find((a) => a.id === agentId);
  const agent = draft ? { ...(saved || {}), ...pickAgent(draft), id: saved?.id } : saved;
  if (!agent) return bad(res, "Not found", 404);
  const started = Date.now();
  const run = { id: uid("run_"), kind: "agent", agentId: agent.id || null, workflowName: `${agent.name || "Agent"} test run`,
    projectId: agent.projectId || null, status: "running", input: { message: input }, steps: {}, output: "", createdAt: now() };
  try {
    const r = await runAgent(agent, input);
    Object.assign(run, { status: "succeeded", output: r.text, finishedAt: now() });
    db.runs.unshift(run);
    db.runs = db.runs.slice(0, 500);
    save();
    res.json({ text: r.text, toolCalls: r.toolCalls, ms: Date.now() - started });
  } catch (e) {
    Object.assign(run, { status: "failed", output: e.message, finishedAt: now() });
    db.runs.unshift(run);
    save();
    throw e;
  }
}));

// ---------------- workflows ----------------
const workflowView = (w) => ({
  ...w,
  stepCount: w.nodes.length,
  agentIds: [...new Set(w.nodes.filter((n) => n.type === "agent").map((n) => n.data?.agentId).filter(Boolean))],
  lastRun: db.runs.find((r) => r.workflowId === w.id) || null,
});

function cleanGraph(body) {
  const nodes = (body.nodes || []).map((n) => ({
    id: String(n.id), type: n.type, x: Math.round(+n.x || 0), y: Math.round(+n.y || 0), data: n.data || {},
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (body.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ id: e.id || uid("e_"), from: e.from, to: e.to, ...(e.branch ? { branch: e.branch } : {}) }));
  return { nodes, edges };
}

app.get("/api/workflows", (req, res) => res.json(db.workflows.map(workflowView)));
app.get("/api/workflows/:id", (req, res) => {
  const w = db.workflows.find((x) => x.id === req.params.id);
  w ? res.json(workflowView(w)) : bad(res, "Not found", 404);
});

app.post("/api/workflows", (req, res) => {
  const name = str(req.body?.name);
  if (!name) return bad(res, "Workflow needs a name.");
  const w = {
    id: uid("wf_"), name, projectId: req.body.projectId || null, status: "draft", version: 1,
    nodes: [{ id: "n_trigger", type: "trigger", x: 40, y: 120, data: { title: "Your request", subtitle: "Describe what you want in plain words" } }],
    edges: [], createdAt: now(), updatedAt: now(),
    ...(req.body.nodes ? cleanGraph(req.body) : {}),
  };
  db.workflows.unshift(w);
  save();
  res.status(201).json(workflowView(w));
});

app.put("/api/workflows/:id", (req, res) => {
  const w = db.workflows.find((x) => x.id === req.params.id);
  if (!w) return bad(res, "Not found", 404);
  const b = req.body || {};
  if (str(b.name)) w.name = str(b.name);
  if (b.projectId !== undefined) w.projectId = b.projectId || null;
  if (["draft", "live", "paused"].includes(b.status)) w.status = b.status;
  if (b.nodes) Object.assign(w, cleanGraph(b));
  if (b.publish) { w.status = "live"; w.version += 1; }
  w.updatedAt = now();
  save();
  res.json(workflowView(w));
});

app.delete("/api/workflows/:id", (req, res) => {
  db.workflows = db.workflows.filter((w) => w.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.post("/api/workflows/:id/run", wrap(async (req, res) => {
  const w = db.workflows.find((x) => x.id === req.params.id);
  if (!w) return bad(res, "Not found", 404);
  // Run what's on the canvas right now (saved by the client just before), not a stale version.
  if (!w.nodes.some((n) => n.type === "trigger")) return bad(res, "Add a trigger step first.");
  if (!llmReady() && w.nodes.some((n) => n.type === "agent")) {
    return bad(res, "Set up the LLM on the Connectors page first.");
  }
  const run = startWorkflow(w, req.body?.input || {});
  res.status(202).json(run);
}));

// ---------------- runs & approvals ----------------
app.get("/api/runs", (req, res) => {
  let runs = db.runs;
  if (req.query.workflowId) runs = runs.filter((r) => r.workflowId === req.query.workflowId);
  res.json(runs.slice(0, +req.query.limit || 50));
});
app.get("/api/runs/:id", (req, res) => {
  const r = db.runs.find((x) => x.id === req.params.id);
  r ? res.json(r) : bad(res, "Not found", 404);
});

app.get("/api/approvals", (req, res) => {
  const list = req.query.status ? db.approvals.filter((a) => a.status === req.query.status) : db.approvals;
  res.json(list.slice(0, 100));
});

app.post("/api/approvals/:id/decide", (req, res) => {
  const decision = req.body?.decision;
  if (!["approve", "reject"].includes(decision)) return bad(res, "decision must be approve or reject.");
  const ap = decide(req.params.id, decision, str(req.body?.comment));
  ap ? res.json(ap) : bad(res, "Already decided or not found.", 409);
});

// ---------------- dashboard ----------------
app.get("/api/dashboard", wrap(async (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 14, 7), 30);
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  const perDay = {};
  for (let i = days - 1; i >= 0; i--) perDay[day(Date.now() - i * 864e5)] = 0;
  const cutoff = Date.now() - days * 864e5;
  const recent = db.runs.filter((r) => new Date(r.createdAt) > cutoff);
  for (const r of recent) if (perDay[day(r.createdAt)] !== undefined) perDay[day(r.createdAt)]++;
  const finished = recent.filter((r) => r.status === "succeeded" || r.status === "failed");

  const events = db.runs.slice(0, 12).map((r) => ({
    at: r.finishedAt || r.createdAt, runId: r.id, status: r.status, text: `${r.workflowName}`,
    kind: r.kind,
  }));
  const pending = db.approvals.filter((a) => a.status === "pending");

  const conns = [];
  for (const c of allConnectors().filter(isActive)) {
    let n = null;
    try { n = (await listTools(c)).length; } catch {}
    conns.push({ id: c.id, name: c.name, tools: n, status: n === null ? "error" : "active" });
  }

  res.json({
    counts: {
      projects: db.projects.length, agents: db.agents.length, workflows: db.workflows.length,
      connectors: conns.length, liveAgents: db.agents.filter((a) => a.status === "live").length,
      pausedAgents: db.agents.filter((a) => a.status === "paused").length,
      draftAgents: db.agents.filter((a) => a.status === "draft").length,
      pendingApprovals: pending.length,
    },
    runsToday: perDay[day(Date.now())] || 0,
    runsYesterday: perDay[day(Date.now() - 864e5)] || 0,
    runsTotal: recent.length,
    successRate: finished.length ? finished.filter((r) => r.status === "succeeded").length / finished.length : null,
    perDay: Object.entries(perDay).map(([date, runs]) => ({ date, runs })),
    oldestPending: pending.length ? pending[pending.length - 1].createdAt : null,
    events,
    topAgents: [...db.agents].filter((a) => a.runs).sort((a, b) => b.runs - a.runs).slice(0, 5)
      .map(({ history, ...a }) => ({ ...a, connectorNames: (a.connectors || []).map((id) => findConnector(id)?.name).filter(Boolean) })),
    connectors: conns,
    localSearches: db.usage[new Date().toISOString().slice(0, 7)] || 0,
  });
}));

registerChat(app, { wrap, bad });

// ---------------- static (production) ----------------
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

seedIfEmpty();
migrateWorkflows();
recoverRuns();
recoverChats();
const PORT = +process.env.PORT || 8787;
app.listen(PORT, "127.0.0.1", () => console.log(`Serpentic API on http://127.0.0.1:${PORT}`));
