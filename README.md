# CV Data Dashboard — Static Edition

상용차 등록·시장 분석 통합 리포트 — Streamlit 버전을 **GitHub Pages 정적 사이트**로
재구현한 버전. 동일한 KAIDA · KAMA · CV_DATA 리포트를 인터랙티브 HTML로 제공한다.

- 호스팅: **GitHub Pages** (Private repo)
- 데이터 동기화: **GitHub Actions** (스케줄 cron) → SharePoint → JSON
- 차트: **Plotly.js** (Python Plotly 코드와 1:1 대응)
- 다국어: 한국어 / English 토글 (`site/i18n/translations.json`)
- 필터 상태: URL query string에 보존 (공유 가능한 링크)

---

## 구조

```
cv-data-static/
├─ .github/workflows/
│   ├─ sync-data.yml           # cron: SharePoint → raw_data/ → build_site.py → commit JSON
│   └─ deploy.yml              # push: build + GH Pages 배포
├─ tools/
│   ├─ sharepoint_sync.py      # MS Graph → raw_data/ 폴더 동기화
│   ├─ build_site.py           # raw_data/*.xlsx → site/data/*.json 집계
│   ├─ kaida_processor.py      # KAIDA Excel 파서 (Streamlit 원본 포팅)
│   ├─ kama_processor.py       # KAMA Excel 파서
│   └─ cv_data_loader.py       # CV_DATA Excel 로더
├─ site/                       # GH Pages가 publish하는 디렉토리
│   ├─ index.html              # 메인 (시장 인사이트)
│   ├─ pages/
│   │   ├─ segment.html        # KAIDA 세그먼트 분석
│   │   ├─ kama.html           # KAMA 국내 상용
│   │   ├─ overview.html       # CV_DATA 시장 개요
│   │   ├─ bestselling.html    # 베스트셀링 모델
│   │   ├─ cargo.html          # 카고차량 분석
│   │   ├─ price.html          # 가격 분석
│   │   └─ body.html           # 특장업체 분석
│   ├─ css/style.css           # 공통 CSS (KAIDA_CSS 포팅)
│   ├─ js/
│   │   ├─ i18n.js             # 다국어 toggle + t()/tdata()
│   │   ├─ state.js            # URL query 기반 필터 state
│   │   ├─ charts.js           # Plotly.js 차트 헬퍼 15종
│   │   ├─ sidebar.js          # 공용 사이드바
│   │   └─ format.js           # 숫자/퍼센트 포매터
│   ├─ data/                   # build_site.py가 생성 (gitignored)
│   │   ├─ kaida_{year}.json
│   │   ├─ kama_{year}.json
│   │   └─ cvdata_{year}.json
│   └─ i18n/translations.json  # ko/en 번역
├─ requirements.txt
└─ README.md
```

---

## 로컬 실행

### 1. 데이터 준비 (둘 중 하나)

**A. SharePoint 동기화 (실데이터):**
```bash
export GRAPH_CLIENT_ID=...
export GRAPH_CLIENT_SECRET=...
export GRAPH_TENANT_ID=19cab1f5-21f4-44df-8ac6-96d6ca595203
export SP_SITE_HOSTNAME=startruckkorea.sharepoint.com
export SP_SITE_PATH=/sites/STK-PMM
export SP_DRIVE_NAME=Documents
export SP_FOLDER_PATH=mbtruck-cvdata

python tools/sharepoint_sync.py        # → raw_data/ 채움
```

**B. 수동 복사:** Streamlit 원본의 `data/` 폴더를 그대로 `raw_data/`로 복사.

### 2. JSON 생성

```bash
pip install -r requirements.txt
python tools/build_site.py             # raw_data/*.xlsx → site/data/*.json
```

### 3. 정적 서버

```bash
cd site
python -m http.server 8050
# → http://localhost:8050
```

---

## GitHub 배포

### 1. Private repo 생성

```bash
gh repo create cv-data-static --private --source=. --push
```

### 2. Azure AD 앱 한 번만 설정 변경

App registration `9b247088-5afb-4622-9c5e-b5f27142761d`:

- **Authentication → SPA platform → Redirect URIs**에 다음 URL 추가:
  - 사내 커스텀 도메인 (예: `https://mbtruck-cvdata.startruckkorea.com`)
  - 로컬 개발용 `http://localhost:8050`
- **Authentication → Advanced settings → Allow public client flows: Yes**
  (refresh-token 방식으로 GitHub Actions가 SharePoint에 접근하기 위해 필요)

기존 Delegated 권한 (`User.Read`, `Sites.ReadWrite.All`, `Files.ReadWrite.All`)
은 그대로 사용한다. 새로 권한을 추가할 필요 없음.

### 3. SharePoint 동기화용 refresh token 생성 (1회)

```bash
python tools/auth_setup.py
```

브라우저에 표시된 URL과 코드를 입력해 회사 MS 계정으로 로그인하면,
`.msal_cache.json` 이 만들어지고 **base64 문자열**이 출력된다. 그 문자열을
**GitHub Actions secret `MSAL_CACHE_B64`** 에 그대로 붙여넣는다.

| Secret 이름 | 값 |
|---|---|
| `MSAL_CACHE_B64` | `auth_setup.py` 출력 |
| `GRAPH_CLIENT_ID` | (선택, 기본값 사용 시 생략) |
| `GRAPH_TENANT_ID` | (선택, 기본값 사용 시 생략) |

> Refresh token은 약 90일 동안 유효하다. 만료되면 `auth_setup.py`를 다시
> 실행해 새 값을 secret에 갱신한다.

### 4. GitHub Pages + 커스텀 도메인

Settings → Pages:
- Source: **GitHub Actions**
- **Custom domain**: 사내 URL (예: `mbtruck-cvdata.startruckkorea.com`)
- DNS: 회사 도메인의 CNAME을 `<org>.github.io`로 향하게 설정

### 5. 첫 실행

`.github/workflows/sync-data.yml`이 매일 06:00 KST (= 21:00 UTC)에
SharePoint를 읽어 JSON을 갱신하고 GH Pages를 재배포한다. 수동 트리거는
Actions 탭 → "Sync data and deploy" → "Run workflow".

---

## 인증 (브라우저 MSAL 게이트)

대시보드 진입 시 브라우저에서 **MS 계정 로그인**을 강제한다 ([site/js/auth.js](site/js/auth.js)).
Streamlit 버전 `utils/auth.py`와 동일한 SPA + PKCE 흐름을 MSAL Browser SDK로
재구현했다.

- 도메인 화이트리스트: `hyosung.com`, `startruckkorea.com`
  ([site/js/auth.js](site/js/auth.js)의 `ALLOWED_DOMAINS` 수정)
- 허용 도메인 외 계정은 자동으로 차단됨
- 로그인 정보는 `sessionStorage`에 저장 (브라우저 탭 종료 시 사라짐)

> GitHub Pages 자체는 누구나 접근 가능한 공개 URL이지만, 페이지가 로딩되는
> 즉시 MSAL 게이트가 동작해 사내 계정 외에는 데이터에 접근하지 못한다.
> 추가 방어가 필요하면 Private repo + GitHub Pages Private 옵션을 병행할 수 있다.

---

## i18n

`site/i18n/translations.json`이 단일 진실원. 키 추가/수정은 직접 JSON 편집
또는 PR로 진행. (Streamlit의 `번역편집` 페이지처럼 GH Pages 안에서 편집할
방법은 없음 — 정적 사이트의 한계.)

---

## Streamlit 버전과의 차이

| 영역 | Streamlit | Static |
|---|---|---|
| 호스팅 | startruckkorea.com 서버 | GitHub Pages (Private) |
| 인증 | MSAL SSO + allowlist | GitHub repo permission |
| 데이터 | 매 요청 SharePoint sync | 1일 1회 cron → JSON commit |
| 필터 | `st.selectbox` 등 rerun | URL query string + JS |
| 번역편집 페이지 | 인터랙티브 editor | JSON 파일 PR로 수정 |
| 메일 발송 | `/me/sendMail` | (미지원) |

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
`find_kaida_files()`가 가장 늦은 달 파일 1개를 자동 선택한다.
