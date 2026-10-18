// 설치 직후 안내만 출력합니다 (네이티브 빌드는 scripts/setup.sh 또는 npm run build:native 에서 수행).
if (process.platform === 'darwin') {
  console.log('\n[macserver] 의존성 설치 완료. 다음 단계: bash scripts/setup.sh  (또는 npm run build:native && npm start)\n');
}
