const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const multer = require('multer');
const AdmZip = require('adm-zip');
const projectUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// esbuild 빌드 시 정의될 전역 인라인 가상 에셋 맵 (로컬 구동 시 빈 객체 폴백)
const vfs = globalThis.__VFS_ASSETS__ || {};

// SEA(Single Executable Application) 모드 판별
const isSea = (typeof process.isSea === 'function') && process.isSea();

// 환경에 따른 public 디렉터리 동적 결정
function resolvePublicDir() {
  const execDir = path.dirname(process.execPath);

  // 1. macOS .app 번들 내부 환경 (MyApp.app/Contents/Resources/public)
  if (process.platform === 'darwin') {
    const appResourcesDir = path.join(execDir, '..', 'Resources', 'public');
    if (fs.existsSync(appResourcesDir)) {
      return appResourcesDir;
    }
  }

  // 2. 실행 바이너리와 같은 위치의 public 폴더
  const binarySameDir = path.join(execDir, 'public');
  if (fs.existsSync(binarySameDir)) {
    return binarySameDir;
  }

  // 3. 로컬 개발 환경
  const cwdDir = path.join(process.cwd(), 'public');
  if (fs.existsSync(cwdDir)) {
    return cwdDir;
  }

  return path.resolve(__dirname, 'public');
}

const publicDir = resolvePublicDir();

let server = null;
let wss = null;
let activePort = 3000;
let isShuttingDown = false;

// System font detection cache & synchronization promise
let cachedSystemFonts = [];
let fontScanPromise = null;

// Session state and active project file name
let isSessionInitialized = false;
let currentProjectFileName = 'Untitled Project';

// OS standard user data directory & port tracking file
function getUserDataPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return process.env.APPDATA 
      ? path.join(process.env.APPDATA, 'browser-lite-titles') 
      : path.join(home, 'AppData', 'Roaming', 'browser-lite-titles');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'browser-lite-titles');
  }
  return path.join(home, '.browser-lite-titles');
}

const userDataDir = getUserDataPath();
const uploadDir = path.join(userDataDir, 'media_uploads');
const portFilePath = path.join(userDataDir, 'current_port.json');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multi-byte & Korean filename normalization
function fixKoreanFileName(name) {
  if (!name) return '';
  try {
    return Buffer.from(name, 'latin1').toString('utf8').normalize('NFC');
  } catch (e) {
    return name.normalize('NFC');
  }
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function verifyPassword(inputPassword, storedHash, salt) {
  if (!inputPassword || !storedHash || !salt) return false;
  const computedHash = hashPassword(inputPassword, salt);
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateChannelId() {
  return 'ch_' + crypto.randomBytes(5).toString('hex');
}

function createFreshSessionConfig(adminPw = 'admin1234', operatorPw = 'title1234') {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    salt,
    adminPasswordHash: hashPassword(adminPw, salt),
    operatorPasswordHash: hashPassword(operatorPw, salt),
    viewKey: crypto.randomBytes(12).toString('hex')
  };
}

function createFreshDataStore() {
  const initialId = generateChannelId();
  return {
    channels: [{ id: initialId, name: 'Channel 1' }],
    channelData: {
      [initialId]: {
        canvasConfig: { canvasW: 1920, canvasH: 1080, transition: 'fade' },
        titleList: [],
        liveState: { isVisible: false, title: null, transition: 'fade', canvasW: 1920, canvasH: 1080, timestamp: 0 }
      }
    },
    assets: []
  };
}

let serverConfig = createFreshSessionConfig();
let dataStore = createFreshDataStore();

const ADMIN_SESSION_TOKEN = crypto.randomBytes(16).toString('hex');
let OPERATOR_SESSION_TOKEN = crypto.randomBytes(16).toString('hex');

// MIME 타입 매핑 헬퍼
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.ico': 'image/x-icon'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// VFS 메모리 에셋 서빙 함수 (Path Traversal 방어 적용)
function serveVfsFile(res, relativePath) {
  const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (vfs[cleanPath]) {
    res.setHeader('Content-Type', getMimeType(cleanPath));
    res.send(Buffer.from(vfs[cleanPath], 'base64'));
    return true;
  }

  const resolvedPublicDir = path.resolve(publicDir);
  const diskPath = path.resolve(resolvedPublicDir, cleanPath);
  const rel = path.relative(resolvedPublicDir, diskPath);

  // 기준 디렉터리(publicDir) 내부 경로인지 엄격히 검증
  const isSafePath = !rel.startsWith('..') && !path.isAbsolute(rel);

  if (isSafePath && fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
    res.setHeader('Content-Type', getMimeType(cleanPath));
    res.sendFile(diskPath);
    return true;
  }

  return false;
}

// OS-level installed fonts scanner
function getSystemFontFamilies() {
  return new Promise((resolve) => {
    const fontSet = new Set();

    if (process.platform === 'darwin') {
      const jxaCmd = `osascript -l JavaScript -e 'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies));'`;
      exec(jxaCmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (!err && stdout) {
          try {
            const families = JSON.parse(stdout.trim());
            if (Array.isArray(families)) {
              families.forEach(f => {
                if (f && typeof f === 'string' && f.trim()) fontSet.add(f.trim());
              });
            }
          } catch (e) {}
        }
        resolve(Array.from(fontSet).sort((a, b) => a.localeCompare(b)));
      });
    } else if (process.platform === 'win32') {
      const hklmCmd = 'chcp 65001 >nul && reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"';
      exec(hklmCmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (!err && stdout) {
          const lines = stdout.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('HKEY_')) continue;
            const match = trimmed.match(/^(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+/i);
            if (match && match[1]) {
              let fontName = match[1].trim();
              fontName = fontName.replace(/\s*\([^)]*\)$/, '').trim();
              if (fontName) fontSet.add(fontName);
            }
          }
        }

        const hkcuCmd = 'chcp 65001 >nul && reg query "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"';
        exec(hkcuCmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (uErr, uStdout) => {
          if (!uErr && uStdout) {
            const uLines = uStdout.split(/\r?\n/);
            for (const line of uLines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('HKEY_')) continue;
              const match = trimmed.match(/^(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+/i);
              if (match && match[1]) {
                let fontName = match[1].trim();
                fontName = fontName.replace(/\s*\([^)]*\)$/, '').trim();
                if (fontName) fontSet.add(fontName);
              }
            }
          }
          resolve(Array.from(fontSet).sort((a, b) => a.localeCompare(b)));
        });
      });
    } else {
      resolve([]);
    }
  });
}

fontScanPromise = getSystemFontFamilies().then((fonts) => {
  cachedSystemFonts = fonts;
  console.log(`[BLT] Detected ${fonts.length} system fonts on host machine.`);
  return fonts;
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const cleanOriginalName = fixKoreanFileName(file.originalname);
    const ext = path.extname(cleanOriginalName).toLowerCase() || path.extname(file.originalname).toLowerCase();
    cb(null, `asset_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const cleanName = fixKoreanFileName(file.originalname);
    const ext = path.extname(cleanName).toLowerCase();
    if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Only JPG, PNG, GIF, WEBP, and SVG are allowed.'), false);
    }
  }
});

function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 로컬 루프백 소켓 IP만 엄격히 판정 (Host 헤더 조작 공격 원천 차단)
function isLocalClient(req) {
  let clientIp = req.socket.remoteAddress || '';
  if (clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }
  return clientIp === '127.0.0.1' || clientIp === '::1';
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers['x-admin-token'] || req.query.token;
  if (token === ADMIN_SESSION_TOKEN) return next();
  return res.status(403).json({ error: 'Main Operator (Admin) authorization required.' });
}

function requireOperatorOrAdmin(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers['x-admin-token'] || req.query.token;
  if (token === ADMIN_SESSION_TOKEN || token === OPERATOR_SESSION_TOKEN) return next();
  return res.status(401).json({ error: 'Operator authorization required.' });
}

function requireAnyAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers['x-admin-token'] || req.query.token;
  const viewKey = req.query.viewKey;
  if (token === ADMIN_SESSION_TOKEN || token === OPERATOR_SESSION_TOKEN || (viewKey && viewKey === serverConfig.viewKey)) {
    return next();
  }

  const referer = req.headers.referer || '';
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const reqHost = req.headers.host || '';
      const allowedHosts = ['localhost', '127.0.0.1', getLocalLanIp()];
      const isSameHost = (refUrl.host === reqHost) || allowedHosts.includes(refUrl.hostname);

      if (isSameHost) {
        const refKey = refUrl.searchParams.get('viewKey');
        if (refKey && refKey === serverConfig.viewKey) return next();
        if (refUrl.pathname === '/' || refUrl.pathname === '/console.html' || refUrl.pathname === '/overlay.html') {
          return next();
        }
      }
    } catch (e) {}
  }
  return res.status(403).send('Forbidden: Access denied.');
}

function broadcastToAll(payload) {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && !client.isDummy) {
      client.send(JSON.stringify(payload));
    }
  });
}

function openDefaultBrowser(url) {
  return new Promise((resolve) => {
    let cmd = '';
    if (process.platform === 'darwin') {
      cmd = `open "${url}"`;
    } else if (process.platform === 'win32') {
      cmd = `cmd.exe /c start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    exec(cmd, { windowsHide: true }, (err) => {
      if (err) console.error('[BLT] Failed to launch default browser:', err);
      resolve();
    });
  });
}

function handleClientDisconnect() {}

function probeServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/session-status`, { timeout: 400 }, (res) => {
      if (res.statusCode !== 200) return resolve(false);
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && (json.app === 'browser-lite-titles' || json.app === 'obs-subtitle-server')) {
            return resolve(true);
          }
        } catch (e) {}
        resolve(false);
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function checkExistingServerAndRun() {
  console.log('[BLT] Checking for existing server instances...');

  let portFromFile = null;
  try {
    if (fs.existsSync(portFilePath)) {
      const content = JSON.parse(fs.readFileSync(portFilePath, 'utf8'));
      if (content && content.port) portFromFile = parseInt(content.port, 10);
    }
  } catch (e) {}

  if (portFromFile && !isNaN(portFromFile)) {
    const isRunning = await probeServer(portFromFile);
    if (isRunning) {
      console.log(`[BLT] Existing server instance found on port ${portFromFile}.`);
      console.log(`[BLT] Launching browser for active instance: http://127.0.0.1:${portFromFile}`);
      await openDefaultBrowser(`http://127.0.0.1:${portFromFile}`);
      process.exit(0);
      return;
    }
  }

  for (let p = 3000; p <= 3005; p++) {
    if (p === portFromFile) continue;
    const isRunning = await probeServer(p);
    if (isRunning) {
      console.log(`[BLT] Existing server instance discovered on port ${p}.`);
      console.log(`[BLT] Launching browser for active instance: http://127.0.0.1:${p}`);
      await openDefaultBrowser(`http://127.0.0.1:${p}`);
      process.exit(0);
      return;
    }
  }

  console.log('[BLT] No active instance found. Initializing new server...');
  startLocalServer(3000);
}

function startLocalServer(startPort = 3000) {
  const expressApp = express();
  server = http.createServer(expressApp);
  wss = new WebSocketServer({ server });

  expressApp.use(express.json({ limit: '100mb' }));

  // CSRF 방어: 상태 변경(POST/PUT/DELETE/PATCH) 요청에 대한 엄격한 Origin/Host 검증
  expressApp.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      let originHeader = req.headers.origin;
      if (!originHeader && req.headers.referer) {
        try {
          originHeader = new URL(req.headers.referer).origin;
        } catch (e) {}
      }

      if (!originHeader) {
        return res.status(403).json({ success: false, message: 'Forbidden: Missing Origin header.' });
      }

      try {
        const originUrl = new URL(originHeader);
        const reqHost = (req.headers.host || '').toLowerCase();
        if (originUrl.host.toLowerCase() !== reqHost) {
          return res.status(403).json({ success: false, message: 'Forbidden: Cross-Origin Request Blocked.' });
        }
      } catch (e) {
        return res.status(403).json({ success: false, message: 'Forbidden: Invalid Origin.' });
      }
    }
    next();
  });

  // 1. 사용자 업로드 미디어 파일 서빙
  expressApp.use('/media', requireAnyAuth, (req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    next();
  }, express.static(uploadDir));

  // 2. 메인 콘솔 페이지 서빙
  expressApp.get(['/', '/console.html'], (req, res, next) => {
    const served = serveVfsFile(res, 'console.html');
    if (served) return;
    next();
  });

  // 3. 오버레이 페이지 서빙
  expressApp.get('/overlay.html', requireAnyAuth, (req, res, next) => {
    const served = serveVfsFile(res, 'overlay.html');
    if (served) return;
    next();
  });

  // 4. 기타 public 내부 정적 에셋 서빙
  expressApp.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const served = serveVfsFile(res, req.path);
    if (served) return;
    next();
  });

  // API 라우터
  expressApp.get('/api/session-status', (req, res) => {
    res.json({
      app: 'browser-lite-titles',
      isLocal: isLocalClient(req),
      isSessionInitialized,
      projectFileName: currentProjectFileName,
      port: activePort
    });
  });

  expressApp.get('/api/system-fonts', async (req, res) => {
    if (cachedSystemFonts.length === 0 && fontScanPromise) {
      cachedSystemFonts = await fontScanPromise;
    }
    const defaultFont = (process.platform === 'darwin') ? 'Apple SD Gothic Neo' : 'Malgun Gothic';
    res.json({
      success: true,
      platform: process.platform,
      defaultFont,
      fonts: cachedSystemFonts
    });
  });

  expressApp.post('/api/session/init', (req, res) => {
    if (!isLocalClient(req)) {
      return res.status(403).json({ success: false, message: 'New projects can only be created from the local server machine.' });
    }

    const { newAdminPassword, newOperatorPassword } = req.body;
    const adminPw = (newAdminPassword && newAdminPassword.trim()) ? newAdminPassword.trim() : 'admin1234';
    const operatorPw = (newOperatorPassword && newOperatorPassword.trim()) ? newOperatorPassword.trim() : 'title1234';

    serverConfig = createFreshSessionConfig(adminPw, operatorPw);
    dataStore = createFreshDataStore();
    isSessionInitialized = true;
    currentProjectFileName = 'Untitled Project';

    broadcastToAll({
      type: 'project_reloaded',
      channel: 'all',
      data: { store: dataStore, viewKey: serverConfig.viewKey, projectFileName: currentProjectFileName }
    });

    return res.json({
      success: true,
      token: ADMIN_SESSION_TOKEN,
      role: 'admin',
      lanIp: getLocalLanIp(),
      port: activePort,
      viewKey: serverConfig.viewKey,
      projectFileName: currentProjectFileName,
      message: 'New project created successfully.'
    });
  });

  expressApp.post('/api/login', async (req, res) => {
    const isLocal = isLocalClient(req);

    if (!isLocal && !isSessionInitialized) {
      return res.status(400).json({
        success: false,
        message: 'No active session found. Please initialize a project on the main host first.'
      });
    }

    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password is required.' });

    // 관리자 로그인은 오직 로컬 루프백 접속일 때만 허용
    if (isLocal && verifyPassword(password, serverConfig.adminPasswordHash, serverConfig.salt)) {
      return res.json({
        success: true,
        token: ADMIN_SESSION_TOKEN,
        role: 'admin',
        lanIp: getLocalLanIp(),
        port: activePort,
        viewKey: serverConfig.viewKey,
        projectFileName: currentProjectFileName
      });
    }

    // 서브 오퍼레이터 비밀번호 검증
    if (verifyPassword(password, serverConfig.operatorPasswordHash, serverConfig.salt)) {
      return res.json({
        success: true,
        token: OPERATOR_SESSION_TOKEN,
        role: 'operator',
        lanIp: getLocalLanIp(),
        port: activePort,
        viewKey: serverConfig.viewKey,
        projectFileName: currentProjectFileName
      });
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    return res.status(401).json({ success: false, message: 'Invalid password.' });
  });

  expressApp.post('/api/project/load', projectUpload.single('projectFile'), async (req, res) => {
    if (!isLocalClient(req)) {
      return res.status(403).json({ success: false, message: 'Loading projects is only permitted on the local server machine.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'No .bltproj file received.' });
    }

    const password = req.body.password || '';
    const fileName = req.body.fileName || 'Project.bltproj';

    try {
      const zip = new AdmZip(req.file.buffer);
      const projectJsonEntry = zip.getEntry('project.json');
      if (!projectJsonEntry) {
        return res.status(400).json({ success: false, message: 'Invalid file: project.json missing in package.' });
      }

      const projectData = JSON.parse(zip.readAsText(projectJsonEntry));
      const { security, store } = projectData;

      if (!verifyPassword(password, security.adminPasswordHash, security.salt)) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        return res.status(401).json({ success: false, message: 'Admin password does not match the project file.' });
      }

      if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      }
      fs.mkdirSync(uploadDir, { recursive: true });

      // Path Traversal (Zip Slip) 방어: uploadDir 절대 경로를 기준으로 탈출 여부 검증
      const resolvedUploadDir = path.resolve(uploadDir);
      const entries = zip.getEntries();
      entries.forEach(entry => {
        if (entry.entryName.startsWith('assets/') && !entry.isDirectory) {
          const fname = path.basename(entry.entryName);
          if (fname) {
            const targetPath = path.resolve(resolvedUploadDir, fname);
            if (targetPath.startsWith(resolvedUploadDir + path.sep)) {
              fs.writeFileSync(targetPath, entry.getData());
            }
          }
        }
      });

      if (store && store.channelData) {
        Object.keys(store.channelData).forEach((chId) => {
          if (store.channelData[chId]) {
            const cData = store.channelData[chId];
            const titles = cData.titleList || cData.subtitleList || [];
            cData.titleList = titles;
            delete cData.subtitleList;

            cData.liveState = {
              isVisible: false,
              title: null,
              transition: (cData.canvasConfig && cData.canvasConfig.transition) || 'fade',
              canvasW: (cData.canvasConfig && cData.canvasConfig.canvasW) || 1920,
              canvasH: (cData.canvasConfig && cData.canvasConfig.canvasH) || 1080,
              timestamp: Date.now()
            };
          }
        });
      }

      serverConfig = {
        salt: security.salt,
        adminPasswordHash: security.adminPasswordHash,
        operatorPasswordHash: security.operatorPasswordHash,
        viewKey: security.viewKey || crypto.randomBytes(12).toString('hex')
      };
      dataStore = store;
      isSessionInitialized = true;
      currentProjectFileName = (fileName && fileName.trim()) ? fileName.trim() : 'Project.bltproj';

      broadcastToAll({
        type: 'project_reloaded',
        channel: 'all',
        data: { store: dataStore, viewKey: serverConfig.viewKey, projectFileName: currentProjectFileName }
      });

      return res.json({
        success: true,
        token: ADMIN_SESSION_TOKEN,
        role: 'admin',
        lanIp: getLocalLanIp(),
        port: activePort,
        viewKey: serverConfig.viewKey,
        projectFileName: currentProjectFileName,
        store: dataStore
      });
    } catch (err) {
      console.error('[BLT] Failed to unpack .bltproj:', err);
      return res.status(400).json({ success: false, message: 'Corrupted or invalid .bltproj file.' });
    }
  });

  expressApp.post('/api/project/export', requireAdmin, (req, res) => {
    if (req.body && req.body.store) {
      dataStore = req.body.store;
    }
    if (req.body && req.body.fileName) {
      currentProjectFileName = req.body.fileName;
      if (!currentProjectFileName.endsWith('.bltproj')) {
        currentProjectFileName += '.bltproj';
      }
      broadcastToAll({
        type: 'update_project_name',
        channel: 'all',
        data: { projectFileName: currentProjectFileName }
      });
    }

    const exportPayload = {
      version: 1,
      createdAt: new Date().toISOString(),
      security: {
        salt: serverConfig.salt,
        adminPasswordHash: serverConfig.adminPasswordHash,
        operatorPasswordHash: serverConfig.operatorPasswordHash,
        viewKey: serverConfig.viewKey
      },
      store: dataStore
    };

    try {
      const zip = new AdmZip();
      zip.addFile('project.json', Buffer.from(JSON.stringify(exportPayload, null, 2), 'utf8'));

      if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        files.forEach(file => {
          const filePath = path.join(uploadDir, file);
          if (fs.statSync(filePath).isFile()) {
            zip.addLocalFile(filePath, 'assets');
          }
        });
      }

      const zipBuffer = zip.toBuffer();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(currentProjectFileName)}"`);
      res.setHeader('x-project-filename', encodeURIComponent(currentProjectFileName));
      return res.send(zipBuffer);
    } catch (err) {
      console.error('[BLT] Export error:', err);
      return res.status(500).json({ success: false, message: 'Failed to package .bltproj file.' });
    }
  });

  expressApp.post('/api/project/new', requireAdmin, (req, res) => {
    if (!isLocalClient(req)) {
      return res.status(403).json({ success: false, message: 'Resetting projects is only permitted on the local server machine.' });
    }

    try {
      if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (e) {}

    const { newAdminPassword, newOperatorPassword } = req.body;
    const adminPw = (newAdminPassword && newAdminPassword.trim()) ? newAdminPassword.trim() : 'admin1234';
    const operatorPw = (newOperatorPassword && newOperatorPassword.trim()) ? newOperatorPassword.trim() : 'title1234';

    serverConfig = createFreshSessionConfig(adminPw, operatorPw);
    dataStore = createFreshDataStore();
    isSessionInitialized = true;
    currentProjectFileName = 'Untitled Project';

    broadcastToAll({
      type: 'project_reloaded',
      channel: 'all',
      data: { store: dataStore, viewKey: serverConfig.viewKey, projectFileName: currentProjectFileName }
    });

    return res.json({
      success: true,
      viewKey: serverConfig.viewKey,
      projectFileName: currentProjectFileName,
      message: 'New project initialized successfully.'
    });
  });

  expressApp.post('/api/change-password', requireAdmin, (req, res) => {
    const { currentAdminPassword, newAdminPassword, newOperatorPassword } = req.body;
    if (!currentAdminPassword) {
      return res.status(400).json({ success: false, message: 'Current admin password is required.' });
    }

    if (!verifyPassword(currentAdminPassword, serverConfig.adminPasswordHash, serverConfig.salt)) {
      return res.status(400).json({ success: false, message: 'Current admin password does not match.' });
    }

    let msg = [];
    if (newAdminPassword && newAdminPassword.trim()) {
      serverConfig.adminPasswordHash = hashPassword(newAdminPassword.trim(), serverConfig.salt);
      msg.push('Admin password');
    }
    if (newOperatorPassword && newOperatorPassword.trim()) {
      serverConfig.operatorPasswordHash = hashPassword(newOperatorPassword.trim(), serverConfig.salt);
      msg.push('Operator password');

      OPERATOR_SESSION_TOKEN = crypto.randomBytes(16).toString('hex');

      if (wss) {
        wss.clients.forEach((client) => {
          if (!client.isDummy && client.isOperator) {
            client.close(4001, 'Operator Password Changed');
          }
        });
      }
    }

    return res.json({ success: true, message: `${msg.join(' and ')} updated successfully.` });
  });

  expressApp.post('/api/regenerate-viewkey', requireAdmin, (req, res) => {
    serverConfig.viewKey = crypto.randomBytes(12).toString('hex');

    wss.clients.forEach((client) => {
      if (!client.isDummy) {
        if (!client.isAdmin && !client.isOperator) {
          client.close(4001, 'ViewKey Regenerated');
        } else if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'update_viewkey',
            channel: 'all',
            data: { viewKey: serverConfig.viewKey }
          }));
        }
      }
    });

    return res.json({ success: true, viewKey: serverConfig.viewKey });
  });

  expressApp.get('/api/data', requireOperatorOrAdmin, (req, res) => {
    res.json({
      success: true,
      store: dataStore,
      viewKey: serverConfig.viewKey,
      projectFileName: currentProjectFileName,
      lanIp: getLocalLanIp(),
      port: activePort
    });
  });

  expressApp.post('/api/upload', requireOperatorOrAdmin, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file received.' });

      const cleanName = fixKoreanFileName(req.file.originalname);
      return res.json({
        url: `/media/${req.file.filename}`,
        name: cleanName
      });
    });
  });

  // 서버 셧다운: 유효한 Admin 토큰 소지 및 로컬 루프백 접속을 동시 강제
  expressApp.post('/api/shutdown', (req, res) => {
    const token = req.headers['x-auth-token'] || req.headers['x-admin-token'] || req.query.token;
    const isLocal = isLocalClient(req);

    if (token === ADMIN_SESSION_TOKEN && isLocal) {
      res.json({ success: true, message: 'All title transmissions stopped. Server process terminating.' });
      console.log('\n[BLT] Shutdown requested by admin via web console.');
      handleShutdown();
    } else {
      res.status(403).json({ success: false, message: 'Unauthorized: Shutdown is only permitted for authenticated admin on local machine.' });
    }
  });

  // WebSocket 연결 처리 (Host와 Origin 동적 일치 검증)
  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const reqHost = (req.headers.host || '').toLowerCase();
        // 다중 LAN 카드 환경을 지원하기 위해 현재 요청받은 Host와 Origin을 정밀 비교
        if (originUrl.host.toLowerCase() !== reqHost) {
          ws.close(4003, 'Forbidden Origin');
          return;
        }
      } catch (e) {
        ws.close(4003, 'Invalid Origin');
        return;
      }
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const isPresence = reqUrl.searchParams.get('type') === 'presence';

    if (isPresence) {
      ws.isDummy = true;
      ws.on('close', () => {
        handleClientDisconnect();
      });
      return;
    }

    const token = reqUrl.searchParams.get('token');
    const viewKey = reqUrl.searchParams.get('viewKey');
    const channel = reqUrl.searchParams.get('channel') || (dataStore.channels[0] ? dataStore.channels[0].id : '');

    const isAdmin = (token === ADMIN_SESSION_TOKEN);
    const isOperator = (token === OPERATOR_SESSION_TOKEN);
    const isViewer = (viewKey === serverConfig.viewKey);

    if (!isAdmin && !isOperator && !isViewer) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.isDummy = false;
    ws.isAdmin = isAdmin;
    ws.isOperator = isOperator;
    ws.channel = channel;

    if (!isAdmin && !isOperator && dataStore.channelData[channel]) {
      const chData = dataStore.channelData[channel];
      if (chData.canvasConfig) ws.send(JSON.stringify({ type: 'canvas', channel, data: chData.canvasConfig }));
      if (chData.liveState) ws.send(JSON.stringify({ type: 'live', channel, data: chData.liveState }));
    }

    ws.on('message', (message) => {
      if (!ws.isAdmin && !ws.isOperator) return;

      try {
        const payload = JSON.parse(message.toString());
        const { type, channel: targetChannel, data } = payload;

        if ((type === 'update_titles' || type === 'update_subtitles') && targetChannel) {
          if (!dataStore.channelData[targetChannel]) dataStore.channelData[targetChannel] = {};
          dataStore.channelData[targetChannel].titleList = data;
          delete dataStore.channelData[targetChannel].subtitleList;
        } else if (type === 'live' && targetChannel) {
          if (!dataStore.channelData[targetChannel]) dataStore.channelData[targetChannel] = {};
          dataStore.channelData[targetChannel].liveState = data;
        } else if (type === 'canvas' && targetChannel) {
          if (!dataStore.channelData[targetChannel]) dataStore.channelData[targetChannel] = {};
          dataStore.channelData[targetChannel].canvasConfig = data;
        } else if (type === 'update_channels') {
          dataStore.channels = data;
        } else if (type === 'update_assets') {
          dataStore.assets = data;
        } else if (type === 'update_project_name' && data) {
          currentProjectFileName = data.projectFileName;
        }

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && !client.isDummy) {
            if (client.isAdmin || client.isOperator || client.channel === targetChannel || client.channel === 'all') {
              client.send(JSON.stringify(payload));
            }
          }
        });
      } catch (err) {
        console.error('[BLT] WebSocket message processing error:', err);
      }
    });

    ws.on('close', () => {
      handleClientDisconnect();
    });
  });

  server.listen(startPort, '0.0.0.0', () => {
    activePort = startPort;
    const lanIp = getLocalLanIp();
    const localUrl = `http://127.0.0.1:${activePort}`;

    try {
      fs.writeFileSync(portFilePath, JSON.stringify({ port: activePort, pid: process.pid }), 'utf8');
    } catch (e) {}

    console.log(`[BLT] Server running at http://${lanIp}:${activePort}`);
    console.log(`[BLT] Launching browser controller: ${localUrl}`);
    
    openDefaultBrowser(localUrl);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      try { if (wss) wss.close(); } catch (e) {}
      try { if (server) server.close(); } catch (e) {}
      startLocalServer(startPort + 1);
    }
  });
}

function handleShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n[BLT] Initiating graceful shutdown sequence...');

  // 1. 송출 중인 모든 채널의 온에어 자막 즉시 클리어 및 WebSocket 브로드캐스트
  try {
    if (dataStore && dataStore.channelData) {
      Object.keys(dataStore.channelData).forEach((chId) => {
        if (dataStore.channelData[chId] && dataStore.channelData[chId].liveState) {
          dataStore.channelData[chId].liveState.isVisible = false;
          dataStore.channelData[chId].liveState.title = null;
          dataStore.channelData[chId].liveState.timestamp = Date.now();
        }
      });
    }

    if (wss && wss.clients) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && !client.isDummy) {
          if (dataStore && dataStore.channelData) {
            Object.keys(dataStore.channelData).forEach((chId) => {
              client.send(JSON.stringify({
                type: 'live',
                channel: chId,
                data: dataStore.channelData[chId].liveState
              }));
            });
          }
        }
      });
    }
  } catch (err) {
    console.error('[BLT] Error broadcasting subtitle clear on shutdown:', err);
  }

  // 2. 오버레이 페이드아웃 및 WebSocket 전송 완료를 위해 400ms 대기 후 리소스 정리 및 종료
  setTimeout(() => {
    console.log('[BLT] Releasing system resources and exiting...');

    try {
      if (fs.existsSync(portFilePath)) fs.unlinkSync(portFilePath);
    } catch (e) {}

    try {
      if (fs.existsSync(uploadDir)) {
        fs.rmSync(uploadDir, { recursive: true, force: true });
        console.log('[BLT] Cleaned up temporary media uploads.');
      }
    } catch (e) {
      console.error('[BLT] Failed to cleanup media uploads:', e);
    }

    try { if (wss) wss.close(); } catch (e) {}

    try {
      if (server) {
        server.close(() => process.exit(0));
      } else {
        process.exit(0);
      }
    } catch (e) {
      process.exit(0);
    }

    // 소켓 지연 등으로 인해 블로킹되는 경우를 방지하기 위한 강제 종료 타이머 (1초)
    setTimeout(() => process.exit(0), 1000).unref();
  }, 400);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// Windows 환경에서 네이티브 런처가 표준 입력으로 전달한 종료 신호 수신
if (process.platform === 'win32') {
  process.stdin.on('data', (chunk) => {
    if (chunk && chunk.toString().trim() === 'shutdown') {
      handleShutdown();
    }
  });
}

checkExistingServerAndRun();