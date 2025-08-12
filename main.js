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
    if (splash && !splash.isDestroyed()) {
      splash.close();
    }
    mainWindow.show();
  });
}

ipcMain.handle('cleanup-registry', async (event, psScript) => {
  return new Promise((resolve) => {
    sudo.exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`, { name: 'BBG Controller Configurator' }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
});

// Auto-updater IPC handlers
ipcMain.handle('get-current-version', async () => {
  try {
    const packageJson = require('./package.json');
    return packageJson.version;
  } catch (error) {
    console.error('Error reading package.json:', error);
    return '3.9.15'; // Fallback version
  }
});

ipcMain.handle('download-update', async (event, { url, fileName, onProgress }) => {
  return new Promise((resolve) => {
    try {
      const os = require('os');
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      
      // Create downloads directory if it doesn't exist (though it usually does)
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }

      const filePath = path.join(downloadsDir, fileName);
      const file = fs.createWriteStream(filePath);

      console.log(`[AutoUpdater] Downloading update to Downloads folder: ${filePath}`);

      const downloadFile = (downloadUrl, redirectCount = 0) => {
        if (redirectCount > 5) {
          console.error('[AutoUpdater] Too many redirects');
          resolve({ success: false, error: 'Too many redirects' });
          return;
        }

        https.get(downloadUrl, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            console.log(`[AutoUpdater] Redirect to: ${response.headers.location}`);
            downloadFile(response.headers.location, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            console.error(`[AutoUpdater] HTTP error: ${response.statusCode}`);
            resolve({ success: false, error: `HTTP ${response.statusCode}` });
            return;
          }

          const totalSize = parseInt(response.headers['content-length'], 10);
          let downloadedSize = 0;

          console.log(`[AutoUpdater] Download size: ${totalSize} bytes`);

          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            const progress = Math.round((downloadedSize / totalSize) * 100);
            
            // Send progress to renderer
            event.sender.send('download-progress', progress);
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(`[AutoUpdater] Download completed to Downloads folder: ${filePath}`);
            resolve({ success: true, filePath });
          });

          file.on('error', (error) => {
            fs.unlink(filePath, () => {}); // Delete partial file
            console.error('[AutoUpdater] Download error:', error);
            resolve({ success: false, error: error.message });
          });
        }).on('error', (error) => {
          console.error('[AutoUpdater] HTTPS request error:', error);
          resolve({ success: false, error: error.message });
        });
      };

      downloadFile(url);
    } catch (error) {
      console.error('[AutoUpdater] Download setup error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('install-update', async (event, downloadPath) => {
  return new Promise((resolve) => {
    try {
      console.log(`[AutoUpdater] Installing update from: ${downloadPath}`);

      // Get current executable path
      const currentExePath = process.execPath;
      const currentDir = path.dirname(currentExePath);
      const currentExeName = path.basename(currentExePath);
      const backupPath = path.join(currentDir, `${currentExeName}.backup`);
      const tempNewPath = path.join(currentDir, `${currentExeName}.new`);

      // Create a batch script to handle the update process
      const batchScript = `
@echo off
echo Updating BGG Configurator...
timeout /t 2 /nobreak >nul

REM Wait for main process to exit
:waitloop
tasklist /FI "IMAGENAME eq ${currentExeName}" 2>NUL | find /I /N "${currentExeName}">NUL
if "%ERRORLEVEL%"=="0" (
  timeout /t 1 /nobreak >nul
  goto waitloop
)

REM Backup current executable
if exist "${currentExePath}" (
  move "${currentExePath}" "${backupPath}"
)

REM Move new executable into place
move "${downloadPath}" "${currentExePath}"

REM Start updated application
start "" "${currentExePath}"

REM Clean up
timeout /t 3 /nobreak >nul
if exist "${backupPath}" (
  del "${backupPath}"
)
del "%~f0"
`;

      const batchPath = path.join(currentDir, 'update_installer.bat');
      fs.writeFileSync(batchPath, batchScript);

      console.log('[AutoUpdater] Starting update installer batch script');

      // Execute the batch script and quit the current app
      spawn('cmd.exe', ['/c', batchPath], {
        detached: true,
        stdio: 'ignore'
      });

      // Give the batch script a moment to start, then quit
      setTimeout(() => {
        app.quit();
      }, 1000);

      resolve({ success: true });
    } catch (error) {
      console.error('[AutoUpdater] Install error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('open-external-link', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('[AutoUpdater] Error opening external link:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-downloads-folder', async () => {
  try {
    const os = require('os');
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    await shell.openPath(downloadsPath);
    return { success: true };
  } catch (error) {
    console.error('[AutoUpdater] Error opening Downloads folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-app', async () => {
  app.quit();
  return { success: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
