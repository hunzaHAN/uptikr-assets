# macserver 아키텍처

## 구성 요소

```
┌──────────────────────────── Mac mini (호스트) ────────────────────────────┐
│                                                                            │
│  Electron 메인 (electron/main.js)                                          │
│   ├─ 서버 기동 (server/index.js) ── HTTP/HTTPS + WebSocket(/ws)             │
│   ├─ 호스트 콘솔 창 ── web/ 콘솔을 로컬 토큰으로 자동 로그인                 │
│   ├─ 숨김 에이전트 창 ── web/agent.js                                        │
│   │    getDisplayMedia(desktopCapturer 자동승인) → WebRTC 송출              │
│   │    제어 데이터채널 수신 → IPC → 네이티브 입력 브리지                      │
│   └─ 네이티브 입력 브리지 (native/macserver-input, Swift)                   │
│        stdin JSON → CGEvent (마우스/키보드/스크롤/유니코드 타이핑)           │
└────────────────────────────────────────────────────────────────────────────┘
          ▲  WebSocket 시그널링 (SDP/ICE 교환)          ▲ WebRTC 미디어+데이터 (P2P)
          │                                              │
┌─────────┴───────────── 뷰어 (다른 Mac / 브라우저 / 폰) ─┴───────────────────┐
│  web/ SPA — 로그인 → 화면 재생(RTCPeerConnection) + 입력 캡처                │
│            파일 브라우저(REST) — 업로드/다운로드/미리보기                      │
└────────────────────────────────────────────────────────────────────────────┘
```

## 화면 공유 흐름 (WebRTC)

1. 뷰어가 `/ws?role=viewer` 로 접속, `screen:request` 전송.
2. 허브(server/hub.js)가 권한·정책 확인. "매번 묻기" 정책이면 호스트 콘솔에 `approval:request` 전달 후 응답 대기.
3. 승인되면 허브가 에이전트에 `screen:start` 전달.
4. 에이전트가 `getDisplayMedia`로 화면 캡처 → `RTCPeerConnection` 생성 → **Offer** 생성.
   - 코덱 선호: H.264(하드웨어) → VP9 → VP8.
   - 제어용 `DataChannel("control")` 생성.
5. 허브를 거쳐 SDP/ICE 후보를 뷰어와 교환(시그널링). 미디어는 **P2P로 직접** 흐릅니다(STUN, 필요시 TURN).
6. 뷰어는 video 트랙을 받아 재생. 입력(포인터/휠/키/텍스트)을 DataChannel로 에이전트에 전송 → 에이전트가 IPC로 네이티브 브리지에 전달 → CGEvent 주입.

좌표는 **대상 디스플레이 기준 정규화(0~1)**로 전송되어 해상도/레터박스와 무관하게 정확히 매핑됩니다.

## 입력 처리

- 브라우저 `KeyboardEvent.code` → macOS 가상 키코드 매핑(server/keymap.js, native/InputBridge.swift 양쪽 동일).
- `⌘Tab`·`⌘Space`처럼 브라우저가 가로채는 조합은 뷰어 툴바의 "단축키" 메뉴로 전송.
- 한글 등 유니코드는 `keyboardSetUnicodeString`으로 레이아웃 무관하게 타이핑.
- 수정자 키는 플래그 + 실제 keyDown/Up으로 전달해 앱이 조합을 인식.
- 세션 종료·포커스 상실 시 `release`로 눌린 키/버튼을 모두 해제(stuck key 방지).

## 파일 서버 (server/fsops.js, files.js)

- 모든 경로를 정규화 후 `realpath`가 공유 루트 안인지 검증 → **심볼릭 링크 탈출/`..` 차단**.
- 업로드는 임시파일 스트리밍 후 원자적 rename, 용량 제한, 폴더 업로드 시 하위 경로 자동 생성.
- 폴더 다운로드는 on-the-fly ZIP(archiver). 미리보기는 이미지/비디오/오디오/PDF/텍스트.
- 삭제는 Electron에서 휴지통 이동(설정) 또는 영구 삭제.

## 데이터 (server/store.js)

JSON 파일에 원자적 저장: `accounts.json`, `shares.json`, `settings.json`, `sessions.json`, 감사 로그 `audit.log`.
위치: `~/Library/Application Support/macserver` (환경변수 `MACSERVER_DATA`로 변경 가능).

## 보안 요약

- bcrypt 해시, 타이밍 안전 비교, 유저 열거 방지.
- 세션 토큰(쿠키 httpOnly + Bearer 병행), 만료/정리, 강제 로그아웃.
- 로그인 실패 시 계정+IP 잠금.
- 상태 변경 요청에 `X-MacServer` 헤더 요구(CSRF 방어).
- 화면 접속 승인 정책, 전역 제어 차단/일시정지 스위치.
- 초기 관리자 생성은 호스트(로컬) 또는 setup 토큰으로만.
