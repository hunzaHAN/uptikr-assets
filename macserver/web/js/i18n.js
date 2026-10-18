// 간단한 다국어 (ko 기본, en 보조)
const dict = {
  ko: {
    home: '홈', search: '검색', screen: '화면', files: '파일', accounts: '계정', settings: '설정', activity: '활동', library: '내 라이브러리',
    login: '로그인', logout: '로그아웃', username: '아이디', password: '비밀번호', displayName: '표시 이름',
    greetingMorning: '좋은 아침이에요', greetingDay: '좋은 오후예요', greetingEvening: '좋은 저녁이에요', greetingNight: '늦은 밤이네요',
    shares: '공유 폴더', screenOf: '{host} 화면', connect: '연결', disconnect: '연결 끊기', control: '제어', viewOnly: '보기 전용',
    online: '온라인', offline: '오프라인', paused: '일시정지됨',
    save: '저장', cancel: '취소', delete: '삭제', create: '만들기', edit: '편집', close: '닫기', confirm: '확인', copy: '복사', copied: '복사했어요',
    upload: '업로드', download: '다운로드', newFolder: '새 폴더', rename: '이름 바꾸기', move: '이동', open: '열기', preview: '미리보기',
    name: '이름', kind: '종류', modified: '수정일', size: '크기', items: '{n}개 항목', folder: '폴더', fileKind: '파일',
    admin: '관리자', userRole: '사용자', host: '호스트', enabled: '활성', disabled: '비활성',
    readOnly: '읽기', readWrite: '읽기+쓰기', noAccess: '없음',
    error: '오류', loading: '불러오는 중…', empty: '비어 있음', noResults: '결과 없음',
  },
  en: {
    home: 'Home', search: 'Search', screen: 'Screen', files: 'Files', accounts: 'Accounts', settings: 'Settings', activity: 'Activity', library: 'Your Library',
    login: 'Log in', logout: 'Log out', username: 'Username', password: 'Password', displayName: 'Display name',
    greetingMorning: 'Good morning', greetingDay: 'Good afternoon', greetingEvening: 'Good evening', greetingNight: 'Up late?',
    shares: 'Shared folders', screenOf: "{host}'s screen", connect: 'Connect', disconnect: 'Disconnect', control: 'Control', viewOnly: 'View only',
    online: 'Online', offline: 'Offline', paused: 'Paused',
    save: 'Save', cancel: 'Cancel', delete: 'Delete', create: 'Create', edit: 'Edit', close: 'Close', confirm: 'OK', copy: 'Copy', copied: 'Copied',
    upload: 'Upload', download: 'Download', newFolder: 'New folder', rename: 'Rename', move: 'Move', open: 'Open', preview: 'Preview',
    name: 'Name', kind: 'Kind', modified: 'Modified', size: 'Size', items: '{n} items', folder: 'Folder', fileKind: 'File',
    admin: 'Admin', userRole: 'User', host: 'Host', enabled: 'Enabled', disabled: 'Disabled',
    readOnly: 'Read', readWrite: 'Read + write', noAccess: 'None',
    error: 'Error', loading: 'Loading…', empty: 'Empty', noResults: 'No results',
  },
};
let lang = 'ko';
export function setLang(l) { lang = dict[l] ? l : 'ko'; document.documentElement.lang = lang; }
export function getLang() { return lang; }
export function t(key, vars = {}) {
  let s = (dict[lang] && dict[lang][key]) || dict.ko[key] || key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
