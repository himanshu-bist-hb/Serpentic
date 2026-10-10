async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code, status: res.status });
  return data;
}

export const api = {
  get: (u) => call("GET", u),
  post: (u, b) => call("POST", u, b || {}),
  put: (u, b) => call("PUT", u, b || {}),
  del: (u) => call("DELETE", u),
};

export const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

export const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
export const pct = (n) => (n == null ? "–" : `${(n * 100).toFixed(1)}%`);
export const successRate = (a) => (a.runs ? a.ok / a.runs : null);
