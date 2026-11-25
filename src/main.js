const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

let mainWindow;
let allowWindowClose = false;
let exitSequenceRequested = false;
let exitFailsafeTimer = null;
const trustedDocumentUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.();
  if (senderUrl !== trustedDocumentUrl) {
    throw new Error('Blocked IPC request from an untrusted document.');
  }
}

function registerTrustedHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return handler(...args);
  });
}

function requestAnimatedClose() {
  if (!mainWindow || mainWindow.isDestroyed() || allowWindowClose) return;
  if (exitSequenceRequested) return;
  exitSequenceRequested = true;
  mainWindow.webContents.send('app:begin-exit');
  clearTimeout(exitFailsafeTimer);
  exitFailsafeTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    allowWindowClose = true;
    mainWindow.close();
  }, 20000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    backgroundColor: '#050608',
    icon: path.join(__dirname, '..', 'assets', 'sprite-creator.ico'),
    title: 'Sprite Creator',
    show: false,
    frame: true,
    fullscreen: false,
    fullscreenable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Start maximized inside a normal Windows window. Keep the native title bar
  // and minimize / restore / close controls visible so the app feels familiar.
  // Maximize before the renderer loads so its first canvas measurement is correct.
  mainWindow.maximize();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== trustedDocumentUrl) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', event => {
    if (allowWindowClose) return;
    event.preventDefault();
    requestAnimatedClose();
  });
  mainWindow.on('closed', () => { clearTimeout(exitFailsafeTimer); mainWindow = null; });
}

app.setName('Sprite Creator');
app.setAppUserModelId('com.spritecreator.desktop');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    // The application is fully local. Deny permission prompts by default.
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

registerTrustedHandler('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Sprite Creator project',
    properties: ['openFile'],
    filters: [
      { name: 'Sprite Creator project', extensions: ['spritecreator', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath, 'utf8');
  return { canceled: false, filePath, data };
});

registerTrustedHandler('project:save', async (payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Sprite Creator project',
    defaultPath: payload?.defaultName || 'My Sprite.spritecreator',
    filters: [{ name: 'Sprite Creator project', extensions: ['spritecreator'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, String(payload?.data ?? ''), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

registerTrustedHandler('file:save-bytes', async (payload) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: payload?.title || 'Export image',
    defaultPath: payload?.defaultName || 'sprite.png',
    filters: payload?.filters || [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const bytes = Buffer.from(payload?.base64 || '', 'base64');
  await fs.writeFile(result.filePath, bytes);
  return { canceled: false, filePath: result.filePath };
});

// Minimal ZIP writer using Node's built-in zlib. This keeps asset bundles
// dependency-free and lets the user export a PNG + metadata as one package.
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const file of files) {
    const safeName = String(file?.name || 'asset.bin').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '') || 'asset.bin';
    const name = Buffer.from(safeName, 'utf8');
    const data = Buffer.from(String(file?.base64 || ''), 'base64');
    if (data.length > 128 * 1024 * 1024) throw new Error(`Asset is too large to bundle: ${safeName}`);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 file name
    local.writeUInt16LE(8, 8); // DEFLATE
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

registerTrustedHandler('file:save-bundle', async (payload) => {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (!files.length || files.length > 32) throw new Error('An export bundle must contain between 1 and 32 files.');
  let totalBytes = 0;
  for (const file of files) {
    const size = Math.floor(String(file?.base64 || '').length * 0.75);
    totalBytes += size;
    if (size > 128 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024) throw new Error('The requested asset bundle is too large to package.');
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: payload?.title || 'Save asset bundle',
    defaultPath: payload?.defaultName || 'Sprite-Creator-Assets.zip',
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, zipFiles(files));
  return { canceled: false, filePath: result.filePath };
});

registerTrustedHandler('app:show-in-folder', async (filePath) => {
  if (typeof filePath === 'string' && filePath.length) shell.showItemInFolder(filePath);
});



registerTrustedHandler('app:toggle-fullscreen', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});
registerTrustedHandler('app:request-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });
registerTrustedHandler('app:complete-close', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(exitFailsafeTimer);
  allowWindowClose = true;
  exitSequenceRequested = false;
  mainWindow.close();
});
registerTrustedHandler('app:open-external', async (rawUrl) => {
  try { const url = new URL(String(rawUrl)); if (url.protocol !== 'https:') return false; await shell.openExternal(url.toString()); return true; }
  catch { return false; }
});
