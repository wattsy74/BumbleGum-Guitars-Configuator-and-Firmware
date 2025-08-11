const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const sudo = require('sudo-prompt');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

// Handle portable app startup safely
try {
  if (require('electron-squirrel-startup')) app.quit();
} catch (error) {
  // electron-squirrel-startup not available, continue normally
}

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
    resizable: false,
    show: true
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
    setTimeout(() => {
      splash.close();
      mainWindow.show();
    }, 3000);
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  // Auto-updater setup
  const autoUpdater = require('./renderer/autoUpdater');
  
  mainWindow.webContents.once('dom-ready', () => {
    console.log('[AutoUpdater] DOM ready, initializing auto-updater...');
    autoUpdater.initAutoUpdater(mainWindow);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers
ipcMain.handle('exit-app', async () => {
  app.quit();
});

ipcMain.handle('minimize-window', async () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

// SIMPLE AUTO-UPDATE HANDLER
ipcMain.handle('install-update', async (event, downloadPath) => {
  console.log('[AutoUpdater] Simple install starting:', downloadPath);
  
  return new Promise((resolve) => {
    try {
      // Get current app path - use the most reliable method
      let appPath = process.argv[0];
      
      // If argv[0] is in temp, search for the real app
      if (appPath.includes('AppData\\Local\\Temp')) {
        const desktop = path.join(require('os').homedir(), 'Desktop');
        try {
          const files = fs.readdirSync(desktop);
          const bggFile = files.find(f => 
            f.toLowerCase().includes('bgg') && 
            f.endsWith('.exe') &&
            fs.statSync(path.join(desktop, f)).size > 50000000
          );
          if (bggFile) {
            appPath = path.join(desktop, bggFile);
          }
        } catch (e) {
          console.error('[AutoUpdater] Error finding app file:', e);
        }
      }
      
      console.log('[AutoUpdater] App path:', appPath);
      console.log('[AutoUpdater] Download path:', downloadPath);
      
      // Create simple batch file for update
      const batchContent = `@echo off
echo === BGG Simple Update ===
echo Waiting for app to close...
timeout /t 5 /nobreak >nul

echo Copying update file...
copy "${downloadPath}" "${appPath}"
if errorlevel 1 (
    echo ERROR: Failed to copy file!
    echo Source: ${downloadPath}
    echo Target: ${appPath}
    pause
    exit /b 1
)

echo Update successful!
echo Starting updated app...
start "" "${appPath}"
echo Done!
timeout /t 2 /nobreak >nul
`;
      
      const batchPath = path.join(require('os').tmpdir(), 'bgg_simple_update.bat');
      fs.writeFileSync(batchPath, batchContent);
      
      console.log('[AutoUpdater] Created batch file:', batchPath);
      
      // Run the batch file with visible console
      const updateProcess = spawn('cmd', ['/k', batchPath], { 
        detached: true, 
        stdio: 'ignore' 
      });
      
      updateProcess.unref();
      console.log('[AutoUpdater] Update process started');
      
      // Quit the app after a short delay
      setTimeout(() => {
        console.log('[AutoUpdater] Quitting for update...');
        app.quit();
      }, 2000);
      
      resolve({ success: true });
    } catch (error) {
      console.error('[AutoUpdater] Simple update error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

// File verification handler
ipcMain.handle('verify-file', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File does not exist' };
    }
    
    const stats = fs.statSync(filePath);
    return {
      success: true,
      size: stats.size,
      lastModified: stats.mtime
    };
  } catch (error) {
    console.error('[AutoUpdater] File verification error:', error);
    return { success: false, error: error.message };
  }
});

// External link handler
ipcMain.handle('open-external-link', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('[AutoUpdater] Failed to open external link:', error);
    return { success: false, error: error.message };
  }
});

// Original device IPC handlers remain here...
// (keeping the rest of the original code for device functionality)
