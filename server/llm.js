// Claude calls: turning a plain request into a structured prompt, and running an agent's tool loop.
import Anthropic from "@anthropic-ai/sdk";
import { AzureOpenAI } from "openai";
import { db, save, anthropicKey, azureKey, llmProvider } from "./store.js";
import { findConnector, listTools, callTool, isActive } from "./connectors.js";
import { collectImages } from "./chat.js";

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Balanced. Best default for most agents." },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Deepest reasoning for multi-step research." },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest and cheapest for simple lookups." },
];

const MAX_TOOL_RESULT = 24000;
const MAX_TURNS = 10;

export class NoKeyError extends Error {
  constructor() {
    super("Set up the LLM (Azure OpenAI or Anthropic) on the Connectors page to let agents think and write prompts.");
    this.code = "no_llm_key";
  }
}

function client() {
  const apiKey = anthropicKey();
  if (!apiKey) throw new NoKeyError();
  return new Anthropic({ apiKey });
}

function azure() {
  const { azureDeployment: deployment, azureApiVersion: apiVersion } = db.settings;
  const endpoint = db.settings.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT;
  if (!azureKey() || !endpoint) throw new NoKeyError();
  return { c: new AzureOpenAI({ endpoint, apiKey: azureKey(), apiVersion, deployment }), deployment };
}

const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

// ---------- prompt generation ----------

const PROMPT_WRITER = `You write short system prompts for tool-using AI agents. You get an agent's name, optional job title, a plain request, and the tools it can call.

Reply in exactly this format, nothing else:
TITLE: <job title, 2 to 3 words, taken from the request, e.g. "Flight Scout">
## Role
## Goal
## Tools
## Process
## Inputs
## Output format
## Rules

Keep it SHORT and simple, 180 words max in total:
- Role and Goal: one sentence each, second person, using the agent's name and title.
- Tools: only the tools given, one line each as "- tool_name: when to use it". If none, write "None. Answer from the conversation."
- Process: 3 short numbered steps.
- Inputs: 2 to 4 lines as "- {{snake_case}}: what it is".
- Output format: one or two lines. Prices in ₹ unless told otherwise.
- Rules: 3 short bullets, including never invent data a tool did not return.
Plain words. No preamble, no closing remarks.`;

export async function generatePrompt({ name, role, description, connectorIds = [], model, language }) {
  const useAzure = llmProvider() === "azure";
  const c = useAzure ? null : client();
  const az = useAzure ? azure() : null;
  const lists = await Promise.all(connectorIds.map(async (id) => {
    const conn = findConnector(id);
    if (!conn) return [];
    try { return (await listTools(conn)).map((t) => `- ${t.name}: ${String(t.description || "").slice(0, 90)}`); } catch { return []; }
  }));
  const tools = lists.flat();
  const user = [
    `Agent name: ${name || "Unnamed"}`,
    role ? `Job title: ${role}` : "Job title: (choose one)",
    `Request: ${description}`,
    language && language !== "English" ? `Reply language: ${language}` : "",
    `Tools:\n${tools.join("\n") || "(none)"}`,
  ].filter(Boolean).join("\n\n");
  let raw;
  if (az) {
    // GPT-5 spends completion tokens on hidden reasoning; keep it minimal so the reply isn't starved.
    const req = { model: az.deployment, max_completion_tokens: 4000, messages: [{ role: "system", content: PROMPT_WRITER }, { role: "user", content: user }] };
    let r;
    try { r = await az.c.chat.completions.create({ ...req, reasoning_effort: "minimal" }); }
    catch (e) { if (e?.status !== 400) throw e; r = await az.c.chat.completions.create(req); }
    raw = (r.choices[0].message.content || "").trim();
  } else {
    const res = await c.messages.create({
      model: model || db.settings.defaultModel,
      max_tokens: 900,
      system: PROMPT_WRITER,
      messages: [{ role: "user", content: user }],
    });
    raw = textOf(res.content);
  }
  if (!raw) throw new Error("The model returned an empty reply. Try again, or shorten your request.");
  const m = raw.match(/^\s*TITLE:\s*(.+)\n?/i);
  return { prompt: (m ? raw.slice(m[0].length) : raw).trim(), role: (m?.[1] || "").replace(/["*`]/g, "").trim().slice(0, 40) };
}

// ---------- running an agent ----------

const toolName = (connId, tool) => `${connId}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

async function buildTools(connectorIds) {
  const defs = [];
  const index = new Map(); // api tool name -> { conn, tool }
  const inactive = (connectorIds || []).map(findConnector).filter((c) => c && !isActive(c)).map((c) => c.name);
  if (inactive.length) throw new Error(`Activate ${inactive.join(", ")} on the Connectors page first (each needs its SerpApi key).`);
  for (const id of connectorIds || []) {
    const conn = findConnector(id);
    if (!conn) continue;
    for (const t of await listTools(conn)) {
      const n = toolName(conn.id, t.name);
      index.set(n, { conn, tool: t.name });
      defs.push({ name: n, description: `[${conn.name}] ${t.description || t.name}`, input_schema: t.inputSchema || { type: "object", properties: {} } });
    }
  }
  return { defs, index };
}

function systemFor(agent, opts = {}) {
  const parts = [agent.prompt || `You are ${agent.name}, ${agent.role || "an assistant"}.`];
  parts.push(`Today is ${new Date().toISOString().slice(0, 10)}.`);
  if (opts.chat) {
    parts.push("You are chatting live with the user, so keep replies conversational and well formatted in Markdown. When the user asks for photos or pictures, call a tool that returns image URLs and show the best ones in your reply as Markdown images, like ![short caption](https://…). Never invent an image URL. If a document or photo is attached, it is included in the user's message.");
  }
  if (agent.language && agent.language !== "English") parts.push(`Write your final reply in ${agent.language}.`);
  if (agent.memory && agent.history?.length) {
    parts.push("Recent requests you handled (for follow-ups):\n" + agent.history.slice(-5).map((h) => `- ${h.q} -> ${h.a}`).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Run one agent on one input. `emit` receives live events: { type: "tool", tool, args } and
 * { type: "tool_done", tool, ms, isError }. Returns { text, toolCalls }.
 */
async function azureLoop(agent, input, emit, opts = {}) {
  const { c, deployment } = azure();
  const { defs, index } = await buildTools(agent.connectors);
  const tools = defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.input_schema } }));
  const userContent = opts.images?.length
    ? [{ type: "text", text: input }, ...opts.images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : input;
  const messages = [{ role: "system", content: systemFor(agent, opts) }, ...(opts.history || []), { role: "user", content: userContent }];
  const toolCalls = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await c.chat.completions.create({ model: deployment, max_completion_tokens: 8000, messages, ...(tools.length ? { tools } : {}) });
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      const text = (msg.content || "").trim();
      if (agent.memory) agent.history = [...(agent.history || []), { q: String(input).slice(0, 160), a: text.slice(0, 200) }].slice(-20);
      return { text, toolCalls };
    }
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      const target = index.get(tc.function.name);
      const started = Date.now();
      emit({ type: "tool", tool: tc.function.name, args });
      const out = target ? await callTool(target.conn, target.tool, args) : { text: `Unknown tool ${tc.function.name}`, isError: true };
      const ms = Date.now() - started;
      toolCalls.push({ server: target?.conn.name, tool: target?.tool || tc.function.name, args, ms, isError: out.isError });
      if (opts.collectImages && !out.isError) collectImages(out.text, opts.collectImages);
      emit({ type: "tool_done", tool: tc.function.name, ms, isError: out.isError });
      const body = out.text.length > MAX_TOOL_RESULT ? out.text.slice(0, MAX_TOOL_RESULT) + "\n…[truncated]" : out.text;
      messages.push({ role: "tool", tool_call_id: tc.id, content: body });
    }
  }
  return { text: "I reached my step limit before finishing. Try a narrower request.", toolCalls };
}

async function agentLoop(agent, input, emit, opts) {
  if (llmProvider() === "azure") return azureLoop(agent, input, emit, opts);
  const c = client();
  const { defs, index } = await buildTools(agent.connectors);
  const messages = [{ role: "user", content: input }];
  const toolCalls = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await c.messages.create({
      model: agent.model || db.settings.defaultModel,
      max_tokens: 4096,
      system: systemFor(agent),
      messages,
      ...(defs.length ? { tools: defs } : {}),
    });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") {
      const text = textOf(res.content);
      if (agent.memory) {
        agent.history = [...(agent.history || []), { q: String(input).slice(0, 160), a: text.slice(0, 200) }].slice(-20);
      }
      return { text, toolCalls };
    }
    const results = [];
    for (const block of res.content.filter((b) => b.type === "tool_use")) {
      const target = index.get(block.name);
      const started = Date.now();
      emit({ type: "tool", tool: block.name, args: block.input });
      const out = target ? await callTool(target.conn, target.tool, block.input || {}) : { text: `Unknown tool ${block.name}`, isError: true };
      const ms = Date.now() - started;
      toolCalls.push({ server: target?.conn.name, tool: target?.tool || block.name, args: block.input, ms, isError: out.isError });
      emit({ type: "tool_done", tool: block.name, ms, isError: out.isError });
      const body = out.text.length > MAX_TOOL_RESULT ? out.text.slice(0, MAX_TOOL_RESULT) + "\n…[truncated]" : out.text;
      results.push({ type: "tool_result", tool_use_id: block.id, content: body, ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "I reached my step limit before finishing. Try a narrower request.", toolCalls };
}

/** Public entry: runs the loop and keeps the saved agent's run counters up to date. */
export async function runAgent(agent, input, emit = () => {}, opts = {}) {
  const saved = agent.id && db.agents.find((a) => a.id === agent.id);
  let ok = false;
  try {
    const res = await agentLoop(agent, input, emit, opts);
    ok = !res.toolCalls.some((t) => t.isError) || !!res.text;
    return res;
  } finally {
    if (saved) {
      saved.runs = (saved.runs || 0) + 1;
      saved.ok = (saved.ok || 0) + (ok ? 1 : 0);
      saved.lastRunAt = new Date().toISOString();
      save();
    }
  }
}

// ---------- combined summary for workflows ----------

const SUMMARY_WRITER = `You are an editor who turns the outputs of several specialist AI agents into ONE polished, easy-to-scan report for the user.

Write Markdown with this structure:
# A short, specific title for this result
> **Bottom line:** one or two sentences with the answer or recommendation.

## Highlights
3 to 5 bullets. Put the key facts (prices in ₹, names, dates, ratings) in **bold**.

Then one "## " section per topic covered by the agents (for example Flights, Stays, Places). Merge overlapping content, do not repeat it. Use a Markdown table whenever options are compared. Keep each section tight.

## Recommendation
What you would pick and why, using only the agents' findings.

## Next steps
2 to 4 short, concrete actions (only if useful).

Rules:
- Use only information in the agents' outputs. Never invent prices, names, dates, links or image URLs. Keep numbers exactly as given.
- Prices: show ONLY prices reported by the flight agent (flight fares) and the hotel agent (hotel rates). Ignore and omit any price, fare, cost or total from any other agent (for example the destination scout or local guide), and never compute or estimate a trip total. Suggested destinations are shown by location only, with no price.
- If an agent step failed or returned nothing, say so briefly in a "Gaps" line at the end and do not guess its content.
- Keep Markdown images and links from the outputs only if they are there already.
- Plain, friendly tone. Under 550 words. No preamble and no closing remarks outside the report.`;

export async function writeSummary({ prompt, sections, failed = [] }) {
  const { c, deployment } = azure();
  const body = [
    `The user's request:\n${prompt || "(none)"}`,
    ...sections.map((s) => `### Output from ${s.title}\n${s.text}`),
    failed.length ? `### Steps that failed or returned nothing\n${failed.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const r = await c.chat.completions.create({
    model: deployment, max_completion_tokens: 7000,
    messages: [{ role: "system", content: SUMMARY_WRITER }, { role: "user", content: body.slice(0, 60000) }],
  });
  return (r.choices[0].message.content || "").trim();
}
