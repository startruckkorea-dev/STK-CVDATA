// Browser MSAL gate — MS account sign-in for the static dashboard.
// Mirrors utils/auth.py from the Streamlit version, but runs entirely
// in the browser using @azure/msal-browser (auth code + PKCE on the
// SPA platform).
//
// Requires:
//   - Azure AD app registered as "Single-page application" platform
//     with the dashboard URL added to Redirect URIs.
//   - msal-browser loaded via <script> in the HTML before this module.

const CLIENT_ID = "9b247088-5afb-4622-9c5e-b5f27142761d";
const TENANT_ID = "19cab1f5-21f4-44df-8ac6-96d6ca595203";

const ALLOWED_DOMAINS = ["hyosung.com", "startruckkorea.com"];
const ALLOWED_USERS = []; // leave empty to allow anyone in the domains

// Login is required on EVERY host, localhost included. The dashboard reads its
// numbers from SharePoint through the signed-in user's Graph token and keeps no
// copy in the repo, so an un-authenticated page has nothing at all to render —
// skipping the gate anywhere would only produce an empty dashboard.
//
// Local development therefore needs its origin registered on the Entra app too
// (e.g. http://localhost:8000, no trailing slash) — see docs/ENTRA_SETUP.md.
function _loginRequired() {
  return true;
}

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    // Popup flow → redirectUri is only where MSAL posts the auth response.
    // Use the bare origin (NO page path, NO trailing slash) so a SINGLE Entra
    // SPA redirect URI covers every page of this multi-page static site.
    //
    // Entra compares redirect URIs as an EXACT string. All three hosts on this
    // registration are registered without the trailing slash:
    //   https://mbtruck-cvdata.startruckkorea.com
    //   https://sam-afab.startruckkorea.com
    //   https://mbtruck-spec.startruckkorea.com
    // so `window.location.origin` — which never carries one — matches as is.
    // Do not append "/" here; that alone is enough to fail with AADSTS50011.
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // localStorage so the sign-in persists across pages and tabs — the site is
    // multi-page (index.html + pages/*.html each boot MSAL independently), and
    // sessionStorage would force a fresh login on every navigation.
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

// A stale/aborted interaction (popup closed, refresh mid-login, tab race) can
// leave `msal.interaction.status` in storage; the next login then throws one of
// these. Clearing the cache and retrying once recovers cleanly. Mirrors the
// proven pattern from the mb-truck-spec app.
const STALE_AUTH_ERRORS = new Set([
  "hash_empty_error",
  "interaction_in_progress",
  "no_token_request_cache_error",
  "no_cached_authority_error",
]);
function _isStaleAuthError(e) {
  return !!e && STALE_AUTH_ERRORS.has(e.errorCode);
}

// Only User.Read is needed to sign in (identity). The SharePoint scopes are
// requested incrementally by getAccessToken() when a page actually calls Graph
// — asking for them at login can trigger admin-consent failures that block
// sign-in entirely. Mirrors the SAM_AFAB gate.
const LOGIN_REQUEST = {
  scopes: ["User.Read"],
};
const GRAPH_SCOPES = ["User.Read", "Sites.ReadWrite.All", "Files.ReadWrite.All"];

let _pca = null;
let _account = null;

function _client() {
  if (_pca) return _pca;
  if (typeof msal === "undefined") {
    throw new Error("msal-browser is not loaded. Add the CDN <script> tag.");
  }
  _pca = new msal.PublicClientApplication(msalConfig);
  return _pca;
}

function _emailDomain(account) {
  const email = (account.username || "").toLowerCase();
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function _isAllowed(account) {
  if (!account) return false;
  const email = (account.username || "").toLowerCase();
  if (ALLOWED_USERS.length > 0) {
    return ALLOWED_USERS.map(u => u.toLowerCase()).includes(email);
  }
  if (ALLOWED_DOMAINS.length > 0) {
    return ALLOWED_DOMAINS.includes(_emailDomain(account));
  }
  return true;
}

/**
 * Top-level auth gate. Call before any page rendering.
 * Returns the signed-in account, or null if the user needs to sign in
 * (in which case a login screen is rendered).
 */
export async function requireLogin() {
  // Without MSAL there is no token, and without a token there is no data.
  if (typeof msal === "undefined") {
    _renderError("Microsoft 로그인 라이브러리를 불러오지 못했습니다 (네트워크/CDN 차단). 관리자에게 문의하세요.");
    return null;
  }

  const pca = _client();
  await pca.initialize?.();

  // Handle the redirect back from MS login (if we're in the middle of one)
  try {
    const result = await pca.handleRedirectPromise();
    if (result && result.account) {
      pca.setActiveAccount(result.account);
    }
  } catch (e) {
    console.error("handleRedirectPromise failed", e);
    _renderError("로그인 처리 중 오류가 발생했습니다: " + e.message);
    return null;
  }

  const accounts = pca.getAllAccounts();
  if (accounts.length === 0) {
    _renderLoginScreen();
    return null;
  }
  const account = accounts[0];
  pca.setActiveAccount(account);

  if (!_isAllowed(account)) {
    _renderForbidden(account);
    return null;
  }

  _account = account;
  return account;
}

export function currentAccount() { return _account; }

/** True once requireLogin() has resolved a real (non-stub) account. Lets the
 *  data layer decide whether a Graph call is even worth attempting — on
 *  localhost / *.github.io the gate returns a stub with an empty username. */
export function isSignedIn() {
  return !!(_account && _account.username);
}

export async function signIn() {
  const pca = _client();
  await pca.initialize?.();
  try {
    const result = await pca.loginPopup(LOGIN_REQUEST);
    pca.setActiveAccount(result.account);
  } catch (e) {
    if (!_isStaleAuthError(e)) {
      _renderError("로그인에 실패했습니다: " + (e.message || e.errorCode || e),
                   _redirectUriHint(e));
      return;
    }
    // stale interaction state left in storage → clear and retry once
    try { await pca.clearCache(); } catch { /* ignore */ }
    const result = await pca.loginPopup(LOGIN_REQUEST);
    pca.setActiveAccount(result.account);
  }
  // Re-run the page's auth gate now that an account exists in localStorage.
  window.location.reload();
}

export async function signOut() {
  const pca = _client();
  const account = _account || pca.getAllAccounts()[0];
  try {
    await pca.logoutPopup({ account });
  } catch {
    // popup blocked/closed — drop local state so the gate falls back to login
    try { await pca.clearCache(); } catch { /* ignore */ }
    window.location.reload();
  }
}

/**
 * Acquire a Graph access token silently (refresh if needed).
 * Used only if the page needs to call Graph directly from the browser —
 * the default architecture has GitHub Actions pre-build JSON, so most
 * pages won't call this.
 */
export async function getAccessToken(scopes = GRAPH_SCOPES) {
  const pca = _client();
  const account = _account || pca.getAllAccounts()[0];
  if (!account) throw new Error("not signed in");
  try {
    const result = await pca.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError) {
      const result = await pca.acquireTokenPopup({ scopes, account });
      return result.accessToken;
    }
    throw e;
  }
}

/** Render a small user chip + sign-out button inside the sidebar. */
export function renderUserChip(target) {
  if (!target || !_account) return;
  const name = _account.name || _account.username;
  const chip = document.createElement("div");
  chip.className = "user-chip";
  chip.innerHTML = `
    <div class="user-info">
      <div class="user-name">${escapeHtml(name)}</div>
      <div class="user-mail">${escapeHtml(_account.username)}</div>
    </div>
    <button class="signout" type="button">Sign out</button>
  `;
  chip.querySelector("button.signout").addEventListener("click", () => signOut());
  target.appendChild(chip);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function _renderLoginScreen() {
  // Rendered before i18n loads, so the name is hardcoded here.
  const root = document.documentElement.dataset.siteRoot || ".";
  document.body.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <img class="auth-logo" src="${root}/assets/mb-logo.svg"
             alt="Mercedes-Benz Trucks" width="114" height="31" />
        <h1>한국 상용차 시장 리포트</h1>
        <p>상용차 등록·시장 분석 통합 리포트</p>
        <p class="muted">사내 Microsoft 계정으로 로그인이 필요합니다.</p>
        <button id="signin-btn" type="button">Microsoft 계정으로 로그인</button>
      </div>
    </div>`;
  document.getElementById("signin-btn").addEventListener("click", () => signIn());
}

function _renderForbidden(account) {
  document.body.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <h1>접근 권한 없음</h1>
        <p><code>${escapeHtml(account.username)}</code> 계정은 이 대시보드에 접근할 수 없습니다.</p>
        <p class="muted">허용 도메인: ${ALLOWED_DOMAINS.join(", ")}</p>
        <button id="signout-btn" type="button">다른 계정으로 로그인</button>
      </div>
    </div>`;
  document.getElementById("signout-btn").addEventListener("click", () => signOut());
}

// An unregistered redirect URI is the single most likely reason sign-in fails
// on a NEW host: Entra renders AADSTS50011 inside the popup and never posts a
// response back, so MSAL only ever sees "the user closed the popup". Rather
// than leave that dead end, spell out the fix whenever the popup ends without
// a token on a protected host.
function _redirectUriHint(e) {
  const code = (e && e.errorCode) || "";
  const looksUnregistered =
    code === "user_cancelled" ||
    code === "popup_window_error" ||
    /AADSTS50011|redirect_uri/i.test((e && e.message) || "");
  if (!looksUnregistered || !_loginRequired()) return "";
  const uri = window.location.origin;
  return `이 주소가 Entra 앱(9b247088-…)의 SPA 리디렉션 URI로 등록되지 않았을 수 있습니다.
          Azure Portal → 앱 등록 → 인증 → SPA 에 <code>${escapeHtml(uri)}</code> 가
          (끝 슬래시 없이) 있는지 확인하세요.`;
}

function _renderError(message, hint = "") {
  document.body.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <h1>오류</h1>
        <p>${escapeHtml(message)}</p>
        ${hint ? `<p class="muted">${hint}</p>` : ""}
        <button onclick="location.reload()" type="button">새로고침</button>
      </div>
    </div>`;
}
