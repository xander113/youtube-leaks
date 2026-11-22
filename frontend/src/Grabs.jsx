import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export const PageContext = createContext(null);
export const usePage = () => useContext(PageContext);

export const socket = io({ transports: ['websocket'], autoConnect: false, timeout: 3500 });

export class RequestError extends Error {
  constructor(response, status) {
    super(response.error || 'Try again in a moment.');
    this.status = status;
    this.details = response.details;
    this.requestId = response.requestId;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const form = body instanceof FormData;
  const headers = method === 'GET' ? {} : { 'X-Requested-With': 'YoutubeLeaks' };
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch('/api' + path, {
      method, credentials: 'include', signal, headers,
      body: body === undefined || form ? body : JSON.stringify(body)
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach the site. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({ error: 'The server sent an unexpected response.' }));
  if (!response.ok) throw new RequestError(data, response.status);
  return data;
}

export async function live(event, payload, path, opts, write = false) {
  if (socket.connected) {
    let answer;
    try { answer = await socket.timeout(write ? 10000 : 2300).emitWithAck(event, payload); }
    catch {
      if (write) throw new Error('The connection dropped. Check the comments before posting again.');
    }
    if (answer) {
      if (!answer.ok) throw new RequestError(answer, answer.status);
      return answer.data;
    }
  }
  return api(path, opts);
}

export function useResource(name, loader, events = []) {
  const current = useRef(loader);
  current.current = loader;
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState({ name: null, data: null, error: null, pending: true });
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  const eventKey = events.join(',');
  useEffect(() => {
    if (!name) return;
    const names = eventKey ? eventKey.split(',') : [];
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 90);
    };
    for (const event of ['connect', ...names]) socket.on(event, schedule);
    return () => {
      clearTimeout(timer);
      for (const event of ['connect', ...names]) socket.off(event, schedule);
    };
  }, [eventKey, name, refresh]);
  useEffect(() => {
    if (!name) return;
    const abort = new AbortController();
    setResult(value => value.name === name ? { ...value, pending: true, error: null } : { name, data: null, error: null, pending: true });
    Promise.resolve().then(() => current.current(abort.signal)).then(data => {
      if (!abort.signal.aborted) setResult({ name, data, error: null, pending: false });
    }).catch(error => {
      if (!abort.signal.aborted) setResult(value => ({ ...value, name, error, pending: false }));
    });
    return () => abort.abort();
  }, [name, version]);
  return {
    ...(result.name === name && name ? result : { data: null, error: null, pending: Boolean(name) }),
    refresh
  };
}

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const running = useRef(false);
  async function run(action) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try { await action(); }
    catch (error) { setError(error); }
    finally { setPending(false); running.current = false; }
  }
  return { pending, error, run };
}

export function formValues(event) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export function itemPath(item) {
  return `/${item.kind}/${item.id}`;
}

export function playbackPath(item, restart = false) {
  return itemPath(item) + (restart ? '?play=1&start=1' : '?play=1');
}

export function isCatalogPath(pathname) {
  return pathname === '/' || pathname === '/search' || pathname.startsWith('/series/');
}

export function viewKey(page) {
  const watcher = page.props;
  return `${watcher.id || 'guest'}:${watcher.canWatch}:${watcher.tier}:${page.paid}`;
}

export function ErrorText({ error, retry }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <span>{error.message}</span>
      {retry && <button className="button small quiet" onClick={retry}>Try again</button>}
      {error.details && <details><summary>Developer details</summary><pre>{JSON.stringify({ requestId: error.requestId, ...error.details }, null, 2)}</pre></details>}
    </div>
  );
}

export function Waiting({ children = 'Loading…' }) {
  return <p className="status" role="status">{children}</p>;
}

export function formatDate(time) {
  return time ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(time) : '';
}
