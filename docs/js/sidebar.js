// Shared sidebar rendering — ports utils/kaida_processor.py::render_sidebar.
import { getLang, setLang, t, applyT } from "./i18n.js";
import { renderUserChip } from "./auth.js";
import { refresh } from "./data.js";

const NAV = [
  {
    group: "import_cv",
    items: [
      { href: "/", key: "nav_market_insight" },
      { href: "/pages/segment.html", key: "nav_segment" },
      // Reached from KAIDA 세그먼트 분석 — its own page because the brand detail
      // made that one too long to scroll.
      { href: "/pages/segment-detail.html", key: "nav_segment_detail", sub: true },
      { href: "/pages/kama.html", key: "nav_kama" },
    ],
  },
  {
    group: "cv_data",
    items: [
      { href: "/pages/overview.html", key: "nav_overview" },
      { href: "/pages/bestselling.html", key: "nav_bestselling" },
      { href: "/pages/cargo.html", key: "nav_cargo" },
      { href: "/pages/price.html", key: "nav_price" },
      { href: "/pages/body.html", key: "nav_body" },
    ],
  },
  {
    group: "admin",
    items: [
      // The monthly update runs from SharePoint in the browser; the older
      // drag-and-drop publish page stays for full rebuilds out of Python.
      { href: "/pages/refresh.html", key: "nav_monthly" },
      { href: "/pages/publish.html", key: "nav_publish" },
      { href: "/pages/translate.html", key: "nav_translate" },
    ],
  },
];

export function renderSidebar(activeHref = null) {
  const root = document.documentElement.dataset.siteRoot || ".";
  const sidebar = document.querySelector("aside.sidebar");
  if (!sidebar) return;

  const isActive = (href) => {
    if (!activeHref) return false;
    return activeHref === href || (href !== "/" && activeHref.endsWith(href));
  };

  const html = `
    <a class="brand" href="${root}/">
      <img class="brand-logo" src="${root}/assets/mb-logo.svg"
           alt="Mercedes-Benz Trucks" width="114" height="31" />
      <h1 data-t="app_title">한국 상용차 시장 리포트</h1>
      <div class="subtitle" data-t="app_subtitle">상용차 등록·시장 분석</div>
    </a>
    ${NAV.map(grp => `
      <details class="nav-group" open>
        <summary data-t="group_${grp.group}">${grp.group}</summary>
        <ul>
          ${grp.items.map(it => `
            <li>
              <a href="${root}${it.href}"
                 class="${it.sub ? "sub " : ""}${isActive(it.href) ? "active" : ""}"
                 data-t="${it.key}">${it.key}</a>
            </li>
          `).join("")}
        </ul>
      </details>
    `).join("")}
    <div class="lang-toggle">
      <button data-lang="ko" class="${getLang() === "ko" ? "active" : ""}">한국어</button>
      <button data-lang="en" class="${getLang() === "en" ? "active" : ""}">English</button>
    </div>
    <div class="data-box">
      <div class="data-source" id="data-source"></div>
      <div class="data-age" id="data-age"></div>
      <button class="data-refresh" id="data-refresh" type="button"
              data-t="action_refresh">데이터 새로 고침</button>
    </div>
  `;
  sidebar.innerHTML = html;

  sidebar.querySelector("#data-refresh").addEventListener("click", (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.removeAttribute("data-t");   // don't let applyT overwrite it
    e.currentTarget.textContent = t("action_refreshing");
    refresh();
  });

  // Filled in when data.js has decided where the numbers came from.
  document.addEventListener("datasource", (ev) => {
    const el = sidebar.querySelector("#data-source");
    if (!el) return;
    const { source, error, generatedAt } = ev.detail;
    if (source === "sharepoint") {
      el.className = "data-source live";
      el.textContent = "SharePoint";
      el.title = "Shared Documents/mbtruck-cvdata/site_data";
    } else {
      el.className = "data-source failed";
      el.textContent = "데이터 연결 실패";
      el.title = error || "";
    }
    // The build timestamp is the honest answer to "how fresh is this?" —
    // refreshing re-reads SharePoint, but the numbers there are only as new as
    // the last publish.
    const age = sidebar.querySelector("#data-age");
    if (age) {
      age.textContent = generatedAt
        ? `${generatedAt.toLocaleString("ko-KR", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
          })} 집계`
        : "";
    }
  });

  sidebar.querySelectorAll("button[data-lang]").forEach(btn => {
    btn.addEventListener("click", () => {
      setLang(btn.dataset.lang);
      sidebar.querySelectorAll("button[data-lang]").forEach(b =>
        b.classList.toggle("active", b.dataset.lang === btn.dataset.lang));
    });
  });

  renderUserChip(sidebar);
  applyT(sidebar);
}
