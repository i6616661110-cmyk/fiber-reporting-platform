import { state } from './state.js';

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    onUnauthorized();
    throw new Error('Session expired');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
