const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const esbuild = require('esbuild');

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const MAIN_FILE = path.join(ROOT_DIR, 'main.js');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ICON_FILE = path.join(ROOT_DIR, 'app.icns');
const SWIFT_LAUNCHER = path.join(ROOT_DIR, 'launcher-mac.swift');
const APP_NAME = 'BLT';
const APP_BUNDLE_DIR = path.join(DIST_DIR, `${APP_NAME}.app`);
const CONTENTS_DIR = path.join(APP_BUNDLE_DIR, 'Contents');
const MACOS_DIR = path.join(CONTENTS_DIR, 'MacOS');
const RESOURCES_DIR = path.join(CONTENTS_DIR, 'Resources');

// 실제 Node 백그라운드 엔진은 BLT_bin, 메뉴 막대를 띄우는 네이티브 진입점은 BLT
const NODE_ENGINE_BIN = path.join(MACOS_DIR, `${APP_NAME}_bin`);
const MAIN_LAUNCHER_BIN = path.join(MACOS_DIR, APP_NAME);

async function buildMac() {
  if (process.platform !== 'darwin') {
    console.error('오류: 이 스크립트는 macOS 환경에서만 실행할 수 있습니다.');
    process.exit(1);
  }

  if (!fs.existsSync(SWIFT_LAUNCHER)) {
    console.error(`오류: 런처 소스 파일(${SWIFT_LAUNCHER})을 찾을 수 없습니다.`);
    process.exit(1);
  }

  console.log('[1/7] dist 및 .app 번들 디렉토리 초기화...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(MACOS_DIR, { recursive: true });
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  console.log('[2/7] macOS 표준 Info.plist 생성 및 아이콘 매핑...');
  const hasIcon = fs.existsSync(ICON_FILE);
  const iconEntry = hasIcon ? `\n  <key>CFBundleIconFile</key>\n  <string>app.icns</string>` : '';

  // LSUIElement = 1 로 설정하여 Dock에는 뜨지 않고 메뉴 막대 전용 에이전트로 상주
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.local.${APP_NAME.toLowerCase()}</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>LSUIElement</key>
  <string>1</string>${iconEntry}
</dict>
</plist>`;
  fs.writeFileSync(path.join(CONTENTS_DIR, 'Info.plist'), infoPlist, 'utf8');

  if (hasIcon) {
    fs.copyFileSync(ICON_FILE, path.join(RESOURCES_DIR, 'app.icns'));
    console.log('✔ Resources/app.icns 아이콘 복사 완료');
  }

  console.log('[3/7] public/ 자산 Resources 디렉토리로 동기화...');
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.cpSync(PUBLIC_DIR, path.join(RESOURCES_DIR, 'public'), { recursive: true });
    console.log('✔ Resources/public 디스크 자산 복사 완료');
  }

  console.log('[4/7] esbuild 번들링...');
  const bundleFile = path.join(DIST_DIR, 'bundle.js');
  await esbuild.build({
    entryPoints: [MAIN_FILE],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundleFile,
    external: ['node:*'],
    sourcemap: false
  });

  console.log('[5/7] macOS SEA Blob 생성...');
  const seaConfigFile = path.join(DIST_DIR, 'sea-config.json');
  const seaBlobFile = path.join(DIST_DIR, 'sea-prep.blob');

  const seaConfig = {
    main: bundleFile,
    output: seaBlobFile,
    disableExperimentalSEAWarning: true
  };
  fs.writeFileSync(seaConfigFile, JSON.stringify(seaConfig, null, 2), 'utf8');
  execSync(`node --experimental-sea-config "${seaConfigFile}"`, { stdio: 'inherit' });

  console.log('[6/7] Mach-O 바이너리 추출 및 SEA 주입 (BLT_bin)...');
  const currentArch = process.arch;
  const lipoArch = currentArch === 'x64' ? 'x86_64' : currentArch;

  try {
    execSync(`lipo -thin ${lipoArch} "${process.execPath}" -output "${NODE_ENGINE_BIN}"`, { stdio: 'pipe' });
    console.log(`✔ 단일 아키텍처(${lipoArch}) 바이너리 추출 완료`);
  } catch (e) {
    fs.copyFileSync(process.execPath, NODE_ENGINE_BIN);
  }

  const postjectCmd = `npx postject "${NODE_ENGINE_BIN}" NODE_SEA_BLOB "${seaBlobFile}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`;
  execSync(postjectCmd, { stdio: 'inherit' });
  fs.chmodSync(NODE_ENGINE_BIN, 0o755);

  console.log('[7/7] 네이티브 Swift 메뉴 막대 런처 컴파일 (BLT)...');
  // macOS 내장 swiftc로 launcher-mac.swift를 컴파일하여 Contents/MacOS/BLT 생성
  const swiftCompileCmd = `swiftc -O "${SWIFT_LAUNCHER}" -o "${MAIN_LAUNCHER_BIN}"`;
  execSync(swiftCompileCmd, { stdio: 'inherit' });
  fs.chmodSync(MAIN_LAUNCHER_BIN, 0o755);
  console.log('✔ 네이티브 메뉴 막대 런처 컴파일 완료');

  // macOS 임시 코드 재서명
  execSync(`codesign --force --deep --sign - "${APP_BUNDLE_DIR}"`, { stdio: 'inherit' });
  console.log('✔ macOS 임시 코드 서명 완료');

  // 임시 생성 파일 정리
  fs.unlinkSync(bundleFile);
  fs.unlinkSync(seaConfigFile);
  fs.unlinkSync(seaBlobFile);

  try {
    execSync(`touch "${APP_BUNDLE_DIR}"`);
  } catch (e) {}

  console.log(`\n빌드 성공: ${APP_BUNDLE_DIR}`);
}

buildMac().catch((err) => {
  console.error('macOS 빌드 실패:', err);
  process.exit(1);
});