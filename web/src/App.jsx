import { useEffect, useRef, useState } from "react";
import { NavLink, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import { Icon, Logo, Avatar, useApp } from "./components/ui.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Projects from "./pages/Projects.jsx";
import Agents from "./pages/Agents.jsx";
import AgentBuilder from "./pages/AgentBuilder.jsx";
import Workflows from "./pages/Workflows.jsx";
import Connectors from "./pages/Connectors.jsx";
import Approvals from "./pages/Approvals.jsx";
import Chat from "./pages/Chat.jsx";

const NAV = [
  { group: "Build", items: [
    { to: "/", label: "Dashboard", icon: "dashboard", end: true },
    { to: "/chat", label: "Chat", icon: "chat" },
    { to: "/projects", label: "Projects", icon: "projects", count: "projects" },
    { to: "/agents", label: "Agents", icon: "agents", count: "agents" },
    { to: "/workflows", label: "Workflows", icon: "workflows", count: "workflows" },
  ] },
  { group: "Connect", items: [{ to: "/connectors", label: "Connectors", icon: "connectors", count: "connectors" }] },
  { group: "Govern", items: [{ to: "/approvals", label: "Approvals", icon: "approvals", count: "pendingApprovals", hot: true }] },
];

const TITLES = { "/": "Dashboard", "/chat": "Chat", "/projects": "Projects", "/agents": "Agents", "/workflows": "Workflows", "/connectors": "Connectors", "/approvals": "Approvals" };

function Sidebar() {
  const { counts, account, settings } = useApp();
  const pctUsed = account?.connected && account.limit ? Math.min(100, (account.used / account.limit) * 100) : 0;
  const name = settings?.userName || "You";
  return (
    <aside className="side" aria-label="Main navigation">
      <Link to="/" className="brand">
        <Logo />
        <span><b>Serpentic</b><small>Agent Studio</small></span>
      </Link>
      <div className="ws">
        <span className="badge">{name.charAt(0).toUpperCase()}</span>
        <span className="grow"><span style={{ fontSize: 13, fontWeight: 500 }}>{settings?.userName ? `${settings.userName}'s workspace` : "My workspace"}</span><small>Local · {counts.projects ?? 0} projects</small></span>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {NAV.map((g) => (
          <div className="navgroup" key={g.group}>
            <span>{g.group}</span>
            {g.items.map((it) => {
              const n = it.count ? counts[it.count] : null;
              return (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-a ${isActive ? "active" : ""}`}>
                  <Icon n={it.icon} />
                  <span>{it.label}</span>
                  {n != null && (it.hot ? n > 0 : true) && <span className={`n tnum ${it.hot ? "hot" : ""}`}>{n}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <div className="quota">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span style={{ fontSize: 12.5, color: "#E6E8EE", fontWeight: 500 }}>SerpAPI searches</span>
          <span className="tnum mono" style={{ fontSize: 11.5, color: "var(--side-mute)" }}>{account?.connected ? `${Math.round(pctUsed)}%` : "–"}</span>
        </div>
        <div className="bar"><i style={{ width: `${pctUsed}%` }} /></div>
        {account?.connected
          ? <span className="tnum" style={{ fontSize: 11.5, color: "var(--side-mute)" }}>{account.used?.toLocaleString()} of {account.limit?.toLocaleString()} this month</span>
          : <Link to="/connectors" style={{ fontSize: 11.5, color: "#A897FF" }}>Activate a connector →</Link>}
      </div>
      <div className="me">
        <span className="av">{name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
        <span className="grow"><span style={{ color: "#F2F3F6", fontSize: 13.5, fontWeight: 500, display: "block" }}>{settings?.userName || "Set your name"}</span><span style={{ fontSize: 12, color: "var(--side-mute)" }}>Owner</span></span>
      </div>
    </aside>
  );
}

function Topbar() {
  const loc = useLocation();
  const nav = useNavigate();
  const { counts } = useApp();
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => { setQ(""); }, [loc.pathname]);

  const load = async () => {
    const [a, w, c] = await Promise.all([api.get("/api/agents"), api.get("/api/workflows"), api.get("/api/connectors")]);
    setItems([
      ...a.map((x) => ({ k: "Agent", name: x.name, sub: x.role, to: `/agents/${x.id}`, color: x.color })),
      ...w.map((x) => ({ k: "Workflow", name: x.name, sub: `${x.stepCount} steps`, to: `/workflows/${x.id}` })),
      ...c.map((x) => ({ k: "Connector", name: x.name, sub: x.engine, to: "/connectors" })),
    ]);
  };
  const hits = q && items ? items.filter((i) => `${i.name} ${i.sub}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];

  const base = "/" + loc.pathname.split("/")[1];
  const title = TITLES[base] || "Dashboard";
  return (
    <header className="top">
      <nav className="crumbs" aria-label="Breadcrumb">
        <span>Workspace</span><span aria-hidden="true" style={{ color: "#B6BBC5" }}>/</span>
        <b>{title}</b>
      </nav>
      <div style={{ flex: 1 }} />
      <label className="search">
        <Icon n="search" size={16} />
        <input ref={ref} type="search" aria-label="Search" placeholder="Search agents, workflows, connectors" value={q}
          onFocus={() => !items && load()} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && hits[0] && nav(hits[0].to)} />
        <kbd>Ctrl K</kbd>
        {q && (
          <div className="results">
            {hits.length ? hits.map((h) => (
              <Link key={h.k + h.name} to={h.to}>
                {h.color ? <span className="avatar sm" style={{ background: h.color }}>{h.name[0]}</span> : <span className="tag">{h.k}</span>}
                <span className="grow"><b style={{ fontWeight: 500 }}>{h.name}</b> <span className="muted">{h.sub}</span></span>
              </Link>
            )) : <div style={{ padding: 12 }} className="muted">No matches</div>}
          </div>
        )}
      </label>
      <Link to="/approvals" className="btn icon" style={{ position: "relative", width: 40 }} aria-label={`Approvals, ${counts.pendingApprovals || 0} waiting`}>
        <Icon n="bell" />
        {counts.pendingApprovals > 0 && <span style={{ position: "absolute", top: 9, right: 10, width: 7, height: 7, borderRadius: "50%", background: "var(--amber-d)", boxShadow: "0 0 0 2px #fff" }} />}
      </Link>
    </header>
  );
}

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main-col">
        <Topbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:agentId" element={<Chat />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:id" element={<AgentBuilder />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/workflows/:id" element={<Workflows />} />
          <Route path="/connectors" element={<Connectors />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="*" element={<div className="page"><h1>Not found</h1></div>} />
        </Routes>
      </div>
    </div>
  );
}
