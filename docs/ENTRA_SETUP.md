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

### 리디렉션 URI — ✅ 이미 등록 완료 (추가 작업 없음)

SPA 플랫폼에 세 호스트가 **모두 끝 슬래시 없이** 등록돼 있습니다:

```
https://mbtruck-cvdata.startruckkorea.com     ← 이 사이트
https://sam-afab.startruckkorea.com
https://mbtruck-spec.startruckkorea.com
```

Entra 는 리디렉션 URI 를 **문자열 그대로** 비교합니다. 그래서
[js/auth.js](js/auth.js) 는 `window.location.origin` 을 그대로 씁니다 —
`origin` 에는 슬래시가 붙지 않으므로 위 등록값과 정확히 일치합니다.

> ⚠️ `redirectUri` 에 `+ "/"` 를 붙이면 그것만으로 `AADSTS50011` 이 납니다.
> 등록값을 바꾸지 않는 한 origin 그대로 두세요.

로컬 개발도 하려면 `http://localhost:8000` 을 (역시 슬래시 없이) 추가하면 됩니다.

## 2. 접근 제어

**데이터는 SharePoint 에만 있습니다.** 레포에는 숫자가 단 한 줄도 커밋되지 않습니다
(`docs/data/`, `build/` 모두 gitignore). 레포가 public 이어도 유출될 데이터가 없습니다.

1. **로그인 게이트** — [js/auth.js](js/auth.js) 는 **모든 호스트에서** 로그인을 요구하고
   (localhost 포함), `ALLOWED_DOMAINS`(`hyosung.com`, `startruckkorea.com`) 계정만
   통과시킵니다. 토큰이 없으면 읽을 데이터 자체가 없으므로 게이트를 우회할 이유가 없습니다.
2. **실제 권한 = SharePoint** — Graph 가 강제합니다. `mbtruck-cvdata` 폴더 접근 권한이
   없는 계정은 로그인에 성공해도 403 을 받고 아무 숫자도 보지 못합니다.
   즉 대시보드 열람 권한 관리 = **SharePoint 폴더 권한 관리** 입니다.

## 3. 데이터 경로

```
https://startruckkorea.sharepoint.com/sites/STK-PMM
  └ Shared Documents / mbtruck-cvdata /
      ├── (KAIDA / KAMA / CV 원본 xlsx)
      └── site_data /        ← 브라우저가 읽는 유일한 소스
            manifest.json, kaida_*.json, kama_*.json, cvdata_*.json
```

[js/data.js](js/data.js) 는 페이지 로드 시 `site_data/manifest.json` 을 읽습니다.
실패하면 **폴백 없이 오류를 표시**합니다 — 오래된 숫자를 조용히 보여주지 않습니다.
사이드바 하단에 연결 상태가 뜹니다 (`SharePoint` / `데이터 연결 실패`).

## 4. 데이터 갱신 (관리자 PC)

```powershell
python tools/auth_setup.py        # 최초 1회 — device code 로그인, .msal_cache.json 생성
python tools/sharepoint_sync.py   # SharePoint 원본 xlsx -> raw_data/
python tools/build_site.py        # raw_data/ -> build/data/*.json  (gitignore, 스테이징)
python tools/publish_data.py      # build/data/*.json -> SharePoint site_data/
```

**`publish_data.py` 가 곧 배포입니다** — git push 는 데이터에 아무 영향이 없습니다.
업로드에는 해당 폴더 **쓰기 권한**이 필요합니다 (읽기 전용 계정은 Graph 403).

## 5. 문제 해결

| 증상 | 원인 / 조치 |
| --- | --- |
| `AADSTS50011` redirect URI mismatch | `auth.js` 의 `redirectUri` 가 등록값과 글자 단위로 같은지 확인 (슬래시 금지) |
| 팝업에 Microsoft 오류 페이지가 뜨고 닫으면 실패 | 십중팔구 리디렉션 URI 불일치. 사이트가 안내 문구를 띄웁니다 → 1번 확인 |
| 로그인 팝업이 바로 닫히고 실패 | 브라우저 팝업 차단 해제. auth.js 가 stale 상태는 자동 1회 재시도함 |
| `접근 권한 없음` 화면 | 계정 도메인이 `ALLOWED_DOMAINS` 밖. 회사 계정으로 로그인 |
| 사이드바에 `데이터 연결 실패` | 화면 상단 배너에 사유가 그대로 표시됩니다 (미로그인 / 403 / site_data 없음) |
| `site_data/manifest.json 이 없습니다` | 아직 한 번도 발행 안 됨 → 관리자가 `python tools/publish_data.py` 실행 (폴더도 자동 생성) |
| Graph 403 (열람) | 그 계정에 `mbtruck-cvdata` 폴더 **읽기** 권한 없음 → SharePoint 에서 공유 |
| Graph 403 (업로드) | 그 계정에 폴더 **쓰기** 권한 없음 |
