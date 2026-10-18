# macserver 네이티브 입력 브리지

원격 마우스·키보드·스크롤 입력을 macOS에 주입하는 작은 Swift 헬퍼입니다.
Electron 메인 프로세스가 이 프로그램을 자식 프로세스로 띄우고, stdin으로 JSON 명령을 보냅니다.

## 빌드

```bash
npm run build:native      # 또는 bash scripts/build-native.sh
```

산출물: `native/build/macserver-input`, `native/build/macserver-perms`

Xcode Command Line Tools가 필요합니다: `xcode-select --install`

## 권한

- **화면 기록(Screen Recording)**: 화면 캡처(getDisplayMedia)에 필요. 허용 후 앱 재실행.
- **손쉬운 사용(Accessibility)**: `macserver-input`이 CGEvent를 주입하려면 필요.

두 권한 모두 시스템 설정 > 개인정보 보호 및 보안에서 **macserver 앱**(개발 중에는 Electron)에 부여합니다.
앱의 설정 > macOS 권한 화면에서 상태 확인과 설정 열기를 할 수 있습니다.

## 프로토콜

`native/InputBridge.swift` 상단 주석 참고. 좌표는 대상 디스플레이 기준 정규화(0~1)이며,
Electron이 캡처 중인 디스플레이 ID를 `{"t":"display","id":...}`로 지정합니다.
