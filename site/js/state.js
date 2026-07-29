// URL query-string-based filter state.
// Equivalent to Streamlit's st.session_state for filter widgets, but
// shareable via the URL.

const _listeners = new Set();

export function getState() {
  const params = new URLSearchParams(window.location.search);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export function setState(patch, { replace = true } = {}) {
  const current = getState();
  const next = { ...current, ...patch };
  // Drop empty/undefined keys
  for (const k of Object.keys(next)) {
    if (next[k] === null || next[k] === undefined || next[k] === "") delete next[k];
  }
  const params = new URLSearchParams(next);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
  _notify(next);
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify(state) {
  for (const fn of _listeners) {
    try { fn(state); } catch (e) { console.error(e); }
  }
}

window.addEventListener("popstate", () => _notify(getState()));
