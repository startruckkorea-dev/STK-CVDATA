// First-paint loading overlay.
//
// A cold visit is slow for reasons that leave the page blank rather than
// obviously busy: 4.5MB of Plotly, the MSAL bundle, the silent-token round
// trip, then the SharePoint reads. Repeat visits hit the browser cache and
// feel instant, so the wait is invisible to anyone who has already been here —
// which is exactly how "차트가 하나도 안 보인다" got reported as a bug.
//
// The markup lives in each page's HTML, not here, so it paints while the
// parser is still working. This module only drives it.
//
// Hidden on whichever comes first: the first chart drawn (charts.js), Graph
// going idle (below), or the watchdog. Never left hanging — an error path that
// renders a banner still needs the overlay gone to show it.

const IDLE_MS = 500;      // grace after the last Graph response, for rendering
const WATCHDOG_MS = 45000; // nothing should legitimately take this long

let inflight = 0;
let settled = false;
let idleTimer = null;

const overlay = () => document.getElementById("app-loading");

/** Swap the status line. Ignored once the overlay is gone. */
export function loadingNote(text) {
  if (settled) return;
  const el = document.getElementById("app-loading-msg");
  if (el) el.textContent = text;
}

/** Take the overlay down for good. */
export function loadingFinish() {
  if (settled) return;
  settled = true;
  clearTimeout(idleTimer);
  const el = overlay();
  if (!el) return;
  el.classList.add("gone");
  // Let the fade finish before pulling it out of the layout.
  setTimeout(() => el.remove(), 300);
}

/** Called by graph.js around every Graph call. */
export function loadingBegin() {
  if (settled) return;
  inflight++;
  clearTimeout(idleTimer);
}

export function loadingEnd() {
  if (settled) return;
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) idleTimer = setTimeout(loadingFinish, IDLE_MS);
}

// Pages with no chart and no Graph call (and any path that throws before
// either) still have to end up with a usable screen.
setTimeout(loadingFinish, WATCHDOG_MS);
