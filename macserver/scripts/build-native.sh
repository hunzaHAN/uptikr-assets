#!/usr/bin/env bash
# macserver 네이티브 헬퍼(Swift) 빌드. macOS + Xcode Command Line Tools 필요.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="native/build"
mkdir -p "$OUT"
if [[ "$(uname)" != "Darwin" ]]; then
  echo "[build-native] macOS 가 아니라 건너뜁니다 (네이티브 입력은 Mac 에서만 동작)."
  exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[build-native] swiftc 가 없습니다. 'xcode-select --install' 로 Command Line Tools 를 설치하세요." >&2
  exit 1
fi
echo "[build-native] InputBridge 빌드…"
swiftc -O -o "$OUT/macserver-input" native/InputBridge.swift -framework CoreGraphics -framework AppKit
echo "[build-native] permissions 빌드…"
swiftc -O -o "$OUT/macserver-perms" native/permissions.swift -framework CoreGraphics -framework AppKit
chmod +x "$OUT/macserver-input" "$OUT/macserver-perms"
echo "[build-native] 완료 → $OUT"
