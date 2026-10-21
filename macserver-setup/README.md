# 새 맥미니 서버 세팅 키트

새 맥미니를 **항상 켜져 있고, 어디서든 접속·컨트롤되고, 정전 뒤에도 혼자 복구되는 서버**로 만드는 키트입니다.
`setup.sh` 하나를 터미널에서 실행하면 아래가 전부 자동으로 됩니다. 사람이 하는 건 비밀번호 입력과 "확인" 클릭뿐입니다.

| 항목 | 자동 처리 내용 |
|---|---|
| 개발 도구 | Xcode Command Line Tools, Rosetta 2, Homebrew, git/tmux/rsync/jq/node/python |
| 이름 | 호스트명 `macserver` (어디서든 `ssh macserver`), 시간대 Asia/Seoul |
| 전원 | 절대 잠들지 않음, **정전 복구 시 자동 재시작**, 시스템 멈춤 시 자동 재시작, Wake-on-LAN, App Nap 끔 |
| 원격 접속 | SSH(원격 로그인) + 화면 공유 켬, 방화벽 켬 |
| 업데이트 | macOS 업데이트가 **멋대로 재부팅하지 못하게** 막음 (보안 패치는 자동 유지) |
| 자동 로그인 | 정전 후 사람 없이 로그인 세션까지 올라와서 서비스가 뜸 |
| Tailscale | 포트포워딩·공인 IP 없이 iPhone/노트북 어디서든 SSH, 화면 공유, HTTPS |
| Claude Code | 설치 + 로그인마다 tmux 안에서 `claude remote-control` 자동 실행 → Claude 앱에서 맥미니 세션 선택 |
| macserver | launchd 서비스 등록: 부팅 시 자동 실행, 죽으면 10초 안에 재시작, 로그 보관·로테이션, (선택) Tailscale HTTPS 노출 |
| 파일 이전 | `setup.sh migrate` 로 예전 맥미니 홈 폴더 전체를 rsync (끊겨도 다시 실행하면 이어서 복사), 예전 맥의 Homebrew 앱 목록도 가져와서 자동 복원 |

---

## 0. 준비물

- 새 맥미니 + 모니터/키보드 (처음 한 번만. 끝나면 모니터 없이 운영 가능)
- 예전 맥미니 (같은 네트워크에 켜 두기)
- Tailscale 계정 (무료, Google/GitHub/Apple 로그인으로 바로 생성됨) → https://login.tailscale.com
- 선택: HDMI 더미 플러그 1~2만원. 모니터 없이 쓸 때 화면 공유가 저해상도·느려지는 걸 막아 줌
- 선택: 소형 UPS. 정전 자동 재시작은 되지만, UPS가 있으면 디스크 손상 위험이 줄어듦

---

## 1. 새 맥미니 첫 부팅 (설정 지원 화면) — 클릭만

1. 언어/지역/Wi-Fi 평소처럼.
2. **"다른 Mac에서 정보 전송" (마이그레이션 지원)** 이 나오면 **선택하세요.** ← 파일·앱·계정·설정 전체를 가장 깔끔하게 가져오는 방법입니다.
   - 예전 맥미니에서 `응용 프로그램 > 유틸리티 > 마이그레이션 지원` 실행 → "다른 Mac으로" 선택
   - 두 맥이 같은 Wi-Fi/이더넷이면 자동으로 보임. Thunderbolt 케이블로 직결하면 훨씬 빠름
   - 전송 항목: 사용자 계정, 응용 프로그램, 기타 파일 전부 체크 → 전송 (수십 분~수 시간)
   - 이걸 하면 예전 맥의 사용자 이름·비밀번호·`~/macserver` 폴더가 그대로 넘어옵니다
3. **FileVault는 체크 해제.** 켜 두면 정전 뒤 비밀번호를 칠 때까지 서버가 안 올라옵니다. (물리적으로 안전한 집/사무실이면 끄는 게 맞습니다)
4. Apple ID 로그인 (iCloud 파일은 알아서 다시 동기화됨)
5. 바탕화면이 뜨면 끝. 마이그레이션을 건너뛰었다면 아래 5번의 `migrate` 로 파일을 가져옵니다.

---

## 2. 스크립트를 새 맥미니로 가져오기

아래 중 편한 것 하나:

- **A. 이 Claude 세션의 파일 카드에서 다운로드** → `~/Downloads/setup.sh` 를 `~/setup.sh` 로 이동
- **B. AirDrop** 으로 예전 맥/아이폰에서 보내기
- **C. GitHub 브랜치에 올려 두면 한 줄** (올려 달라고 하면 바로 푸시해 드립니다):
  ```bash
  curl -fsSL https://raw.githubusercontent.com/hunzaHAN/uptikr-assets/macserver-setup/macserver-setup/setup.sh -o ~/setup.sh
  ```

---

## 3. 설정값 정하기 (macserver 부분만 알려주면 됨)

`setup.sh` 상단의 설정 블록을 고치거나, 실행할 때 환경변수로 넘깁니다. 꼭 필요한 건 **시작 명령** 하나입니다. 비워 두면 실행 중에 물어봅니다.

```bash
export SERVER_NAME=macserver                 # 호스트명 = Tailscale 이름
export MACSERVER_DIR="$HOME/macserver"       # macserver 코드 위치 (마이그레이션했으면 이미 있음)
export MACSERVER_INSTALL_CMD="npm ci"        # 의존성 설치 (없으면 비움)
export MACSERVER_START_CMD="npm start"       # ★ 서버 시작 명령 (예: ./macserver --port 8080 / python3 server.py)
export MACSERVER_PORT=8080                   # macserver가 듣는 포트 (있으면 Tailscale HTTPS로 노출 + 상태 체크)
export MACSERVER_EXPOSE=serve                # serve = 내 기기들만 / funnel = 공개 인터넷 / none
export MACSERVER_GIT_URL=""                  # 폴더가 없을 때만 clone
```

- macserver가 **GUI·AppleScript·키체인**을 건드린다면 기본값(`MACSERVER_SCOPE=agent`, 자동 로그인 ON) 그대로 두세요.
- 순수 백엔드라 로그인 전에도 떠야 하면 `MACSERVER_SCOPE=daemon`.

---

## 4. 실행 — 입력이 필요한 순간은 5번뿐

```bash
bash ~/setup.sh
```

| 순서 | 화면에 뜨는 것 | 할 일 |
|---|---|---|
| 1 | `Password:` | 맥 로그인 비밀번호 1회 (이후엔 다시 안 물음) |
| 2 | 할 일 목록 + `계속할까요? [Y/n]` | Enter |
| 3 | (CLT 팝업이 뜨는 경우만) "명령어 라인 개발자 도구" | **설치** 클릭. 보통은 팝업 없이 자동 설치됨 |
| 4 | `'사용자' 로그인 비밀번호 (자동 로그인 등록용)` | 비밀번호 1회 (화면에 안 보임, 저장 안 됨) |
| 5 | `https://login.tailscale.com/a/xxxx` | 아무 기기에서 열고 **Connect/승인** 클릭 |
| 6 | (시작 명령을 안 정했을 때) `시작 명령:` | 예: `npm start` |
| 끝 | 완료 요약 + 다음 할 일 | — |

실행 시간은 보통 10~20분 (CLT·Homebrew 다운로드가 대부분). 중간에 끊겨도 **다시 실행하면 이미 된 건 건너뜁니다.**

끝나고 한 번:
```bash
claude          # 첫 로그인 (브라우저 승인 1회) → 이후 재부팅마다 remote-control 자동
```

---

## 5. 예전 맥미니 파일 가져오기 (1번에서 마이그레이션 지원을 안 했을 때)

예전 맥미니에서 **시스템 설정 > 일반 > 공유 > 원격 로그인** 켜기 (1클릭). 그리고 새 맥에서:

```bash
bash ~/setup.sh migrate --dry-run     # 뭐가 복사될지 먼저 보기
bash ~/setup.sh migrate               # 실제 복사 (예전 맥 비밀번호 1회 → 이후 키 접속)
bash ~/setup.sh                       # 가져온 ~/Brewfile 로 앱/패키지 복원 + macserver 등록
```

- 주소는 `예전맥이름.local`, IP, 또는 예전 맥에도 Tailscale이 있으면 그 이름.
- 홈 폴더 전체를 복사하되 캐시·휴지통·iCloud(다시 동기화됨)·샌드박스 앱 데이터·메일/메시지/키체인(마이그레이션 지원 전용)은 제외합니다. 필요하면 `setup.sh` 의 `ex=(...)` 목록을 수정하세요.
- `/Applications` 의 앱은 rsync로 옮기지 않습니다. Homebrew로 깐 앱은 Brewfile로 자동 복원되고, 나머지는 마이그레이션 지원이나 재설치가 안전합니다.

| | 마이그레이션 지원 (1번) | `setup.sh migrate` |
|---|---|---|
| 가져오는 것 | 계정·앱·설정·파일 전부 | 홈 폴더 파일 (+Homebrew 목록) |
| 시점 | 첫 부팅 때가 제일 쉬움 (나중에도 가능) | 아무 때나, 반복 실행 가능 |
| 추천 | **처음 한 번** | 이후 추가 동기화, 또는 선택적 복사 |

---

## 6. 검증 + 정전 테스트

```bash
bash ~/setup.sh verify     # 점검표: sleep=0, autorestart=1, SSH ON, 화면공유 ON, 자동로그인=사용자, OS자동설치=0, Tailscale, macserver 상태
sudo reboot                # 재부팅 테스트 → 2~3분 뒤 다른 기기에서 ssh 사용자@macserver
```

그다음 **전원 케이블을 뽑았다가 다시 꽂아** 보세요. 혼자 켜지고 → 자동 로그인 → macserver가 떠야 합니다. 다른 기기에서 `ssh 사용자@macserver 'bash ~/setup.sh status'` 로 확인.

---

## 7. 밖에서 접속·컨트롤하기

모든 기기에 Tailscale 앱을 깔고 같은 계정으로 로그인하면 끝입니다. 공유기 설정, 공인 IP, DDNS 전부 필요 없습니다.

| 하고 싶은 것 | 방법 |
|---|---|
| 터미널 | `ssh 사용자@macserver` (맥북 터미널, iPhone은 Termius/Blink). Tailscale SSH라 키 관리도 필요 없음 |
| 화면 보기/조작 | 맥: Finder `⌘K` → `vnc://macserver`. iPhone/iPad: Screens 또는 Jump Desktop → 주소 `macserver` |
| Claude로 지시 | Claude 앱 → 세션 목록에서 `macserver` 선택 (remote-control). "폴더 확인해줘", "서비스 재시작해줘" 같은 걸 바로 시킬 수 있음 |
| macserver 웹 UI | `MACSERVER_PORT` 설정 시 `https://macserver.<tailnet>.ts.net` (serve = 내 기기만, funnel = 공개) |
| 파일 주고받기 | `scp`, 또는 Finder `⌘K` → `smb://macserver` (파일 공유를 켠 경우) |

---

## 8. 운영 명령

```bash
bash ~/setup.sh status      # macserver 상태 (pid, 마지막 종료코드, 포트 응답)
bash ~/setup.sh logs        # 로그 실시간 보기 (~/Library/Logs/macserver/)
bash ~/setup.sh restart     # 재시작
bash ~/setup.sh stop        # 중지 (재부팅하면 다시 뜸)
bash ~/setup.sh macserver   # 시작 명령·포트 바꾼 뒤 다시 등록:  MACSERVER_START_CMD='...' bash ~/setup.sh macserver
bash ~/setup.sh verify      # 전체 점검표
tmux attach -t claude       # 자동 실행 중인 claude remote-control 화면 보기 (나오기: Ctrl-b d)
sudo softwareupdate -ia --restart   # OS 업데이트는 내가 원할 때
```

설정은 `~/.config/macserver-setup/env` 에 저장되어 다음 실행 때 자동으로 읽힙니다. 실행 로그는 `~/Library/Logs/macserver-setup/`.

---

## 9. 자주 막히는 것

- **"화면 공유/원격 로그인이 안 켜졌다"** 경고가 뜨면: 시스템 설정 > 일반 > 공유 에서 해당 토글 1클릭. 최신 macOS는 일부를 GUI에서만 허용합니다.
- **"Terminal이 로컬 네트워크의 기기를 찾으려고 합니다"** 팝업 (macOS 15+): 허용. `migrate` 로 `.local` 주소에 붙을 때 뜹니다.
- **자동 로그인이 건너뛰어졌다**: FileVault가 켜져 있는 겁니다. `sudo fdesetup disable` 후 복호화가 끝나면 `bash ~/setup.sh` 재실행.
- **Tailscale**: 이 키트는 Homebrew의 오픈소스 `tailscaled` 를 시스템 데몬으로 깝니다 (로그인 전에도 올라오고 Tailscale SSH 지원). App Store의 Tailscale 앱을 **추가로 깔지 마세요** (충돌).
- **funnel 실패**: 처음엔 Tailscale 관리콘솔에서 Funnel 허용이 필요합니다. 명령이 안내 URL을 출력합니다.
- **macserver가 계속 재시작**: `bash ~/setup.sh logs` 로 stderr 확인. 시작 명령이 PATH 문제면 절대경로로 (`/opt/homebrew/bin/node server.js`).
- **모니터 없이 화면 공유가 느리다**: HDMI 더미 플러그.
- **다시 처음부터**: 스크립트는 몇 번 실행해도 안전합니다. 서비스 해제만 하려면 `launchctl bootout gui/$UID/com.hunza.macserver` 후 `~/Library/LaunchAgents/com.hunza.macserver.plist` 삭제.

---

## 10. 솔직한 한계

- 이 키트는 리눅스 환경에서 작성·문법 검증·plist 생성 테스트까지 했고, **실제 macOS에서 끝까지 돌려 보지는 못했습니다.** 그래서 모든 단계가 실패해도 멈추지 않고 "수동으로 어디를 클릭하면 되는지"를 출력한 뒤 다음 단계로 넘어가도록 만들었습니다. 첫 실행 로그(`~/Library/Logs/macserver-setup/`)를 보내 주시면 바로 고쳐 드립니다.
- macserver가 어떤 프로그램인지(언어, 포트, GUI 필요 여부) 몰라서 시작 명령을 설정값으로 뺐습니다. 저장소를 알려 주시면 그 부분을 맞춤으로 박아 넣겠습니다.
