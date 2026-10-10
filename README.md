# Serpentic — Agent Studio

Build agents on top of SerpApi MCP servers, then chain them into workflows with conditions and approvals.

## Run

```
npm install
npm run dev        # API on :8787, UI on http://localhost:5173
# or: npm run build && npm start   -> everything on http://127.0.0.1:8787
```

Open **Connectors**, paste your SerpApi key (verified against SerpApi before it is saved) and an Anthropic key (the agents' LLM). Keys are encrypted in `data/` on this machine. `ANTHROPIC_API_KEY` / `SERPAPI_API_KEY` env vars also work.

## Layout

- `server/mcp/` — the 10 MCP servers copied from `Ken's Competition/mcp-server`, run in-process; the saved SerpApi key is handed to them. Pine Labs is not included (register it as a custom server).
- `server/connectors.js` — built-in + custom (remote Streamable HTTP) MCP connectors.
- `server/llm.js` — prompt generation and the agent tool-use loop (Claude).
- `server/workflow.js` — workflow engine (parallel branches, conditions, approval pause/resume).
- `web/` — React UI (Dashboard, Projects, Agents, Agent builder, Workflows canvas, Connectors, Approvals).
