import { app, BrowserWindow, globalShortcut, desktopCapturer, ipcMain, session, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const initialW = 440;
  const initialH = 520;

  mainWindow = new BrowserWindow({
    width: initialW,
    height: initialH,
    x: screenW - initialW - 24,
    y: 32,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
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

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  globalShortcut.register('CommandOrControl+Shift+G', () => {
    mainWindow.webContents.send('TOGGLE_GHOST_MODE_FROM_MAIN');
  });
}

app.whenReady().then(() => {
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
  if (!mainWindow) return;
  if (ghostMode) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

ipcMain.handle('GET_WINDOW_BOUNDS', () => {
  if (!mainWindow) return { x: 0, y: 0, width: 440, height: 520 };
  return mainWindow.getBounds();
});

ipcMain.handle('SET_WINDOW_BOUNDS', (_event, bounds) => {
  if (!mainWindow || !bounds) return;
  const { x, y, width, height } = bounds;
  mainWindow.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(200, Math.round(width)),
    height: Math.max(48, Math.round(height)),
  });
});
