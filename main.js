const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sudo = require('sudo-prompt');

app.disableHardwareAcceleration();

let splash;
let mainWindow;

function createWindow() {
  // Splash screen
  splash = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false
  });

  splash.loadFile(path.join(__dirname, 'renderer/splash.html'));

  // Main app window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    splash.close();
    mainWindow.show();
  });
}

ipcMain.handle('cleanup-registry', async (event, psScript) => {
  return new Promise((resolve) => {
    sudo.exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, { name: 'BumbleGum Guitar Configurator' }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
