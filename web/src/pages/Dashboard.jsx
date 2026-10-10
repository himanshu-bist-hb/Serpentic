import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ago, pct, successRate } from "../api.js";
import { Avatar, Icon, Status, useApp, useLoad } from "../components/ui.jsx";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const { settings, account } = useApp();
  const [days, setDays] = useState(14);
  const [d] = useLoad(() => api.get(`/api/dashboard?days=${days}`), [days]);
  if (!d) return <div className="page" aria-busy="true"><div className="muted">Loading…</div></div>;

  const max = Math.max(1, ...d.perDay.map((x) => x.runs));
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const diff = d.runsToday - d.runsYesterday;
  const needsSetup = d.counts.connectors === 0;

  return (
    <main className="page">
      <section className="head">
        <div>
          <span className="eyebrow">{today}</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>
            {greeting()}{settings?.userName ? ", " : ""}
            {settings?.userName && <span className="serif" style={{ fontSize: 40 }}>{settings.userName}</span>}
          </h1>
          <p>{d.counts.liveAgents} agent{d.counts.liveAgents === 1 ? " is" : "s are"} live across {d.counts.projects} project{d.counts.projects === 1 ? "" : "s"}
            {d.counts.pendingApprovals ? <>, and <b>{d.counts.pendingApprovals}</b> run{d.counts.pendingApprovals === 1 ? " is" : "s are"} waiting for your approval.</> : "."}</p>
        </div>
        <div className="row wrap">
          <Link className="btn" to="/workflows"><Icon n="workflows" size={16} />New workflow</Link>
          <Link className="btn ink" to="/agents/new"><Icon n="plus" size={16} />Create agent</Link>
        </div>
      </section>

      {needsSetup && (
        <div className="note">
          <b>Finish setup:</b> no connectors are active yet. Add a SerpApi key to a connector so agents can search.{" "}
          <Link to="/connectors">Open Connectors →</Link>
        </div>
      )}

      <section className="grid g4">
        <div className="card stat"><span className="eyebrow">Live agents</span><span className="v tnum">{d.counts.liveAgents}<small>of {d.counts.agents}</small></span><span className="hint">{d.counts.draftAgents} draft · {d.counts.pausedAgents} paused</span></div>
        <div className="card stat"><span className="eyebrow">Workflow runs today</span><span className="v tnum">{d.runsToday}<small>runs</small></span><span className="hint">{diff === 0 ? "Same as yesterday" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than yesterday`}</span></div>
        <div className="card stat"><span className="eyebrow">SerpAPI searches</span>
          <span className="v tnum">{account?.connected ? account.used?.toLocaleString() : d.localSearches}<small>{account?.connected ? `of ${account.limit?.toLocaleString()}` : "this month"}</small></span>
          <span className="hint">{account?.connected ? `${account.plan} plan` : "Activate a connector to see your plan"}</span></div>
        <Link to="/approvals" className="card stat" style={{ color: "inherit" }}><span className="eyebrow">Awaiting approval</span><span className="v tnum" style={{ color: d.counts.pendingApprovals ? "var(--amber-d)" : undefined }}>{d.counts.pendingApprovals}<small>pending</small></span>
          <span className="hint">{d.oldestPending ? `Oldest waiting ${ago(d.oldestPending).replace(" ago", "")}` : "Nothing waiting"}</span></Link>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <div className="card">
          <div className="card-h">
            <div><h2>Workflow runs</h2><span className="hint tnum">{d.runsTotal} runs in the last {days} days{d.successRate != null && <> · <b>{pct(d.successRate)}</b> succeeded</>}</span></div>
            <div className="seg" role="group" aria-label="Range">
              {[7, 14, 30].map((n) => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n}D</button>)}
            </div>
          </div>
          <div style={{ padding: "8px 20px 20px" }}>
            <div className="chart" role="img" aria-label={`Runs per day over the last ${days} days`}>
              {d.perDay.map((x, i) => (
                <div className="col-b" key={x.date} title={`${x.date}: ${x.runs} runs`}>
                  <div className={`bar ${i === d.perDay.length - 1 ? "today" : ""}`} style={{ height: `${(x.runs / max) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="row mono" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              <span>{new Date(d.perDay[0].date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span><span>Today</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h2>Live activity</h2></div>
          <div className="feed" style={{ marginTop: 10 }}>
            {d.events.length === 0 && <div className="muted" style={{ padding: "20px" }}>No runs yet. Open a workflow and press Test run.</div>}
            {d.events.slice(0, 6).map((e) => (
              <div key={e.runId}>
                <span className="dot" style={{ background: e.status === "failed" ? "var(--red)" : e.status === "waiting" ? "var(--amber)" : e.status === "running" ? "var(--accent)" : "var(--green)" }} />
                <div className="grow">
                  <div style={{ fontSize: 13.5 }}><b style={{ fontWeight: 500 }}>{e.text}</b> <Status s={e.status} /></div>
                  <span className="hint">{ago(e.at)}</span>
                </div>
                {e.kind === "workflow" && <Link to={`/workflows`} className="btn sm">Open</Link>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <div className="card" style={{ gridColumn: "span 1" }}>
          <div className="card-h"><div><h2>Top agents</h2><span className="hint">Ranked by completed runs</span></div><Link to="/agents" className="btn sm">All agents</Link></div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            {d.topAgents.length === 0 ? <div className="muted" style={{ padding: 20 }}>Agents appear here after their first run.</div> : (
              <table className="t">
                <thead><tr><th>Agent</th><th>MCP servers</th><th>Runs</th><th>Success</th><th>Last run</th></tr></thead>
                <tbody>{d.topAgents.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/agents/${a.id}`} className="row" style={{ color: "inherit" }}><Avatar agent={a} size="sm" /><span><b style={{ fontWeight: 500 }}>{a.name}</b><br /><span className="hint">{a.role}</span></span></Link></td>
                    <td><div className="tools">{a.connectorNames.map((n) => <span className="tag" key={n}>{n}</span>)}</div></td>
                    <td className="tnum">{a.runs}</td><td className="tnum">{pct(successRate(a))}</td><td className="muted">{ago(a.lastRunAt)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h"><div><h2>MCP servers</h2><span className="hint">Availability</span></div><Link to="/connectors" className="btn sm">Manage</Link></div>
          <div style={{ padding: "8px 8px 12px" }}>
            {d.connectors.map((c) => (
              <div key={c.id} className="row" style={{ padding: "8px 12px", borderRadius: 10 }}>
                <span className="grow" style={{ fontWeight: 500 }}>{c.name}</span>
                <span className="hint tnum">{c.tools ?? "–"} tools</span>
                <Status s={c.status} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
