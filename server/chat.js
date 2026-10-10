// 1:1 chat with an agent: attachments (photos and documents), tool-using replies, and photos from tool results.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { db, save, uid, now } from "./store.js";
import { runAgent } from "./llm.js";
import { isActive, findConnector } from "./connectors.js";

const UPLOADS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_DOC_CHARS = 30000;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const TEXT_EXT = new Set([".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".htm", ".yaml", ".yml", ".tsv"]);

db.chats ||= {}; // agentId -> { messages: [] }
db.files ||= {}; // fileId -> { name, mime, path, size }

const chatOf = (agentId) => (db.chats[agentId] ||= { messages: [] });

// ---------- attachments ----------
async function extractText(ext, buf) {
  if (TEXT_EXT.has(ext)) return buf.toString("utf8");
  if (ext === ".pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return text;
  }
  if (ext === ".docx") {
    const mammoth = (await import("mammoth")).default;
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  throw new Error(`“${ext || "this file type"}” isn't supported. Use photos (png, jpg, webp, gif), PDF, Word (.docx) or text files.`);
}

async function saveAttachment(a) {
  const name = String(a.name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const ext = path.extname(name).toLowerCase();
  const buf = Buffer.from(String(a.data || ""), "base64");
  if (!buf.length) throw new Error(`“${name}” is empty.`);
  if (buf.length > MAX_FILE) throw new Error(`“${name}” is larger than 15 MB.`);
  const id = crypto.randomBytes(8).toString("hex");
  const isImage = ext in IMAGE_TYPES;
  const mime = isImage ? IMAGE_TYPES[ext] : "application/octet-stream";
  let extract = "";
  if (!isImage) {
    extract = (await extractText(ext, buf)).replace(/\u0000/g, "").trim();
    if (!extract) throw new Error(`Couldn't read any text from “${name}”. Scanned PDFs need to be sent as photos.`);
  }
  const file = path.join(UPLOADS, id + ext);
  fs.writeFileSync(file, buf);
  db.files[id] = { name, mime, path: file, size: buf.length };
  return { id, name, size: buf.length, kind: isImage ? "image" : "doc", mime, extract: extract.slice(0, MAX_DOC_CHARS), truncated: extract.length > MAX_DOC_CHARS, file };
}

// ---------- pulling photos out of tool results ----------
const IMG_KEY = /image|photo|picture|original|src/i;
const URL_RE = /^https?:\/\/[^\s"']+$/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif)(\?|#|$)/i;

export function collectImages(text, into) {
  let data;
  try { data = JSON.parse(text); } catch { return; }
  const walk = (v, key = "") => {
    if (into.length >= 24) return;
    if (typeof v === "string") {
      if (!URL_RE.test(v) || /thumb/i.test(key)) return;
      if ((IMG_KEY.test(key) || IMG_EXT.test(v)) && !into.includes(v)) into.push(v);
    } else if (Array.isArray(v)) v.slice(0, 40).forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(data);
}

// ---------- running a turn ----------
const dataUrl = (a) => `data:${a.mime};base64,${fs.readFileSync(a.file).toString("base64")}`;

function historyFor(messages) {
  return messages.filter((m) => m.status !== "running" && (m.text || m.attachments?.length)).slice(-16).map((m) => {
    let content = m.text || "";
    for (const a of m.attachments || []) {
      if (a.kind === "doc") content += `\n\n[Attached document “${a.name}”]\n${(a.extract || "").slice(0, 6000)}`;
      else content += `\n\n[Attached photo “${a.name}”]`;
    }
    return { role: m.role, content: content.trim() };
  });
}

async function runTurn(agent, chat, userMsg, assistant, attachments) {
  try {
    const missing = (agent.connectors || []).map(findConnector).filter((c) => c && !isActive(c)).map((c) => c.name);
    if (missing.length) throw new Error(`Activate ${missing.join(", ")} on the Connectors page first.`);
    let input = userMsg.text || "";
    for (const a of attachments.filter((x) => x.kind === "doc")) {
      input += `\n\n[Attached document “${a.name}”${a.truncated ? " (shortened)" : ""}]\n${a.extract}`;
    }
    const photos = attachments.filter((a) => a.kind === "image");
    if (photos.length && !input.trim()) input = "Please look at the attached photo(s).";
    const prior = historyFor(chat.messages.filter((m) => m.id !== userMsg.id && m.id !== assistant.id));

    const found = [];
    const res = await runAgent(agent, input.trim(), (ev) => {
      if (ev.type === "tool") assistant.tools.push({ tool: ev.tool, running: true });
      else {
        const t = [...assistant.tools].reverse().find((x) => x.tool === ev.tool && x.running);
        if (t) Object.assign(t, { running: false, ms: ev.ms, isError: ev.isError });
      }
      save();
    }, { history: prior, images: photos.map(dataUrl), chat: true, collectImages: found });

    assistant.text = res.text;
    assistant.tools = res.toolCalls.map(({ server, tool, ms, isError }) => ({ server, tool, ms, isError }));
    assistant.images = found.filter((u) => !res.text.includes(u)).slice(0, 12);
    assistant.status = "done";
  } catch (e) {
    assistant.status = "error";
    assistant.error = e.message;
  }
  assistant.doneAt = now();
  save();
}

// ---------- routes ----------
export function registerChat(app, { wrap, bad }) {
  const view = (m) => ({ ...m, attachments: (m.attachments || []).map(({ extract, file, ...a }) => a) });

  app.get("/api/chats", (req, res) => {
    res.json(db.agents.map((a) => {
      const msgs = db.chats[a.id]?.messages || [];
      const last = msgs[msgs.length - 1];
      return {
        agentId: a.id, running: msgs.some((m) => m.status === "running"),
        last: last ? { role: last.role, text: last.text || (last.attachments?.length ? "📎 Attachment" : last.error || ""), at: last.at } : null,
      };
    }));
  });

  app.get("/api/chats/:agentId", (req, res) => {
    if (!db.agents.some((a) => a.id === req.params.agentId)) return bad(res, "Not found", 404);
    res.json({ messages: (db.chats[req.params.agentId]?.messages || []).map(view) });
  });

  app.post("/api/chats/:agentId/messages", wrap(async (req, res) => {
    const agent = db.agents.find((a) => a.id === req.params.agentId);
    if (!agent) return bad(res, "Not found", 404);
    const chat = chatOf(agent.id);
    if (chat.messages.some((m) => m.status === "running")) return bad(res, "Wait for the current reply to finish.", 409);
    const text = String(req.body?.text || "").trim().slice(0, 12000);
    const incoming = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 6) : [];
    if (!text && !incoming.length) return bad(res, "Type a message or attach a file.");
    const total = incoming.reduce((n, a) => n + String(a.data || "").length * 0.75, 0);
    if (total > MAX_TOTAL) return bad(res, "Attachments are over 25 MB in total.");

    const attachments = [];
    try { for (const a of incoming) attachments.push(await saveAttachment(a)); }
    catch (e) { return bad(res, e.message); }

    const userMsg = { id: uid("m_"), role: "user", text, attachments, at: now() };
    const assistant = { id: uid("m_"), role: "assistant", text: "", status: "running", tools: [], images: [], at: now() };
    chat.messages.push(userMsg, assistant);
    chat.messages = chat.messages.slice(-200);
    save();
    runTurn(agent, chat, userMsg, assistant, attachments);
    res.status(202).json({ messages: chat.messages.map(view) });
  }));

  app.delete("/api/chats/:agentId", (req, res) => {
    const chat = db.chats[req.params.agentId];
    if (chat?.messages.some((m) => m.status === "running")) return bad(res, "Wait for the current reply to finish.", 409);
    for (const m of chat?.messages || []) for (const a of m.attachments || []) {
      try { fs.unlinkSync(a.file); } catch {}
      delete db.files[a.id];
    }
    delete db.chats[req.params.agentId];
    save();
    res.json({ ok: true });
  });

  // Uploaded files. Images render inline; everything else is a download. Never served as HTML/SVG.
  app.get("/api/files/:id", (req, res) => {
    const f = db.files[req.params.id];
    if (!f || !fs.existsSync(f.path)) return bad(res, "Not found", 404);
    const image = f.mime.startsWith("image/");
    res.setHeader("Content-Type", f.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.sendFile(f.path);
  });
}

/** Replies cannot survive a restart mid-flight. */
export function recoverChats() {
  for (const chat of Object.values(db.chats || {})) {
    for (const m of chat.messages) if (m.status === "running") { m.status = "error"; m.error = "The server restarted before this reply finished."; }
  }
  save();
}
