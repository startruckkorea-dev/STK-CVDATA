// Shared sidebar rendering — ports utils/kaida_processor.py::render_sidebar.
import { getLang, setLang, t, applyT } from "./i18n.js";
import { renderUserChip } from "./auth.js";

const NAV = [
  {
    group: "import_cv",
    items: [
      { href: "/", key: "nav_market_insight" },
      { href: "/pages/segment.html", key: "nav_segment" },
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
    <h1 data-t="app_title">CV Data Dashboard</h1>
    <div class="subtitle" data-t="app_subtitle">상용차 등록·시장 분석</div>
    ${NAV.map(grp => `
      <details class="nav-group" open>
        <summary data-t="group_${grp.group}">${grp.group}</summary>
        <ul>
          ${grp.items.map(it => `
            <li>
              <a href="${root}${it.href}" class="${isActive(it.href) ? "active" : ""}"
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
  `;
  sidebar.innerHTML = html;

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
