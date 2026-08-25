// Shared sidebar rendering — ports utils/kaida_processor.py::render_sidebar.
import { getLang, setLang, t, applyT } from "./i18n.js";
import { renderUserChip, isAdmin } from "./auth.js";
import { refresh } from "./data.js";

const NAV = [
  {
    // The one screen written for management: the whole month in four KPIs,
    // three charts and three sentences. Everything below it is the analysis
    // those numbers came from.
    group: "executive",
    items: [
      { href: "/", key: "nav_exec_overview" },
    ],
  },
  {
    // One page per segment, each reading the same KAIDA aggregate through
    // js/segment-page.js. Replaces the old insight / segment / segment-detail
    // trio, which split one segment's story across three screens.
    group: "market_analysis",
    items: [
      { href: "/pages/seg-tractor.html", key: "nav_seg_tractor" },
      { href: "/pages/seg-cargo.html", key: "nav_seg_cargo" },
      { href: "/pages/seg-tipper.html", key: "nav_seg_tipper" },
    ],
  },
  {
    group: "import_cv",
    items: [
      { href: "/pages/kama.html", key: "nav_kama" },
    ],
  },
  {
    // Still a test build off the annual CV_DATA workbook, so it stays with the
    // admins until the numbers are trusted — hidden from read-grade accounts,
    // and the pages refuse them directly too.
    group: "cv_data",
    adminOnly: true,
    items: [
      { href: "/pages/overview.html", key: "nav_overview" },
      { href: "/pages/bestselling.html", key: "nav_bestselling" },
      { href: "/pages/cargo.html", key: "nav_cargo" },
      { href: "/pages/price.html", key: "nav_price" },
      { href: "/pages/body.html", key: "nav_body" },
    ],
  },
  {
    // Hidden from read-grade accounts (Access 명부 H열), like CV DATA above.
    // The pages behind it gate themselves too — this only keeps the menu honest.
    group: "admin",
    adminOnly: true,
    items: [
      // The monthly update runs from SharePoint in the browser; the older
      // drag-and-drop publish page stays for full rebuilds out of Python.
      { href: "/pages/access.html", key: "nav_access" },
      { href: "/pages/refresh.html", key: "nav_monthly" },
      { href: "/pages/publish.html", key: "nav_publish" },
      { href: "/pages/translate.html", key: "nav_translate" },
    ],
  },
];

/**
 * Off-canvas navigation for phones.
 *
 * The sidebar is a column of the page grid on a desktop; on a phone that
 * column becomes a full screen of menu the reader has to scroll past before
 * reaching a single number. Below the CSS breakpoint it slides in over the
 * page instead, opened from a button that stays put while the page scrolls.
 * Everything visual lives in the stylesheet — this only wires the state, so a
 * wide window never sees any of it.
 */
function _mountNavToggle(sidebar) {
  if (document.getElementById("nav-toggle")) return;   // already wired

  const btn = document.createElement("button");
  btn.id = "nav-toggle";
  btn.className = "nav-toggle";
  btn.type = "button";
  btn.setAttribute("aria-label", "메뉴");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `<span></span><span></span><span></span>`;

  const scrim = document.createElement("div");
  scrim.className = "nav-scrim";
  scrim.id = "nav-scrim";

  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    btn.setAttribute("aria-expanded", String(open));
  };

  btn.addEventListener("click", () =>
    setOpen(!document.body.classList.contains("nav-open")));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  // Tapping a destination should feel like arriving, not like being left with
  // the menu still over the page while it loads.
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  document.body.appendChild(scrim);
  document.body.appendChild(btn);
}

export function renderSidebar(activeHref = null) {
  const root = document.documentElement.dataset.siteRoot || ".";
  const sidebar = document.querySelector("aside.sidebar");
  if (!sidebar) return;

  const isActive = (href) => {
    if (!activeHref) return false;
    // "/index.html" and "/" are the same page — the executive dashboard.
    const path = activeHref.replace(/\/index\.html$/, "/");
    return path === href || (href !== "/" && path.endsWith(href));
  };

  const html = `
    <a class="brand" href="${root}/">
      <img class="brand-logo" src="${root}/assets/mb-logo-white.svg"
           alt="Mercedes-Benz Trucks" width="114" height="31" />
      <h1 data-t="app_title">한국 상용차 시장 리포트</h1>
      <div class="subtitle" data-t="app_subtitle">상용차 등록·시장 분석</div>
    </a>
    <div class="lang-toggle">
      <button data-lang="ko" class="${getLang() === "ko" ? "active" : ""}">한국어</button>
      <button data-lang="en" class="${getLang() === "en" ? "active" : ""}">English</button>
    </div>
    ${NAV.filter(grp => !grp.adminOnly || isAdmin()).map(grp => `
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
  _mountNavToggle(sidebar);
}
