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

ipcMain.handle('download-update', async (event, { url, fileName }) => {
  return new Promise((resolve) => {
    console.log(`[AutoUpdater] === DOWNLOAD REQUEST RECEIVED ===`);
    console.log(`[AutoUpdater] URL: ${url}`);
    console.log(`[AutoUpdater] Filename: ${fileName}`);
    
    // Create immediate debug log
    const debugLogPath = path.join(require('os').homedir(), 'Desktop', 'download_debug.txt');
    const debugLog = `
=== DOWNLOAD DEBUG LOG ===
Timestamp: ${new Date().toISOString()}
URL: ${url}
Filename: ${fileName}
Process ID: ${process.pid}
Download handler called: YES
`;
    
    try {
      fs.writeFileSync(debugLogPath, debugLog);
      console.log('[AutoUpdater] Download debug log created at:', debugLogPath);
    } catch (err) {
      console.error('[AutoUpdater] Failed to create download debug log:', err);
    }

    try {
      // Use Electron's app data directory for consistent, user-specific storage
      // This works across different operating systems and user accounts
      const { app } = require('electron');
      const appDataPath = app.getPath('userData');
      const updatesDir = path.join(appDataPath, 'updates');
      
      console.log(`[AutoUpdater] Using app data directory: ${updatesDir}`);
      
      // Create updates directory if it doesn't exist
      if (!fs.existsSync(updatesDir)) {
        fs.mkdirSync(updatesDir, { recursive: true });
        console.log(`[AutoUpdater] Created updates directory: ${updatesDir}`);
      }

      const filePath = path.join(updatesDir, fileName);
      const file = fs.createWriteStream(filePath);

      console.log(`[AutoUpdater] Downloading update to: ${filePath}`);
      console.log(`[AutoUpdater] Download URL: ${url}`);

      https.get(url, (response) => {
        console.log(`[AutoUpdater] Response status: ${response.statusCode}`);
        console.log(`[AutoUpdater] Response headers:`, response.headers);
        
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`[AutoUpdater] Redirect to: ${response.headers.location}`);
          // Follow redirect
          https.get(response.headers.location, (redirectResponse) => {
            const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
            let downloadedSize = 0;

            console.log(`[AutoUpdater] Starting download (after redirect), total size: ${totalSize} bytes`);

            redirectResponse.on('data', (chunk) => {
              downloadedSize += chunk.length;
              const progress = Math.round((downloadedSize / totalSize) * 100);
              
              // Send progress to renderer every 5% to avoid flooding
              if (progress % 5 === 0 || progress === 100) {
                console.log(`[AutoUpdater] Download progress: ${progress}%`);
                event.sender.send('download-progress', progress);
              }
            });

            redirectResponse.pipe(file);

            file.on('finish', () => {
              file.close();
              console.log(`[AutoUpdater] Download completed successfully: ${filePath}`);
              console.log(`[AutoUpdater] Final downloaded size: ${downloadedSize} bytes`);
              
              // Log to debug file
              try {
                fs.appendFileSync(debugLogPath, `Download completed: ${filePath} (${downloadedSize} bytes)\n`);
              } catch (e) {}
              
              resolve({ success: true, filePath });
            });

            file.on('error', (error) => {
              fs.unlink(filePath, () => {}); // Delete partial file
              console.error('[AutoUpdater] File write error:', error);
              resolve({ success: false, error: error.message });
            });
          }).on('error', (error) => {
            console.error('[AutoUpdater] Redirect HTTPS request error:', error);
            resolve({ success: false, error: error.message });
          });
          return;
        }
        
        // Handle non-200 responses
        if (response.statusCode !== 200) {
          console.error(`[AutoUpdater] Download failed with status: ${response.statusCode}`);
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        console.log(`[AutoUpdater] Starting download, total size: ${totalSize} bytes`);

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const progress = Math.round((downloadedSize / totalSize) * 100);
          
          // Send progress to renderer every 5% to avoid flooding
          if (progress % 5 === 0 || progress === 100) {
            console.log(`[AutoUpdater] Download progress: ${progress}%`);
            event.sender.send('download-progress', progress);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`[AutoUpdater] Download completed successfully: ${filePath}`);
          console.log(`[AutoUpdater] Final downloaded size: ${downloadedSize} bytes`);
          resolve({ success: true, filePath });
        });

        file.on('error', (error) => {
          fs.unlink(filePath, () => {}); // Delete partial file
          console.error('[AutoUpdater] File write error:', error);
          resolve({ success: false, error: error.message });
        });
      }).on('error', (error) => {
        console.error('[AutoUpdater] HTTPS request error:', error);
        resolve({ success: false, error: error.message });
      });
    } catch (error) {
      console.error('[AutoUpdater] Download setup error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('verify-downloaded-file', async (event, filePath) => {
  try {
    console.log(`[AutoUpdater] Verifying downloaded file: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }
    
    // Get file stats
    const stats = fs.statSync(filePath);
    console.log(`[AutoUpdater] File size: ${stats.size} bytes`);
    
    // Check if file has content (at least 1MB for an executable)
    if (stats.size < 1024 * 1024) {
      return { success: false, error: `File too small: ${stats.size} bytes` };
    }
    
    // Additional check: try to read the first few bytes to ensure file is accessible
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(4);
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);
      
      // Check for PE header (Windows executable)
      if (buffer[0] === 0x4D && buffer[1] === 0x5A) { // "MZ" header
        console.log('[AutoUpdater] File appears to be a valid Windows executable');
        return { success: true, size: stats.size };
      } else {
        return { success: false, error: 'File does not appear to be a Windows executable' };
      }
    } catch (readError) {
      return { success: false, error: `Cannot read file: ${readError.message}` };
    }
    
  } catch (error) {
    console.error('[AutoUpdater] File verification error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', async (event, downloadPath) => {
  // CREATE IMMEDIATE LOG TO PROVE THIS HANDLER IS CALLED
  const immediateLogPath = path.join(require('os').homedir(), 'Desktop', 'IPC_INSTALL_CALLED.txt');
  try {
    fs.writeFileSync(immediateLogPath, `[${new Date().toISOString()}] install-update IPC handler called!\nDownload path: ${downloadPath}\n`);
  } catch (e) {
    console.error('Failed to write immediate IPC log:', e);
  }
  
  return new Promise((resolve) => {
    console.log(`[AutoUpdater] === INSTALL REQUEST RECEIVED ===`);
    console.log(`[AutoUpdater] Download path: ${downloadPath}`);
    
    // Create install debug log
    const debugLogPath = path.join(require('os').homedir(), 'Desktop', 'install_debug.txt');
    const debugLog = `
=== INSTALL DEBUG LOG ===
Timestamp: ${new Date().toISOString()}
Download path: ${downloadPath}
Process ID: ${process.pid}
Install handler called: YES
`;
    
    try {
      fs.writeFileSync(debugLogPath, debugLog);
      console.log('[AutoUpdater] Install debug log created at:', debugLogPath);
    } catch (err) {
      console.error('[AutoUpdater] Failed to create install debug log:', err);
    }

    try {
      console.log(`[AutoUpdater] Installing update from: ${downloadPath}`);
      
      // Check if the downloaded file exists
      if (!fs.existsSync(downloadPath)) {
        // Try alternative filename with dots instead of dashes (Windows sometimes changes this)
        const altPath1 = downloadPath.replace(/BumbleGum-Guitars-Configurator/g, 'BumbleGum.Guitars.Configurator');
        const altPath2 = downloadPath.replace(/BumbleGum.Guitars.Configurator/g, 'BumbleGum-Guitars-Configurator');
        
        console.log(`[AutoUpdater] Original path not found, trying alternatives:`);
        console.log(`[AutoUpdater] Alt 1: ${altPath1}`);
        console.log(`[AutoUpdater] Alt 2: ${altPath2}`);
        
        if (fs.existsSync(altPath1)) {
          console.log(`[AutoUpdater] Found file at alternative path: ${altPath1}`);
          downloadPath = altPath1; // Update the path to the actual file
        } else if (fs.existsSync(altPath2)) {
          console.log(`[AutoUpdater] Found file at alternative path: ${altPath2}`);
          downloadPath = altPath2; // Update the path to the actual file
        } else {
          const error = `Downloaded file not found at any path: ${downloadPath}, ${altPath1}, ${altPath2}`;
          console.error(`[AutoUpdater] ${error}`);
          resolve({ success: false, error });
          return;
        }
      }
      
      console.log(`[AutoUpdater] Downloaded file confirmed to exist: ${downloadPath}`);

      // Check if we're running in development mode
      // In development: execPath contains node_modules/electron/dist/electron.exe
      // In production: execPath is the actual executable name (TestAutoUpdater.exe, etc.)
      const execPathLower = process.execPath.toLowerCase();
      const isDevelopment = process.env.NODE_ENV === 'development' || 
                           (execPathLower.includes('node_modules') && execPathLower.includes('electron')) ||
                           execPathLower.endsWith('electron.exe');

      console.log('[AutoUpdater] Development mode check:');
      console.log('[AutoUpdater]   execPath:', process.execPath);
      console.log('[AutoUpdater]   NODE_ENV:', process.env.NODE_ENV);
      console.log('[AutoUpdater]   isDevelopment:', isDevelopment);

      if (isDevelopment) {
        console.log('[AutoUpdater] Development mode detected - skipping actual install');
        resolve({ success: true, message: 'Development mode: Install simulation complete' });
        return;
      }

      // Get current executable path
      const currentExePath = process.execPath;
      const currentDir = path.dirname(currentExePath);
      const currentExeName = path.basename(currentExePath);
      
      // Check if we're running from a temp directory (extracted portable app)
      const isPortableTemp = currentDir.includes('\\AppData\\Local\\Temp\\') || 
                            currentDir.includes('/tmp/') ||
                            currentExeName.includes('BumbleGum Guitars Configurator.exe');
      
      let originalExePath = currentExePath;
      
      if (isPortableTemp) {
        // We're running from extracted temp - need to find the original executable
        console.log('[AutoUpdater] Detected portable temp execution');
        console.log('[AutoUpdater] Current path:', currentExePath);
        console.log('[AutoUpdater] Process argv:', process.argv);
        
        // Get the original filename from argv[0] - the app knows its own name!
        let originalFileName = null;
        let detectedOriginalPath = null;
        
        // Extract filename from argv[0] first - this is the most reliable method
        if (process.argv && process.argv[0]) {
          originalFileName = path.basename(process.argv[0]);
          console.log('[AutoUpdater] Original filename detected:', originalFileName);
          
          // Method 1: Check if argv[0] path exists and is valid
          if (!process.argv[0].includes('\\AppData\\Local\\Temp\\')) {
            const argvPath = process.argv[0];
            try {
              if (fs.existsSync(argvPath)) {
                const stats = fs.statSync(argvPath);
                if (stats.size > 50000000) { // 50MB minimum
                  detectedOriginalPath = argvPath;
                  console.log('[AutoUpdater] Found original path from argv[0]:', detectedOriginalPath);
                  console.log('[AutoUpdater] File size:', stats.size, 'bytes');
                } else {
                  console.log('[AutoUpdater] argv[0] file too small:', stats.size, 'bytes');
                }
              } else {
                console.log('[AutoUpdater] argv[0] file does not exist:', argvPath);
              }
            } catch (err) {
              console.log('[AutoUpdater] Error checking argv[0] file:', err.message);
            }
          } else {
            console.log('[AutoUpdater] argv[0] points to temp directory, will search for original');
          }
        }
        
        // Method 2: Check environment variables that might contain the original path
        if (!detectedOriginalPath && process.env._ && !process.env._.includes('\\AppData\\Local\\Temp\\')) {
          detectedOriginalPath = process.env._;
          console.log('[AutoUpdater] Found original path from env._:', detectedOriginalPath);
        }
        
        // Method 3: Smart search using any BGG-related executable in common locations
        if (!detectedOriginalPath) {
          const os = require('os');
          const commonLocations = [
            path.join(os.homedir(), 'Desktop'),
            path.join(os.homedir(), 'OneDrive', 'Desktop'),
            path.join(os.homedir(), 'Downloads'),
            path.join(os.homedir(), 'Documents'),
            'C:\\Program Files\\BumbleGum',
            'C:\\BGG'
          ];
          
          console.log('[AutoUpdater] Searching for BGG executable in common locations...');
          console.log('[AutoUpdater] Looking for filename:', originalFileName || 'unknown');
          
          for (const location of commonLocations) {
            try {
              if (fs.existsSync(location)) {
                const files = fs.readdirSync(location);
                
                // Look for the exact filename first if we know it
                let bggFile = null;
                if (originalFileName) {
                  bggFile = files.find(file => file === originalFileName);
                  if (bggFile) {
                    console.log('[AutoUpdater] Found exact filename match:', bggFile);
                  }
                }
                
                // If exact match not found, try pattern matching
                if (!bggFile) {
                  bggFile = files.find(file => {
                    const fileName = file.toLowerCase();
                    return fileName.endsWith('.exe') && (
                      // Original naming patterns
                      (fileName.includes('bumblegum') && fileName.includes('guitar')) ||
                      (fileName.includes('bumblegum') && fileName.includes('configurator')) ||
                      // BGG abbreviation patterns
                      fileName.includes('bgg') ||
                      // Look for files in the right size range (50-100MB) as a fallback
                      (() => {
                        try {
                          const testPath = path.join(location, file);
                          const stats = fs.statSync(testPath);
                          return stats.size > 50000000 && stats.size < 100000000; // 50-100MB range
                        } catch {
                          return false;
                        }
                      })()
                    );
                  });
                  if (bggFile) {
                    console.log('[AutoUpdater] Found pattern match:', bggFile);
                  }
                }
                
                if (bggFile) {
                  const testPath = path.join(location, bggFile);
                  // Verify it's not tiny (should be 50MB+)
                  const stats = fs.statSync(testPath);
                  if (stats.size > 50000000) { // 50MB minimum
                    detectedOriginalPath = testPath;
                    console.log('[AutoUpdater] Found BGG executable:', detectedOriginalPath);
                    console.log('[AutoUpdater] File size:', stats.size, 'bytes');
                    break;
                  }
                }
              }
            } catch (err) {
              // Ignore permission errors, continue searching
              console.log('[AutoUpdater] Could not search in:', location, err.message);
            }
          }
        }
        
        if (detectedOriginalPath) {
          originalExePath = detectedOriginalPath;
          console.log('[AutoUpdater] Using detected original path:', originalExePath);
        } else {
          console.warn('[AutoUpdater] Could not detect original executable path!');
          console.warn('[AutoUpdater] Update may not work correctly');
          console.warn('[AutoUpdater] argv[0]:', process.argv[0]);
          console.warn('[AutoUpdater] env._:', process.env._);
          
          // Give user helpful guidance by returning a warning message
          console.warn('[AutoUpdater] Will proceed with warning about path detection');
          
          // Fallback to temp path with warning
          console.warn('[AutoUpdater] Falling back to temp path (update may not persist)');
        }
      }
      
      const backupPath = path.join(path.dirname(originalExePath), `${path.basename(originalExePath)}.backup`);
      const logPath = path.join(require('os').homedir(), 'Desktop', 'node_install_log.txt');  // Changed to desktop for easier access

      console.log('[AutoUpdater] Starting Node.js-based update installer');
      console.log('[AutoUpdater] Downloaded file path:', downloadPath);
      console.log('[AutoUpdater] Current exe path:', currentExePath);
      console.log('[AutoUpdater] Original exe path:', originalExePath);
      console.log('[AutoUpdater] Is portable temp:', isPortableTemp);
      console.log('[AutoUpdater] Backup path:', backupPath);
      console.log('[AutoUpdater] Log path:', logPath);

      // Create a detailed debug log immediately
      const debugLogPath = path.join(require('os').homedir(), 'Desktop', 'auto_update_debug.txt');
      const debugLog = `
=== AUTO UPDATE DEBUG LOG ===
Timestamp: ${new Date().toISOString()}
Process ID: ${process.pid}
Process execPath: ${process.execPath}
Downloaded file: ${downloadPath}
Current exe: ${currentExePath}
Original exe: ${originalExePath}
Is portable temp: ${isPortableTemp}
Backup path: ${backupPath}
Log path: ${logPath}
Debug log path: ${debugLogPath}

File checks:
Desktop BumbleGum file exists: ${fs.existsSync('C:\\Users\\mlwat\\OneDrive\\Desktop\\BumbleGum Guitars Configurator.exe')}
Desktop BumbleGum file size: ${fs.existsSync('C:\\Users\\mlwat\\OneDrive\\Desktop\\BumbleGum Guitars Configurator.exe') ? fs.statSync('C:\\Users\\mlwat\\OneDrive\\Desktop\\BumbleGum Guitars Configurator.exe').size : 'N/A'}
`;
      
      try {
        fs.writeFileSync(debugLogPath, debugLog);
        console.log('[AutoUpdater] Debug log created at:', debugLogPath);
      } catch (err) {
        console.error('[AutoUpdater] Failed to create debug log:', err);
      }

      // Verify the downloaded file exists
      if (!fs.existsSync(downloadPath)) {
        const error = `Downloaded file not found: ${downloadPath}`;
        console.error('[AutoUpdater] ERROR:', error);
        try {
          fs.appendFileSync(debugLogPath, `ERROR: ${error}\n`);
        } catch (e) {}
        resolve({ success: false, error: 'Downloaded file not found' });
        return;
      }

      const downloadStats = fs.statSync(downloadPath);
      console.log('[AutoUpdater] Downloaded file verified, size:', downloadStats.size, 'bytes');
      
      try {
        fs.appendFileSync(debugLogPath, `Downloaded file exists: ${downloadPath} (${downloadStats.size} bytes)\n`);
      } catch (e) {}

      if (downloadStats.size < 1000000) { // Less than 1MB is suspicious
        const error = `Downloaded file appears invalid, size: ${downloadStats.size}`;
        console.error('[AutoUpdater] ERROR:', error);
        try {
          fs.appendFileSync(debugLogPath, `ERROR: ${error}\n`);
        } catch (e) {}
        resolve({ success: false, error: 'Downloaded file appears invalid' });
        return;
      }

      // Create a Node.js script to handle the update
      const updateScript = `
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const currentExe = String.raw\`${originalExePath}\`;
const newExe = String.raw\`${downloadPath}\`;
const backupPath = String.raw\`${backupPath}\`;
const logPath = String.raw\`${logPath}\`;

function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = \`[\${timestamp}] \${message}\\n\`;
  try {
    fs.appendFileSync(logPath, logMessage);
    console.log(message);
  } catch (err) {
    console.log('Log write failed:', message);
  }
}

function waitForProcessExit(processName, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    function checkProcess() {
      const { execSync } = require('child_process');
      try {
        // Check for both the exact name and just the base filename
        const baseName = processName.replace(/\\\\/g, '\\\\').split('\\\\').pop();
        execSync(\`tasklist /FI "IMAGENAME eq \${baseName}" | findstr \${baseName}\`, { stdio: 'pipe' });
        // Process still running
        if (Date.now() - startTime > timeoutMs) {
          writeLog(\`Timeout reached after \${timeoutMs}ms, process may still be running\`);
          resolve();
        } else {
          setTimeout(checkProcess, 1000); // Check every second
        }
      } catch (err) {
        // Process not found (exited)
        writeLog(\`Process \${baseName} has exited\`);
        resolve();
      }
    }
    
    checkProcess();
  });
}

async function performUpdate() {
  try {
    writeLog('=== BGG Auto-Update Node.js Script Started ===');
    writeLog(\`Current Exe: \${currentExe}\`);
    writeLog(\`New Exe: \${newExe}\`);
    writeLog(\`Backup Path: \${backupPath}\`);
    
    // Wait for main process to exit
    writeLog('Waiting 5 seconds for main app to signal shutdown...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    writeLog('Waiting for main process to exit...');
    await waitForProcessExit('${currentExeName}');
    
    // Verify new file
    writeLog('Verifying new executable...');
    if (!fs.existsSync(newExe)) {
      throw new Error(\`New executable not found: \${newExe}\`);
    }
    
    const newFileSize = fs.statSync(newExe).size;
    writeLog(\`New executable size: \${newFileSize} bytes\`);
    
    if (newFileSize < 1000000) {
      throw new Error(\`New executable appears invalid (size: \${newFileSize} bytes)\`);
    }
    
    // Backup current executable
    writeLog('Backing up current executable...');
    if (fs.existsSync(currentExe)) {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.renameSync(currentExe, backupPath);
      writeLog('Backup created successfully');
    }
    
    // Install new executable
    writeLog('Installing new executable...');
    fs.renameSync(newExe, currentExe);
    writeLog('New executable installed successfully');
    
    // Verify installation
    if (!fs.existsSync(currentExe)) {
      throw new Error('Installation verification failed');
    }
    
    // Start updated application
    writeLog('Starting updated application...');
    const child = spawn(currentExe, [], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    
    writeLog(\`Updated application started with PID: \${child.pid}\`);
    
    // Clean up backup
    setTimeout(() => {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        writeLog('Backup cleaned up');
      }
      writeLog('Update completed successfully!');
      writeLog('\\n=== UPDATE COMPLETE ===');
      writeLog('Press any key to close this window...');
      
      // Keep console open for debugging
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', process.exit.bind(process, 0));
    }, 5000);
    
  } catch (error) {
    writeLog(\`ERROR: \${error.message}\`);
    
    // Try to restore from backup
    if (fs.existsSync(backupPath) && !fs.existsSync(currentExe)) {
      writeLog('Restoring from backup...');
      fs.renameSync(backupPath, currentExe);
      
      // Start original version
      const child = spawn(currentExe, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      writeLog('Original version restored and started');
    }
    
    writeLog('\\n=== UPDATE FAILED ===');
    writeLog('Press any key to close this window...');
    
    // Keep console open for debugging
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
  }
}

performUpdate();
`;

      const batchScriptPath = path.join(currentDir, 'update_installer.bat');
      const batchScript = `@echo off
echo === BGG Auto-Update Batch Script Started ===
echo Current Exe: ${originalExePath}
echo New Exe: ${downloadPath}
echo Current Time: %DATE% %TIME%
echo.

echo Waiting 5 seconds for main app to close...
timeout /t 5 /nobreak >nul

echo Checking if main app process is still running...
tasklist | findstr /i "Test-BGG-App.exe" >nul
if %errorlevel% == 0 (
    echo Main app still running, waiting additional 5 seconds...
    timeout /t 5 /nobreak >nul
) else (
    echo Main app has closed.
)

echo.
echo Creating backup of current executable...
if exist "${originalExePath}.backup" del "${originalExePath}.backup"
copy "${originalExePath}" "${originalExePath}.backup"
if %errorlevel% neq 0 (
    echo ERROR: Failed to create backup
    goto error
)

echo.
echo Replacing executable with new version...
copy "${downloadPath}" "${originalExePath}"
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy new executable
    echo Restoring from backup...
    copy "${originalExePath}.backup" "${originalExePath}"
    goto error
)

echo.
echo Starting updated application...
start "" "${originalExePath}"

echo.
echo Cleaning up backup...
timeout /t 3 /nobreak >nul
del "${originalExePath}.backup"

echo.
echo === UPDATE COMPLETED SUCCESSFULLY ===
goto end

:error
echo.
echo === UPDATE FAILED ===

:end
echo.
echo Press any key to close this window...
pause >nul
`;
      fs.writeFileSync(batchScriptPath, batchScript);
      console.log('[AutoUpdater] Batch update script created at:', batchScriptPath);
      
      try {
        fs.appendFileSync(debugLogPath, `Batch script created: ${batchScriptPath}\n`);
        fs.appendFileSync(debugLogPath, `Script size: ${fs.statSync(batchScriptPath).size} bytes\n`);
      } catch (e) {}

      // Execute the batch script and quit the current app
      console.log('[AutoUpdater] About to spawn batch process...');
      
      // Create an immediate log file to verify the script is being called
      const immediateLogPath = path.join(require('os').homedir(), 'Desktop', 'SPAWN_DEBUG.txt');
      try {
        fs.writeFileSync(immediateLogPath, `[${new Date().toISOString()}] AutoUpdater attempting to spawn batch script\n`);
        fs.appendFileSync(immediateLogPath, `Script path: ${batchScriptPath}\n`);
        fs.appendFileSync(immediateLogPath, `Command: cmd /k "${batchScriptPath}"\n`);
        fs.appendFileSync(immediateLogPath, `Current working directory: ${process.cwd()}\n`);
      } catch (e) {
        console.error('[AutoUpdater] Failed to write immediate log:', e);
      }
      
      try {
        fs.appendFileSync(debugLogPath, `About to spawn batch script: ${batchScriptPath}\n`);
      } catch (e) {}
      
      // Use cmd to run batch script in visible console window that stays open
      const updateProcess = spawn('cmd', ['/k', `"${batchScriptPath}"`], {
        detached: true,
        stdio: 'ignore'
      });

      // Capture any immediate errors
      updateProcess.on('error', (error) => {
        console.error('[AutoUpdater] Spawn error:', error);
        try {
          fs.appendFileSync(immediateLogPath, `SPAWN ERROR: ${error.message}\n`);
        } catch (e) {}
      });

      updateProcess.on('exit', (code, signal) => {
        console.log(`[AutoUpdater] Update process exited with code: ${code}, signal: ${signal}`);
        try {
          fs.appendFileSync(immediateLogPath, `Process exited with code: ${code}, signal: ${signal}\n`);
        } catch (e) {}
      });

      updateProcess.unref();

      updateProcess.unref();
      console.log('[AutoUpdater] Update process started with PID:', updateProcess.pid);
      
      try {
        fs.appendFileSync(debugLogPath, `Update process spawned with PID: ${updateProcess.pid}\n`);
        fs.appendFileSync(debugLogPath, `Main app will quit in 60 seconds to allow console log capture...\n`);
        fs.appendFileSync(immediateLogPath, `Update process spawned successfully with PID: ${updateProcess.pid}\n`);
      } catch (e) {}

      // Give the spawn process more time to start, then quit for file replacement
      setTimeout(() => {
        console.log('[AutoUpdater] Exiting for update installation...');
        try {
          fs.appendFileSync(debugLogPath, `Main app quitting now...\n`);
          fs.appendFileSync(immediateLogPath, `Main app quitting after 8 seconds...\n`);
        } catch (e) {}
        app.quit();
      }, 8000);  // 8 seconds delay - more time for Node.js script to start

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
