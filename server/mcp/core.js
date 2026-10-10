// Shared MCP plumbing: stateless Streamable HTTP (JSON responses), one server per call.
// A server module exports { SERVER_INFO, TOOLS } where each tool is
// { name, description, inputSchema, handler }.

const PROTOCOL_VERSION = "2025-03-26";

async function handleRpc(server, msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: server.SERVER_INFO,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: server.TOOLS.map(({ handler, ...t }) => t) });
    case "tools/call": {
      const tool = server.TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === "");
      if (missing.length) {
        return ok({
          isError: true,
          content: [{ type: "text", text: `Missing required argument(s): ${missing.join(", ")}` }],
        });
      }
      try {
        const result = await tool.handler(args);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
}

// Serve one MCP request for the given server module.
async function serve(server, req, res) {
  if (req.method === "GET") {
    // Health check; no server-initiated SSE stream in stateless mode.
    if ((req.headers.accept || "").includes("text/event-stream")) return res.status(405).end();
    return res.status(200).json({ ...server.SERVER_INFO, status: "ok", tools: server.TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  const responses = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || !m.method) continue;
    if (m.id === undefined) continue; // notification, no response
    responses.push(await handleRpc(server, m));
  }
  if (!responses.length) return res.status(202).end();
  return res.status(200).json(batch ? responses : responses[0]);
}

module.exports = { serve, setCors };
