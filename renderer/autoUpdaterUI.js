/**
 * Auto-Updater UI Component
 * Handles displaying update notifications and progress
 */

class AutoUpdaterUI {
  constructor() {
    this.updateModal = null;
    this.progressModal = null;
    this.currentUpdateInfo = null;
    this.init();
  }

  init() {
    // Create update notification modal
    this.createUpdateModal();
    this.createProgressModal();
    
    // Set up auto-updater event listeners
    if (window.autoUpdater) {
      window.autoUpdater.on('updateAvailable', (updateInfo) => {
        this.showUpdateNotification(updateInfo);
      });

      window.autoUpdater.on('updateNotAvailable', () => {
        this.showNotification('No Updates', 'You are running the latest version.', 'info');
      });

      window.autoUpdater.on('downloadProgress', (progress) => {
        this.updateDownloadProgress(progress);
      });

      window.autoUpdater.on('updateDownloaded', (updateInfo) => {
        this.showInstallPrompt(updateInfo);
      });

      window.autoUpdater.on('error', (error) => {
        // Only show error if it's not a "no releases" scenario
        if (!error.message.includes('No releases found')) {
          this.showErrorMessage(error);
        }
      });
    }
  }

  createUpdateModal() {
    this.updateModal = document.createElement('div');
    this.updateModal.className = 'modal fade';
    this.updateModal.id = 'updateNotificationModal';
    this.updateModal.setAttribute('tabindex', '-1');
    this.updateModal.setAttribute('role', 'dialog');
    
    this.updateModal.innerHTML = `
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="fas fa-download text-primary"></i>
              Update Available
            </h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body">
            <div class="update-info">
              <h6>New Version Available: <span id="updateVersion" class="text-primary"></span></h6>
              <p class="text-muted">Published: <span id="updateDate"></span></p>
              
              <div class="release-notes-container">
                <h6>What's New:</h6>
                <div id="releaseNotes" class="release-notes"></div>
              </div>
              
              <div class="update-actions mt-3">
                <div class="row">
                  <div class="col-md-6">
                    <p class="small text-muted mb-2">File: <span id="updateFileName"></span></p>
                    <p class="small text-muted mb-0">Size: <span id="updateFileSize"></span></p>
                  </div>
                  <div class="col-md-6 text-right">
                    <button type="button" class="btn btn-secondary mr-2" data-dismiss="modal">
                      <i class="fas fa-times"></i> Later
                    </button>
                    <button type="button" class="btn btn-primary" id="downloadUpdateBtn">
                      <i class="fas fa-download"></i> Download Update
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.updateModal);

    // Set up download button click handler
    document.getElementById('downloadUpdateBtn').addEventListener('click', () => {
      this.startDownload();
    });

    // Set up modal close handlers
    this.updateModal.querySelector('.close').addEventListener('click', () => {
      this.updateModal.style.display = 'none';
    });
    
    this.updateModal.querySelector('[data-dismiss="modal"]').addEventListener('click', () => {
      this.updateModal.style.display = 'none';
    });

    // Close modal when clicking outside
    this.updateModal.addEventListener('click', (e) => {
      if (e.target === this.updateModal) {
        this.updateModal.style.display = 'none';
      }
    });
  }

  createProgressModal() {
    this.progressModal = document.createElement('div');
    this.progressModal.className = 'modal fade';
    this.progressModal.id = 'updateProgressModal';
    this.progressModal.setAttribute('tabindex', '-1');
    this.progressModal.setAttribute('role', 'dialog');
    this.progressModal.setAttribute('data-backdrop', 'static');
    this.progressModal.setAttribute('data-keyboard', 'false');
    
    this.progressModal.innerHTML = `
      <div class="modal-dialog" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">
              <i class="fas fa-download text-primary"></i>
              Downloading Update
            </h5>
          </div>
          <div class="modal-body text-center">
            <div class="progress mb-3" style="height: 25px;">
              <div id="downloadProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" 
                   role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                0%
              </div>
            </div>
            <p id="downloadStatus" class="text-muted">Preparing download...</p>
            <div id="downloadComplete" class="d-none">
              <div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                Download completed successfully!
              </div>
              <button type="button" class="btn btn-success" id="installUpdateBtn">
                <i class="fas fa-sync"></i> Install & Restart
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.progressModal);

    // Set up install button click handler
    document.getElementById('installUpdateBtn').addEventListener('click', () => {
      this.installUpdate();
    });
  }

  showUpdateNotification(updateInfo) {
    this.currentUpdateInfo = updateInfo;
    
    // Populate modal with update information
    document.getElementById('updateVersion').textContent = updateInfo.version;
    document.getElementById('updateDate').textContent = new Date(updateInfo.publishedAt).toLocaleDateString();
    document.getElementById('updateFileName').textContent = updateInfo.fileName;
    document.getElementById('updateFileSize').textContent = this.formatFileSize(updateInfo.fileSize);
    
    // Format release notes
    const releaseNotesEl = document.getElementById('releaseNotes');
    if (updateInfo.releaseNotes) {
      // Convert markdown-style formatting to HTML
      let formattedNotes = updateInfo.releaseNotes
        .replace(/## (.*)/g, '<h6>$1</h6>')
        .replace(/### (.*)/g, '<strong>$1</strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/- (.*)/g, '<li>$1</li>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
      
      if (formattedNotes.includes('<li>')) {
        formattedNotes = formattedNotes.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
      }
      
      releaseNotesEl.innerHTML = `<p>${formattedNotes}</p>`;
    } else {
      releaseNotesEl.innerHTML = '<p class="text-muted">No release notes available.</p>';
    }

    // Show the modal using vanilla JavaScript
    this.updateModal.style.display = 'flex';
    
    console.log('[AutoUpdaterUI] Showing update notification for version:', updateInfo.version);
  }

  startDownload() {
    if (!this.currentUpdateInfo) return;

    // Hide update modal and show progress modal using vanilla JavaScript
    this.updateModal.style.display = 'none';
    this.progressModal.style.display = 'flex';

    // Reset progress
    this.updateDownloadProgress(0);
    document.getElementById('downloadStatus').textContent = 'Starting download...';
    document.getElementById('downloadComplete').classList.add('d-none');

    // Start download via auto-updater
    window.autoUpdater.downloadUpdate(this.currentUpdateInfo);
  }

  updateDownloadProgress(progress) {
    const progressBar = document.getElementById('downloadProgressBar');
    const statusEl = document.getElementById('downloadStatus');
    
    progressBar.style.width = `${progress}%`;
    progressBar.setAttribute('aria-valuenow', progress);
    progressBar.textContent = `${progress}%`;
    
    if (progress < 100) {
      statusEl.textContent = `Downloading... ${progress}%`;
    } else {
      statusEl.textContent = 'Download completed!';
      document.getElementById('downloadComplete').classList.remove('d-none');
    }
  }

  showInstallPrompt(updateInfo) {
    document.getElementById('downloadComplete').classList.remove('d-none');
    document.getElementById('downloadStatus').textContent = 'Ready to install!';
  }

  installUpdate() {
    if (!this.currentUpdateInfo) return;

    document.getElementById('installUpdateBtn').disabled = true;
    document.getElementById('installUpdateBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
    
    // Install via auto-updater (this will restart the app)
    window.autoUpdater.installUpdate(this.currentUpdateInfo.downloadPath);
  }

  showErrorMessage(error) {
    console.error('[AutoUpdaterUI] Update error:', error);
    
    // Hide any open modals using vanilla JavaScript
    this.updateModal.style.display = 'none';
    this.progressModal.style.display = 'none';
    
    // Show error notification
    this.showNotification('Update Error', error.message || 'An error occurred while updating.', 'error');
  }

  showNotification(title, message, type = 'info') {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : 'info'} alert-dismissible fade show`;
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '9999';
    notification.style.minWidth = '300px';
    
    notification.innerHTML = `
      <strong>${title}</strong><br>
      ${message}
      <button type="button" class="close" data-dismiss="alert" aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 5000);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Manual update check trigger
  checkForUpdates() {
    if (window.autoUpdater) {
      window.autoUpdater.checkForUpdates();
      this.showNotification('Update Check', 'Checking for updates...', 'info');
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.autoUpdaterUI = new AutoUpdaterUI();
  });
} else {
  window.autoUpdaterUI = new AutoUpdaterUI();
}
