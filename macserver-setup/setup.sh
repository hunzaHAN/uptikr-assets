#!/bin/bash
# =============================================================================
#  macserver-setup/setup.sh
#  새 맥미니를 "항상 켜져 있고, 어디서든 접속/컨트롤되는 서버"로 만드는 부트스트랩
#
#  사용법 (새 맥미니 터미널에서):
#    bash setup.sh              # 전체 세팅 (처음 1회, 다시 실행해도 안전함)
#    bash setup.sh migrate      # 예전 맥미니 홈 폴더를 rsync로 가져오기 (--dry-run 가능)
#    bash setup.sh verify       # 세팅 상태 점검표
#    bash setup.sh push         # ★ 메인(예전) 맥에서 실행: macserver 폴더를 새 맥으로 보내고 새 맥에서 등록까지
#    bash setup.sh fetch        # 새 맥에서 실행: 예전 맥에서 macserver 폴더만 가져와 바로 등록
#    bash setup.sh find         # 이 맥에서 macserver 폴더 후보 찾기
#    bash setup.sh macserver    # macserver 서비스만 (재)등록  (MACSERVER_DIR=/경로 로 직접 지정 가능)
#    bash setup.sh status|logs|restart|stop|start   # macserver 운영
#
#  사람이 손댈 순간은 이것뿐:
#    1) sudo 비밀번호 1회          2) "계속할까요?" Enter
#    3) 예전 맥 주소 (또는 Enter)   4) 자동로그인용 비밀번호 1회
#    5) Tailscale 로그인 URL 열고 '승인'   6) macserver 감지 결과 확인 Enter
#    7) (선택) 'claude' 첫 로그인
# =============================================================================

# ----------------------------- 설정 (필요하면 수정) ---------------------------
# 이전 실행에서 저장한 값이 있으면 기본값으로 사용 (환경변수로 넘긴 값이 우선)
[[ -f "$HOME/.config/macserver-setup/env" ]] && . "$HOME/.config/macserver-setup/env"

SERVER_NAME="${SERVER_NAME:-macserver}"          # 호스트명 = Tailscale 이름 → ssh macserver
TIMEZONE="${TIMEZONE:-Asia/Seoul}"

MACSERVER_DIR="${MACSERVER_DIR:-$HOME/macserver}"      # macserver 코드 위치
MACSERVER_GIT_URL="${MACSERVER_GIT_URL:-}"             # 비어있으면 clone 안 함 (마이그레이션으로 이미 있을 때)
MACSERVER_INSTALL_CMD="${MACSERVER_INSTALL_CMD:-}"     # 예: "npm ci"  /  "pip install -r requirements.txt"
MACSERVER_START_CMD="${MACSERVER_START_CMD:-}"         # 예: "npm start"  /  "./macserver --port 8080"  (비우면 실행 중 물어봄)
MACSERVER_PORT="${MACSERVER_PORT:-}"                   # 예: 8080  (설정하면 Tailscale HTTPS로 노출)
MACSERVER_EXPOSE="${MACSERVER_EXPOSE:-serve}"          # serve = 내 Tailscale 기기만 / funnel = 공개 인터넷 / none
MACSERVER_SCOPE="${MACSERVER_SCOPE:-agent}"            # agent = 로그인 세션(GUI 가능, 기본) / daemon = 로그인 전에도 실행
MACSERVER_LABEL="${MACSERVER_LABEL:-com.hunza.macserver}"

BREW_FORMULAE="${BREW_FORMULAE:-git tmux rsync jq node python@3.12}"
BREW_CASKS="${BREW_CASKS:-}"                           # 예: "visual-studio-code"

INSTALL_TAILSCALE="${INSTALL_TAILSCALE:-1}"
INSTALL_CLAUDE="${INSTALL_CLAUDE:-1}"
CLAUDE_REMOTE_CONTROL="${CLAUDE_REMOTE_CONTROL:-1}"    # 로그인마다 tmux 안에서 claude remote-control 자동 실행
ENABLE_AUTOLOGIN="${ENABLE_AUTOLOGIN:-1}"
ENABLE_SCREEN_SHARING="${ENABLE_SCREEN_SHARING:-1}"
INSTALL_ROSETTA="${INSTALL_ROSETTA:-1}"

OLD_MAC_HOST="${OLD_MAC_HOST:-}"                       # migrate용: 예전 맥 주소 (old-mac.local / IP / Tailscale 이름)
OLD_MAC_USER="${OLD_MAC_USER:-$USER}"
# -----------------------------------------------------------------------------

set -uo pipefail
LOG_DIR="$HOME/Library/Logs/macserver-setup"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/setup-$(date +%Y%m%d-%H%M%S).log"
start_log() { exec > >(tee -a "$LOG") 2>&1; }

c_reset=$'\e[0m'; c_bold=$'\e[1m'; c_green=$'\e[32m'; c_yellow=$'\e[33m'; c_red=$'\e[31m'; c_blue=$'\e[34m'
step() { printf '\n%s==> %s%s\n' "$c_bold$c_blue" "$*" "$c_reset"; }
ok()   { printf '%s  ✔ %s%s\n' "$c_green" "$*" "$c_reset"; }
warn() { printf '%s  ⚠ %s%s\n' "$c_yellow" "$*" "$c_reset"; }
fail() { printf '%s  ✖ %s%s\n' "$c_red" "$*" "$c_reset"; }
die()  { fail "$*"; exit 1; }
# 프롬프트는 /dev/tty로 직접 → curl | bash 로 실행해도, 로그로 리다이렉트해도 입력 가능
ask()        { local ans; printf '%s' "$1" >/dev/tty; read -r ans </dev/tty; echo "${ans:-${2:-}}"; }
ask_secret() { local ans; printf '%s' "$1" >/dev/tty; read -rs ans </dev/tty; printf '\n' >/dev/tty; echo "$ans"; }
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' <<<"$1"; }

ARCH="$(uname -m)"
BREW=/opt/homebrew/bin/brew; [[ "$ARCH" == "x86_64" ]] && BREW=/usr/local/bin/brew
[[ -x "$BREW" ]] && eval "$("$BREW" shellenv)"
export PATH="$HOME/.local/bin:$PATH"

# ------------------------------------------------------------------ 공통
preflight() {
  [[ "$(uname -s)" == "Darwin" ]] || die "macOS 전용 스크립트입니다."
  [[ "$EUID" -ne 0 ]] || die "root 말고 일반 관리자 계정으로 실행하세요:  bash setup.sh  (sudo 붙이지 않기)"
  dseditgroup -o checkmember -m "$USER" admin >/dev/null 2>&1 || die "'$USER' 계정이 관리자(admin)가 아닙니다."
  curl -fsSIL --max-time 10 https://github.com >/dev/null 2>&1 || die "인터넷 연결이 필요합니다."
  ok "macOS $(sw_vers -productVersion) / $ARCH / 사용자 $USER"
}

need_sudo() {
  step "관리자 권한 (비밀번호 1회)"
  sudo -v </dev/tty || die "sudo 인증 실패"
  ( while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
  SUDO_KEEPALIVE_PID=$!
  trap 'kill "$SUDO_KEEPALIVE_PID" 2>/dev/null' EXIT
  ok "sudo 준비됨 (스크립트 끝날 때까지 다시 묻지 않음)"
}

show_plan() {
  local expose_desc="없음 (MACSERVER_PORT 설정 시 Tailscale HTTPS)"
  [[ -n "$MACSERVER_PORT" ]] && expose_desc="포트 $MACSERVER_PORT → tailscale $MACSERVER_EXPOSE"
  cat <<EOF

${c_bold}이 스크립트가 할 일${c_reset}
  1. Xcode Command Line Tools / Rosetta 2 / Homebrew + 기본 패키지 ($BREW_FORMULAE)
     (선택) 예전 맥미니 홈 폴더 가져오기 → 주소만 입력, 비우면 건너뜀
  2. 호스트명 '$SERVER_NAME', 시간대 $TIMEZONE
  3. 전원: 절대 잠들지 않기, 정전 복구 시 자동 재시작, 시스템 멈춤 시 자동 재시작, Wake-on-LAN
  4. 원격 접속: SSH(원격 로그인) + 화면 공유 켜기, 방화벽 켜기
  5. macOS 자동 업데이트의 임의 재부팅 막기 (보안 패치는 자동 유지)
  6. 자동 로그인 (정전 후 사람 없이 서비스가 다시 뜨도록)
  7. Tailscale → 어디서든  ssh $USER@$SERVER_NAME , 화면 공유, HTTPS
  8. Claude Code 설치 (+ 로그인 시 tmux 안에서 claude remote-control 자동 실행)
  9. macserver 를 launchd 서비스로 등록 (부팅 시 자동 실행, 죽으면 10초 내 재시작, 로그 보관/로테이션)
     - 위치/시작 명령/포트는 자동으로 찾아서 보여주고 Enter 로 확정 (${MACSERVER_START_CMD:-미지정이면 감지}) 
     - 노출: $expose_desc
  로그: $LOG
EOF
  [[ "${ASSUME_YES:-0}" == 1 ]] && return 0
  local a; a="$(ask "계속할까요? [Y/n] " Y)"
  [[ "$a" =~ ^[Yy]$ ]] || die "중단했습니다."
}

# ------------------------------------------------------------------ 1. 도구
install_clt() {
  step "Xcode Command Line Tools"
  if xcode-select -p >/dev/null 2>&1; then ok "이미 설치됨"; return 0; fi
  # 헤드리스 설치 트릭: softwareupdate 카탈로그에 CLT를 노출시켜 GUI 없이 설치
  local flag=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress label
  sudo touch "$flag"
  label="$(softwareupdate -l 2>/dev/null | grep -o 'Command Line Tools for Xcode-[0-9.]*' | sort | tail -1)"
  [[ -n "$label" ]] && sudo softwareupdate -i "$label" --verbose
  sudo rm -f "$flag"
  if ! xcode-select -p >/dev/null 2>&1; then
    warn "팝업이 뜨면 '설치'를 누르세요. 끝날 때까지 기다립니다..."
    xcode-select --install >/dev/null 2>&1 || true
    until xcode-select -p >/dev/null 2>&1; do sleep 10; done
  fi
  ok "설치 완료: $(xcode-select -p)"
}

install_rosetta() {
  [[ "$INSTALL_ROSETTA" == 1 && "$ARCH" == "arm64" ]] || return 0
  step "Rosetta 2 (인텔용 바이너리 호환)"
  if /usr/bin/pgrep -q oahd; then ok "이미 설치됨"; return 0; fi
  sudo softwareupdate --install-rosetta --agree-to-license && ok "설치 완료" \
    || warn "Rosetta 설치 실패 (나중에: sudo softwareupdate --install-rosetta --agree-to-license)"
}

install_brew() {
  step "Homebrew"
  if [[ ! -x "$BREW" ]]; then
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || die "Homebrew 설치 실패"
  fi
  ensure_shell_profile
  eval "$("$BREW" shellenv)"
  ok "$(brew --version | head -1)"

  step "기본 패키지: $BREW_FORMULAE"
  # shellcheck disable=SC2086
  brew install $BREW_FORMULAE || warn "일부 패키지 설치 실패 (로그 확인)"
  # shellcheck disable=SC2086
  [[ -n "$BREW_CASKS" ]] && { brew install --cask $BREW_CASKS || warn "일부 cask 설치 실패"; }
  return 0
}

# .zprofile 에 brew / claude 경로가 항상 있도록 (migrate 가 .zprofile 을 덮어써도 복구)
ensure_shell_profile() {
  grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null || printf '\neval "$(%s shellenv)"\n' "$BREW" >> "$HOME/.zprofile"
  grep -q '.local/bin' "$HOME/.zprofile" 2>/dev/null || printf 'export PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zprofile"
}

restore_brewfile() {
  [[ -f "$HOME/Brewfile" ]] || return 0
  step "~/Brewfile 발견 → 예전 맥의 앱/패키지 복원"
  brew bundle --file="$HOME/Brewfile" || warn "Brewfile 일부 실패 (나중에: brew bundle --file=~/Brewfile)"
  return 0
}

# setup 흐름 안에서 예전 맥 파일 가져오기 (주소를 비우면 건너뜀)
maybe_migrate() {
  [[ "${ASSUME_YES:-0}" == 1 && -z "$OLD_MAC_HOST" ]] && return 0
  step "예전 맥미니에서 파일 가져오기 (선택)"
  if [[ -z "$OLD_MAC_HOST" ]]; then
    echo "  마이그레이션 지원으로 이미 옮겼거나 나중에 할 거면 그냥 Enter."
    OLD_MAC_HOST="$(ask "  예전 맥 주소 (예: old-mac.local / 192.168.0.10, 비우면 건너뜀): " "")"
  fi
  [[ -n "$OLD_MAC_HOST" ]] || { ok "건너뜀 (나중에: bash setup.sh migrate)"; return 0; }
  migrate
  ensure_shell_profile
}

# ------------------------------------------------------------------ 2~5. 시스템
set_identity() {
  step "호스트명 '$SERVER_NAME' / 시간대 $TIMEZONE"
  sudo scutil --set ComputerName "$SERVER_NAME"
  sudo scutil --set HostName "$SERVER_NAME"
  sudo scutil --set LocalHostName "$SERVER_NAME"
  sudo defaults write /Library/Preferences/SystemConfiguration/com.apple.smb.server NetBIOSName -string "$SERVER_NAME"
  sudo dscacheutil -flushcache
  sudo systemsetup -settimezone "$TIMEZONE" >/dev/null 2>&1 || warn "시간대 설정 실패 (시스템 설정 > 일반 > 날짜와 시간)"
  sudo systemsetup -setusingnetworktime on >/dev/null 2>&1 || true
  ok "완료 (같은 네트워크에서는 $SERVER_NAME.local)"
}

set_power() {
  step "전원 / 자동 재시작"
  sudo pmset -a sleep 0 disksleep 0 displaysleep 15        # 본체는 절대 잠들지 않음, 모니터만 15분 뒤 끔
  sudo pmset -a autorestart 1                              # 정전 → 전원 복구 시 자동으로 켜짐
  sudo pmset -a womp 1                                     # Wake on LAN
  sudo pmset -a powernap 0 ttyskeepawake 1 2>/dev/null || true
  sudo pmset -a lowpowermode 0 2>/dev/null || true
  sudo systemsetup -setrestartfreeze on        >/dev/null 2>&1 || true   # 시스템 멈춤 시 자동 재시작
  sudo systemsetup -setrestartpowerfailure on  >/dev/null 2>&1 || true
  sudo systemsetup -setcomputersleep Never     >/dev/null 2>&1 || true
  sudo systemsetup -setwakeonnetworkaccess on  >/dev/null 2>&1 || true
  defaults write NSGlobalDomain NSAppSleepDisabled -bool YES                # App Nap 끄기
  ok "$(pmset -g | awk '/^ *(sleep|autorestart|womp) /{printf "%s=%s  ",$1,$2}')"
}

enable_ssh() {
  step "SSH (원격 로그인)"
  sudo systemsetup -setremotelogin on >/dev/null 2>&1 || true
  sudo launchctl enable system/com.openssh.sshd 2>/dev/null || true
  sudo launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
  if sudo launchctl print system/com.openssh.sshd >/dev/null 2>&1; then ok "SSH 켜짐"
  else warn "SSH 자동 활성화 실패 → 시스템 설정 > 일반 > 공유 > '원격 로그인' 켜기 (1클릭)"; fi
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  [[ -f "$HOME/.ssh/id_ed25519" ]] || ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" -C "$USER@$SERVER_NAME" >/dev/null
  return 0
}

enable_screen_sharing() {
  [[ "$ENABLE_SCREEN_SHARING" == 1 ]] || return 0
  step "화면 공유 (VNC)"
  sudo launchctl enable system/com.apple.screensharing 2>/dev/null || true
  sudo launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
  if sudo launchctl print system/com.apple.screensharing >/dev/null 2>&1; then ok "화면 공유 켜짐 → 다른 맥에서 Finder ⌘K: vnc://$SERVER_NAME"
  else warn "화면 공유 자동 활성화 실패 → 시스템 설정 > 일반 > 공유 > '화면 공유' 켜기 (1클릭)"; fi
}

enable_firewall() {
  step "방화벽"
  local fw=/usr/libexec/ApplicationFirewall/socketfilterfw
  sudo $fw --setglobalstate on >/dev/null
  sudo $fw --setallowsigned on >/dev/null
  sudo $fw --setallowsignedapp on >/dev/null
  sudo $fw --setstealthmode off >/dev/null
  ok "$(sudo $fw --getglobalstate)"
}

set_updates() {
  step "macOS 업데이트 정책 (멋대로 재부팅 금지, 보안 패치는 자동)"
  local p=/Library/Preferences/com.apple.SoftwareUpdate
  sudo defaults write $p AutomaticCheckEnabled -bool true
  sudo defaults write $p AutomaticDownload -bool true
  sudo defaults write $p AutomaticallyInstallMacOSUpdates -bool false
  sudo defaults write $p ConfigDataInstall -bool true
  sudo defaults write $p CriticalUpdateInstall -bool true
  sudo defaults write /Library/Preferences/com.apple.commerce AutoUpdate -bool false
  ok "완료 (OS 업데이트는 원할 때 직접:  sudo softwareupdate -ia --restart)"
}

set_autologin() {
  [[ "$ENABLE_AUTOLOGIN" == 1 ]] || return 0
  step "자동 로그인 (정전 후 사람 없이 복구)"
  if fdesetup status | grep -q "On"; then
    warn "FileVault가 켜져 있으면 자동 로그인이 안 됩니다 (정전 후 비밀번호 입력 전까지 서버가 안 뜸)."
    warn "서버용이면 끄는 걸 권장:  sudo fdesetup disable   (복호화 후 이 스크립트 다시 실행). 건너뜁니다."
    return 0
  fi
  if [[ "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)" == "$USER" ]]; then
    ok "이미 설정됨 ($USER)"; return 0
  fi
  local pw; pw="$(ask_secret "  '$USER' 로그인 비밀번호 (자동 로그인 등록용, 어디에도 저장 안 됨): ")"
  sudo sysadminctl -autologin set -userName "$USER" -password "$pw" >/dev/null 2>&1 || true
  unset pw
  if [[ "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null)" == "$USER" ]]; then ok "자동 로그인: $USER"
  else warn "자동 등록 실패 → 시스템 설정 > 사용자 및 그룹 > '자동 로그인'에서 '$USER' 선택 (1클릭)"; fi
}

# ------------------------------------------------------------------ 7. Tailscale
install_tailscale() {
  [[ "$INSTALL_TAILSCALE" == 1 ]] || return 0
  step "Tailscale (어디서든 접속, 포트포워딩 불필요)"
  brew list tailscale >/dev/null 2>&1 || brew install tailscale || { warn "tailscale 설치 실패"; return 0; }
  if [[ ! -f /Library/LaunchDaemons/com.tailscale.tailscaled.plist ]]; then
    sudo "$(brew --prefix)/bin/tailscaled" install-system-daemon || { warn "tailscaled 데몬 등록 실패"; return 0; }
    sleep 3
  fi
  if tailscale status >/dev/null 2>&1; then
    ok "이미 로그인됨"
  else
    warn "아래에 뜨는 URL을 아무 기기 브라우저에서 열고 '승인(Connect)'을 누르세요 (1회)."
    sudo tailscale up --ssh --hostname "$SERVER_NAME" --operator="$USER" --accept-dns=true </dev/tty \
      || { warn "tailscale up 실패 (나중에: sudo tailscale up --ssh --hostname $SERVER_NAME --operator=$USER)"; return 0; }
  fi
  ok "Tailscale IP: $(tailscale ip -4 2>/dev/null)   → 다른 기기에서:  ssh $USER@$SERVER_NAME"
}

expose_macserver() {
  [[ -n "$MACSERVER_PORT" && "$MACSERVER_EXPOSE" != none && "$INSTALL_TAILSCALE" == 1 ]] || return 0
  command -v tailscale >/dev/null 2>&1 || return 0
  step "macserver 포트 $MACSERVER_PORT → Tailscale HTTPS ($MACSERVER_EXPOSE)"
  if [[ "$MACSERVER_EXPOSE" == funnel ]]; then
    tailscale funnel --bg "$MACSERVER_PORT" || warn "funnel 실패 (관리콘솔 ACL에서 funnel 허용 필요: https://login.tailscale.com/admin/acls)"
  else
    tailscale serve --bg "$MACSERVER_PORT" || warn "serve 실패"
  fi
  tailscale serve status 2>/dev/null | sed 's/^/  /'
  return 0
}

# ------------------------------------------------------------------ launchd 공통
# write_launchd <gui|system> <label> <workdir> <keepalive true|false> <log-dirname> <program> [args...]
write_launchd() {
  local domain="$1" label="$2" workdir="$3" keepalive="$4" logname="$5"; shift 5
  local logdir="$HOME/Library/Logs/$logname" plist args="" a username=""
  mkdir -p "$logdir"
  for a in "$@"; do args+="    <string>$(xml_escape "$a")</string>"$'\n'; done
  [[ "$domain" == system ]] && username="  <key>UserName</key><string>$USER</string>"$'\n'
  local content
  content="$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
${args}  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$workdir")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><$keepalive/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$logdir/stdout.log</string>
  <key>StandardErrorPath</key><string>$logdir/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
    <key>LANG</key><string>ko_KR.UTF-8</string>
  </dict>
${username}</dict>
</plist>
EOF
)"
  if [[ "$domain" == system ]]; then
    plist="/Library/LaunchDaemons/$label.plist"
    printf '%s\n' "$content" | sudo tee "$plist" >/dev/null
    sudo chown root:wheel "$plist"; sudo chmod 644 "$plist"
    sudo launchctl bootout "system/$label" 2>/dev/null || true
    sudo launchctl bootstrap system "$plist" || warn "bootstrap 실패: $label (재부팅하면 자동 로드됨)"
    sudo launchctl enable "system/$label" 2>/dev/null || true
  else
    mkdir -p "$HOME/Library/LaunchAgents"
    plist="$HOME/Library/LaunchAgents/$label.plist"
    printf '%s\n' "$content" > "$plist"
    launchctl bootout "gui/$UID/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$plist" || warn "지금은 GUI 세션이 없어 못 띄움: $label (다음 로그인/재부팅 때 자동 실행)"
    launchctl enable "gui/$UID/$label" 2>/dev/null || true
  fi
  ok "등록: $plist"
}

# ------------------------------------------------------------------ 8. Claude Code
install_claude() {
  [[ "$INSTALL_CLAUDE" == 1 ]] || return 0
  step "Claude Code"
  if ! command -v claude >/dev/null 2>&1; then
    curl -fsSL https://claude.ai/install.sh | bash || { warn "Claude Code 설치 실패"; return 0; }
  fi
  ensure_shell_profile
  ok "$(claude --version 2>/dev/null || echo 'claude 설치됨')"
  warn "처음 1회 로그인 필요: 터미널에서  claude  실행 → 브라우저 로그인"
  if [[ "$CLAUDE_REMOTE_CONTROL" == 1 ]]; then
    write_launchd gui com.hunza.claude-remote "$HOME" false claude-remote \
      /bin/zsh -lc "tmux has-session -t claude 2>/dev/null || exec tmux new-session -d -s claude -c \"$HOME\" \"claude remote-control\""
    ok "로그인마다 tmux 세션 'claude'에서 remote-control 실행 (확인: tmux attach -t claude)"
  fi
}

# ------------------------------------------------------------------ 9. macserver
save_env() {
  mkdir -p "$HOME/.config/macserver-setup"
  {
    for v in SERVER_NAME MACSERVER_DIR MACSERVER_START_CMD MACSERVER_INSTALL_CMD MACSERVER_PORT MACSERVER_SCOPE MACSERVER_LABEL MACSERVER_EXPOSE; do
      printf ': ${%s:=%q}\n' "$v" "${!v}"
    done
  } > "$HOME/.config/macserver-setup/env"
}

macserver_domain() { if [[ "$MACSERVER_SCOPE" == daemon ]]; then echo system; else echo "gui/$UID"; fi; }
macserver_plist()  { if [[ "$MACSERVER_SCOPE" == daemon ]]; then echo "/Library/LaunchDaemons/$MACSERVER_LABEL.plist"; else echo "$HOME/Library/LaunchAgents/$MACSERVER_LABEL.plist"; fi; }

# ---- macserver 자동 감지: 폴더 / 시작 명령 / 설치 명령 / 포트
has_marker() {
  local d="$1"
  [[ -f "$d/package.json" || -f "$d/requirements.txt" || -f "$d/pyproject.toml" || -f "$d/go.mod" || -f "$d/Cargo.toml" \
     || -f "$d/Package.swift" || -f "$d/Makefile" || -f "$d/Dockerfile" || -f "$d/docker-compose.yml" || -d "$d/.git" ]] \
  || ls -d "$d"/*.xcodeproj "$d"/*.app "$d"/*.sh >/dev/null 2>&1
}

# 이름에 macserver / mac-server / mac_server 가 들어간 폴더를 Spotlight + find 로 전부 수집 (홈, 외장 디스크 포함)
list_macserver_candidates() {
  local c out=""
  while IFS= read -r c; do [[ -n "$c" && -d "$c" ]] && out+="$c"$'\n'; done < <(
    mdfind "kMDItemContentType == 'public.folder' && (kMDItemFSName == '*macserver*'c || kMDItemFSName == '*mac-server*'c || kMDItemFSName == '*mac_server*'c)" 2>/dev/null
    find "$HOME" /Volumes /opt /usr/local -maxdepth 5 -type d \( -iname '*macserver*' -o -iname '*mac-server*' -o -iname '*mac_server*' \) \
      -not -path '*/Library/*' -not -path '*/node_modules/*' -not -path '*/.*' -not -path '*/Backups.backupdb/*' 2>/dev/null
  )
  printf '%s' "$out" | grep -v '^$' | grep -v '/node_modules/' | sort -u
}

find_macserver_dir() {
  [[ -d "$MACSERVER_DIR" ]] && { echo "$MACSERVER_DIR"; return; }
  local c marked="" plain="" all=""
  while IFS= read -r c; do
    [[ -n "$c" ]] || continue
    if has_marker "$c"; then marked+="$c"$'\n'; else plain+="$c"$'\n'; fi
  done < <(list_macserver_candidates)
  all="$(printf '%s%s' "$marked" "$plain" | grep -v '^$')"
  [[ -n "$all" ]] || return 0
  local n; n="$(printf '%s\n' "$all" | wc -l | tr -d ' ')"
  if [[ "$n" -eq 1 && -n "$marked" ]]; then echo "$all"; return; fi
  {
    echo "  후보 폴더:"
    local i=0; while IFS= read -r c; do i=$((i+1)); printf '   %2d) %s%s\n' "$i" "$c" "$( has_marker "$c" && echo '   ← 프로젝트 표식 있음' )"; done <<<"$all"
  } >&2
  local pick; pick="$(ask "  번호를 고르거나 경로를 직접 입력 [1]: " 1)"
  if [[ "$pick" =~ ^[0-9]+$ ]]; then sed -n "${pick}p" <<<"$all"; else echo "${pick/#\~/$HOME}"; fi
}

infer_install_cmd() {
  local d="$1"
  if   [[ -f "$d/package-lock.json" ]]; then echo "npm ci"
  elif [[ -f "$d/pnpm-lock.yaml" ]];   then echo "pnpm install"
  elif [[ -f "$d/yarn.lock" ]];        then echo "yarn install"
  elif [[ -f "$d/package.json" ]];     then echo "npm install"
  elif [[ -f "$d/requirements.txt" ]]; then echo "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  elif [[ -f "$d/go.mod" ]];           then echo "go build -o macserver ."
  elif [[ -f "$d/Cargo.toml" ]];       then echo "cargo build --release"
  elif [[ -f "$d/Package.swift" ]];    then echo "swift build -c release"
  fi
}

infer_start_cmd() {
  local d="$1" f py=python3
  if [[ -f "$d/package.json" ]]; then
    grep -qE '"start"[[:space:]]*:' "$d/package.json" && { echo "npm start"; return; }
    grep -qE '"serve"[[:space:]]*:' "$d/package.json" && { echo "npm run serve"; return; }
    grep -qE '"dev"[[:space:]]*:'   "$d/package.json" && { echo "npm run dev"; return; }
    for f in server.js index.js app.js main.js dist/index.js; do [[ -f "$d/$f" ]] && { echo "node $f"; return; }; done
  fi
  [[ -f "$d/requirements.txt" ]] && py=".venv/bin/python"
  for f in server.py app.py main.py run.py; do [[ -f "$d/$f" ]] && { echo "$py $f"; return; }; done
  [[ -f "$d/go.mod" ]]        && { echo "./macserver"; return; }
  [[ -f "$d/Cargo.toml" ]]    && { echo "./target/release/$(basename "$d")"; return; }
  [[ -f "$d/Package.swift" ]] && { echo "swift run -c release"; return; }
  local app; app="$(ls -d "$d"/*.app "$d"/build/*.app 2>/dev/null | head -1)"
  [[ -n "$app" ]] && { echo "\"$app/Contents/MacOS/$(basename "$app" .app)\""; return; }
  for f in macserver bin/macserver start.sh run.sh serve.sh; do [[ -x "$d/$f" ]] && { echo "./$f"; return; }; done
  if [[ -f "$d/Makefile" ]]; then
    for t in run start serve; do grep -qE "^$t:" "$d/Makefile" && { echo "make $t"; return; }; done
  fi
  [[ -f "$d/docker-compose.yml" || -f "$d/compose.yml" ]] && command -v docker >/dev/null 2>&1 && { echo "docker compose up"; return; }
  local shs; shs="$(ls "$d"/*.sh 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$shs" == 1 ]] && { echo "bash $(basename "$d"/*.sh)"; return; }
  echo ""
}

infer_port() {
  local d="$1"
  cat "$d"/.env "$d"/.env.* "$d"/*.js "$d"/*.ts "$d"/*.py "$d"/*.json "$d"/src/*.js "$d"/src/*.ts "$d"/src/*.py "$d"/*.go "$d"/*.swift 2>/dev/null \
    | grep -oE '[Pp][Oo][Rr][Tt][^0-9]{0,15}[0-9]{4,5}' | grep -oE '[0-9]{4,5}$' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}'
}

# git clone; 비공개 GitHub 저장소면 gh 로 브라우저 로그인(클릭 1회) 후 재시도
clone_macserver() {
  local url="$1" dest="$2"
  rm -rf "$dest.partial"
  GIT_TERMINAL_PROMPT=0 git clone "$url" "$dest" 2>/dev/null && return 0
  if [[ "$url" == *github.com* ]]; then
    warn "비공개 저장소로 보입니다 → GitHub 로그인이 필요합니다 (브라우저에서 코드 입력/승인 1회)"
    command -v gh >/dev/null 2>&1 || brew install gh || return 1
    gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web </dev/tty || return 1
    gh auth setup-git >/dev/null 2>&1 || true
    rm -rf "$dest"; git clone "$url" "$dest" && return 0
  fi
  return 1
}

detect_macserver() {
  local dir inst start port a
  echo "  macserver 폴더를 찾는 중..."
  dir="$(find_macserver_dir 2>/dev/null)"
  if [[ -z "$dir" ]]; then
    if [[ -n "$MACSERVER_GIT_URL" ]]; then
      clone_macserver "$MACSERVER_GIT_URL" "$MACSERVER_DIR" && dir="$MACSERVER_DIR" || { warn "clone 실패: $MACSERVER_GIT_URL"; return 1; }
    else
      warn "이 맥에서 macserver 폴더를 못 찾았습니다 (이름에 macserver/mac-server/mac_server 가 들어간 폴더 기준)."
      echo "    - 아직 예전 맥에만 있다면:   OLD_MAC_HOST=예전맥.local bash ~/setup.sh migrate   후   bash ~/setup.sh macserver"
      echo "    - GitHub 에 있다면:          MACSERVER_GIT_URL=https://github.com/... bash ~/setup.sh macserver"
      echo "    - 이름이 다르다면 경로를 직접 입력 (Finder 에서 폴더를 터미널로 드래그하면 경로가 붙습니다)"
      dir="$(ask "  macserver 폴더 경로 (비우면 건너뜀): " "")"
      dir="${dir/#\~/$HOME}"; dir="${dir%/}"
      [[ -n "$dir" && -d "$dir" ]] || { warn "건너뜀. 나중에:  MACSERVER_DIR=/경로 bash ~/setup.sh macserver"; return 1; }
    fi
  fi
  inst="${MACSERVER_INSTALL_CMD:-$(infer_install_cmd "$dir")}"
  start="${MACSERVER_START_CMD:-$(infer_start_cmd "$dir")}"
  port="${MACSERVER_PORT:-$(infer_port "$dir")}"
  printf '\n  %-10s %s\n' "폴더:" "$dir"
  printf '  %-10s %s\n' "설치:"  "${inst:-(없음)}"
  printf '  %-10s %s\n' "시작:"  "${start:-(못 찾음 → 입력 필요)}"
  printf '  %-10s %s\n' "포트:"  "${port:-(없음)}"
  if [[ "${ASSUME_YES:-0}" == 1 && -n "$start" ]]; then a=Y; else a="$(ask "  이대로 등록할까요? [Y/n] " Y)"; fi
  if [[ ! "$a" =~ ^[Yy]$ || -z "$start" ]]; then
    dir="$(ask "  폴더 [$dir]: " "$dir")"; dir="${dir/#\~/$HOME}"
    inst="$(ask "  설치 명령 [${inst:-없음}] (없으면 '-'): " "${inst:--}")"; [[ "$inst" == "-" ]] && inst=""
    start="$(ask "  시작 명령 [${start:-예: npm start}]: " "$start")"
    port="$(ask "  포트 [${port:-없음}] (없으면 '-'): " "${port:--}")"; [[ "$port" == "-" ]] && port=""
  fi
  [[ -n "$start" ]] || { warn "시작 명령이 없어 건너뜀. 나중에:  MACSERVER_START_CMD='npm start' bash setup.sh macserver"; return 1; }
  MACSERVER_DIR="$dir"; MACSERVER_INSTALL_CMD="$inst"; MACSERVER_START_CMD="$start"; MACSERVER_PORT="$port"
  return 0
}

install_macserver() {
  step "macserver 서비스 등록"
  detect_macserver || { save_env; return 0; }
  if [[ -n "$MACSERVER_INSTALL_CMD" ]]; then
    ( cd "$MACSERVER_DIR" && /bin/zsh -lc "$MACSERVER_INSTALL_CMD" ) || warn "설치 명령 실패: $MACSERVER_INSTALL_CMD"
  fi
  local domain; domain="$(macserver_domain)"; [[ "$domain" == system ]] || domain=gui
  write_launchd "$domain" "$MACSERVER_LABEL" "$MACSERVER_DIR" true macserver \
    /bin/zsh -lc "cd \"$MACSERVER_DIR\" && exec $MACSERVER_START_CMD"
  # 로그 로테이션 (7개 보관, 10MB 넘으면 압축)
  printf '%s/Library/Logs/macserver/*.log  %s:staff  644  7  10000  *  J\n' "$HOME" "$USER" \
    | sudo tee /etc/newsyslog.d/macserver.conf >/dev/null
  save_env
  sleep 3; macserver_status
}

macserver_status() {
  local d s=""; d="$(macserver_domain)"; [[ "$d" == system ]] && s=sudo
  if $s launchctl print "$d/$MACSERVER_LABEL" >/dev/null 2>&1; then
    $s launchctl print "$d/$MACSERVER_LABEL" | grep -E 'state =|pid =|last exit' | sed 's/^[[:space:]]*/  /'
  else
    warn "macserver 서비스가 로드되어 있지 않음 ($d/$MACSERVER_LABEL) →  bash setup.sh start"
  fi
  if [[ -n "$MACSERVER_PORT" ]]; then
    if curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$MACSERVER_PORT/"; then ok "포트 $MACSERVER_PORT 응답 OK"
    else warn "포트 $MACSERVER_PORT 응답 없음 (로그: bash setup.sh logs)"; fi
  fi
  return 0
}

macserver_ctl() {
  local d s=""; d="$(macserver_domain)"; [[ "$d" == system ]] && s=sudo
  case "$1" in
    start)   $s launchctl bootstrap "$d" "$(macserver_plist)" 2>/dev/null || true
             $s launchctl kickstart "$d/$MACSERVER_LABEL" && ok "시작" ;;
    restart) $s launchctl kickstart -k "$d/$MACSERVER_LABEL" && ok "재시작" ;;
    stop)    $s launchctl bootout "$d/$MACSERVER_LABEL" && ok "중지 (재부팅/재로그인 시 다시 뜸)" ;;
    logs)    tail -n 100 -f "$HOME/Library/Logs/macserver/"*.log ;;
  esac
  [[ "$1" == logs ]] || macserver_status
}

# ------------------------------------------------------------------ migrate / fetch
ensure_old_mac_ssh() {
  local u="$1" h="$2"
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  [[ -f "$HOME/.ssh/id_ed25519" ]] || ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519" >/dev/null
  if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$u@$h" true 2>/dev/null; then
    echo "  '$u@$h' 비밀번호를 1회 입력하면 이후엔 키로 접속합니다. (팝업: Terminal의 로컬 네트워크 접근 → 허용)"
    ssh-copy-id -i "$HOME/.ssh/id_ed25519.pub" "$u@$h" </dev/tty || die "SSH 접속 실패: $u@$h  (상대 맥: 시스템 설정 > 일반 > 공유 > 원격 로그인 켜기)"
  fi
}

# 예전 맥에서 macserver 폴더 하나만 가져와서 바로 등록
fetch_macserver() {
  step "예전 맥에서 macserver 폴더만 가져오기"
  echo "  예전 맥에서 먼저: 시스템 설정 > 일반 > 공유 > '원격 로그인' 켜기 (1클릭)"
  [[ -n "$OLD_MAC_HOST" ]] || OLD_MAC_HOST="$(ask "  예전 맥 주소 (예: old-mac.local / 192.168.0.10): " "")"
  [[ -n "$OLD_MAC_HOST" ]] || die "주소가 필요합니다."
  local u="$OLD_MAC_USER" h="$OLD_MAC_HOST" src="${OLD_MAC_PATH:-}" list n c i pick
  ensure_old_mac_ssh "$u" "$h"
  if [[ -z "$src" ]]; then
    echo "  예전 맥에서 후보 폴더를 찾는 중..."
    list="$(ssh "$u@$h" "find ~ /Volumes -maxdepth 5 -type d \( -iname '*macserver*' -o -iname '*mac-server*' -o -iname '*mac_server*' \) -not -path '*/Library/*' -not -path '*/node_modules/*' -not -path '*/.*' 2>/dev/null | sort")"
    if [[ -n "$list" ]]; then
      i=0; while IFS= read -r c; do i=$((i+1)); printf '   %2d) %s\n' "$i" "$c"; done <<<"$list"
      pick="$(ask "  번호를 고르거나 예전 맥의 경로를 직접 입력 [1]: " 1)"
      if [[ "$pick" =~ ^[0-9]+$ ]]; then src="$(sed -n "${pick}p" <<<"$list")"; else src="$pick"; fi
    else
      src="$(ask "  예전 맥에서 macserver 폴더 경로 (예: ~/Projects/macserver): " "")"
    fi
  fi
  [[ -n "$src" ]] || die "경로가 필요합니다."
  local dest="$HOME/$(basename "$src")"
  local rsync_bin; rsync_bin="$(command -v rsync)"; [[ -x /opt/homebrew/bin/rsync ]] && rsync_bin=/opt/homebrew/bin/rsync
  echo "  $u@$h:$src/  →  $dest/"
  "$rsync_bin" -avh --progress --partial --exclude='.DS_Store' -e ssh "$u@$h:$src/" "$dest/" || die "복사 실패"
  ok "복사 완료: $dest"
  MACSERVER_DIR="$dest"
  install_macserver; expose_macserver
}

# 메인(예전) 맥에서 실행: 이 맥의 macserver 폴더를 새 맥으로 복사하고, 새 맥에서 서비스 등록까지 실행
push_macserver() {
  step "이 맥의 macserver → 새 맥으로 보내고 등록"
  local dir name target nuser self
  dir="$(find_macserver_dir)"
  if [[ -z "$dir" || ! -d "$dir" ]]; then
    dir="$(ask "  macserver 폴더 경로 (Finder 에서 드래그): " "")"; dir="${dir/#\~/$HOME}"; dir="${dir%/}"
  fi
  [[ -d "$dir" ]] || die "폴더가 없습니다: $dir"
  name="$(basename "$dir")"
  target="${NEW_MAC_HOST:-}"; [[ -n "$target" ]] || target="$(ask "  새 맥 주소 [macserver.local] (Tailscale 이면 macserver): " macserver.local)"
  nuser="${NEW_MAC_USER:-$USER}"; nuser="$(ask "  새 맥 사용자 이름 [$nuser]: " "$nuser")"
  ensure_old_mac_ssh "$nuser" "$target"
  echo "  $dir/  →  $nuser@$target:~/$name/   (node_modules, .venv 는 새 맥에서 다시 설치)"
  rsync -avh --progress --partial --exclude='.DS_Store' --exclude='node_modules' --exclude='.venv' --exclude='__pycache__' \
    -e ssh "$dir/" "$nuser@$target:~/$name/" || die "복사 실패"
  ok "복사 완료 → $nuser@$target:~/$name"
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  scp -q "$self" "$nuser@$target:~/setup.sh" && ok "setup.sh 도 새 맥에 복사"
  echo
  echo "  이제 새 맥에서 등록을 시작합니다. (새 맥의 비밀번호 1회 → 감지 결과 확인 Enter)"
  ssh -t "$nuser@$target" "MACSERVER_DIR=\"\$HOME/$name\" bash ~/setup.sh macserver"
}

migrate() {
  step "예전 맥미니 → 이 맥 홈 폴더 복사 (rsync, 다시 실행하면 이어서 복사)"
  echo "  예전 맥에서 먼저: 시스템 설정 > 일반 > 공유 > '원격 로그인' 켜기 (1클릭)"
  [[ -n "$OLD_MAC_HOST" ]] || OLD_MAC_HOST="$(ask "  예전 맥 주소 (예: old-mac.local / 192.168.0.10 / Tailscale 이름): " "")"
  [[ -n "$OLD_MAC_HOST" ]] || die "주소가 필요합니다."
  local u="$OLD_MAC_USER" h="$OLD_MAC_HOST" dry=""
  [[ "${1:-}" == "--dry-run" ]] && dry="--dry-run"
  ensure_old_mac_ssh "$u" "$h"
  local rsync_bin; rsync_bin="$(command -v rsync)"; [[ -x /opt/homebrew/bin/rsync ]] && rsync_bin=/opt/homebrew/bin/rsync
  local ex=(
    --exclude='.Trash' --exclude='.DS_Store' --exclude='.Spotlight-V100' --exclude='.cache' --exclude='.npm/_cacache'
    --exclude='Library/Caches' --exclude='Library/Logs' --exclude='Library/Saved Application State'
    --exclude='Library/Developer/Xcode/DerivedData' --exclude='Library/Application Support/MobileSync'
    --exclude='Library/Mobile Documents' --exclude='Library/CloudStorage'      # iCloud/클라우드는 로그인하면 다시 동기화됨
    --exclude='Library/Containers' --exclude='Library/Group Containers'       # 샌드박스 앱 데이터 (마이그레이션 지원이 담당)
    --exclude='Library/Mail' --exclude='Library/Messages' --exclude='Library/Keychains' --exclude='Library/Accounts'
    --exclude='Library/Biome' --exclude='Library/Metadata' --exclude='Library/Preferences/ByHost'
    --exclude='Library/LaunchAgents'                                          # 예전 맥의 자동실행 항목은 가져오지 않음
  )
  echo "  $u@$h:~/  →  $HOME/   ($rsync_bin ${dry:-실제 복사})"
  # shellcheck disable=SC2086
  "$rsync_bin" -avh --progress --partial $dry "${ex[@]}" -e ssh "$u@$h:~/" "$HOME/" \
    || warn "rsync가 경고/오류로 끝났습니다 (위 출력 확인). 다시 실행하면 이어서 복사합니다."
  [[ -z "$dry" ]] || return 0
  ok "홈 폴더 복사 완료"
  local oldbrew; oldbrew="$(ssh "$u@$h" 'ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1')"
  if [[ -n "$oldbrew" ]]; then
    step "예전 맥 Homebrew 목록 → ~/Brewfile"
    if ssh "$u@$h" "$oldbrew bundle dump --force --file=- 2>/dev/null" > "$HOME/Brewfile" && [[ -s "$HOME/Brewfile" ]]; then
      ok "저장됨 → 'bash setup.sh' 실행 시 자동 복원 (또는 brew bundle --file=~/Brewfile)"
    else warn "Brewfile 생성 실패"; rm -f "$HOME/Brewfile"; fi
  fi
}

# ------------------------------------------------------------------ verify
verify() {
  step "점검표"
  local fw=/usr/libexec/ApplicationFirewall/socketfilterfw
  printf '  %-14s %s\n' "macOS"      "$(sw_vers -productVersion) / $ARCH / $USER"
  printf '  %-14s %s\n' "호스트명"   "$(scutil --get HostName 2>/dev/null)  ($(scutil --get LocalHostName 2>/dev/null).local)"
  printf '  %-14s %s\n' "전원"       "$(pmset -g | awk '/^ *(sleep|disksleep|autorestart|womp) /{printf "%s=%s  ",$1,$2}')  (sleep=0, autorestart=1 이어야 함)"
  printf '  %-14s %s\n' "SSH"        "$(sudo launchctl print system/com.openssh.sshd >/dev/null 2>&1 && echo ON || echo OFF)"
  printf '  %-14s %s\n' "화면 공유"  "$(sudo launchctl print system/com.apple.screensharing >/dev/null 2>&1 && echo ON || echo OFF)"
  printf '  %-14s %s\n' "방화벽"     "$(sudo $fw --getglobalstate | head -1)"
  printf '  %-14s %s\n' "자동 로그인" "$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || echo OFF)"
  printf '  %-14s %s\n' "FileVault"  "$(fdesetup status | head -1)"
  printf '  %-14s %s\n' "OS 자동설치" "$(defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates 2>/dev/null || echo '?')  (0 이어야 함)"
  printf '  %-14s %s\n' "Tailscale"  "$(tailscale status --self=true --peers=false 2>/dev/null | head -1 || echo '미설치/로그아웃')"
  printf '  %-14s %s\n' "Claude Code" "$(claude --version 2>/dev/null || echo '미설치')"
  printf '  %-14s %s\n' "macserver"  "$MACSERVER_DIR  ($(macserver_domain)/$MACSERVER_LABEL)"
  macserver_status
}

summary() {
  step "완료! 다음 할 일"
  cat <<EOF
  1) 재부팅 테스트:   sudo reboot   → 2~3분 뒤 다른 기기에서   ssh $USER@$SERVER_NAME
  2) 정전 테스트:     전원 케이블을 뽑았다 다시 꽂기 → 혼자 켜지고 macserver가 떠야 함 (bash ~/setup.sh status)
  3) 다른 기기에서:   Tailscale 앱 설치 + 같은 계정 로그인
       터미널   ssh $USER@$SERVER_NAME
       화면     Finder ⌘K → vnc://$SERVER_NAME     (iPhone/iPad: Screens 또는 Jump Desktop)
       Claude   Claude 앱 → '$SERVER_NAME' 세션 (claude remote-control, 첫 'claude' 로그인 후)
  4) 운영:   bash ~/setup.sh status | logs | restart | verify
  로그: $LOG
EOF
}

# ------------------------------------------------------------------ main
main() {
  local cmd="${1:-setup}"; shift || true
  case "$cmd" in
    setup)
      start_log; preflight; show_plan; need_sudo
      install_clt; install_rosetta; install_brew; maybe_migrate; restore_brewfile
      set_identity; set_power; enable_ssh; enable_screen_sharing; enable_firewall; set_updates; set_autologin
      install_tailscale; install_claude; install_macserver; expose_macserver
      summary ;;
    migrate)   start_log; preflight; migrate "$@" ;;
    fetch)     start_log; preflight; need_sudo; fetch_macserver ;;
    push)      [[ "$(uname -s)" == Darwin ]] || die "macOS 전용"; push_macserver ;;
    verify)    start_log; need_sudo; verify ;;
    macserver) start_log; preflight; need_sudo; install_macserver; expose_macserver ;;
    find)      echo "macserver 후보 폴더 (Spotlight + find):"; list_macserver_candidates | sed 's/^/  /'; echo "등록:  MACSERVER_DIR=/경로 bash ~/setup.sh macserver" ;;
    status)    macserver_status ;;
    start|stop|restart|logs) macserver_ctl "$cmd" ;;
    *) sed -n '2,23p' "$0"; exit 1 ;;
  esac
}
main "$@"
