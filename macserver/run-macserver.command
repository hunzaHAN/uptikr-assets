#!/usr/bin/env bash
# 더블클릭으로 macserver 실행 (Finder에서 바로 실행용)
cd "$(dirname "$0")"
if [[ ! -d node_modules ]]; then echo "최초 실행: 설치를 진행합니다…"; bash scripts/setup.sh; fi
exec npm start
