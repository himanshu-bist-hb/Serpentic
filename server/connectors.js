// Connectors = MCP servers. Built-ins run in-process (the SerpApi key from Settings is
// handed to them); custom ones are remote MCP endpoints spoken to over Streamable HTTP.
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, decrypt } from "./store.js";

const require = createRequire(import.meta.url);

const catalog = require("./mcp/catalog.js");

const TRAVEL = [
  { key: "flight-details", name: "Google Flights", engine: "google_flights", serp: true, desc: "Search flights and find the cheapest fares between airports." },
  { key: "flight-deals", name: "Flight Deals", engine: "google_flights_deals", serp: true, desc: "Currently discounted round-trip flight deals from an origin." },
  { key: "hotel-details", name: "Google Hotels", engine: "google_hotels", serp: true, desc: "Hotel search with prices, ratings and hotel deals." },
  { key: "hotel-reviews", name: "Hotel Reviews", engine: "google_hotels_reviews", serp: true, desc: "Guest reviews and review highlights for a hotel." },
  { key: "hotel-photos", name: "Hotel Photos", engine: "google_hotels_photos", serp: true, desc: "Hotel photos grouped by category." },
  { key: "travel-explore", name: "Travel Explore", engine: "google_travel_explore", serp: true, desc: "Where to go for given dates, with flight and hotel prices." },
  { key: "google-news", name: "Google News", engine: "google_news", serp: true, desc: "Travel news and disruption alerts." },
  { key: "tripadvisor-place", name: "Tripadvisor Places", engine: "tripadvisor", serp: true, desc: "Attractions, restaurants and hotels from Tripadvisor." },
  { key: "tripadvisor-reviews", name: "Tripadvisor Reviews", engine: "tripadvisor_place", serp: true, desc: "Place reviews and review summaries." },
].map((b) => ({ ...b, group: "Travel" }));

export const BUILTIN = [
  ...TRAVEL,
  ...catalog.SERVERS.map((s) => ({ key: s.key, name: s.name, engine: s.engine, serp: true, desc: s.desc, group: "Daily" })),
];

const modules = new Map();
export function loadModule(key) {
  if (!modules.has(key)) modules.set(key, catalog.modules[key] || require(`./mcp/${key}/tools.js`));
  return modules.get(key);
}

// Each built-in connector has its own SerpApi key. The MCP modules read the key through
// globalThis.__serpKey(), which returns the key of the connector currently being called.
const keyStore = new AsyncLocalStorage();
globalThis.__serpKey = () => keyStore.getStore();

export const isActive = (conn) => conn.kind === "custom" || !!db.active[conn.id];
export const connectorKey = (conn) => decrypt(db.active[conn.id]?.key);
export const runWithKey = (conn, fn) => keyStore.run(connectorKey(conn), fn);

export function allConnectors() {
  const builtin = BUILTIN.map((b) => ({ ...b, id: b.key, kind: "builtin" }));
  const custom = db.connectors.map((c) => ({
    id: c.id, key: c.id, group: "Custom", kind: "custom", name: c.name, engine: "custom", serp: false, desc: c.desc || c.url, url: c.url,
  }));
  return [...builtin, ...custom];
}

export const findConnector = (id) => allConnectors().find((c) => c.id === id);

// ---- remote MCP client (stateless Streamable HTTP, JSON or SSE replies) ----
let rpcId = 0;
async function rpc(conn, method, params) {
  const rec = db.connectors.find((c) => c.id === conn.id);
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const token = decrypt(rec.token);
  if (token) headers.Authorization = `Bearer ${token}`;
  const id = ++rpcId;
  const res = await fetch(conn.url, {
    method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${conn.name}: HTTP ${res.status}`);
  const text = await res.text();
  let msg;
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    const line = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).reverse()
      .find((l) => l.includes('"jsonrpc"'));
    msg = line && JSON.parse(line);
  } else {
    msg = JSON.parse(text);
  }
  if (!msg) throw new Error(`${conn.name}: empty response`);
  if (msg.error) throw new Error(msg.error.message || "MCP error");
  return msg.result;
}

const toolCache = new Map(); // connector id -> { at, tools }

export async function listTools(conn, { fresh = false } = {}) {
  if (conn.kind === "builtin") {
    return loadModule(conn.key).TOOLS.map(({ handler, ...t }) => t);
  }
  const hit = toolCache.get(conn.id);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60000) return hit.tools;
  await rpc(conn, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "serpentic", version: "0.1.0" } });
  const { tools } = await rpc(conn, "tools/list", {});
  toolCache.set(conn.id, { at: Date.now(), tools });
  return tools;
}

// Returns { text, isError }
export async function callTool(conn, name, args) {
  if (conn.kind === "builtin") {
    const tool = loadModule(conn.key).TOOLS.find((t) => t.name === name);
    if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
    const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === "");
    if (missing.length) return { text: `Missing required argument(s): ${missing.join(", ")}`, isError: true };
    if (!isActive(conn)) return { text: `${conn.name} is not active. Add its key on the Connectors page.`, isError: true };
    if (conn.serp && !connectorKey(conn)) return { text: `${conn.name} has no SerpApi key. Add it on the Connectors page.`, isError: true };
    try {
      if (conn.serp) {
        const m = new Date().toISOString().slice(0, 7);
        db.usage[m] = (db.usage[m] || 0) + 1;
      }
      return { text: JSON.stringify(await runWithKey(conn, () => tool.handler(args)), null, 2), isError: false };
    } catch (e) {
      return { text: `Error: ${e.message}`, isError: true };
    }
  }
  try {
    await rpc(conn, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "serpentic", version: "0.1.0" } });
    const r = await rpc(conn, "tools/call", { name, arguments: args });
    const text = (r.content || []).map((c) => c.text ?? JSON.stringify(c)).join("\n");
    return { text, isError: !!r.isError };
  } catch (e) {
    return { text: `Error: ${e.message}`, isError: true };
  }
}
