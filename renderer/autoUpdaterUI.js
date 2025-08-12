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
        console.log(`[AutoUpdaterUI] Progress event received: ${progress}%`);
        this.updateDownloadProgress(progress);
      });

      window.autoUpdater.on('updateDownloaded', (updateInfo) => {
        this.showInstallPrompt(updateInfo);
      });

      window.autoUpdater.on('error', (error) => {
        // Only show error if it's not a "no releases" or "no portable executable" scenario
        if (!error.message.includes('No releases found') && !error.message.includes('No portable executable found')) {
          this.showErrorMessage(error);
        }
      });
      
      // Start automatic update check after 5 seconds
      setTimeout(() => {
        console.log('[AutoUpdaterUI] Starting automatic update check...');
        this.checkForUpdates();
      }, 5000);
    }
  }

  createUpdateModal() {
    this.updateModal = document.createElement('div');
    this.updateModal.className = 'modal fade';
    this.updateModal.id = 'updateNotificationModal';
    this.updateModal.setAttribute('tabindex', '-1');
    this.updateModal.setAttribute('role', 'dialog');
    
    // Add proper modal styling
    this.updateModal.style.display = 'none';
    this.updateModal.style.position = 'fixed';
    this.updateModal.style.top = '0';
    this.updateModal.style.left = '0';
    this.updateModal.style.width = '100%';
    this.updateModal.style.height = '100%';
    this.updateModal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    this.updateModal.style.zIndex = '9999';
    this.updateModal.style.justifyContent = 'center';
    this.updateModal.style.alignItems = 'center';
    
    this.updateModal.innerHTML = `
      <div class="modal-dialog modal-lg" role="document" style="margin: auto; max-width: 600px; width: 90%; background: #333; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; color: #f4e4bc; border: 1px solid #ffcc00;">
        <div class="modal-content" style="border: none; border-radius: 12px; background: #333;">
          <div class="modal-header" style="background: linear-gradient(135deg, #333333 0%, #000 100%); color: #f4e4bc; padding: 1.5rem; border-bottom: 1px solid #ffcc00; position: relative;">
            <h5 class="modal-title" style="margin: 0; font-weight: 600; font-size: 1.25rem; color: #f4e4bc;">
              <i class="fas fa-download" style="margin-right: 10px; color: #ffcc00;"></i>
              Update Available
            </h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Close" style="position: absolute; top: 15px; right: 20px; background: none; border: none; font-size: 1.8rem; cursor: pointer; padding: 0; margin: 0; color: #ffcc00; opacity: 0.8; line-height: 1;">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body" style="padding: 2rem; background: #333;">
            <div class="update-info">
              <div style="text-align: center; margin-bottom: 1.5rem;">
                <h3 style="margin: 0; color: #ffcc00; font-weight: 600;">Version <span id="updateVersion"></span></h3>
                <p style="color: #ffcc00; margin: 0.5rem 0 0 0; font-size: 0.9rem;">Published: <span id="updateDate"></span></p>
              </div>
              
              <div class="release-notes-container" style="margin-bottom: 2rem;">
                <h6 style="margin-bottom: 1rem; color: #f4e4bc; font-weight: 600; border-bottom: 2px solid #ffcc00; padding-bottom: 0.5rem;">What's New:</h6>
                <div id="releaseNotes" class="release-notes" style="background: #1a0f08; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #ffcc00; max-height: 150px; overflow-y: auto; line-height: 1.5; font-size: 0.9rem; color: #f4e4bc;"></div>
              </div>
              
              <div style="background: #1a0f08; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border: 1px solid #ffcc00;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <p style="margin: 0; color: #f4e4bc; font-weight: 600; font-size: 0.9rem;">📁 <span id="updateFileName"></span></p>
                    <p style="margin: 0.25rem 0 0 0; color: #d4af37; font-size: 0.85rem;">📦 Size: <span id="updateFileSize"></span></p>
                  </div>
                </div>
              </div>
              
              <div class="update-actions" style="display: flex; gap: 1rem; justify-content: center;">
                <button type="button" class="btn btn-secondary later-btn" data-dismiss="modal" style="padding: 0.75rem 1.5rem; border: 2px solid #ffcc00; background: transparent; color: #d4af37; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; justify-content: center;">
                  Later
                </button>
                <button type="button" class="btn btn-primary" id="downloadUpdateBtn" style="padding: 0.75rem 2rem; border: 2px solid #ffd700; background: #ffd700; color: #2c1810; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.2s; box-shadow: 0 2px 4px rgba(255,215,0,0.3); display: flex; align-items: center; justify-content: center;">
                  <i class="fas fa-download" style="margin-right: 0.5rem;"></i> Download Update
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initially hide the modal
    this.updateModal.style.display = 'none';
    
    document.body.appendChild(this.updateModal);

    // Set up download button click handler
    document.getElementById('downloadUpdateBtn').addEventListener('click', () => {
      this.startDownload();
    });

    // Set up modal close handlers
    const closeBtn = this.updateModal.querySelector('.close');
    const laterBtn = this.updateModal.querySelector('.later-btn');
    
    closeBtn.addEventListener('click', () => {
      this.updateModal.style.display = 'none';
    });
    
    laterBtn.addEventListener('click', () => {
      this.updateModal.style.display = 'none';
    });

    // Add hover effects to buttons
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    
    downloadBtn.addEventListener('mouseenter', () => {
      downloadBtn.style.backgroundColor = '#e6c200';
      downloadBtn.style.borderColor = '#e6c200';
      downloadBtn.style.transform = 'translateY(-1px)';
      downloadBtn.style.boxShadow = '0 4px 8px rgba(255,215,0,0.4)';
    });
    downloadBtn.addEventListener('mouseleave', () => {
      downloadBtn.style.backgroundColor = '#ffcc00';
      downloadBtn.style.borderColor = '#ffcc00';
      downloadBtn.style.transform = 'translateY(0)';
      downloadBtn.style.boxShadow = '0 2px 4px rgba(255,215,0,0.3)';
    });
    
    laterBtn.addEventListener('mouseenter', () => {
      laterBtn.style.backgroundColor = '#333333';
      laterBtn.style.borderColor = '#000000';
      laterBtn.style.color = '#f4e4bc';
      laterBtn.style.transform = 'translateY(-1px)';
    });
    laterBtn.addEventListener('mouseleave', () => {
      laterBtn.style.backgroundColor = 'transparent';
      laterBtn.style.borderColor = '#ffcc00';
      laterBtn.style.color = '#d4af37';
      laterBtn.style.transform = 'translateY(0)';
    });
    
    // Add hover effect to close button
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.opacity = '1';
      closeBtn.style.transform = 'scale(1.1)';
      closeBtn.style.color = '#ffd700';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.opacity = '0.8';
      closeBtn.style.transform = 'scale(1)';
      closeBtn.style.color = '#f4e4bc';
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
    
    // Add proper modal styling to match the main modal
    this.progressModal.style.display = 'none';
    this.progressModal.style.position = 'fixed';
    this.progressModal.style.top = '0';
    this.progressModal.style.left = '0';
    this.progressModal.style.width = '100%';
    this.progressModal.style.height = '100%';
    this.progressModal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    this.progressModal.style.zIndex = '9999';
    this.progressModal.style.justifyContent = 'center';
    this.progressModal.style.alignItems = 'center';
    
    this.progressModal.innerHTML = `
      <div class="modal-dialog" role="document" style="margin: auto; max-width: 500px; width: 90%; background: #333; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; color: #f4e4bc; border: 1px solid #ffcc00;">
        <div class="modal-content" style="border: none; border-radius: 12px; background: #333;">
          <div class="modal-header" style="background: linear-gradient(135deg, #333333 0%, #000 100%); color: #f4e4bc; padding: 1.5rem; border-bottom: 1px solid #ffcc00; display: flex; justify-content: space-between; align-items: center;">
            <h5 class="modal-title" style="margin: 0; font-weight: 600; font-size: 1.25rem; color: #f4e4bc;">
              <i class="fas fa-download" style="margin-right: 10px; color: #ffcc00;"></i>
              Downloading Update
            </h5>
            <button type="button" id="closeProgressModalBtn" style="background: none; border: none; color: #ffcc00; font-size: 1.5rem; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body" style="padding: 1.5rem; text-align: center; background: #333;">
            <div id="downloadInProgress">
              <div class="progress" style="height: 30px; background: #1a1a1a; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #ffcc00; overflow: hidden; position: relative; display: flex; align-items: stretch;">
                <div id="downloadProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" 
                     role="progressbar" style="width: 0%; background: linear-gradient(45deg, #ffcc00, #e6b800); color: #000; font-weight: 600; height: 100%; position: absolute; top: 0; left: 0; bottom: 0; right: auto; display: flex; align-items: center; justify-content: center; border-radius: 8px; margin: 0; padding: 0; box-sizing: border-box;" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
                  0%
                </div>
              </div>
              <p id="downloadStatus" style="color: #ffcc00; margin: 0;">Preparing download...</p>
            </div>
            
            <div id="downloadComplete" style="display: none;">
              <div style="background: #1a1a1a; padding: 1rem; border-radius: 8px; border-left: 4px solid #ffcc00; margin-bottom: 1rem;">
                <i class="fas fa-check-circle" style="color: #ffcc00; margin-right: 0.5rem; font-size: 1.1rem;"></i>
                <strong style="color: #ffcc00;">Download completed successfully!</strong>
              </div>
              
              <div style="background: #1a1a1a; padding: 1rem; border-radius: 8px; border: 1px solid #ffcc00; margin-bottom: 1rem; text-align: left;">
                <h6 style="color: #ffcc00; margin-top: 0; margin-bottom: 0.5rem; text-align: center; font-size: 1rem;">📁 Installation Instructions</h6>
                <p style="color: #f4e4bc; margin: 0; text-align: center; line-height: 1.5; font-size: 0.9rem;">
                  Close this app and replace it with the one in your download folder.
                </p>
              </div>
              
              <div style="display: flex; justify-content: center;">
                <button type="button" id="openDownloadsAndCloseBtn" style="padding: 0.75rem 1.5rem; border: 2px solid #ffcc00; background: #ffcc00; color: #000; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.2s; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;">
                  <i class="fas fa-folder-open" style="margin-right: 0.5rem;"></i> Open Downloads & Close App
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initially hide the modal
    this.progressModal.style.display = 'none';
    
    document.body.appendChild(this.progressModal);

    // Set up event handlers for the new buttons
    this.progressModal.addEventListener('click', (e) => {
      if (e.target.id === 'closeProgressModalBtn') {
        this.hideProgressModal();
      } else if (e.target.id === 'openDownloadsAndCloseBtn') {
        // Open Downloads folder and close the application
        window.electronAPI.openDownloadsFolder();
        setTimeout(() => {
          window.electronAPI.closeApp();
        }, 500); // Small delay to ensure downloads folder opens first
      }
    });
  }

  showUpdateNotification(updateInfo) {
    this.currentUpdateInfo = updateInfo;
    
    // Populate modal with update information
    document.getElementById('updateVersion').textContent = updateInfo.version;
    document.getElementById('updateDate').textContent = new Date(updateInfo.publishedAt).toLocaleDateString();
    document.getElementById('updateFileName').textContent = updateInfo.fileName || 'Not available for auto-download';
    document.getElementById('updateFileSize').textContent = updateInfo.fileSize ? this.formatFileSize(updateInfo.fileSize) : 'N/A';
    
    // Handle download button based on availability of portable executable
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    if (updateInfo.hasPortableExecutable) {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download Update';
    } else {
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = '<i class="fas fa-external-link-alt"></i> Visit GitHub Release';
      downloadBtn.onclick = () => {
        window.open(`https://github.com/wattsy74/BumbleGum-Guitars-Configurator/releases/tag/v${updateInfo.version}`, '_blank');
      };
    }
    
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

    // Add message about manual download if no portable executable
    if (!updateInfo.hasPortableExecutable) {
      releaseNotesEl.innerHTML += '<div class="alert alert-info mt-2"><i class="fas fa-info-circle"></i> <strong>Manual Download Required:</strong> This update requires manual download from GitHub.</div>';
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

    // Reset progress and show downloading section
    this.updateDownloadProgress(0);
    document.getElementById('downloadStatus').textContent = 'Starting download...';
    document.getElementById('downloadInProgress').style.display = 'block';
    document.getElementById('downloadComplete').style.display = 'none';

    // Start download via auto-updater
    window.autoUpdater.downloadUpdate(this.currentUpdateInfo);
  }

  updateDownloadProgress(progress) {
    console.log(`[AutoUpdaterUI] updateDownloadProgress called with: ${progress}%`);
    const progressBar = document.getElementById('downloadProgressBar');
    const statusEl = document.getElementById('downloadStatus');
    
    if (!progressBar) {
      console.error('[AutoUpdaterUI] Progress bar element not found!');
      return;
    }
    
    progressBar.style.width = `${progress}%`;
    progressBar.setAttribute('aria-valuenow', progress);
    progressBar.textContent = `${progress}%`;
    
    if (progress < 100) {
      statusEl.textContent = `Downloading... ${progress}%`;
    } else {
      statusEl.textContent = 'Download completed!';
      // Hide the downloading section and show completion section
      document.getElementById('downloadInProgress').style.display = 'none';
      document.getElementById('downloadComplete').style.display = 'block';
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
    console.error('[AutoUpdaterUI] Error message:', error.message);
    console.error('[AutoUpdaterUI] Error string:', error.toString());
    
    // Hide any open modals using vanilla JavaScript
    this.updateModal.style.display = 'none';
    this.progressModal.style.display = 'none';
    
    // Get error message with better fallback handling
    const errorMessage = error.message || error.toString() || 'An error occurred while updating.';
    
    // Show error notification
    this.showNotification('Update Error', errorMessage, 'error');
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
    
    // Add proper background colors and styling
    if (type === 'error') {
      notification.style.backgroundColor = '#f8d7da';
      notification.style.borderColor = '#f5c6cb';
      notification.style.color = '#721c24';
    } else {
      notification.style.backgroundColor = '#d1ecf1';
      notification.style.borderColor = '#bee5eb';
      notification.style.color = '#0c5460';
    }
    notification.style.border = '1px solid';
    notification.style.borderRadius = '0.375rem';
    notification.style.padding = '0.75rem 1.25rem';
    notification.style.boxShadow = '0 0.125rem 0.25rem rgba(0, 0, 0, 0.075)';
    
    notification.innerHTML = `
      <strong>${title}</strong><br>
      ${message}
      <button type="button" class="close" data-dismiss="alert" aria-label="Close" style="position: absolute; top: 0; right: 0; padding: 0.75rem 1.25rem; color: inherit; background: none; border: none; font-size: 1.5rem; cursor: pointer;">
        <span aria-hidden="true">&times;</span>
      </button>
    `;
    
    // Add click handler for close button
    const closeBtn = notification.querySelector('.close');
    closeBtn.addEventListener('click', () => {
      if (notification.parentNode) {
        notification.remove();
      }
    });
    
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

  hideProgressModal() {
    if (this.progressModal) {
      this.progressModal.style.display = 'none';
    }
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
