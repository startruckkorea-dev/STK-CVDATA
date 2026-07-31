# 로그인 · SharePoint 연동 설정

이 사이트는 **백엔드 서버가 없습니다.** GitHub Pages 정적 호스팅 + 브라우저 MSAL 로그인 +
브라우저에서 직접 호출하는 Microsoft Graph 로만 동작합니다.
(Client secret 없음, GitHub Actions secret 없음, 세션/쿠키 없음)

## 1. Entra 앱 — 새로 등록하지 않습니다

기존 앱을 **그대로 재사용**합니다. SAM-AFAB / mbtruck-spec 이 쓰는 것과 동일한 앱입니다.

| 항목 | 값 |
| --- | --- |
| Client ID | `9b247088-5afb-4622-9c5e-b5f27142761d` |
| Tenant ID | `19cab1f5-21f4-44df-8ac6-96d6ca595203` |
| 플랫폼 | Single-page application (SPA) |

위임 권한 `User.Read`, `Sites.ReadWrite.All`, `Files.ReadWrite.All` 은 **이미 관리자 동의가
완료**되어 있으므로 추가 권한 요청·동의 절차가 없습니다.

### 딱 한 가지 필요한 작업 — 리디렉션 URI 추가

Azure Portal → Microsoft Entra ID → 앱 등록 → 위 앱 → **인증(Authentication)** →
Single-page application 플랫폼에 아래 한 줄을 추가하고 저장:

```
https://mbtruck-cvdata.startruckkorea.com/
```

> **끝의 슬래시가 중요합니다.** Entra 는 리디렉션 URI 를 문자열 그대로 비교하고,
> [js/auth.js](js/auth.js) 는 `window.location.origin + "/"` 를 씁니다.
> 슬래시가 없으면 `AADSTS50011: redirect URI mismatch` 로 로그인이 막힙니다.

로컬 개발도 하려면 `http://localhost:8000/` 을 함께 추가하면 됩니다.

## 2. 접근 제어

두 겹입니다.

1. **화면 게이트** — [js/auth.js](js/auth.js) 의 `PROTECTED_HOSTS` 에 있는 호스트
   (`mbtruck-cvdata.startruckkorea.com`) 에서만 로그인을 요구하고,
   `ALLOWED_DOMAINS` (`hyosung.com`, `startruckkorea.com`) 계정만 통과시킵니다.
   localhost / `*.github.io` 에서는 로그인 없이 열립니다.
2. **실제 보안 경계 = SharePoint** — 정적 사이트의 게이트는 UX 용일 뿐이고,
   레포가 public 이므로 `docs/data/*.json` 은 URL 만 알면 누구나 받을 수 있습니다.
   진짜 권한은 Graph 가 강제합니다: `mbtruck-cvdata` 폴더 접근 권한이 없는 계정은
   로그인에 성공해도 Graph 403 을 받고 SharePoint 데이터를 읽지 못합니다.

**비공개로 유지해야 하는 수치는 `docs/data/` 에 커밋하지 말고 SharePoint 에만 두세요.**

## 3. 데이터 경로

```
https://startruckkorea.sharepoint.com/sites/STK-PMM
  └ Shared Documents / mbtruck-cvdata /
      ├── (KAIDA / KAMA / CV 원본 xlsx)
      └── site_data /        ← 브라우저가 읽는 빌드 결과 JSON
            manifest.json, kaida_*.json, kama_*.json, cvdata_*.json
```

[js/data.js](js/data.js) 는 페이지 로드 시 `site_data/manifest.json` 을 한 번 탐색해서
읽히면 **SharePoint 모드**, 실패하면 **레포 번들 모드**(`docs/data/*.json`) 로 고정합니다.
사이드바 하단에 현재 소스가 표시됩니다 (`SharePoint 실시간` / `저장본 데이터`).

## 4. 데이터 갱신 (관리자 PC)

```powershell
python tools/auth_setup.py        # 최초 1회 — device code 로그인, .msal_cache.json 생성
python tools/sharepoint_sync.py   # SharePoint 원본 xlsx -> raw_data/
python tools/build_site.py        # raw_data/ -> docs/data/*.json
python tools/publish_data.py      # docs/data/*.json -> SharePoint site_data/
```

`publish_data.py` 까지 돌리면 **git push 없이** 모든 사용자에게 즉시 반영됩니다.
번들 폴백까지 함께 갱신하려면 `docs/data/` 변경분을 커밋해서 push 하면 됩니다.
업로드에는 해당 폴더 **쓰기 권한**이 필요합니다 (읽기 전용 계정은 Graph 403).

## 5. 문제 해결

| 증상 | 원인 / 조치 |
| --- | --- |
| `AADSTS50011` redirect URI mismatch | 1번의 리디렉션 URI를 **끝 슬래시 포함**해서 등록 |
| 로그인 팝업이 바로 닫히고 실패 | 브라우저 팝업 차단 해제. auth.js 가 stale 상태는 자동 1회 재시도함 |
| `접근 권한 없음` 화면 | 계정 도메인이 `ALLOWED_DOMAINS` 밖. 회사 계정으로 로그인 |
| 사이드바에 `저장본 데이터` 로 표시 | SharePoint 읽기 실패. 콘솔 경고 확인 — 대개 폴더 권한 없음(403) 또는 `site_data/` 미생성(404) |
| Graph 404 | `site_data` 폴더가 아직 없음 → `python tools/publish_data.py` 실행 시 자동 생성 |
| Graph 403 (업로드) | 해당 계정에 폴더 쓰기 권한 없음 |
