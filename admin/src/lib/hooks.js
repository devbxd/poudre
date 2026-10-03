import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api.js';

/** Loads `path` and reloads when it changes. Returns { data, error, loading, reload, setData }. */
export function useFetch(path, { keep = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setState((s) => ({ data: keep ? s.data : null, error: null, loading: true }));
    try {
      const data = await api.get(path);
      if (id === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [path, keep]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

/** Filters stored in the URL so they survive refresh and back button. */
export function useFilters(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const values = { ...defaults };
  for (const [k, v] of params.entries()) values[k] = v;
  const set = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '' || v === defaults[k]) next.delete(k);
        else next.set(k, v);
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]); // eslint-disable-line
  return [values, set];
}

// Settings are shared by many screens; load them once per session
let settingsPromise = null;
export function loadSettings(force = false) {
  if (!settingsPromise || force) settingsPromise = api.get('/admin/settings').catch((e) => { settingsPromise = null; throw e; });
  return settingsPromise;
}
export function useSettings() {
  const [s, setS] = useState(null);
  useEffect(() => { loadSettings().then(setS).catch(() => {}); }, []);
  return s;
}
