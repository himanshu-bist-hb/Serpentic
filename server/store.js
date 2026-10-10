// Tiny JSON-file database plus AES-256-GCM encryption for stored secrets.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const DB_FILE = path.join(DIR, "db.json");
const SECRET_FILE = path.join(DIR, ".secret");
fs.mkdirSync(DIR, { recursive: true });

const EMPTY = {
  settings: { userName: "", serpapiKey: "", anthropicKey: "", defaultModel: "claude-sonnet-5-5",
    llmProvider: "anthropic", azureKey: "", azureEndpoint: "", azureDeployment: "gpt-5", azureApiVersion: "2024-12-01-preview" },
  projects: [],
  agents: [],
  connectors: [], // custom MCP servers only; built-ins live in code
  workflows: [],
  runs: [],
  approvals: [],
  active: {}, // built-in connector id -> { key: encrypted SerpApi key, plan, left, limit, used }
  usage: {}, // "YYYY-MM" -> SerpApi-backed tool calls made from this app
  seeded: false,
};

export const db = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { ...structuredClone(EMPTY), ...saved, settings: { ...EMPTY.settings, ...saved.settings } };
  } catch {
    return structuredClone(EMPTY);
  }
})();

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}
export function flush() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
process.on("exit", () => {
  try { flush(); } catch {}
});

export const uid = (prefix = "") => prefix + crypto.randomBytes(5).toString("hex");
export const now = () => new Date().toISOString();

// ---- secrets ----
function secretKey() {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim(), "hex");
}

export function encrypt(plain) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((p) => (Buffer.isBuffer(p) ? p.toString("base64") : p)).join(".");
}

export function decrypt(blob) {
  if (!blob) return "";
  try {
    const [, iv, tag, ct] = blob.split(".");
    const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const mask = (k) => (k ? `${k.slice(0, 4)}${"•".repeat(12)}${k.slice(-4)}` : "");

// Effective keys: value saved in the UI wins, environment is the fallback.
export const serpapiKey = () => decrypt(db.settings.serpapiKey) || process.env.SERPAPI_API_KEY || "";
export const anthropicKey = () => decrypt(db.settings.anthropicKey) || process.env.ANTHROPIC_API_KEY || "";
export const azureKey = () => decrypt(db.settings.azureKey) || process.env.AZURE_OPENAI_API_KEY || "";
// The app always uses GPT-5 on Azure; there is no provider switch in the UI.
export const llmProvider = () => "azure";
export const llmReady = () => (llmProvider() === "azure" ? !!(azureKey() && (db.settings.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT)) : !!anthropicKey());
