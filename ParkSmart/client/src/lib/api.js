// Thin fetch wrapper for the ParkSmart REST API (CI-02: JSON + Bearer JWT, CI-03: /api/v1)
const BASE = '/api/v1';
const TOKEN_KEY = 'parksmart.token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
    this.offline = status === 0;
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('No connection to the ParkSmart server. Check the network and press Retry — your input is kept.', 0);
  }
  if (raw && res.ok) return res;
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized && !path.startsWith('/auth/login')) onUnauthorized(data && data.error);
    const msg = (data && data.error) || (res.status >= 500 ? 'Server error. Try again in a moment.' : `Request failed (${res.status}).`);
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

/** Download a protected file (CSV/PDF) with the auth header and save it via the browser. */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
