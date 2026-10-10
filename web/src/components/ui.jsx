import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

/* ---------- icons ---------- */
const P = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  projects: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  agents: <><rect x="4" y="7" width="16" height="12" rx="3.5" /><path d="M12 7V4.5" /><circle cx="12" cy="3.6" r=".9" /><path d="M9.5 12.5v1M14.5 12.5v1" /></>,
  workflows: <><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="15" width="6" height="6" rx="1.5" /><path d="M6 9v3a3 3 0 0 0 3 3h6" /></>,
  connectors: <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  approvals: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M7 5l12 7-12 7z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 7v10M18 11c0 4-6 3-12 6" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  dots: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  key: <><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M16 6l3 3M14 8l2 2" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  tidy: <path d="M4 6h8M4 12h16M4 18h8" />,
  minus: <path d="M5 12h14" />,
  fit: <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 4v4.5H8M12 8v4.5l3 1.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7.5L12 13l8.5-5.5" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  chat: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" />,
  paperclip: <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  send: <path d="M4 12L20 4l-5 16-3.5-6.5z M11.5 13.5L20 4" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  chevron: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
};

export const Icon = ({ n, size = 18, sw = 1.7, className, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
    {P[n]}
  </svg>
);

export const Logo = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
    <rect width="34" height="34" rx="9" fill="#5B3DF5" />
    <path d="M23 10.5h-8.5a4 4 0 0 0 0 8h5a4 4 0 0 1 0 8H11" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="23" cy="10.5" r="2.6" fill="#F5A524" />
  </svg>
);

/* ---------- small components ---------- */
export const COLORS = ["#5B3DF5", "#E8890C", "#12A06E", "#2F6FED", "#D6453D", "#B13BB4", "#0E8A9B", "#6B7180"];

export const Avatar = ({ agent, name, color, size }) => {
  const n = name ?? agent?.name ?? "?";
  return (
    <span className={`avatar ${size || ""}`} style={{ background: color ?? agent?.color ?? "#5B3DF5" }} aria-hidden="true">
      {n.charAt(0).toUpperCase()}
    </span>
  );
};

const LABEL = { needs_key: "Needs key", succeeded: "Succeeded", waiting: "Waiting", failed: "Failed", running: "Running" };
export const Status = ({ s, label }) => (
  <span className={`status s-${s}`}>
    <i />
    {label || LABEL[s] || s.charAt(0).toUpperCase() + s.slice(1)}
  </span>
);

export const Spinner = ({ size = 16 }) => <Icon n="refresh" size={size} className="spin" />;

export const Empty = ({ title, children, action }) => (
  <div className="empty">
    <b>{title}</b>
    {children && <span style={{ maxWidth: 420 }}>{children}</span>}
    {action}
  </div>
);

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Menu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="kebab" ref={ref}>
      <button className="btn sm icon" aria-label="More actions" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n="dots" size={16} /></button>
      {open && (
        <div className="menu" role="menu">
          {items.filter(Boolean).map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Switch = ({ checked, onChange, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
);

/* ---------- markdown (small, safe: builds React nodes, never HTML) ---------- */
function inline(text, key) {
  const parts = [];
  const re = /(!\[[^\]]*\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|`[^`]+`|\{\{[\w.]+\}\}|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("![")) {
      const [, alt, url] = t.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      parts.push(<a key={`${key}${i++}`} href={url} target="_blank" rel="noreferrer noopener" className="md-img-link"><img className="md-img" src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} /></a>);
    } else if (t.startsWith("**")) parts.push(<strong key={`${key}${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={`${key}${i++}`}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("{{")) parts.push(<span key={`${key}${i++}`} className="var">{t}</span>);
    else {
      const [, label, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/);
      parts.push(<a key={`${key}${i++}`} href={url} target="_blank" rel="noreferrer noopener">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Md({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(<pre key={out.length}>{buf.join("\n")}</pre>);
    } else if (/^#{1,4}\s/.test(l)) {
      const lvl = Math.min(l.match(/^#+/)[0].length + 1, 4);
      const H = `h${lvl}`;
      out.push(<H key={out.length}>{inline(l.replace(/^#+\s*/, ""), out.length)}</H>);
      i++;
    } else if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <table key={out.length}>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, j)}</th>)}</tr></thead>
          <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, k)}</td>)}</tr>)}</tbody>
        </table>
      );
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      out.push(<L key={out.length}>{items.map((t, j) => <li key={j}>{inline(t, j)}</li>)}</L>);
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) { buf.push(lines[i++]); }
      out.push(<p key={out.length}>{inline(buf.join(" "), out.length)}</p>);
    }
  }
  return <div className="md">{out}</div>;
}

/* ---------- app context: toasts, settings, counts ---------- */
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [account, setAccount] = useState(null);
  const [counts, setCounts] = useState({});

  const toast = useCallback((msg, bad = false) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 6000 : 3200);
  }, []);

  const refresh = useCallback(async () => {
    const [s, a, d] = await Promise.all([
      api.get("/api/settings").catch(() => null),
      api.get("/api/account").catch(() => null),
      api.get("/api/dashboard?days=7").catch(() => null),
    ]);
    if (s) setSettings(s);
    if (a) setAccount(a);
    if (d) setCounts(d.counts);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ toast, settings, account, counts, refresh, setSettings }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.bad ? "bad" : ""}`}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** Load data on mount and expose reload. */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => fn().then((d) => { setData(d); setError(null); return d; }).catch((e) => { setError(e.message); }), deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, error, setData];
}

export const INDIAN_NAMES = [
  ["Aarav", "आरव"], ["Meera", "मीरा"], ["Tara", "तारा"], ["Ishaan", "ईशान"], ["Kabir", "कबीर"], ["Ananya", "अनन्या"],
  ["Rohan", "रोहन"], ["Vihaan", "विहान"], ["Ishita", "इशिता"], ["Arjun", "अर्जुन"], ["Diya", "दिया"], ["Kavya", "काव्या"],
  ["Rahul", "राहुल"], ["Priya", "प्रिया"], ["Neha", "नेहा"], ["Aditya", "आदित्य"], ["Saanvi", "सान्वी"], ["Vivaan", "विवान"],
  ["Riya", "रिया"], ["Aryan", "आर्यन"], ["Nisha", "निशा"], ["Dev", "देव"], ["Pooja", "पूजा"], ["Sameer", "समीर"],
  ["Anika", "अनिका"], ["Yash", "यश"], ["Lakshmi", "लक्ष्मी"], ["Karan", "करण"], ["Zoya", "ज़ोया"], ["Harsh", "हर्ष"],
  ["Sneha", "स्नेहा"], ["Manav", "मानव"], ["Trisha", "तृषा"], ["Veer", "वीर"], ["Pranav", "प्रणव"], ["Myra", "मायरा"],
];

export function transliterate(name) {
  const hit = INDIAN_NAMES.find(([n]) => n.toLowerCase() === name.trim().toLowerCase());
  return hit ? hit[1] : "";
}
