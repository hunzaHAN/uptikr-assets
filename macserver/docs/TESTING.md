# 테스트

## 단위 · 통합 (Node 내장 러너)

```bash
npm test
```

- `test/server.test.js` — 설정/로그인/계정/공유/파일 API, 경로 탈출·심볼릭 링크 차단, 권한 전파, 로그인 잠금, 영속성.
- `test/hub.test.js` — WebSocket 인증, WebRTC 시그널링 릴레이, 승인 정책, 강제 종료, 제어 권한 실시간 변경, 에이전트 끊김 처리.

## E2E (Playwright + Chromium)

실제 브라우저에서 에이전트(가짜 카메라)와 뷰어를 띄워 **WebRTC 화면 공유 + 입력 전달 + 파일/계정 UI**를 끝까지 검증하고 스크린샷을 남깁니다.

```bash
cd test/e2e && npm install        # playwright-core (최초 1회)
cd ../.. && node test/e2e/run.mjs # 스크린샷 → test/e2e/.out/
```

컨테이너/서버 등 디스플레이가 없는 환경에서는 사전 설치된 Chromium 경로를 지정:
```bash
CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node test/e2e/run.mjs
```

검증 항목: 설정 마법사 → 홈 → 화면 세션(1280×720 수신, 마우스/휠/키/한글 텍스트가 에이전트에 도달, 좌표 정규화) → 세션 유지/종료 → 파일 목록/업로드/미리보기/폴더 생성/탐색/그리드 → 검색 → 계정 생성 → 설정 → 게스트 로그인(권한 제한 확인).

## Electron 통합 스모크

```bash
MACSERVER_SMOKE=1 xvfb-run -a ./node_modules/.bin/electron . --no-sandbox
# SMOKE_RESULT {...} 출력: 서버 주소, 에이전트 온라인, 화면 캡처 성공, 콘솔 로드
```

실제 macOS에서는 `npm start` 후 다른 기기 브라우저로 접속해 수동 확인하세요.
