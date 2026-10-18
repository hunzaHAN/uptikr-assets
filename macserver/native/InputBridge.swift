// macserver 입력 브리지 — stdin 으로 JSON 명령을 받아 CGEvent 로 마우스/키보드/스크롤을 주입합니다.
// 빌드:  swiftc -O -o native/build/macserver-input native/InputBridge.swift -framework CoreGraphics -framework AppKit
// 프로토콜(줄 단위 JSON):
//   {"t":"move","x":0.5,"y":0.5}                      // 정규화 좌표 (주 디스플레이 또는 displayId)
//   {"t":"down","x":..,"y":..,"b":0,"n":2}            // b: 0=좌,1=중,2=우 / n: 클릭 횟수
//   {"t":"up","x":..,"y":..,"b":0}
//   {"t":"wheel","dx":..,"dy":..}                     // 픽셀 단위
//   {"t":"key","code":"KeyA","down":true}             // DOM code → 가상 키코드
//   {"t":"text","text":"안녕"}                         // 유니코드 문자열 타이핑
//   {"t":"release"}                                   // 모든 눌린 키/버튼 해제
//   {"t":"display","id":123}                          // 대상 디스플레이 지정
//   {"t":"clipboard","text":".."} / {"t":"clipboard:get"}
// 출력(줄 단위 JSON):  {"ok":true} | {"error":".."} | {"clipboard":".."}
import Foundation
import CoreGraphics
import AppKit

let src = CGEventSource(stateID: .combinedSessionState)
src?.localEventsSuppressionInterval = 0.0
var targetDisplay: CGDirectDisplayID = CGMainDisplayID()
var lastPoint = CGPoint(x: 0, y: 0)
var pressedKeys = Set<CGKeyCode>()
var pressedButtons = Set<Int>()
var curFlags: CGEventFlags = []

func out(_ obj: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) {
    print(s); fflush(stdout)
  }
}

// 정규화 좌표(0..1, 대상 디스플레이 기준) → 전역 픽셀 좌표
func toGlobal(_ nx: Double, _ ny: Double) -> CGPoint {
  let b = CGDisplayBounds(targetDisplay)
  let x = b.origin.x + max(0, min(1, nx)) * b.size.width
  let y = b.origin.y + max(0, min(1, ny)) * b.size.height
  return CGPoint(x: x, y: y)
}

func mouseButton(_ b: Int) -> CGMouseButton { b == 1 ? .center : (b == 2 ? .right : .left) }
func downType(_ b: Int) -> CGEventType { b == 1 ? .otherMouseDown : (b == 2 ? .rightMouseDown : .leftMouseDown) }
func upType(_ b: Int) -> CGEventType { b == 1 ? .otherMouseUp : (b == 2 ? .rightMouseUp : .leftMouseUp) }
func dragType(_ b: Int) -> CGEventType { b == 1 ? .otherMouseDragged : (b == 2 ? .rightMouseDragged : .leftMouseDragged) }

func postMouse(_ type: CGEventType, _ p: CGPoint, button: Int, clicks: Int = 1) {
  guard let e = CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: mouseButton(button)) else { return }
  if clicks > 1 { e.setIntegerValueField(.mouseEventClickState, value: Int64(clicks)) }
  e.flags = curFlags
  e.post(tap: .cghidEventTap)
  lastPoint = p
}

func moveMouse(_ p: CGPoint) {
  if let b = pressedButtons.first {
    postMouse(dragType(b), p, button: b)
  } else if let e = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) {
    e.flags = curFlags; e.post(tap: .cghidEventTap); lastPoint = p
  }
}

func scroll(_ dx: Int, _ dy: Int) {
  // 자연스러운 스크롤: 위로 스와이프 = 콘텐츠 위로. WebRTC deltaY 양수 = 아래로.
  if let e = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 2, wheel1: Int32(-dy), wheel2: Int32(-dx), wheel3: 0) {
    e.flags = curFlags; e.post(tap: .cghidEventTap)
  }
}

func applyModifier(_ code: CGKeyCode, down: Bool) -> Bool {
  let map: [CGKeyCode: CGEventFlags] = [
    0x37: .maskCommand, 0x36: .maskCommand, 0x38: .maskShift, 0x3C: .maskShift,
    0x3A: .maskAlternate, 0x3D: .maskAlternate, 0x3B: .maskControl, 0x3E: .maskControl, 0x39: .maskAlphaShift,
  ]
  guard let f = map[code] else { return false }
  if down { curFlags.insert(f) } else { curFlags.remove(f) }
  // modifier 키도 실제 keyDown/Up 이벤트로 전달 (앱이 조합을 인식하도록)
  if let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) { e.flags = curFlags; e.post(tap: .cghidEventTap) }
  return true
}

func keyEvent(_ code: CGKeyCode, down: Bool) {
  if applyModifier(code, down: down) { if down { pressedKeys.insert(code) } else { pressedKeys.remove(code) }; return }
  guard let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down) else { return }
  e.flags = curFlags
  e.post(tap: .cghidEventTap)
  if down { pressedKeys.insert(code) } else { pressedKeys.remove(code) }
}

// 유니코드 문자열을 키 이벤트로 타이핑 (keyboard layout 무관)
func typeText(_ text: String) {
  for scalarChunk in text.unicodeScalars.chunked() {
    var utf16 = Array(String(String.UnicodeScalarView(scalarChunk)).utf16)
    if let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true) {
      down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
      down.post(tap: .cghidEventTap)
    }
    if let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false) {
      up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
      up.post(tap: .cghidEventTap)
    }
    usleep(1500)
  }
}
extension Array where Element == Unicode.Scalar {
  init(_ v: String.UnicodeScalarView) { self.init(); for s in v { append(s) } }
}
extension String.UnicodeScalarView { func chunked() -> [[Unicode.Scalar]] { map { [$0] } } }

func releaseAll() {
  for b in pressedButtons { postMouse(upType(b), lastPoint, button: b) }
  pressedButtons.removeAll()
  for k in pressedKeys { if let e = CGEvent(keyboardEventSource: src, virtualKey: k, keyDown: false) { e.post(tap: .cghidEventTap) } }
  pressedKeys.removeAll()
  curFlags = []
}

func setClipboard(_ text: String) {
  let pb = NSPasteboard.general; pb.clearContents(); pb.setString(text, forType: .string)
}
func getClipboard() -> String { NSPasteboard.general.string(forType: .string) ?? "" }

// DOM KeyboardEvent.code → macOS 가상 키코드
let CODE_TO_VK: [String: CGKeyCode] = [
  "KeyA":0x00,"KeyS":0x01,"KeyD":0x02,"KeyF":0x03,"KeyH":0x04,"KeyG":0x05,"KeyZ":0x06,"KeyX":0x07,"KeyC":0x08,"KeyV":0x09,
  "KeyB":0x0B,"KeyQ":0x0C,"KeyW":0x0D,"KeyE":0x0E,"KeyR":0x0F,"KeyY":0x10,"KeyT":0x11,
  "Digit1":0x12,"Digit2":0x13,"Digit3":0x14,"Digit4":0x15,"Digit6":0x16,"Digit5":0x17,"Equal":0x18,"Digit9":0x19,"Digit7":0x1A,
  "Minus":0x1B,"Digit8":0x1C,"Digit0":0x1D,"BracketRight":0x1E,"KeyO":0x1F,"KeyU":0x20,"BracketLeft":0x21,"KeyI":0x22,"KeyP":0x23,
  "Enter":0x24,"KeyL":0x25,"KeyJ":0x26,"Quote":0x27,"KeyK":0x28,"Semicolon":0x29,"Backslash":0x2A,"Comma":0x2B,"Slash":0x2C,
  "KeyN":0x2D,"KeyM":0x2E,"Period":0x2F,"Tab":0x30,"Space":0x31,"Backquote":0x32,"Backspace":0x33,"Escape":0x35,
  "MetaRight":0x36,"MetaLeft":0x37,"ShiftLeft":0x38,"CapsLock":0x39,"AltLeft":0x3A,"ControlLeft":0x3B,
  "ShiftRight":0x3C,"AltRight":0x3D,"ControlRight":0x3E,
  "NumpadDecimal":0x41,"NumpadMultiply":0x43,"NumpadAdd":0x45,"NumLock":0x47,"VolumeUp":0x48,"VolumeDown":0x49,"Mute":0x4A,
  "NumpadDivide":0x4B,"NumpadEnter":0x4C,"NumpadSubtract":0x4E,"NumpadEqual":0x51,
  "Numpad0":0x52,"Numpad1":0x53,"Numpad2":0x54,"Numpad3":0x55,"Numpad4":0x56,"Numpad5":0x57,"Numpad6":0x58,"Numpad7":0x59,"Numpad8":0x5B,"Numpad9":0x5C,
  "F5":0x60,"F6":0x61,"F7":0x62,"F3":0x63,"F8":0x64,"F9":0x65,"F11":0x67,"F13":0x69,"F14":0x6B,"F10":0x6D,"F12":0x6F,
  "F15":0x71,"Help":0x72,"Insert":0x72,"Home":0x73,"PageUp":0x74,"Delete":0x75,"F4":0x76,"End":0x77,"F2":0x78,"PageDown":0x79,"F1":0x7A,
  "ArrowLeft":0x7B,"ArrowRight":0x7C,"ArrowDown":0x7D,"ArrowUp":0x7E,
  "Lang1":0x68,"Lang2":0x66,
]

func handle(_ obj: [String: Any]) {
  guard let t = obj["t"] as? String else { return }
  switch t {
  case "move": moveMouse(toGlobal(obj["x"] as? Double ?? 0, obj["y"] as? Double ?? 0))
  case "down":
    let b = obj["b"] as? Int ?? 0; let p = toGlobal(obj["x"] as? Double ?? 0, obj["y"] as? Double ?? 0)
    pressedButtons.insert(b); postMouse(downType(b), p, button: b, clicks: obj["n"] as? Int ?? 1)
  case "up":
    let b = obj["b"] as? Int ?? 0; let p = toGlobal(obj["x"] as? Double ?? 0, obj["y"] as? Double ?? 0)
    pressedButtons.remove(b); postMouse(upType(b), p, button: b)
  case "wheel": scroll(obj["dx"] as? Int ?? 0, obj["dy"] as? Int ?? 0)
  case "key":
    let down = obj["down"] as? Bool ?? true
    if let code = obj["code"] as? String, let vk = CODE_TO_VK[code] { keyEvent(vk, down: down) }
    else if down, let key = obj["key"] as? String, key.count == 1 { typeText(key) }  // 폴백
  case "text": if let s = obj["text"] as? String { typeText(s) }
  case "release": releaseAll()
  case "display": if let id = obj["id"] as? Int { targetDisplay = CGDirectDisplayID(id) } else if let id = obj["id"] as? UInt32 { targetDisplay = id }
  case "clipboard": if let s = obj["text"] as? String { setClipboard(s) }
  case "clipboard:get": out(["clipboard": getClipboard()])
  case "ping": out(["pong": obj["ts"] ?? 0])
  default: break
  }
}

// AX 권한 확인 (정보 출력용)
let axTrusted = AXIsProcessTrusted()
out(["ready": true, "accessibility": axTrusted, "mainDisplay": Int(CGMainDisplayID())])

while let line = readLine(strippingNewline: true) {
  if line.isEmpty { continue }
  guard let data = line.data(using: .utf8) else { continue }
  do {
    if let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
      handle(obj)
    } else if let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      for o in arr { handle(o) }
    }
  } catch { out(["error": "\(error)"]) }
}
releaseAll()
