# CV Data Dashboard — Static Edition

상용차 등록·시장 분석 통합 리포트 — Streamlit 버전을 **GitHub Pages 정적 사이트**로
재구현한 버전. 동일한 KAIDA · KAMA · CV_DATA 리포트를 인터랙티브 HTML로 제공한다.

- 호스팅: **GitHub Pages** — `main` 브랜치 `/docs` 폴더, https://mbtruck-cvdata.startruckkorea.com
- 인증: **브라우저 MSAL** (Entra SPA, 기존 앱 `9b247088-…` 재사용)
- 데이터: **SharePoint 전용** — 브라우저가 로그인 사용자 권한으로 Graph 호출
- 차트: **Plotly.js** (self-host, 사내망 CDN 차단 대응)
- 집계: 과거 연도는 **Python**(`tools/`), 당해년도 월간 갱신은 **브라우저**(SheetJS)
- 다국어: 한국어 / English 토글 (`docs/i18n/translations.json`)
- 필터 상태: URL query string에 보존 (공유 가능한 링크)

서버도 GitHub Actions도 client secret도 쓰지 않는다. 설정 상세는
[docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md).

---

## 데이터가 흐르는 방식

```
SharePoint  sites/STK-PMM → Shared Documents/mbtruck-cvdata/
   ├── KAIDA/ KAMA/ CV_Data/   ← 원본 xlsx
   │      │
   │      │ 폴더 다운로드(zip) → raw_data/    ※ 확정 연도는 1회로 끝
   │      ↓
   │   (1) build_site.py → build/data/*.json
   │      │
   └── site_data/ ←(2) 사이트 "데이터 발행" 페이지에서 업로드
          │
          └──Graph(위임 토큰)──→ 브라우저   ← 화면은 오직 여기만 읽는다
```

**레포에는 숫자가 커밋되지 않는다.** `raw_data/`, `build/`, `docs/data/` 는 모두
gitignore 대상이고, 화면은 SharePoint `site_data/` 만 읽는다. 읽지 못하면
오래된 값을 보여주는 대신 **오류를 표시**한다.

따라서 **(2) 발행이 곧 배포**다 — git push 는 데이터에 영향이 없다.
열람 권한 관리 = SharePoint 폴더 권한 관리.

업로드가 Python 이 아니라 브라우저에서 이뤄지는 이유는, 이 앱 등록의
"Allow public client flows" 가 꺼져 있어 Python 쪽 인증이 전부 `AADSTS7000218`
로 거부되기 때문이다. `tools/auth_setup.py` · `sharepoint_sync.py` ·
`publish_data.py` 는 그 설정을 켜야만 동작한다 —
[docs/ENTRA_SETUP.md](docs/ENTRA_SETUP.md) 4장 참고.

---

## 구조

```
CV_data_git/
├─ tools/
│   ├─ build_site.py           # raw_data/*.xlsx → build/data/*.json 집계
│   ├─ auth_setup.py           # (미사용) device-code 로그인 — public client flows 필요
│   ├─ sharepoint_sync.py      # (미사용) MS Graph → raw_data/ 동기화
│   ├─ publish_data.py         # (미사용) build/data/*.json → SharePoint
│   ├─ kaida_processor.py      # KAIDA Excel 파서 (Streamlit 원본 포팅)
│   ├─ kama_processor.py       # KAMA Excel 파서
│   ├─ cv_data_loader.py       # CV_DATA Excel 로더
│   └─ make_logo_assets.py     # 브랜드 PDF → SVG/favicon
├─ docs/                       # GH Pages가 publish하는 디렉토리
│   ├─ index.html              # 메인 (시장 인사이트)
│   ├─ pages/                  # segment · kama · overview · bestselling
│   │                          #  · cargo · price · body
│   │                          #  · access (접속 권한) · publish (데이터 발행)
│   │                          #  · translate
│   │                          #  · refresh (월간 갱신)
│   ├─ css/style.css
│   ├─ js/
│   │   ├─ auth.js             # MSAL 로그인 게이트 + 토큰 broker
│   │   ├─ access.js           # 권한 등급(Admin/Read/NA) 게이트 + 명부 발행
│   │   ├─ graph.js            # Graph 래퍼 (SharePoint 읽기/쓰기)
│   │   ├─ data.js             # SharePoint 전용 데이터 로더
│   │   ├─ i18n.js             # 다국어 toggle + t()/tdata()
│   │   ├─ state.js            # URL query 기반 필터 state
│   │   ├─ charts.js           # Plotly.js 차트 헬퍼
│   ├─ kaida-build.js      # KAIDA xlsx 집계 (kaida_processor.py 이식)
│   ├─ kama-build.js       # KAMA xlsx 집계 (kama_processor.py 이식)
│   ├─ loading.js          # 첫 방문 로딩 오버레이
│   │   ├─ sidebar.js          # 공용 사이드바
│   │   └─ format.js           # 숫자/퍼센트 포매터
│   ├─ vendor/                 # plotly · msal-browser · xlsx (self-host)
│   ├─ assets/                 # MB 로고 · favicon
│   ├─ i18n/translations.json  # ko/en 번역
│   ├─ CNAME                   # mbtruck-cvdata.startruckkorea.com
│   └─ ENTRA_SETUP.md          # 로그인·SharePoint 설정 문서
├─ requirements.txt
└─ README.md
```

---

## 매달 갱신 — 사이트에서 (권장)

당해년도 KAIDA · KAMA 는 **브라우저가 SharePoint 원본을 직접 읽어** 집계한다.
PC 에 파일을 내려받을 필요도, Python 을 돌릴 필요도 없다.

1. SharePoint `mbtruck-cvdata/KAIDA/{연도}/` 에 그 달 xlsx 를 올린다
   (KAMA 는 `KAMA/{연도}/Monthly{연도}-{MM}.xlsx`)
2. 사이트 → **관리 → 월간 갱신** → 연도 선택 → `원본 찾기` → `집계 실행`
3. 현재 발행값과의 차이를 확인하고 → `발행`

집계 로직은 [docs/js/kaida-build.js](docs/js/kaida-build.js) ·
[docs/js/kama-build.js](docs/js/kama-build.js) 로, `tools/` 의 Python 파서를
이식한 것이다. 두 구현은 2017–2026 전 연도에서 **동일한 JSON** 을 낸다.
어느 한쪽을 고치면 다른 쪽도 같이 고쳐야 한다.

필요 권한은 `mbtruck-cvdata` 폴더 **쓰기** 뿐이므로, 관리자 PC 설정 없이
여러 명이 나눠 맡을 수 있다.

> KAIDA 워크북 중에는 dimension 레코드가 실제보다 작게 적힌 파일이 있다
> (2026-07 본 파일은 103행짜리 시트에 `A1:V9` 로 기록됨). SheetJS 는 그 값을
>믿기 때문에 `sheetGrid()` 가 실제 셀 범위를 다시 계산한다 — openpyxl 은
> 셀을 훑으므로 Python 쪽에서는 드러나지 않던 문제다.

---

## 전체 재빌드 (Python — 과거 연도 / CV_DATA)

CV_DATA 는 연 1회라 아래 경로를 그대로 쓰고, 과거 연도를 다시 만들 때도
마찬가지다.

### 데이터 갱신 (관리자)

### 원본 xlsx 가져오기

OneDrive 클라이언트를 쓰지 않으므로 SharePoint 폴더 동기화는 불가능하다.
SharePoint 화면에서 `KAIDA` · `KAMA` 폴더를 선택해 **다운로드**(zip)한 뒤,
`raw_data/` 에 아래 구조 그대로 풀어 넣는다.

```
raw_data/
  KAIDA/KAIDA/{year}/        2017 … 현재
  KAIDA/KAIDA-Dump/{year}/   2017 … 2025 (2026부터 덤프가 본 파일에 통합)
  KAMA/{year}/               Monthly{year}-{01..12}.xlsx
  CV_Data/{year}/            2020 …
```

확정 연도는 다시 바뀌지 않으니 **한 번만** 받으면 되고, 이후로는 진행 연도
파일만 갱신하면 된다.

폴더가 `raw_data/` 가 아닌 다른 곳에 있다면 `--raw` 로 지정하거나
`CV_RAW_DIR` 에 넣어둔다 — WebDAV 로 매핑한 SharePoint 경로도 그대로 쓸 수
있다(`\\startruckkorea.sharepoint.com@SSL\DavWWWRoot\...`), 다만 인증이
자주 풀리고 대용량에서 느리다.

```powershell
[Environment]::SetEnvironmentVariable('CV_RAW_DIR', 'D:\경로\mbtruck-cvdata', 'User')
```

### 매 갱신

1. JSON 생성
   ```powershell
   pip install -r requirements.txt
   python tools/build_site.py        # raw_data(또는 $CV_RAW_DIR) → build/data/*.json
   ```
   KAMA 는 파일당 1~2.5초가 걸린다 — 10개년 전체 재빌드는 3~5분.
2. 사이트 → **관리 → 데이터 발행** → `build/data` 폴더를 끌어다 놓고 발행

발행 페이지는 현재 SharePoint 에 올라가 있는 파일과 최종 수정 시각을 함께
보여주므로, 무엇이 언제 갱신됐는지 그 화면에서 바로 확인할 수 있다.
발행에는 `mbtruck-cvdata` 폴더 **쓰기 권한**이 필요하다 (없으면 Graph 403).

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

[docs/js/auth.js](docs/js/auth.js) — Entra SPA + PKCE, `localStorage` 캐시. PC 는 팝업 로그인, 모바일(터치 기기·앱 내 브라우저)은 전체 화면 리디렉션 로그인 — 휴대폰 브라우저는 페이지 자체를 팝업 창으로 여는 경우가 많고, MSAL 은 팝업 안에서 팝업을 열지 않습니다(`block_nested_popups`). 팝업이 막히면 PC 에서도 리디렉션으로 넘어갑니다
(멀티페이지 사이트라 페이지 이동마다 재로그인하지 않도록).

- 허용 도메인: `hyosung.com`, `startruckkorea.com` (`ALLOWED_DOMAINS`)
- 특정 사용자만 허용하려면 `ALLOWED_USERS` 에 이메일을 넣으면 그쪽이 우선한다
- 리디렉션 URI 는 `window.location.origin` — Entra 등록값과 **글자 단위로** 같아야 한다

### 권한 등급 — Admin / Read / NA

도메인 통과 후 **개인별 권한**을 다시 확인한다 ([docs/js/access.js](docs/js/access.js)).
명부는 관리자만 여는 SharePoint 폴더에 있고, 일반 사용자는 그 폴더를 열지 않는다.

```
(관리자만)  mbtruck-cvdata/Access/*.xlsx      C열 이름 · G열 이메일 · H열 권한
                     │  관리 → 접속 권한 화면에서 읽어 발행
                     ↓
(모든 사용자) mbtruck-cvdata/site_data/access.json   ← 로그인 게이트가 읽는 파일
```

| H열 | 뜻 | 볼 수 있는 것 |
|---|---|---|
| `Admin` · `관리자` | 관리자 | 전체 — **CV DATA** · **관리**(접속 권한 · 데이터 발행 · 월간 갱신 · 번역편집) 포함 |
| `Read` · `읽기` · `일반` | 일반 | 대시보드 · 수입 상용차(KAIDA) · 국내 상용차(KAMA) |
| `NA` · 빈칸 · **명부에 없음** | 불가 | 사내 계정으로 로그인해도 차단 |

CV DATA 는 아직 테스트 버전이라 관리자에게만 보인다.

발행되는 `access.json` 에는 **이메일도 이름도 들어가지 않는다** — 주소마다
`SHA-256(salt|이메일)` 해시와 등급만 담기고, 브라우저는 로그인한 본인 주소를
같은 방식으로 해시해서 자기 등급을 찾는다. 대시보드를 볼 수 있는 사람이
`site_data` 를 열어도 직원 명부가 되지 않는다. NA 는 **파일에 없는 것**으로 표현한다.

**권한 바꾸는 절차**

1. `Access` 폴더의 xlsx 를 고친다 (관리자만 접근 가능한 폴더 그대로 둔다)
2. 사이트 → **관리 → 접속 권한** → `명부 읽기` → 인원수·등급 확인 → `발행`
3. 사용자 브라우저는 최대 **1시간** 캐시한다(`localStorage`,`cvdata.cache.access`).
   즉시 반영이 필요하면 해당 사용자가 사이드바 **데이터 새로 고침**을 누르면 된다

발행 화면은 **자기 자신이 관리자가 아닌 명부는 발행을 거부한다** — 그대로 올리면
그 화면을 다시 열 사람이 없어지기 때문이다. 그래도 막혔을 때를 위해
`access.js` 의 `FALLBACK_ADMIN_HASHES` 계정은 **`access.json` 이 없을 때만**
관리자로 들어온다(현재 `sunghan.cho@hyosung.com`). 발행된 파일이 있으면
그 파일이 우선이므로 상시 백도어가 아니다.

명부 읽기가 일시적으로 실패하면 그 브라우저가 **마지막으로 읽은 목록**을 기한 없이
재사용한다 — 한 번도 못 읽은 브라우저는 캐시가 없으니 그대로 차단된다.

관리자 전용 페이지(`access` · `publish` · `refresh` · `translate` 와 CV DATA 5개
페이지)는 `requireAdmin()` 으로 스스로도 막으므로, 사이드바에서 메뉴가 숨겨진 것과
별개로 URL 직접 입력도 막힌다.

> 이것도 UX 계층이다. 실제 경계는 여전히 SharePoint 폴더 권한이며, `NA` 로 적어도
> 그 사람이 `mbtruck-cvdata` 폴더 자체에 권한이 있다면 원본 데이터는 볼 수 있다.
> 완전히 막으려면 SharePoint 권한도 함께 조정해야 한다.

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
