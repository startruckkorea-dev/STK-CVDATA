# CV Data Dashboard — Static Edition

상용차 등록·시장 분석 통합 리포트 — Streamlit 버전을 **GitHub Pages 정적 사이트**로
재구현한 버전. 동일한 KAIDA · KAMA · CV_DATA 리포트를 인터랙티브 HTML로 제공한다.

- 호스팅: **GitHub Pages** — `main` 브랜치 `/docs` 폴더, https://mbtruck-cvdata.startruckkorea.com
- 인증: **브라우저 MSAL** (Entra SPA, 기존 앱 `9b247088-…` 재사용)
- 데이터: **SharePoint 전용** — 브라우저가 로그인 사용자 권한으로 Graph 호출
- 차트: **Plotly.js** (self-host, 사내망 CDN 차단 대응)
- 다국어: 한국어 / English 토글 (`docs/i18n/translations.json`)
- 필터 상태: URL query string에 보존 (공유 가능한 링크)

서버도 GitHub Actions도 client secret도 쓰지 않는다. 설정 상세는
[docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md).

---

## 데이터가 흐르는 방식

```
SharePoint  sites/STK-PMM → Shared Documents/mbtruck-cvdata/
   ├── 원본 xlsx  ──┐
   └── site_data/ ←─┼── (3) publish_data.py 업로드
          ↑         │
          │         └── (1) sharepoint_sync.py → raw_data/
          │                    (2) build_site.py → build/data/*.json
          │
   브라우저 ──Graph(위임 토큰)──┘   ← 화면은 오직 여기만 읽는다
```

**레포에는 숫자가 커밋되지 않는다.** `raw_data/`, `build/`, `docs/data/` 는 모두
gitignore 대상이고, 화면은 SharePoint `site_data/` 만 읽는다. 읽지 못하면
오래된 값을 보여주는 대신 **오류를 표시**한다.

따라서 **`publish_data.py` 실행이 곧 배포**다 — git push 는 데이터에 영향이 없다.
열람 권한 관리 = SharePoint 폴더 권한 관리.

---

## 구조

```
CV_data_git/
├─ tools/
│   ├─ auth_setup.py           # 1회 device-code 로그인 → .msal_cache.json
│   ├─ sharepoint_sync.py      # MS Graph → raw_data/ 동기화
│   ├─ build_site.py           # raw_data/*.xlsx → build/data/*.json 집계
│   ├─ publish_data.py         # build/data/*.json → SharePoint site_data/
│   ├─ kaida_processor.py      # KAIDA Excel 파서 (Streamlit 원본 포팅)
│   ├─ kama_processor.py       # KAMA Excel 파서
│   ├─ cv_data_loader.py       # CV_DATA Excel 로더
│   └─ make_logo_assets.py     # 브랜드 PDF → SVG/favicon
├─ docs/                       # GH Pages가 publish하는 디렉토리
│   ├─ index.html              # 메인 (시장 인사이트)
│   ├─ pages/                  # segment · kama · overview · bestselling
│   │                          #  · cargo · price · body · translate
│   ├─ css/style.css
│   ├─ js/
│   │   ├─ auth.js             # MSAL 로그인 게이트 + 토큰 broker
│   │   ├─ graph.js            # Graph 래퍼 (SharePoint 읽기/쓰기)
│   │   ├─ data.js             # SharePoint 전용 데이터 로더
│   │   ├─ i18n.js             # 다국어 toggle + t()/tdata()
│   │   ├─ state.js            # URL query 기반 필터 state
│   │   ├─ charts.js           # Plotly.js 차트 헬퍼
│   │   ├─ sidebar.js          # 공용 사이드바
│   │   └─ format.js           # 숫자/퍼센트 포매터
│   ├─ vendor/                 # plotly · msal-browser (self-host)
│   ├─ assets/                 # MB 로고 · favicon
│   ├─ i18n/translations.json  # ko/en 번역
│   ├─ CNAME                   # mbtruck-cvdata.startruckkorea.com
│   └─ ENTRA_SETUP.md          # 로그인·SharePoint 설정 문서
├─ requirements.txt
└─ README.md
```

---

## 데이터 갱신 (관리자 PC)

```powershell
pip install -r requirements.txt
python tools/auth_setup.py        # 최초 1회 — device code 로그인
python tools/sharepoint_sync.py   # SharePoint 원본 xlsx → raw_data/
python tools/build_site.py        # raw_data/ → build/data/*.json
python tools/publish_data.py      # build/data/*.json → SharePoint site_data/
```

`publish_data.py` 는 `--dry-run` 으로 업로드 목록만 먼저 확인할 수 있다.
업로드에는 `mbtruck-cvdata` 폴더 **쓰기 권한**이 필요하다 (없으면 Graph 403).

`.msal_cache.json` 의 refresh token 은 약 90일 유효하다. 만료되면
`auth_setup.py` 를 다시 실행한다.

---

## 로컬 실행

```powershell
python -m http.server -d docs 8000
# → http://localhost:8000
```

로그인은 **로컬에서도 요구된다** — 토큰이 없으면 읽을 데이터가 없기 때문이다.
따라서 Entra 앱의 SPA 리디렉션 URI 에 `http://localhost:8000` 을 (끝 슬래시 없이)
추가해야 로컬에서 화면이 뜬다.

---

## 인증 (브라우저 MSAL 게이트)

[docs/js/auth.js](docs/js/auth.js) — Entra SPA + PKCE, 팝업 로그인, `localStorage` 캐시
(멀티페이지 사이트라 페이지 이동마다 재로그인하지 않도록).

- 허용 도메인: `hyosung.com`, `startruckkorea.com` (`ALLOWED_DOMAINS`)
- 특정 사용자만 허용하려면 `ALLOWED_USERS` 에 이메일을 넣으면 그쪽이 우선한다
- 리디렉션 URI 는 `window.location.origin` — Entra 등록값과 **글자 단위로** 같아야 한다

> 정적 사이트의 로그인 게이트 자체는 UX 계층이다. 실제 보안 경계는 SharePoint 이며,
> 레포에 숫자를 커밋하지 않기 때문에 public 레포여도 노출될 데이터가 없다.

---

## i18n

`docs/i18n/translations.json` 이 기본값이고, `번역편집` 페이지에서 편집하면
SharePoint `mbtruck-cvdata/translations.json` 에 저장된다.

---

## 데이터 레이아웃 (raw_data/)

```
raw_data/
├─ KAIDA 2024/{year} KAIDA CV Registration Statistics in_{Mon}.xlsx
├─ KAIDA 2024/KAIDA CV(Dump) Registration({Mon}. {year}).xlsx
├─ KAIDA 2025/...
├─ KAMA/2024/Monthly2024-{01..12}.xlsx
├─ KAMA/2025/...
└─ {year}_CV_DATA*.xlsx
```

KAIDA 월간 보고서는 누적이라 같은 폴더에 여러 달치 파일이 있어도
`find_kaida_files()` 가 가장 늦은 달 파일 1개를 자동 선택한다.
