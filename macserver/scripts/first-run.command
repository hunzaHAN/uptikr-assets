#!/bin/bash
# macserver 최초 설정 + 실행 (Terminal 창에서 진행 상황을 보여줍니다)
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"
for d in "$HOME/.nvm/versions/node"/*/bin; do [ -d "$d" ] && export PATH="$d:$PATH"; done
clear
echo "╭────────────────────────────────────────────╮"
echo "│   macserver 최초 설정을 시작합니다            │"
echo "│   잠시 걸려요. 창을 닫지 말고 기다려 주세요.  │"
echo "╰────────────────────────────────────────────╯"
echo
if [ ! -d node_modules ] || [ ! -d node_modules/electron ]; then
  echo "▶ 필요한 구성요소 설치 중… (1~3분)"
  npm install --no-fund --no-audit || { echo; echo "✗ 설치 실패. 위 메시지를 확인하세요."; echo "엔터를 누르면 닫혀요."; read; exit 1; }
fi
if [ "$(uname)" = "Darwin" ] && [ ! -x native/build/macserver-input ]; then
  echo "▶ 원격 제어용 입력 모듈 빌드 중…"
  if command -v swiftc >/dev/null 2>&1; then bash scripts/build-native.sh || echo "  ! 입력 모듈 빌드 실패(화면 보기는 가능, 제어만 제한). 나중에 설정 > macOS 권한에서 다시 빌드할 수 있어요.";
  else echo "  ! Xcode Command Line Tools가 없어 원격 '제어'는 아직 불가해요."; echo "    설치:  xcode-select --install   (설치 후 앱의 설정 > macOS 권한에서 '다시 빌드')"; fi
fi
echo
echo "✅ 준비 완료! macserver를 시작합니다. (이 창을 닫으면 종료돼요)"
echo
exec npm start
