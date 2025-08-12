/**
 * Auto-Updater for Portable BGG Configurator
 * Handles checking for updates and downloading new portable executables
 */

class PortableAutoUpdater {
  constructor() {
    this.currentVersion = null;
    this.latestVersion = null;
    this.updateAvailable = false;
    this.checking = false;
    this.downloading = false;
    this.githubRepo = 'wattsy74/BumbleGum-Guitars-Configurator';
    this.updateCheckInterval = null;
    this.callbacks = {
      onUpdateAvailable: null,
      onUpdateNotAvailable: null,
      onError: null,
      onDownloadProgress: null,
      onUpdateDownloaded: null
    };
    
    // Set up download progress listener
    if (window.electronAPI && window.electronAPI.onDownloadProgress) {
      window.electronAPI.onDownloadProgress((event, progress) => {
        console.log(`[AutoUpdater] Progress received: ${progress}%`);
        if (this.callbacks.onDownloadProgress) {
          console.log(`[AutoUpdater] Calling progress callback with: ${progress}%`);
          this.callbacks.onDownloadProgress(progress);
        } else {
          console.log('[AutoUpdater] No progress callback set');
        }
      });
    } else {
      console.log('[AutoUpdater] No electronAPI.onDownloadProgress available');
    }
  }

  /**
   * Initialize the auto-updater
   */
  async initialize() {
    console.log('[AutoUpdater] Initializing...');
    
    // Get current version from package.json via IPC
    try {
      this.currentVersion = await window.electronAPI.getCurrentVersion();
      console.log(`[AutoUpdater] Current version: ${this.currentVersion}`);
    } catch (error) {
      console.error('[AutoUpdater] Failed to get current version:', error);
      this.currentVersion = '3.9.15'; // Fallback
    }

    // Set up automatic update checks (every 4 hours)
    this.startAutoCheck();
  }

  /**
   * Start automatic update checking
   */
  startAutoCheck() {
    // Check immediately on startup (after 30 seconds)
    setTimeout(() => {
      this.checkForUpdates();
    }, 30000);

    // Then check every 4 hours
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, 4 * 60 * 60 * 1000);
  }

  /**
   * Stop automatic update checking
   */
  stopAutoCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates() {
    if (this.checking) {
      console.log('[AutoUpdater] Update check already in progress');
      return;
    }

    this.checking = true;
    console.log('[AutoUpdater] Checking for updates...');

    try {
      // Fetch latest release from GitHub API
      const response = await fetch(`https://api.github.com/repos/${this.githubRepo}/releases/latest`);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log('[AutoUpdater] No releases found in repository');
          if (this.callbacks.onUpdateNotAvailable) {
            this.callbacks.onUpdateNotAvailable();
          }
          return;
        }
        throw new Error(`GitHub API request failed: ${response.status}`);
      }

      const release = await response.json();
      this.latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
      
      console.log(`[AutoUpdater] Latest version: ${this.latestVersion}`);
      console.log(`[AutoUpdater] Current version: ${this.currentVersion}`);

      // Compare versions
      if (this.isNewerVersion(this.latestVersion, this.currentVersion)) {
        this.updateAvailable = true;
        console.log('[AutoUpdater] Update available!');
        
        // Find executable in release assets (look for .exe files)
        const portableAsset = release.assets.find(asset => 
          asset.name.endsWith('.exe') && !asset.name.includes('Setup') && !asset.name.includes('Installer')
        );

        // Update is available, notify user first
        const updateInfo = {
          version: this.latestVersion,
          releaseNotes: release.body,
          downloadUrl: portableAsset ? portableAsset.browser_download_url : null,
          fileName: portableAsset ? portableAsset.name : null,
          fileSize: portableAsset ? portableAsset.size : 0,
          publishedAt: release.published_at,
          hasPortableExecutable: !!portableAsset
        };

        if (this.callbacks.onUpdateAvailable) {
          this.callbacks.onUpdateAvailable(updateInfo);
        }

        // If no portable executable, log but don't show error to user
        if (!portableAsset) {
          console.error('[AutoUpdater] No portable executable found in latest release');
          // Note: We don't call onError here since we want users to know an update exists
          // even if they can't auto-download it
        }
      } else {
        this.updateAvailable = false;
        console.log('[AutoUpdater] No update available');
        
        if (this.callbacks.onUpdateNotAvailable) {
          this.callbacks.onUpdateNotAvailable();
        }
      }
    } catch (error) {
      console.error('[AutoUpdater] Error checking for updates:', error);
      
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    } finally {
      this.checking = false;
    }
  }

  /**
   * Download and install update
   */
  async downloadUpdate(updateInfo) {
    if (this.downloading) {
      console.log('[AutoUpdater] Download already in progress');
      return;
    }

    this.downloading = true;
    console.log(`[AutoUpdater] Downloading update: ${updateInfo.fileName}`);

    try {
      // Use IPC to download via main process (for better file handling)
      // Only pass serializable data (no functions)
      const result = await window.electronAPI.downloadUpdate({
        url: updateInfo.downloadUrl,
        fileName: updateInfo.fileName
      });

      if (result.success) {
        console.log('[AutoUpdater] Update downloaded successfully');
        
        // Trigger 100% progress before calling download complete
        if (this.callbacks.onDownloadProgress) {
          this.callbacks.onDownloadProgress(100);
        }
        
        if (this.callbacks.onUpdateDownloaded) {
          this.callbacks.onUpdateDownloaded({
            ...updateInfo,
            downloadPath: result.filePath
          });
        }
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[AutoUpdater] Error downloading update:', error);
      
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    } finally {
      this.downloading = false;
    }
  }

  /**
   * Install the downloaded update
   */
  async installUpdate(downloadPath) {
    console.log(`[AutoUpdater] Installing update from: ${downloadPath}`);
    
    try {
      // Use IPC to install via main process
      const result = await window.electronAPI.installUpdate(downloadPath);
      
      if (result.success) {
        console.log('[AutoUpdater] Update installed successfully, restarting...');
        // App will restart automatically
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('[AutoUpdater] Error installing update:', error);
      
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
    }
  }

  /**
   * Compare version strings (semantic versioning)
   */
  isNewerVersion(latest, current) {
    const parseVersion = (version) => {
      return version.split('.').map(num => parseInt(num, 10));
    };

    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    const maxLength = Math.max(latestParts.length, currentParts.length);

    for (let i = 0; i < maxLength; i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }

    return false; // Versions are equal
  }

  /**
   * Set event callbacks
   */
  on(event, callback) {
    if (this.callbacks.hasOwnProperty(`on${event.charAt(0).toUpperCase()}${event.slice(1)}`)) {
      this.callbacks[`on${event.charAt(0).toUpperCase()}${event.slice(1)}`] = callback;
    }
  }

  /**
   * Get current update status
   */
  getStatus() {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.latestVersion,
      updateAvailable: this.updateAvailable,
      checking: this.checking,
      downloading: this.downloading
    };
  }
}

// Create global instance
window.autoUpdater = new PortableAutoUpdater();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.autoUpdater.initialize();
  });
} else {
  window.autoUpdater.initialize();
}
