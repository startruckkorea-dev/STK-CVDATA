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

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin + window.location.pathname,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

const LOGIN_REQUEST = {
  scopes: ["User.Read", "Sites.ReadWrite.All", "Files.ReadWrite.All"],
};

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

export async function signIn() {
  await _client().loginRedirect(LOGIN_REQUEST);
}

export async function signOut() {
  const account = _account || _client().getAllAccounts()[0];
  await _client().logoutRedirect({ account });
}

/**
 * Acquire a Graph access token silently (refresh if needed).
 * Used only if the page needs to call Graph directly from the browser —
 * the default architecture has GitHub Actions pre-build JSON, so most
 * pages won't call this.
 */
export async function getAccessToken(scopes = LOGIN_REQUEST.scopes) {
  const pca = _client();
  const account = _account || pca.getAllAccounts()[0];
  if (!account) throw new Error("not signed in");
  try {
    const result = await pca.acquireTokenSilent({ scopes, account });
    return result.accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes, account });
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
  document.body.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <h1>CV Data Dashboard</h1>
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

function _renderError(message) {
  document.body.innerHTML = `
    <div class="auth-gate">
      <div class="auth-card">
        <h1>오류</h1>
        <p>${escapeHtml(message)}</p>
        <button onclick="location.reload()" type="button">새로고침</button>
      </div>
    </div>`;
}
