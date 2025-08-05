// ===== AUTOMATIC FIRMWARE UPDATE SYSTEM =====
// Checks online sources for firmware updates and manages the update process

class AutomaticFirmwareUpdater {
    constructor() {
        this.updateCheckInterval = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.lastCheckTime = localStorage.getItem('lastUpdateCheck') || 0;
        this.currentVersion = null;
        this.remoteManifest = null;
        this.updateAvailable = false;
        this.firmwareUpdater = null; // Will be set from firmwareUpdater.js
        
        // GitHub API configuration
        this.githubAPI = {
            owner: 'wattsy74',
            repo: 'bgg-firmware-updates',
            branch: 'main'
        };
        
        this.manifestURL = `https://api.github.com/repos/${this.githubAPI.owner}/${this.githubAPI.repo}/contents/version_manifest.json?ref=${this.githubAPI.branch}`;
        
        // Bind methods
        this.checkForUpdates = this.checkForUpdates.bind(this);
        // Note: downloadAndApplyUpdate method not yet implemented
    }

    /**
     * Initialize the automatic update system
     */
    async initialize(firmwareUpdater, multiDeviceManager) {
        this.firmwareUpdater = firmwareUpdater;
        this.multiDeviceManager = multiDeviceManager || window.multiDeviceManager;
        
        console.log("🔄 Initializing automatic firmware update system...");
        
        // Get current device version
        try {
            await this.getCurrentVersion();
            console.log("📱 Current device version detected:", this.currentVersion);
        } catch (error) {
            console.warn("⚠️ Failed to get current device version:", error);
        }
        
        // Check if it's time for an update check
        const now = Date.now();
        const timeSinceLastCheck = now - parseInt(this.lastCheckTime);
        
        // Force check on first run (if never checked before) or if 24 hours have passed
        if (!this.lastCheckTime || this.lastCheckTime === '0' || timeSinceLastCheck >= this.updateCheckInterval) {
            console.log("⏰ Running automatic update check...");
            setTimeout(() => this.checkForUpdates(), 5000); // Increased delay to ensure device version is detected
        } else {
            const nextCheck = new Date(parseInt(this.lastCheckTime) + this.updateCheckInterval);
            console.log(`⏳ Next update check scheduled for: ${nextCheck.toLocaleString()}`);
        }
        
        // Set up periodic checking
        setInterval(this.checkForUpdates, this.updateCheckInterval);
    }

    /**
     * Get device firmware version from the main app's working detection system
     */
    getDeviceFirmwareFromMainApp() {
        try {
            console.log("🔍 [AutomaticUpdater] Getting device firmware from main app...");
            
            // FIRST: Check if version is displayed in the UI (most reliable)
            const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
            console.log("🔍 [AutomaticUpdater] deviceFirmwareElement found:", !!deviceFirmwareElement);
            console.log("🔍 [AutomaticUpdater] deviceFirmwareElement textContent:", deviceFirmwareElement?.textContent);
            
            if (deviceFirmwareElement && deviceFirmwareElement.textContent && deviceFirmwareElement.textContent !== '-') {
                const uiVersion = deviceFirmwareElement.textContent.trim();
                console.log('✅ [AutomaticUpdater] Found device firmware version from UI:', uiVersion);
                return uiVersion;
            }
            
            // SECOND: Check multiDeviceManager for stored version
            const multiDeviceManager = window.multiDeviceManager;
            console.log("🔍 [AutomaticUpdater] multiDeviceManager found:", !!multiDeviceManager);
            
            if (multiDeviceManager) {
                const activeDevice = multiDeviceManager.getActiveDevice?.();
                console.log("🔍 [AutomaticUpdater] activeDevice found:", !!activeDevice);
                console.log("🔍 [AutomaticUpdater] activeDevice.firmwareVersion:", activeDevice?.firmwareVersion);
                
                if (activeDevice && activeDevice.firmwareVersion) {
                    console.log('✅ [AutomaticUpdater] Found device firmware version from main app:', activeDevice.firmwareVersion);
                    return activeDevice.firmwareVersion;
                }
            }
            
            console.log('❌ [AutomaticUpdater] No device firmware version found in main app');
            return null;
        } catch (error) {
            console.log('⚠️ [AutomaticUpdater] Error getting device firmware from main app:', error);
            return null;
        }
    }

    /**
     * Get current firmware version from device - NO FALLBACKS
     */
    async getCurrentVersion() {
        // Use multiDeviceManager to pause scanning during version detection
        const multiDeviceManager = window.multiDeviceManager;
        if (!multiDeviceManager) {
            // Try to get version from main app's working system
            const deviceVersion = this.getDeviceFirmwareFromMainApp();
            if (deviceVersion) {
                console.log('✅ [AutomaticUpdater] Using device version from main app:', deviceVersion);
                this.currentVersion = { firmware_version: deviceVersion };
                return this.currentVersion;
            }
            
            console.log('❌ [AutomaticUpdater] MultiDeviceManager not available and no UI version found');
            this.currentVersion = null;
            return null;
        }

        return await multiDeviceManager.pauseScanningDuringOperation(async () => {
            return new Promise((resolve, reject) => {
                try {
                    const activeDevice = multiDeviceManager.getActiveDevice?.();
                    if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                        console.log('⚠️ [AutomaticUpdater] No active device, trying UI version');
                        // Try to get version from main app's working system first
                        const deviceVersionFallback = this.getDeviceFirmwareFromMainApp();
                        if (deviceVersionFallback) {
                            console.log('✅ [AutomaticUpdater] No active device, but found version from main app:', deviceVersionFallback);
                            this.currentVersion = { firmware_version: deviceVersionFallback };
                            resolve(this.currentVersion);
                            return;
                        }
                        
                        console.log('❌ [AutomaticUpdater] No active device and no UI version available');
                        this.currentVersion = null;
                        resolve(null);
                        return;
                    }

                    console.log('[AutomaticUpdater] 🔄 Starting version detection with scanning paused');
                    const port = activeDevice.port;
                    let buffer = '';
                
                const timeout = setTimeout(() => {
                    port.off('data', handleResponse);
                    
                    console.log('⚠️ [AutomaticUpdater] Timeout getting device version, trying UI version');
                    // Try to get version from main app's working system first
                    const timeoutDeviceVersion = this.getDeviceFirmwareFromMainApp();
                    if (timeoutDeviceVersion) {
                        console.log('✅ [AutomaticUpdater] Timeout, but found version from main app:', timeoutDeviceVersion);
                        this.currentVersion = { firmware_version: timeoutDeviceVersion };
                        resolve(this.currentVersion);
                        return;
                    }
                    
                    console.log('❌ [AutomaticUpdater] Timeout and no UI version available');
                    this.currentVersion = null;
                    resolve(null);
                }, 10000);
                
                const handleResponse = (data) => {
                    try {
                        buffer += data.toString();
                        console.log('[AutomaticUpdater] Response buffer length:', buffer.length);
                        
                        // Use simple READVERSION command response format
                        if (buffer.includes('END')) {
                            console.log('[AutomaticUpdater] ✅ Received END marker, processing READVERSION response...');
                            clearTimeout(timeout);
                            port.off('data', handleResponse);
                            
                            console.log('[AutomaticUpdater] Full response buffer:', buffer);
                            
                            let version = null;
                            
                            // Parse VERSION:x.x response from READVERSION command
                            const versionMatch = buffer.match(/VERSION:([^\s\n\r]+)/);
                            if (versionMatch) {
                                version = versionMatch[1].trim();
                                console.log('[AutomaticUpdater] ✅ Found version from READVERSION:', version);
                            }
                            
                            if (version) {
                                this.currentVersion = { firmware_version: version };
                                console.log(`[AutomaticUpdater] 📱 Current device version detected: v${version}`);
                                resolve(this.currentVersion);
                                return;
                            } else {
                                console.log('[AutomaticUpdater] ⚠️ Could not extract version from READVERSION response, trying main app fallback');
                                // Try to get version from main app's working system
                                const extractDeviceVersion = this.getDeviceFirmwareFromMainApp();
                                if (extractDeviceVersion) {
                                    console.log('[AutomaticUpdater] ✅ Using version from main app as fallback:', extractDeviceVersion);
                                    this.currentVersion = { firmware_version: extractDeviceVersion };
                                    resolve(this.currentVersion);
                                    return;
                                }
                                
                                console.log('[AutomaticUpdater] ❌ No version could be determined');
                                this.currentVersion = null;
                                resolve(null);
                            }
                        }
                    } catch (error) {
                        clearTimeout(timeout);
                        port.off('data', handleResponse);
                        
                        // Try to get version from main app's working system first
                        const errorDeviceVersion = this.getDeviceFirmwareFromMainApp();
                        if (errorDeviceVersion) {
                            console.log('✅ [AutomaticUpdater] Communication error, but found version from main app:', errorDeviceVersion);
                            this.currentVersion = { firmware_version: errorDeviceVersion };
                            resolve(this.currentVersion);
                            return;
                        }
                        
                        console.log('❌ [AutomaticUpdater] Error reading device version and no UI version available:', error.message);
                        this.currentVersion = null;
                        resolve(null);
                    }
                };
                
                port.on('data', handleResponse);
                console.log('[AutomaticUpdater] Sending READVERSION command (simple and reliable)...');
                // Use the simple READVERSION command like the working serial test
                port.write('READVERSION\n');
                console.log('[AutomaticUpdater] Attempting to read version using READVERSION command');
                
            } catch (error) {
                // Try to get version from main app's working system first
                const finalDeviceVersion = this.getDeviceFirmwareFromMainApp();
                if (finalDeviceVersion) {
                    console.log('✅ [AutomaticUpdater] Error in getCurrentVersion, but found version from main app:', finalDeviceVersion);
                    this.currentVersion = { firmware_version: finalDeviceVersion };
                    resolve(this.currentVersion);
                    return;
                }
                
                console.log('❌ [AutomaticUpdater] Error in getCurrentVersion and no UI version available:', error.message);
                this.currentVersion = null;
                resolve(null);
            }
        });
        });
    }

    /**
     * Check online for firmware updates - Only proceed if version is known
     */
    async checkForUpdates(showNotification = true) {
        console.log("🔍 [AutomaticUpdater] Checking for firmware updates...");
        console.log("🔍 [AutomaticUpdater] showNotification:", showNotification);
        console.log("🔍 [AutomaticUpdater] Current version:", this.currentVersion);
        
        try {
            // Update last check time
            this.lastCheckTime = Date.now();
            localStorage.setItem('lastUpdateCheck', this.lastCheckTime.toString());
            
            console.log("🔍 [AutomaticUpdater] Fetching remote manifest from:", this.manifestURL);
            
            // Fetch remote manifest
            const response = await fetch(this.manifestURL);
            console.log("🔍 [AutomaticUpdater] Fetch response status:", response.status, response.ok);
            
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }
            
            const githubResponse = await response.json();
            console.log("🔍 [AutomaticUpdater] GitHub response received:", !!githubResponse);
            console.log("🔍 [AutomaticUpdater] GitHub response content:", githubResponse);
            const manifestContent = atob(githubResponse.content);
            this.remoteManifest = JSON.parse(manifestContent);
            
            // Only proceed if we have a valid current version
            if (!this.currentVersion) {
                await this.getCurrentVersion();
            }
            
            // If we still don't have a version after trying, don't proceed with automatic update check
            if (!this.currentVersion || !this.currentVersion.firmware_version) {
                console.log("❌ [AutomaticUpdater] Cannot determine device version - skipping automatic update check");
                console.log("💡 Use manual refresh button to retry version detection");
                
                if (showNotification) {
                    this.showVersionDetectionFailedNotification();
                }
                return false;
            }
            
            console.log(`📱 Current device version: ${this.currentVersion.firmware_version}`);
            console.log(`🌐 Remote version: ${this.remoteManifest.firmware_version}`);
            
            this.updateAvailable = this.compareVersions(
                this.currentVersion.firmware_version,
                this.remoteManifest.firmware_version
            );
            
            if (this.updateAvailable) {
                console.log("🎉 Firmware update available!");
                
                if (showNotification) {
                    this.showUpdateNotification();
                }
                
                // Trigger custom event for UI updates
                window.dispatchEvent(new CustomEvent('firmwareUpdateAvailable', {
                    detail: {
                        currentVersion: this.currentVersion.firmware_version,
                        newVersion: this.remoteManifest.firmware_version,
                        releaseNotes: this.remoteManifest.release_notes
                    }
                }));
                
            } else {
                console.log("✅ Firmware is up to date");
                
                if (showNotification) {
                    this.showUpToDateNotification();
                }
            }
            
            return this.updateAvailable;
            
        } catch (error) {
            console.error("❌ Update check failed:", error);
            
            if (showNotification) {
                this.showErrorNotification(error.message);
            }
            
            return false;
        }
    }

    /**
     * Manual refresh of device version
     */
    async refreshDeviceVersion() {
        console.log("🔄 Manual device version refresh requested");
        
        // Show refresh progress
        const refreshModal = document.createElement('div');
        refreshModal.className = 'update-progress-modal';
        refreshModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        refreshModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                <h3 style="margin-top: 0; color: #4CAF50;">🔄 Refreshing Device Version...</h3>
                <p style="margin: 15px 0;">Detecting current firmware version...</p>
            </div>
        `;
        
        document.body.appendChild(refreshModal);
        
        try {
            // Force fresh version detection
            this.currentVersion = null;
            const version = await this.getCurrentVersion();
            
            if (version && version.firmware_version) {
                // Format version number to avoid double "v" prefix
                const versionDisplay = version.firmware_version.startsWith('v') ? version.firmware_version : `v${version.firmware_version}`;
                
                // Success - show version but DON'T trigger update check
                refreshModal.innerHTML = `
                    <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                        <h3 style="margin-top: 0; color: #4CAF50;">✅ Version Detected!</h3>
                        <p style="margin: 15px 0;"><strong>Current Firmware:</strong> ${versionDisplay}</p>
                        <p style="margin: 15px 0;">Version detection successful.</p>
                        <button onclick="this.parentNode.parentNode.remove()" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
                    </div>
                `;
                
                // Auto-close after 3 seconds
                setTimeout(() => {
                    if (refreshModal.parentNode) {
                        refreshModal.remove();
                    }
                }, 3000);
                
            } else {
                // Still failed
                refreshModal.innerHTML = `
                    <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                        <h3 style="margin-top: 0; color: #f44336;">❌ Version Detection Failed</h3>
                        <p style="margin: 15px 0;">Unable to determine firmware version.</p>
                        <p style="margin: 15px 0;">Please ensure device is connected and try again.</p>
                        <button onclick="this.parentNode.parentNode.remove()" style="background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
                    </div>
                `;
            }
            
        } catch (error) {
            // Error during refresh
            refreshModal.innerHTML = `
                <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                    <h3 style="margin-top: 0; color: #f44336;">❌ Refresh Failed</h3>
                    <p style="margin: 15px 0;">Error: ${error.message}</p>
                    <button onclick="this.parentNode.parentNode.remove()" style="background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
                </div>
            `;
        }
    }

    /**
     * Show version detection failed notification
     */
    showVersionDetectionFailedNotification() {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        notification.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 450px; text-align: center;">
                <h3 style="margin-top: 0; color: #ff9800;">⚠️ Version Detection Failed</h3>
                <p style="margin: 15px 0;">Unable to determine current firmware version.</p>
                <p style="margin: 15px 0;">Update check cannot proceed without knowing the current version.</p>
                <div style="margin-top: 25px;">
                    <button id="refresh-version" style="background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">🔄 Refresh Version</button>
                    <button id="dismiss-warning" style="background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">Dismiss</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Handle button clicks
        document.getElementById('refresh-version').onclick = async () => {
            notification.remove();
            await this.refreshDeviceVersion();
        };
        
        document.getElementById('dismiss-warning').onclick = () => {
            notification.remove();
        };
        
        // Auto-remove after 15 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 15000);
    }

    /**
     * Compare version strings (semantic versioning)
     */
    compareVersions(current, remote) {
        console.log("🔍 [AutomaticUpdater] compareVersions called with:");
        console.log("🔍 [AutomaticUpdater] - current:", current);
        console.log("🔍 [AutomaticUpdater] - remote:", remote);
        
        // Normalize versions by removing 'v' prefix if present
        const normalizeCurrent = current.replace(/^v/, '');
        const normalizeRemote = remote.replace(/^v/, '');
        
        const parseCurrent = normalizeCurrent.split('.').map(num => parseInt(num) || 0);
        const parseRemote = normalizeRemote.split('.').map(num => parseInt(num) || 0);
        
        console.log("🔍 [AutomaticUpdater] - parseCurrent:", parseCurrent);
        console.log("🔍 [AutomaticUpdater] - parseRemote:", parseRemote);
        
        // Pad arrays to same length
        const maxLength = Math.max(parseCurrent.length, parseRemote.length);
        while (parseCurrent.length < maxLength) parseCurrent.push(0);
        while (parseRemote.length < maxLength) parseRemote.push(0);
        
        console.log("🔍 [AutomaticUpdater] - parseCurrent (padded):", parseCurrent);
        console.log("🔍 [AutomaticUpdater] - parseRemote (padded):", parseRemote);
        
        // Compare each segment
        for (let i = 0; i < maxLength; i++) {
            console.log(`🔍 [AutomaticUpdater] - Comparing segment ${i}: ${parseRemote[i]} vs ${parseCurrent[i]}`);
            if (parseRemote[i] > parseCurrent[i]) {
                console.log("🔍 [AutomaticUpdater] - Result: Remote is newer (true)");
                return true; // Remote is newer
            } else if (parseRemote[i] < parseCurrent[i]) {
                console.log("🔍 [AutomaticUpdater] - Result: Current is newer (false)");
                return false; // Current is newer
            }
        }
        
        console.log("🔍 [AutomaticUpdater] - Result: Versions are equal (false)");
        return false; // Versions are equal
    }

    /**
     * Manual update check (called by UI button)
     */
    async manualUpdateCheck() {
        console.log("🔍 [AutomaticUpdater] Manual update check requested");
        console.log("🔍 [AutomaticUpdater] Current version state:", this.currentVersion);
        console.log("🔍 [AutomaticUpdater] Calling checkForUpdates...");
        return await this.checkForUpdates(true);
    }

    /**
     * Show update available notification
     */
    showUpdateNotification() {
        // Create and show update notification UI
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        
        // Create the modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: #2a2a2a; 
            color: #eee; 
            padding: 30px; 
            border-radius: 8px; 
            box-shadow: 0 4px 20px rgba(0,0,0,0.5); 
            max-width: 500px; 
            text-align: center;
        `;
        
        // Format version numbers to avoid double "v" prefix
        const currentVersionDisplay = this.currentVersion.firmware_version.startsWith('v') ? this.currentVersion.firmware_version : `v${this.currentVersion.firmware_version}`;
        const remoteVersionDisplay = this.remoteManifest.firmware_version.startsWith('v') ? this.remoteManifest.firmware_version : `v${this.remoteManifest.firmware_version}`;
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; color: #4CAF50;">🎉 Firmware Update Available!</h3>
            <p style="margin: 15px 0;"><strong>Current:</strong> ${currentVersionDisplay}</p>
            <p style="margin: 15px 0;"><strong>Available:</strong> ${remoteVersionDisplay}</p>
            <p style="margin: 15px 0; font-size: 14px; color: #ccc;">${this.remoteManifest.release_notes || 'New firmware version available'}</p>
        `;
        
        // Create buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'margin-top: 25px;';
        
        const updateButton = document.createElement('button');
        updateButton.textContent = 'Update Now';
        updateButton.style.cssText = 'background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;';
        updateButton.onclick = () => {
            console.log("🚀 Update Now clicked - starting firmware update process");
            notification.remove();
            this.startUpdateProcess();
        };
        
        const laterButton = document.createElement('button');
        laterButton.textContent = 'Later';
        laterButton.style.cssText = 'background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;';
        laterButton.onclick = () => {
            console.log("⏳ Update Later clicked - dismissing notification");
            notification.remove();
        };
        
        buttonContainer.appendChild(updateButton);
        buttonContainer.appendChild(laterButton);
        modalContent.appendChild(buttonContainer);
        notification.appendChild(modalContent);
        
        document.body.appendChild(notification);
        
        // Auto-remove after 30 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 30000);
    }

    /**
     * Show up-to-date notification
     */
    showUpToDateNotification() {
        // Format version number to avoid double "v" prefix
        const versionDisplay = this.currentVersion.firmware_version.startsWith('v') ? this.currentVersion.firmware_version : `v${this.currentVersion.firmware_version}`;
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        notification.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                <h3 style="margin-top: 0; color: #4CAF50;">✅ Firmware Up to Date</h3>
                <p style="margin: 15px 0;">Your device is running the latest firmware version ${versionDisplay}</p>
                <button onclick="this.parentNode.parentNode.remove()" style="background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-close after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    /**
     * Show error notification
     */
    showErrorNotification(error) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        notification.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                <h3 style="margin-top: 0; color: #f44336;">❌ Update Check Failed</h3>
                <p style="margin: 15px 0;">${error}</p>
                <button onclick="this.parentNode.parentNode.remove()" style="background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Dismiss</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 10000);
    }

    /**
     * Show update settings
     */
    showUpdateSettings() {
        // Implementation for update settings UI
        console.log("⚙️ Update settings requested");
        // This would open a settings modal for configuring update behavior
    }

    /**
     * Start the update process with progress UI
     */
    async startUpdateProcess() {
        console.log("🚀 Starting firmware update process...");
        
        // Show update progress modal
        const updateModal = document.createElement('div');
        updateModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            font-family: 'Segoe UI', sans-serif;
        `;
        updateModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                <h3 style="margin-top: 0; color: #4CAF50;">🚀 Firmware Update Process</h3>
                <p style="margin: 15px 0;">This will open the main firmware updater.</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;">The automatic update download and installation is not yet implemented in this version.</p>
                <div style="margin-top: 25px;">
                    <button id="open-updater" style="background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;">Open Firmware Updater</button>
                    <button id="cancel-update" style="background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;">Cancel</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(updateModal);
        
        // Handle button clicks
        document.getElementById('open-updater').onclick = () => {
            updateModal.remove();
            // Trigger the main firmware updater
            if (window.firmwareUpdater) {
                console.log("🔄 Opening main firmware updater interface");
                // This would trigger the main firmware updater UI
                // For now, just log that we'd open it
                const event = new CustomEvent('openFirmwareUpdater');
                window.dispatchEvent(event);
            } else {
                console.log("⚠️ Main firmware updater not available");
            }
        };
        
        document.getElementById('cancel-update').onclick = () => {
            updateModal.remove();
        };
    }

    // Additional methods (notifications, UI, etc.) would go here...
    // For brevity, keeping core functionality only
}

// Export for use in main app
window.AutomaticFirmwareUpdater = AutomaticFirmwareUpdater;
