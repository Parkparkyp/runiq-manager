# 루닉스냅 매니저
웨딩 촬영 예약/입금/캘린더 관리 PWA (서버·DB 없음, 데이터는 기기 localStorage 저장)

## 폴더 구성
index.html · manifest.json · sw.js · icons/ (이 파일들을 같은 폴더에 두세요)

## GitHub Pages 배포
1. 저장소에 위 파일 전부 업로드 → Settings → Pages → Branch: main / (root)
2. 발급된 https 주소를 폰 크롬에서 열기 → ⋮ → "앱 설치" 또는 "홈 화면에 추가"

## 주의
- 데이터는 기기·브라우저별로 따로 저장됩니다. 설정 탭의 JSON 백업을 주기적으로 받으세요.
- file:// 로 열면 서비스워커(오프라인)가 동작하지 않습니다. 꼭 Pages(https)로 여세요.
