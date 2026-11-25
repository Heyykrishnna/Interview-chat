import { app, BrowserWindow, globalShortcut, desktopCapturer, ipcMain, session, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let stealthFocusEnabled = true;

function applyFocusLockState(locked) {
  stealthFocusEnabled = Boolean(locked);
  if (!mainWindow || mainWindow.isDestroyed()) return stealthFocusEnabled;
  if (stealthFocusEnabled) {
    if (mainWindow.isFocused()) {
      mainWindow.blur();
    }
    mainWindow.setFocusable(false);
  } else {
    mainWindow.setFocusable(true);
    mainWindow.focus();
  }
  mainWindow.webContents.send('STEALTH_FOCUS_CHANGED', stealthFocusEnabled);
  return stealthFocusEnabled;
}

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const initialW = 440;
  const initialH = 540;

  mainWindow = new BrowserWindow({
    width: initialW,
    height: initialH,
    x: screenW - initialW - 24,
    y: 32,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  if (process.platform === 'win32' || process.platform === 'darwin') {
    mainWindow.setContentProtection(true);
  }

  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadURL('http://localhost:5555');

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.showInactive();
  });

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.showInactive();
    }
  });

  globalShortcut.register('CommandOrControl+Shift+G', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('TOGGLE_GHOST_MODE_FROM_MAIN');
  });

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
    mainWindow.webContents.send('TRIGGER_SCREEN_SNAP_FROM_MAIN');
  });

  globalShortcut.register('CommandOrControl+Shift+K', () => {
    applyFocusLockState(!stealthFocusEnabled);
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const screenSource = sources[0];
      if (!screenSource) {
        callback({});
        return;
      }
      const useLoopback = process.platform === 'darwin' || process.platform === 'win32';
      callback({
        video: screenSource,
        ...(useLoopback ? { audio: 'loopback' } : {}),
      });
    } catch (err) {
      console.error('Display media handler failed:', err);
      callback({});
    }
  }, { useSystemPicker: false });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('GET_SOURCES', async (_event, types) => {
  const sources = await desktopCapturer.getSources({ types: types || ['window', 'screen'] });
  return sources;
});

ipcMain.handle('TOGGLE_MOUSE_EVENTS', (_event, ghostMode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (ghostMode) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

ipcMain.handle('GET_WINDOW_BOUNDS', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 0, y: 0, width: 440, height: 540 };
  return mainWindow.getBounds();
});

ipcMain.handle('SET_WINDOW_BOUNDS', (_event, bounds) => {
  if (!mainWindow || mainWindow.isDestroyed() || !bounds) return;
  const { x, y, width, height } = bounds;
  mainWindow.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(200, Math.round(width)),
    height: Math.max(48, Math.round(height)),
  });
});

ipcMain.handle('GET_FOCUS_LOCK', () => stealthFocusEnabled);

ipcMain.handle('SET_FOCUS_LOCK', (_event, locked) => {
  return applyFocusLockState(locked);
});

ipcMain.handle('CAPTURE_FULL_SCREEN', async () => {
  const targetDisplay = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const scale = Math.min(targetDisplay.scaleFactor || 1, 2);
  const rawW = Math.round(targetDisplay.size.width * scale);
  const rawH = Math.round(targetDisplay.size.height * scale);
  const maxW = 2400;
  const ratio = rawW > maxW ? maxW / rawW : 1;
  const targetW = Math.max(1280, Math.round(rawW * ratio));
  const targetH = Math.max(720, Math.round(rawH * ratio));

  let temporarilyHidden = false;
  if (process.platform === 'linux' && mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
    temporarilyHidden = true;
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetW, height: targetH },
    });

    const source = sources.find(s => s.display_id === String(targetDisplay.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      return { error: 'SCREEN_CAPTURE_UNAVAILABLE' };
    }

    const size = source.thumbnail.getSize();
    return {
      dataUrl: source.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
      displayName: source.name,
    };
  } finally {
    if (temporarilyHidden && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
    }
  }
});
