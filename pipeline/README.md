# UPTIKR 파이프라인

@uptikr 인스타그램 경제 브리핑 자동 발행 시스템.

## 구조
- 클라우드(Claude): 리서치 → 콘텐츠 JSON 작성 → 1080x1350 PNG 렌더링 → 맥미니 큐로 전송
- 맥미니(publish.py): 큐 감시 → GitHub 업로드 → 인스타그램 캐러셀 발행

## 파일
- theme.py: 디자인 시스템(CSS, 프레임)
- slides.py: 슬라이드 타입별 HTML 빌더
- render.py: Playwright 렌더러

## 슬라이드 타입
cover / indices / point / bignum / checklist / outro

## 발행 시각
아침 07:30, 점심 12:30, 저녁 21:00 (KST)
