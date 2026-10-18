#!/usr/bin/env bash
# macserver 최초 설치 — 의존성 설치 + 네이티브 헬퍼 빌드 + 점검
set -euo pipefail
cd "$(dirname "$0")/.."
echo "▶ macserver 설치를 시작합니다"
echo "▶ 1/3  npm 의존성 설치…"
npm install --no-fund --no-audit
if [[ "$(uname)" == "Darwin" ]]; then
  echo "▶ 2/3  네이티브 입력 브리지 빌드…"
  if command -v swiftc >/dev/null 2>&1; then bash scripts/build-native.sh; else echo "   ! swiftc 없음 — 'xcode-select --install' 후 'npm run build:native' 를 실행하세요 (원격 제어에 필요)."; fi
else
  echo "▶ 2/3  (macOS 아님 — 네이티브 빌드 건너뜀)"
fi
echo "▶ 3/3  환경 점검"
node scripts/doctor.js || true
echo ""
echo "✅ 준비 완료! 다음 명령으로 실행하세요:"
echo "     npm start          # macserver 앱 (화면 공유 + 파일 서버)"
echo "     npm run server     # 서버 전용 (Electron 없이)"
