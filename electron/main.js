import { app, BrowserWindow, globalShortcut, desktopCapturer, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simplicity in prototyping, normally use preload
    },
  });

  // Make sure it floats above EVERYTHING including full-screen apps like Chrome/Zoom
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Set the window to be ignored by screen capture (where supported)
  // This helps hide the UI during screen sharing!
  if (process.platform === 'win32' || process.platform === 'darwin') {
    mainWindow.setContentProtection(true);
  }

  // Click-through mechanism
  // We can make it click-through, but then the user can't interact with it.
  // We will expose an IPC method to toggle click-through
  mainWindow.setIgnoreMouseEvents(false);

  // Load the Vite dev server URL or the built index.html
  // Force localhost:5555 since we are running vite concurrently in dev
  mainWindow.loadURL('http://localhost:5555');

  // Keyboard shortcut to toggle UI click-through or visibility
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  // Global shortcut to toggle Ghost Mode (click-through)
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    mainWindow.webContents.send('TOGGLE_GHOST_MODE_FROM_MAIN');
  });
}

app.whenReady().then(() => {
  // Auto-allow all permissions (Microphone, etc.)
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

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

// IPC handler to get desktop streams for capturing
ipcMain.handle('GET_SOURCES', async (event, types) => {
  const sources = await desktopCapturer.getSources({ types: types || ['window', 'screen'] });
  return sources;
});

// IPC handler to toggle ignore mouse events
ipcMain.handle('TOGGLE_MOUSE_EVENTS', (event, ignore) => {
  if (mainWindow) {
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  }
});
