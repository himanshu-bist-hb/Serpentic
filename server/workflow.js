// Workflow executor. A workflow is a graph of nodes (trigger, agent, condition, approval, output)
// and edges. Each node waits for all its upstream nodes, runs, and hands its text to the next ones.
// Approval nodes pause the run; deciding on the approval resumes it.
import { db, save, uid, now } from "./store.js";
import { runAgent, writeSummary } from "./llm.js";

const TERMINAL = new Set(["succeeded", "failed", "skipped"]);
const advancing = new Set();

export function newRun(workflow, input) {
  const steps = {};
  for (const n of workflow.nodes) steps[n.id] = { status: "pending" };
  const run = {
    id: uid("run_"), kind: "workflow", workflowId: workflow.id, workflowName: workflow.name, projectId: workflow.projectId,
    status: "running", input, steps, output: "", createdAt: now(), finishedAt: null,
  };
  db.runs.unshift(run);
  db.runs = db.runs.slice(0, 500);
  save();
  return run;
}

export function startWorkflow(workflow, input) {
  const run = newRun(workflow, input);
  advance(run.id, structuredClone(workflow)).catch((e) => console.error("advance failed", e));
  return run;
}

export const promptOf = (run) => String(run.input?.prompt ?? Object.values(run.input || {}).filter(Boolean).join("; ")).trim();

/** Outputs of every agent step so far, in workflow order, plus the ones that failed. */
function agentOutputs(run, wf) {
  const sections = [], failed = [], images = [];
  for (const n of wf.nodes.filter((x) => x.type === "agent")) {
    const st = run.steps[n.id], a = db.agents.find((x) => x.id === n.data?.agentId);
    const title = a ? `${a.name} (${a.role || "agent"})` : n.data?.title || "Agent";
    if (st.status === "succeeded" && st.output) { sections.push({ title, text: st.output }); images.push(...(st.images || [])); }
    else if (st.status === "failed") failed.push(`- ${title}: ${st.error || "failed"}`);
  }
  return { sections, failed, images };
}

/** One polished summary of all agent outputs. Falls back to the raw outputs if the writer fails. */
async function combine(run, wf) {
  const { sections, failed, images } = agentOutputs(run, wf);
  const pics = [...new Set(images)].slice(0, 12);
  if (!sections.length) return { text: failed.length ? `No agent produced a result.\n\n${failed.join("\n")}` : "No agent output to summarise.", images: [] };
  try {
    const text = await writeSummary({ prompt: promptOf(run), sections, failed });
    return { text, images: pics.filter((u) => !text.includes(u)) };
  } catch (e) {
    return { text: sections.map((s) => `## ${s.title}\n${s.text}`).join("\n\n"), images: pics, warning: `Summary writer failed (${e.message}); showing raw agent outputs.` };
  }
}

const fill = (tpl, vars) => String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (vars[k] ?? ""));

export function evalCondition(data, ctx) {
  const left = data.source && data.source !== "prev" ? String(ctx.input[data.source] ?? "") : ctx.prev;
  const right = data.value ?? "";
  switch (data.op) {
    case "contains": return left.toLowerCase().includes(String(right).toLowerCase());
    case "not_contains": return !left.toLowerCase().includes(String(right).toLowerCase());
    case "equals": return left.trim().toLowerCase() === String(right).trim().toLowerCase();
    case "gt": return parseFloat(left.replace(/[^\d.-]/g, "")) > parseFloat(right);
    case "lt": return parseFloat(left.replace(/[^\d.-]/g, "")) < parseFloat(right);
    default: return left.trim().length > 0; // not_empty
  }
}

async function execute(run, wf, node, upstream) {
  const step = run.steps[node.id];
  const d = node.data || {};
  const prev = upstream.map((u) => u.text).join("\n\n");
  const prompt = promptOf(run);

  switch (node.type) {
    case "trigger":
      return { text: prompt };

    case "condition": {
      const yes = evalCondition(d, { input: run.input || {}, prev });
      step.branch = yes ? "yes" : "no";
      return { text: prev };
    }

    case "approval": {
      const ap = { id: uid("ap_"), runId: run.id, nodeId: node.id, workflowName: wf.name, projectId: wf.projectId,
        title: d.title || "Review before continuing", note: d.note || "", content: prev, status: "pending", createdAt: now() };
      db.approvals.unshift(ap);
      step.approvalId = ap.id;
      return { waiting: true };
    }

    case "output": {
      if (d.summary === false) return { text: prev };
      const r = await combine(run, wf);
      step.images = r.images;
      if (r.warning) step.warning = r.warning;
      return { text: r.text };
    }

    case "agent": {
      const agent = db.agents.find((a) => a.id === d.agentId);
      if (!agent) throw new Error("This step has no agent selected, or the agent was deleted.");
      const vars = { ...(run.input || {}), prompt, prev };
      const parts = [
        `Overall request from the user:\n"${prompt}"`,
        `You are one agent in a multi-agent workflow. Your job: ${agent.role || agent.name}. Do only your part of the request; other agents handle the rest.`,
      ];
      if (d.message) parts.push(`Extra instruction for this step:\n${fill(d.message, vars)}`);
      for (const u of upstream.filter((x) => x.type !== "trigger")) {
        parts.push(`Output from "${u.title}" (use it as input for your part):\n${u.text}`);
      }
      step.tools = [];
      const found = [];
      const res = await runAgent(agent, parts.join("\n\n"), (ev) => {
        if (ev.type === "tool") step.tools.push({ tool: ev.tool, running: true });
        else {
          const t = [...step.tools].reverse().find((x) => x.tool === ev.tool && x.running);
          if (t) Object.assign(t, { running: false, ms: ev.ms, isError: ev.isError });
        }
        save();
      }, { collectImages: found });
      step.toolCalls = res.toolCalls;
      step.images = found.filter((u) => !res.text.includes(u)).slice(0, 8);
      if (agent.requireApproval) {
        const ap = { id: uid("ap_"), runId: run.id, nodeId: node.id, workflowName: wf.name, projectId: wf.projectId,
          agentName: agent.name, title: `${agent.name} wants to share results`, note: "Approval is switched on for this agent.",
          content: res.text, status: "pending", createdAt: now() };
        db.approvals.unshift(ap);
        step.approvalId = ap.id;
        return { waiting: true };
      }
      return { text: res.text };
    }
    default:
      throw new Error(`Unknown step type "${node.type}"`);
  }
}

async function finish(run, wf) {
  const steps = Object.values(run.steps);
  if (steps.some((s) => s.status === "waiting")) { run.status = "waiting"; save(); return; }
  run.status = steps.some((s) => s.status === "failed") ? "failed" : "succeeded";
  const outs = wf.nodes.filter((n) => n.type === "output" && run.steps[n.id].status === "succeeded");
  if (outs.length) {
    run.output = outs.map((n) => run.steps[n.id].output).join("\n\n");
    run.images = [...new Set(outs.flatMap((n) => run.steps[n.id].images || []))];
  } else {
    // No Output step on the canvas: still give the user one combined summary.
    const r = await combine(run, wf);
    run.output = r.text;
    run.images = r.images;
  }
  run.finishedAt = now();
  const agentSteps = wf.nodes.filter((n) => n.type === "agent").map((n) => run.steps[n.id]);
  run.stats = {
    agents: agentSteps.filter((s) => s.status === "succeeded").length,
    toolCalls: agentSteps.reduce((n, s) => n + (s.toolCalls?.length || 0), 0),
    ms: new Date(run.finishedAt) - new Date(run.createdAt),
  };
  save();
}

export async function advance(runId, wfSnapshot) {
  if (advancing.has(runId)) return;
  advancing.add(runId);
  try {
    const run = db.runs.find((r) => r.id === runId);
    const wf = wfSnapshot || db.workflows.find((w) => w.id === run?.workflowId);
    if (!run || !wf) return;
    run.status = "running";

    for (;;) {
      const ready = [];
      for (const node of wf.nodes) {
        const step = run.steps[node.id];
        if (step.status !== "pending") continue;
        const incoming = wf.edges.filter((e) => e.to === node.id);
        if (!incoming.length && node.type !== "trigger") { step.status = "skipped"; continue; }
        const preds = incoming.map((e) => ({ e, from: wf.nodes.find((n) => n.id === e.from) })).filter((p) => p.from);
        if (!preds.every((p) => TERMINAL.has(run.steps[p.from.id].status))) continue;
        const active = preds.filter((p) => {
          const ps = run.steps[p.from.id];
          if (ps.status !== "succeeded") return false;
          return p.from.type !== "condition" || !p.e.branch || p.e.branch === ps.branch;
        });
        if (preds.length && !active.length) { step.status = "skipped"; continue; }
        ready.push({ node, upstream: active.map((p) => ({ type: p.from.type, title: p.from.data?.title || p.from.type, text: run.steps[p.from.id].output || "" })) });
      }
      if (!ready.length) break;

      await Promise.all(ready.map(async ({ node, upstream }) => {
        const step = run.steps[node.id];
        step.status = "running";
        step.startedAt = now();
        save();
        const t0 = Date.now();
        try {
          const r = await execute(run, wf, node, upstream);
          if (r.waiting) step.status = "waiting";
          else { step.status = "succeeded"; step.output = r.text; }
        } catch (e) {
          step.status = "failed";
          step.error = e.message;
        }
        step.ms = Date.now() - t0;
        save();
      }));
    }
    await finish(run, wf);
  } finally {
    advancing.delete(runId);
  }
}

/** Approve or reject a pending approval, then resume its run. */
export function decide(approvalId, decision, comment = "") {
  const ap = db.approvals.find((a) => a.id === approvalId);
  if (!ap || ap.status !== "pending") return null;
  ap.status = decision === "approve" ? "approved" : "rejected";
  ap.comment = comment;
  ap.decidedAt = now();
  const run = db.runs.find((r) => r.id === ap.runId);
  const step = run?.steps[ap.nodeId];
  if (step) {
    if (ap.status === "approved") {
      step.status = "succeeded";
      step.output = comment ? `${ap.content}\n\nReviewer note: ${comment}` : ap.content;
    } else {
      step.status = "failed";
      step.error = comment ? `Rejected: ${comment}` : "Rejected by reviewer";
    }
  }
  save();
  if (run) advance(run.id).catch((e) => console.error("resume failed", e));
  return ap;
}

/** Runs cannot survive a restart mid-flight: mark them failed so the UI does not spin forever. */
export function recoverRuns() {
  for (const run of db.runs) {
    if (run.status !== "running") continue;
    for (const s of Object.values(run.steps)) if (s.status === "running" || s.status === "pending") { s.status = "failed"; s.error = "Server restarted during the run"; }
    run.status = "failed";
    run.finishedAt = now();
  }
  save();
}
