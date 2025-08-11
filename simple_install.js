// Simple install handler for BGG app
ipcMain.handle('install-update', async (event, downloadPath) => {
  console.log('[AutoUpdater] Simple install starting:', downloadPath);
  
  return new Promise((resolve) => {
    try {
      // Get current app path
      let appPath = process.argv[0] || process.execPath;
      
      // If running from temp, search for actual file
      if (appPath.includes('AppData\\Local\\Temp')) {
        const desktop = path.join(require('os').homedir(), 'Desktop');
        const files = fs.readdirSync(desktop);
        const bggFile = files.find(f => 
          f.toLowerCase().includes('bgg') && 
          f.endsWith('.exe')
        );
        if (bggFile) {
          appPath = path.join(desktop, bggFile);
        }
      }
      
      console.log('[AutoUpdater] App path:', appPath);
      
      // Create batch file
      const batchContent = `@echo off
echo BGG Update - Waiting for app to close...
timeout /t 5 /nobreak >nul
copy "${downloadPath}" "${appPath}"
if errorlevel 1 (
    echo Failed to copy file
    pause
    exit
)
echo Update complete - Starting app...
start "" "${appPath}"
`;
      
      const batchPath = path.join(require('os').tmpdir(), 'bgg_update.bat');
      fs.writeFileSync(batchPath, batchContent);
      
      // Run batch file
      spawn('cmd', ['/c', batchPath], { detached: true, stdio: 'ignore' });
      
      // Quit app
      setTimeout(() => app.quit(), 3000);
      
      resolve({ success: true });
    } catch (error) {
      console.error('[AutoUpdater] Error:', error);
      resolve({ success: false, error: error.message });
    }
  });
});
