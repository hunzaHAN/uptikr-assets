// macserver 권한 확인 헬퍼 — 화면 기록/손쉬운 사용 권한 상태를 JSON 으로 출력
// 빌드: swiftc -O -o native/build/macserver-perms native/permissions.swift -framework CoreGraphics -framework AppKit
import Foundation
import CoreGraphics
import AppKit

var screen = false
if #available(macOS 10.15, *) { screen = CGPreflightScreenCaptureAccess() }
else { screen = true }
let ax = AXIsProcessTrusted()
let prompt = CommandLine.arguments.contains("--prompt-ax")
if prompt {
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  _ = AXIsProcessTrustedWithOptions(opts)
}
let requestScreen = CommandLine.arguments.contains("--request-screen")
if requestScreen, #available(macOS 10.15, *) { CGRequestScreenCaptureAccess() }

let obj: [String: Any] = ["screen": screen, "accessibility": ax]
if let d = try? JSONSerialization.data(withJSONObject: obj) { print(String(data: d, encoding: .utf8)!) }
