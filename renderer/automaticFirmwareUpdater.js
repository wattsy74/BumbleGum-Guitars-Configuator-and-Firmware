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
        this.downloadAndApplyUpdate = this.downloadAndApplyUpdate.bind(this);
    }

    /**
     * Initialize the automatic update system
     */
    async initialize(firmwareUpdater, multiDeviceManager) {
        this.firmwareUpdater = firmwareUpdater;
        this.multiDeviceManager = multiDeviceManager || window.multiDeviceManager;
        
        console.log("🔄 Initializing automatic firmware update system...");
        
        // Set up device connection event listener for automatic version detection with retry
        if (this.multiDeviceManager && typeof this.multiDeviceManager.on === 'function') {
            this.multiDeviceManager.on('deviceConnected', async (device) => {
                console.log("🔌 Device connected event received, waiting for setupDeviceInformation to complete...");
                
                // Wait briefly to let setupDeviceInformation complete its version detection
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Check if setupDeviceInformation already got the version
                const deviceVersion = this.getDeviceFirmwareFromMainApp();
                if (deviceVersion) {
                    console.log("✅ setupDeviceInformation already detected version:", deviceVersion);
                    this.currentVersion = { firmware_version: deviceVersion };
                    return; // Don't retry if we already have the version
                }
                
                console.log("⚠️ setupDeviceInformation didn't detect version, starting retry logic...");
                // Attempt version detection with retry logic only if no version was found
                await this.retryVersionDetectionAfterConnection(device);
            });
            
            console.log("✅ Device connection event listener registered for automatic version detection");
        }
        
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
            // Increased delay significantly to ensure device version is fully detected and to avoid conflicts
            setTimeout(() => this.checkForUpdates(false), 10000); // 10 second delay, don't show notifications automatically
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
                
                // CRITICAL: Ignore temporary status messages that are not actual versions
                // BUT allow version-like patterns even if they might be temporary
                const temporaryStatusMessages = [
                    'Refreshing...',
                    'Requesting...',
                    'Loading...',
                    'Detecting...',
                    'Unknown',
                    'Error',
                    'No device connected',
                    'Connecting...',
                    'Timeout',
                    '-'
                ];
                
                // If it looks like a version number (contains digits and dots), use it even if it might be temporary
                const looksLikeVersion = /^v?[\d]+\.[\d]+/.test(uiVersion);
                
                if (temporaryStatusMessages.includes(uiVersion)) {
                    console.log(`⚠️ [AutomaticUpdater] Ignoring temporary status message: "${uiVersion}"`);
                } else if (looksLikeVersion) {
                    console.log('✅ [AutomaticUpdater] Found valid device firmware version from UI:', uiVersion);
                    return uiVersion;
                } else {
                    console.log(`⚠️ [AutomaticUpdater] UI version doesn't look like a valid version: "${uiVersion}"`);
                }
            }
            
            // SECOND: Check multiDeviceManager for stored version
            const multiDeviceManager = window.multiDeviceManager;
            console.log("🔍 [AutomaticUpdater] multiDeviceManager found:", !!multiDeviceManager);
            
            if (multiDeviceManager) {
                const activeDevice = multiDeviceManager.getActiveDevice?.();
                console.log("🔍 [AutomaticUpdater] activeDevice found:", !!activeDevice);
                console.log("🔍 [AutomaticUpdater] activeDevice.firmwareVersion:", activeDevice?.firmwareVersion);
                
                if (activeDevice && activeDevice.firmwareVersion) {
                    // Also check for temporary status messages in cached device version
                    const cachedVersion = activeDevice.firmwareVersion.trim();
                    const temporaryStatusMessages = [
                        'Refreshing...',
                        'Requesting...',
                        'Loading...',
                        'Detecting...',
                        'Unknown',
                        'Error',
                        'No device connected',
                        'Connecting...',
                        'Timeout',
                        '-'
                    ];
                    
                    if (temporaryStatusMessages.includes(cachedVersion)) {
                        console.log(`⚠️ [AutomaticUpdater] Ignoring temporary cached status: "${cachedVersion}"`);
                    } else {
                        console.log('✅ [AutomaticUpdater] Found valid device firmware version from main app cache:', cachedVersion);
                        return cachedVersion;
                    }
                }
            }
            
            console.log('❌ [AutomaticUpdater] No valid device firmware version found in main app');
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
        // Check if setupDeviceInformation is currently running to avoid conflicts
        if (window.setupDeviceInformationInProgress) {
            console.log('⏳ [AutomaticUpdater] setupDeviceInformation is in progress, waiting for it to complete...');
            
            // Wait for setupDeviceInformation to complete, then get version from UI
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (!window.setupDeviceInformationInProgress) {
                        clearInterval(checkInterval);
                        
                        // Now try to get version from main app's UI
                        const deviceVersion = this.getDeviceFirmwareFromMainApp();
                        if (deviceVersion) {
                            console.log('✅ [AutomaticUpdater] Got version from main app after waiting:', deviceVersion);
                            this.currentVersion = { firmware_version: deviceVersion };
                            resolve(this.currentVersion);
                        } else {
                            console.log('❌ [AutomaticUpdater] No version available after waiting for setupDeviceInformation');
                            this.currentVersion = null;
                            resolve(null);
                        }
                    }
                }, 100); // Check every 100ms
                
                // Timeout after 10 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn('⚠️ [AutomaticUpdater] Timeout waiting for setupDeviceInformation to complete');
                    this.currentVersion = null;
                    resolve(null);
                }, 10000);
            });
        }
        
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
                // Helper function to clean up and resolve
                const cleanupAndResolve = (value) => {
                    this._versionDetectionInProgress = false;
                    resolve(value);
                };
                
                // Helper function to clean up and reject
                const cleanupAndReject = (error) => {
                    this._versionDetectionInProgress = false;
                    reject(error);
                };
                
                try {
                    // Set flag to prevent conflicts with main app's version detection
                    this._versionDetectionInProgress = true;
                    
                    const activeDevice = multiDeviceManager.getActiveDevice?.();
                    if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                        console.log('⚠️ [AutomaticUpdater] No active device, trying UI version');
                        // Try to get version from main app's working system first
                        const deviceVersionFallback = this.getDeviceFirmwareFromMainApp();
                        if (deviceVersionFallback) {
                            console.log('✅ [AutomaticUpdater] No active device, but found version from main app:', deviceVersionFallback);
                            this.currentVersion = { firmware_version: deviceVersionFallback };
                            cleanupAndResolve(this.currentVersion);
                            return;
                        }
                        
                        console.log('❌ [AutomaticUpdater] No active device and no UI version available');
                        this.currentVersion = null;
                        cleanupAndResolve(null);
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
                        cleanupAndResolve(this.currentVersion);
                        return;
                    }
                    
                    console.log('❌ [AutomaticUpdater] Timeout and no UI version available');
                    this.currentVersion = null;
                    cleanupAndResolve(null);
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
                                cleanupAndResolve(this.currentVersion);
                                return;
                            } else {
                                console.log('[AutomaticUpdater] ⚠️ Could not extract version from READVERSION response, trying main app fallback');
                                // Try to get version from main app's working system
                                const extractDeviceVersion = this.getDeviceFirmwareFromMainApp();
                                if (extractDeviceVersion) {
                                    console.log('[AutomaticUpdater] ✅ Using version from main app as fallback:', extractDeviceVersion);
                                    this.currentVersion = { firmware_version: extractDeviceVersion };
                                    cleanupAndResolve(this.currentVersion);
                                    return;
                                }
                                
                                console.log('[AutomaticUpdater] ❌ No version could be determined');
                                this.currentVersion = null;
                                cleanupAndResolve(null);
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
                            cleanupAndResolve(this.currentVersion);
                            return;
                        }
                        
                        console.log('❌ [AutomaticUpdater] Error reading device version and no UI version available:', error.message);
                        this.currentVersion = null;
                        cleanupAndResolve(null);
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
                    cleanupAndResolve(this.currentVersion);
                    return;
                }
                
                console.log('❌ [AutomaticUpdater] Error in getCurrentVersion and no UI version available:', error.message);
                this.currentVersion = null;
                cleanupAndResolve(null);
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
     * Clear all cached version information to force fresh detection
     */
    clearVersionCache() {
        console.log("🧹 Clearing version cache for fresh detection");
        
        // Clear our own cache
        this.currentVersion = null;
        
        // Clear cached version from active device
        const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
        if (activeDevice) {
            activeDevice.firmwareVersion = null;
            // Only clear firmware_version from config, not entire config
            if (activeDevice.config && activeDevice.config.firmware_version) {
                activeDevice.config.firmware_version = null;
            }
            console.log("✅ Cleared activeDevice version cache");
        }
        
        // Clear UI version display
        const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
        if (deviceFirmwareElement) {
            deviceFirmwareElement.textContent = 'Unknown';
            console.log("✅ Reset UI version display");
        }
    }

    /**
     * Refresh device information in the diagnostics UI
     */
    refreshDeviceInformationUI() {
        console.log("🔄 Refreshing device information UI");
        
        // Call the main setupDeviceInformation function if available
        if (typeof setupDeviceInformation === 'function') {
            setupDeviceInformation();
            console.log("✅ Called global setupDeviceInformation()");
        } else if (window.setupDeviceInformation) {
            window.setupDeviceInformation();
            console.log("✅ Called window.setupDeviceInformation()");
        } else {
            console.warn("⚠️ setupDeviceInformation function not found");
        }
    }
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
            // Clear ALL cached versions to force fresh detection
            this.currentVersion = null;
            
            // Clear cached version from active device
            const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
            if (activeDevice) {
                // Store the old version temporarily before clearing it
                const oldFirmwareVersion = activeDevice.firmwareVersion;
                activeDevice.firmwareVersion = null;
                // Only clear firmware_version from config, not entire config
                if (activeDevice.config && activeDevice.config.firmware_version) {
                    activeDevice.config.firmware_version = null;
                }
                console.log("🔄 Cleared cached versions, old version was:", oldFirmwareVersion);
            }
            
            // DON'T set UI to "Refreshing..." to avoid fallback confusion
            // Just keep the current display and only update when we have a real version
            const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
            console.log("🔄 Current UI element text before refresh:", deviceFirmwareElement?.textContent);
            
            // Force fresh version detection
            console.log("🔍 Starting fresh version detection...");
            const version = await this.getCurrentVersion();
            console.log("🔍 Version detection result:", version);
            
            if (version && version.firmware_version) {
                console.log("✅ Version detected successfully:", version.firmware_version);
                
                // Format version number to avoid double "v" prefix
                const versionDisplay = version.firmware_version.startsWith('v') ? version.firmware_version : `v${version.firmware_version}`;
                
                // IMMEDIATE UI UPDATE: Update the device firmware element directly before calling setupDeviceInformation
                if (deviceFirmwareElement) {
                    deviceFirmwareElement.textContent = versionDisplay;
                    console.log("✅ Immediately updated UI element to:", versionDisplay);
                    
                    // Reset any error styling
                    deviceFirmwareElement.style.color = '';
                    deviceFirmwareElement.style.fontWeight = '';
                }
                
                // Cache the version in the active device to prevent setupDeviceInformation from overriding
                const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
                if (activeDevice) {
                    activeDevice.firmwareVersion = version.firmware_version;
                    if (activeDevice.config) {
                        activeDevice.config.firmware_version = version.firmware_version;
                    }
                    console.log("✅ Cached version in active device:", version.firmware_version);
                }
                
                // Now refresh the rest of the UI diagnostics information (but firmware version is already set)
                console.log("🔄 Refreshing UI diagnostics...");
                if (typeof setupDeviceInformation === 'function') {
                    setupDeviceInformation();
                    console.log("✅ Called setupDeviceInformation()");
                } else if (window.setupDeviceInformation) {
                    window.setupDeviceInformation();
                    console.log("✅ Called window.setupDeviceInformation()");
                } else {
                    console.warn("⚠️ setupDeviceInformation function not found");
                }
                
                refreshModal.innerHTML = `
                    <div style="background: #2a2a2a; color: #eee; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 400px; text-align: center;">
                        <h3 style="margin-top: 0; color: #4CAF50;">✅ Version Refreshed!</h3>
                        <p style="margin: 15px 0;"><strong>Current Firmware:</strong> ${versionDisplay}</p>
                        <p style="margin: 15px 0;">Device version successfully updated in diagnostics.</p>
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
                console.warn("❌ Version detection failed - no version returned");
                console.log("🔍 Version object:", version);
                
                // Still failed - restore UI to show failure
                if (deviceFirmwareElement) {
                    deviceFirmwareElement.textContent = 'Unknown';
                    console.log("🔄 Reset UI element to 'Unknown'");
                }
                
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
            console.error("❌ Error during refresh:", error);
            console.log("🔍 Error stack:", error.stack);
            
            // Error during refresh - restore UI
            const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
            if (deviceFirmwareElement) {
                deviceFirmwareElement.textContent = 'Error';
                console.log("🔄 Reset UI element to 'Error'");
            }
            
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
     * Automatically retry version detection after device connection with progressive delays
     */
    async retryVersionDetectionAfterConnection(device, maxRetries = 3) {
        console.log(`🔄 Starting automatic version detection retry for device: ${device.id || 'unknown'}`);
        
        const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔍 Version detection attempt ${attempt}/${maxRetries}...`);
                
                // Update UI to show retry status
                if (deviceFirmwareElement) {
                    deviceFirmwareElement.textContent = `Detecting... (${attempt}/${maxRetries})`;
                }
                
                // Try to get the version
                const version = await this.getCurrentVersion();
                
                if (version && version.firmware_version) {
                    console.log(`✅ Version detection successful on attempt ${attempt}: ${version.firmware_version}`);
                    
                    // Update UI with successful version
                    if (deviceFirmwareElement) {
                        const versionDisplay = version.firmware_version.startsWith('v') ? 
                            version.firmware_version : `v${version.firmware_version}`;
                        deviceFirmwareElement.textContent = versionDisplay;
                    }
                    
                    // Cache the version in the device
                    if (device) {
                        device.cachedFirmwareVersion = version.firmware_version;
                    }
                    
                    // Update the rest of the UI
                    if (typeof setupDeviceInformation === 'function') {
                        setupDeviceInformation();
                    } else if (window.setupDeviceInformation) {
                        window.setupDeviceInformation();
                    }
                    
                    console.log("🎉 Automatic version detection completed successfully");
                    return; // Success - exit retry loop
                } else {
                    console.warn(`⚠️ Version detection attempt ${attempt} returned no version`);
                }
                
            } catch (error) {
                console.warn(`❌ Version detection attempt ${attempt} failed:`, error.message);
            }
            
            // If not the last attempt, wait before trying again with progressive delay
            if (attempt < maxRetries) {
                const delay = attempt * 2000; // 2s, 4s, 6s delays
                console.log(`⏳ Waiting ${delay}ms before retry attempt ${attempt + 1}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        // All retries failed
        console.error(`❌ All ${maxRetries} version detection attempts failed after device connection`);
        
        // Update UI to show failure
        if (deviceFirmwareElement) {
            deviceFirmwareElement.textContent = 'Unknown';
        }
        
        console.log("💡 User can manually refresh version using the refresh button if needed");
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
     * Download and apply firmware update automatically
     */
    async downloadAndApplyUpdate() {
        console.log("🚀 Starting automatic firmware download and update...");
        
        if (!this.remoteManifest) {
            throw new Error('No remote manifest available');
        }
        
        // Show progress modal
        const progressModal = document.createElement('div');
        progressModal.style.cssText = `
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
        
        const updateProgress = (phase, current, total, detail) => {
            const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
            progressModal.innerHTML = `
                <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center; min-width: 400px;">
                    <h3 style="margin-top: 0; color: #4CAF50;">🚀 Updating Firmware to v${this.remoteManifest.firmware_version}</h3>
                    <div style="margin: 20px 0;">
                        <div style="background: #444; border-radius: 10px; overflow: hidden; height: 20px; margin: 10px 0;">
                            <div style="background: #4CAF50; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
                        </div>
                        <p style="margin: 10px 0; font-size: 14px;">${detail}</p>
                        ${total > 0 ? `<p style="margin: 5px 0; font-size: 12px; color: #aaa;">${current}/${total} (${percentage}%)</p>` : ''}
                    </div>
                </div>
            `;
        };
        
        document.body.appendChild(progressModal);
        
        try {
            // Step 1: Download all firmware files
            updateProgress('downloading', 0, 0, 'Downloading firmware files from GitHub...');
            
            const firmwareFiles = new Map();
            const filesToDownload = Object.keys(this.remoteManifest.files);
            
            for (let i = 0; i < filesToDownload.length; i++) {
                const fileName = filesToDownload[i];
                updateProgress('downloading', i, filesToDownload.length, `Downloading firmware files (${i + 1}/${filesToDownload.length})...`);
                
                const fileURL = `https://api.github.com/repos/${this.githubAPI.owner}/${this.githubAPI.repo}/contents/${fileName}?ref=${this.githubAPI.branch}`;
                
                const response = await fetch(fileURL);
                if (!response.ok) {
                    throw new Error(`Failed to download ${fileName}: ${response.status}`);
                }
                
                const githubResponse = await response.json();
                const fileContent = atob(githubResponse.content);
                firmwareFiles.set(fileName, fileContent);
                
                console.log(`✅ Downloaded ${fileName} (${fileContent.length} bytes)`);
            }
            
            updateProgress('downloading', filesToDownload.length, filesToDownload.length, 'All files downloaded successfully!');
            
            // Step 2: Prepare firmware updater
            updateProgress('preparing', 0, 0, 'Preparing firmware updater...');
            
            if (!this.firmwareUpdater) {
                this.firmwareUpdater = new FirmwareUpdater();
            }
            
            // Clear any existing update package and add our files
            this.firmwareUpdater.clearUpdatePackage();
            for (const [fileName, content] of firmwareFiles) {
                this.firmwareUpdater.addUpdateFile(fileName, content);
            }
            
            // Step 3: Deploy update
            updateProgress('installing', 0, 0, 'Installing firmware update...');
            
            await this.firmwareUpdater.deployUpdate((progress) => {
                if (progress.phase === 'deploying') {
                    updateProgress('installing', progress.current || 0, progress.total || 0, progress.detail || 'Installing firmware...');
                } else if (progress.phase === 'rebooting') {
                    updateProgress('rebooting', 0, 0, 'Rebooting device to apply update...');
                }
            });
            
            // Success - Clear version cache immediately after successful update
            console.log('✅ [AutomaticUpdater] Firmware update successful, clearing version cache for next detection...');
            this.clearVersionCache();
            
            progressModal.innerHTML = `
                <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                    <h3 style="margin-top: 0; color: #4CAF50;">✅ Update Complete!</h3>
                    <p style="margin: 15px 0;">Firmware has been successfully updated to v${this.remoteManifest.firmware_version}</p>
                    <p style="margin: 15px 0; font-size: 14px; color: #ccc;">Device will reboot automatically. Please wait for reconnection.</p>
                    <button onclick="this.parentNode.parentNode.remove()" style="background: #4CAF50; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin-top: 15px;">Close</button>
                </div>
            `;
            
            // Auto-close after 10 seconds
            setTimeout(() => {
                if (progressModal.parentNode) {
                    progressModal.remove();
                }
            }, 10000);
            
        } catch (error) {
            console.error("❌ Update failed:", error);
            
            progressModal.innerHTML = `
                <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                    <h3 style="margin-top: 0; color: #f44336;">❌ Update Failed</h3>
                    <p style="margin: 15px 0;">Error: ${error.message}</p>
                    <p style="margin: 15px 0; font-size: 14px; color: #ccc;">You can try again or use the manual firmware updater.</p>
                    <button onclick="this.parentNode.parentNode.remove()" style="background: #f44336; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin-top: 15px;">Close</button>
                </div>
            `;
        }
    }

    /**
     * Start the update process - now calls downloadAndApplyUpdate directly
     */
    async startUpdateProcess() {
        console.log("🚀 Starting firmware update process...");
        await this.downloadAndApplyUpdate();
    }

    // Additional methods (notifications, UI, etc.) would go here...
    // For brevity, keeping core functionality only
}

// Export for use in main app
window.AutomaticFirmwareUpdater = AutomaticFirmwareUpdater;
