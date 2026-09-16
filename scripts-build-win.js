const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const esbuild = require('esbuild');
const ResEdit = require('resedit');

const ROOT_DIR = process.cwd();
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAIN_FILE = path.join(ROOT_DIR, 'main.js');
const ICON_FILE = path.join(ROOT_DIR, 'app.ico');
const CS_LAUNCHER = path.join(ROOT_DIR, 'launcher-win.cs');

// 빌드 과정에서만 일시적으로 생성되는 파일들
const TEMP_NODE_ENGINE = path.join(DIST_DIR, 'BLT_bin.exe');
const FINAL_EXE = path.join(DIST_DIR, 'BLT.exe');

function findCscPath() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const frameworkDirs = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319')
  ];

  for (const dir of frameworkDirs) {
    const candidate = path.join(dir, 'csc.exe');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    execSync('where csc.exe', { stdio: 'ignore' });
    return 'csc.exe';
  } catch (e) {
    return null;
  }
}

async function build() {
  if (process.platform !== 'win32') {
    console.error('오류: 이 스크립트는 Windows 환경에서만 실행할 수 있습니다.');
    process.exit(1);
  }

  if (!fs.existsSync(CS_LAUNCHER)) {
    console.error(`오류: C# 런처 소스 파일(${CS_LAUNCHER})을 찾을 수 없습니다.`);
    process.exit(1);
  }

  const cscPath = findCscPath();
  if (!cscPath) {
    console.error('오류: .NET Framework C# 컴파일러(csc.exe)를 찾을 수 없습니다.');
    process.exit(1);
  }

  console.log('[1/6] dist 디렉토리 초기화...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  console.log('[2/6] public/ 정적 자산 VFS Base64 맵 구성...');
  const vfsMap = {};
  if (fs.existsSync(PUBLIC_DIR)) {
    const files = fs.readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true });
    for (const file of files) {
      if (file.isFile()) {
        const fullPath = path.join(file.parentPath || file.path, file.name);
        const relPath = path.relative(PUBLIC_DIR, fullPath).replace(/\\/g, '/');
        vfsMap[relPath] = fs.readFileSync(fullPath).toString('base64');
      }
    }
  }
  console.log(`✔ ${Object.keys(vfsMap).length}개 정적 파일 패키징 준비 완료`);

  console.log('[3/6] esbuild 번들링 (VFS 인라인 주입)...');
  const bundleFile = path.join(DIST_DIR, 'bundle.js');
  await esbuild.build({
    entryPoints: [MAIN_FILE],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundleFile,
    external: ['node:*'],
    sourcemap: false,
    define: {
      'globalThis.__VFS_ASSETS__': JSON.stringify(vfsMap)
    }
  });

  console.log('[4/6] Node.js SEA Blob 생성...');
  const seaConfigFile = path.join(DIST_DIR, 'sea-config.json');
  const seaBlobFile = path.join(DIST_DIR, 'sea-prep.blob');

  const seaConfig = {
    main: bundleFile,
    output: seaBlobFile,
    disableExperimentalSEAWarning: true
  };
  fs.writeFileSync(seaConfigFile, JSON.stringify(seaConfig, null, 2), 'utf8');
  execSync(`node --experimental-sea-config "${seaConfigFile}"`, { stdio: 'inherit' });

  console.log('[5/6] 백그라운드 Node 바이너리 생성 및 SEA 주입 (BLT_bin.exe)...');
  fs.copyFileSync(process.execPath, TEMP_NODE_ENGINE);

  const exeBuffer = fs.readFileSync(TEMP_NODE_ENGINE);
  const exe = ResEdit.NtExecutable.from(exeBuffer, { ignoreCert: true });
  exe.newHeader.optionalHeader.subsystem = 2; // GUI 모드 강제

  const res = ResEdit.NtExecutableResource.from(exe);
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  let vi = viList.length > 0 ? viList[0] : ResEdit.Resource.VersionInfo.createEmpty();

  vi.setFileVersion(1, 0, 0, 0);
  vi.setProductVersion(1, 0, 0, 0);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      FileDescription: 'BLT Backend Engine',
      ProductName: 'BLT',
      LegalCopyright: ' ',
      OriginalFilename: 'BLT_bin.exe'
    }
  );
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(TEMP_NODE_ENGINE, Buffer.from(exe.generate()));

  const postjectCmd = `npx postject "${TEMP_NODE_ENGINE}" NODE_SEA_BLOB "${seaBlobFile}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
  execSync(postjectCmd, { stdio: 'inherit' });
  console.log('✔ 백그라운드 엔진 Blob 주입 완료');

  console.log('[6/6] C# 단일 패키징 바이너리 컴파일 (BLT_bin.exe 내장 -> BLT.exe)...');
  const hasIcon = fs.existsSync(ICON_FILE);
  const iconOpt = hasIcon ? `/win32icon:"${ICON_FILE}"` : '';
  
  // TEMP_NODE_ENGINE을 바이너리 리소스(BLT_bin.exe)로 완전히 내장
  const cscCmd = `"${cscPath}" /target:winexe /optimize+ ${iconOpt} /resource:"${TEMP_NODE_ENGINE}",BLT_bin.exe /out:"${FINAL_EXE}" "${CS_LAUNCHER}"`;
  execSync(cscCmd, { stdio: 'inherit' });
  console.log('✔ 내장 리소스가 포함된 단일 실행 파일 컴파일 완료');

  // dist 디렉터리 내에 BLT.exe를 제외한 모든 잔여 임시 파일(BLT_bin.exe, sea-prep.blob, bundle.js 등) 강제 삭제
  const distFiles = fs.readdirSync(DIST_DIR);
  for (const file of distFiles) {
    if (file !== 'BLT.exe') {
      try {
        fs.rmSync(path.join(DIST_DIR, file), { recursive: true, force: true });
      } catch (e) {}
    }
  }

  // 루트에 남아있을 수 있는 임시 설정 파일 삭제
  if (fs.existsSync('sea-config.json')) {
    fs.unlinkSync('sea-config.json');
  }

  console.log(`\n✔ 단일 실행 파일 패키징 성공: ${FINAL_EXE}`);
}

build().catch((err) => {
  console.error('Windows 빌드 실패:', err);
  process.exit(1);
});