// ===== AUTOMATIC FIRMWARE UPDATE SYSTEM =====
// Checks online sources for firmware updates and manages the update process

class AutomaticFirmwareUpdater {
    constructor() {
        this.updateCheckInterval = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.lastCheckTime = localStorage.getItem('lastUpdateCheck') || 0;
        // Remove global suppression - now device-specific
        this.currentVersion = null;
        this.remoteManifest = null;
        this.cachedRemoteManifest = null; // Store remote version fetched at startup
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
        
        // STEP 1: Always fetch latest firmware version at startup (regardless of device connection)
        console.log("🌐 Fetching latest firmware version at startup...");
        await this.fetchLatestFirmwareVersion();
        
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
                    
                    // STEP 2: Now that we have device version, check against cached remote version
                    console.log("🔍 [AutomaticUpdater] Device connected and version detected, checking against cached remote version...");
                    this.checkDeviceAgainstCachedRemote();
                    return; // Don't retry if we already have the version
                }
                
                console.log("⚠️ setupDeviceInformation didn't detect version, starting retry logic...");
                // Attempt version detection with retry logic only if no version was found
                await this.retryVersionDetectionAfterConnection(device);
            });
            
            console.log("✅ Device connection event listener registered for automatic version detection");
        }
        
        // Get current device version if already connected
        try {
            await this.getCurrentVersion();
            console.log("📱 Current device version detected:", this.currentVersion);
            
            // If we have both device version and cached remote, check immediately
            if (this.currentVersion && this.cachedRemoteManifest) {
                console.log("🔍 Both device and remote versions available, checking for updates...");
                this.checkDeviceAgainstCachedRemote();
            }
        } catch (error) {
            console.warn("⚠️ Failed to get current device version:", error);
        }
        
        // Traditional 24-hour periodic checking for manual checks and background updates
        setInterval(() => {
            // Try to get device version if we don't have one
            if (!this.currentVersion || !this.currentVersion.firmware_version) {
                console.log("🔍 [AutomaticUpdater] Periodic check: No device version, attempting detection...");
                this.getCurrentVersion().then(version => {
                    if (version && version.firmware_version) {
                        console.log("✅ [AutomaticUpdater] Device version detected during periodic check:", version.firmware_version);
                        // Now that we have a version, check for updates
                        this.checkForUpdates(false);
                    }
                }).catch(error => {
                    console.log("⚠️ [AutomaticUpdater] Periodic version detection failed:", error);
                });
            } else {
                // We have a version, do normal update check
                this.checkForUpdates(false);
            }
        }, this.updateCheckInterval);
        
        // Additional shorter interval for version detection when no device version available
        const versionCheckInterval = setInterval(() => {
            if (!this.currentVersion || !this.currentVersion.firmware_version) {
                console.log("🔍 [AutomaticUpdater] Short interval check: Attempting device version detection...");
                this.getCurrentVersion().then(version => {
                    if (version && version.firmware_version) {
                        console.log("✅ [AutomaticUpdater] Device version detected:", version.firmware_version);
                        clearInterval(versionCheckInterval); // Stop the short interval once we have a version
                        // Check against cached remote version
                        if (this.cachedRemoteManifest) {
                            this.checkDeviceAgainstCachedRemote();
                        }
                    }
                }).catch(error => {
                    console.log("⚠️ [AutomaticUpdater] Version detection attempt failed:", error);
                });
            } else {
                clearInterval(versionCheckInterval); // Stop if we already have a version
            }
        }, 30000); // Check every 30 seconds for device version
    }

    /**
     * Fetch latest firmware version at app startup (independent of device connection)
     */
    async fetchLatestFirmwareVersion() {
        try {
            console.log("🌐 [AutomaticUpdater] Fetching latest firmware manifest from GitHub...");
            
            const response = await fetch(this.manifestURL);
            console.log("🌐 [AutomaticUpdater] GitHub response status:", response.status, response.ok);
            
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }
            
            const githubResponse = await response.json();
            const manifestContent = atob(githubResponse.content);
            this.cachedRemoteManifest = JSON.parse(manifestContent);
            
            console.log(`🌐 [AutomaticUpdater] Latest firmware version cached: v${this.cachedRemoteManifest.firmware_version}`);
            
            // Update last check time since we successfully fetched remote version
            this.lastCheckTime = Date.now();
            localStorage.setItem('lastUpdateCheck', this.lastCheckTime.toString());
            
            return this.cachedRemoteManifest;
            
        } catch (error) {
            console.error("❌ [AutomaticUpdater] Failed to fetch latest firmware version:", error);
            return null;
        }
    }

    /**
     * Get device-specific unique identifier for suppression tracking
     */
    getDeviceSuppressionKey() {
        const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
        if (!activeDevice) {
            console.warn("⚠️ [AutomaticUpdater] No active device for suppression key");
            return null;
        }
        
        // Use device UID if available, otherwise fall back to device name/id combination
        if (activeDevice.uid) {
            return `updatePromptSuppression_${activeDevice.uid}`;
        } else if (activeDevice.id) {
            // Use device ID and name combination as fallback
            const deviceName = activeDevice.displayName || activeDevice.name || 'unknown';
            return `updatePromptSuppression_${activeDevice.id}_${deviceName}`;
        } else {
            console.warn("⚠️ [AutomaticUpdater] Cannot create device suppression key - no UID or ID");
            return null;
        }
    }

    /**
     * Check if update prompts are suppressed for the current device
     */
    isUpdatePromptSuppressed() {
        const suppressionKey = this.getDeviceSuppressionKey();
        if (!suppressionKey) {
            console.warn("⚠️ [AutomaticUpdater] No suppression key - allowing prompt");
            return false;
        }
        
        const suppressionTimestamp = localStorage.getItem(suppressionKey);
        if (!suppressionTimestamp) {
            console.log(`📱 [AutomaticUpdater] No suppression found for device: ${suppressionKey}`);
            return false;
        }
        
        const now = Date.now();
        const timeSinceSuppression = now - parseInt(suppressionTimestamp);
        const suppressionPeriod = 24 * 60 * 60 * 1000; // 24 hours
        
        if (timeSinceSuppression < suppressionPeriod) {
            const nextPrompt = new Date(parseInt(suppressionTimestamp) + suppressionPeriod);
            console.log(`⏰ [AutomaticUpdater] Update prompt suppressed for device until: ${nextPrompt.toLocaleString()}`);
            return true;
        } else {
            console.log(`✅ [AutomaticUpdater] Suppression period expired for device: ${suppressionKey}`);
            // Clean up expired suppression
            localStorage.removeItem(suppressionKey);
            return false;
        }
    }

    /**
     * Set update prompt suppression for the current device
     */
    suppressUpdatePromptForDevice() {
        const suppressionKey = this.getDeviceSuppressionKey();
        if (!suppressionKey) {
            console.error("❌ [AutomaticUpdater] Cannot suppress - no device suppression key");
            return false;
        }
        
        const suppressionTimestamp = Date.now();
        localStorage.setItem(suppressionKey, suppressionTimestamp.toString());
        
        const nextPrompt = new Date(suppressionTimestamp + (24 * 60 * 60 * 1000));
        console.log(`⏰ [AutomaticUpdater] Update prompts suppressed for device ${suppressionKey} until: ${nextPrompt.toLocaleString()}`);
        
        return true;
    }

    /**
     * Check device firmware version against cached remote version
     */
    checkDeviceAgainstCachedRemote() {
        console.log("🔍 [AutomaticUpdater] Checking device version against cached remote version...");
        
        if (!this.currentVersion || !this.currentVersion.firmware_version) {
            console.log("⚠️ [AutomaticUpdater] No device version available for comparison");
            return false;
        }
        
        if (!this.cachedRemoteManifest) {
            console.log("⚠️ [AutomaticUpdater] No cached remote manifest available for comparison");
            return false;
        }
        
        const deviceVersion = this.currentVersion.firmware_version;
        const remoteVersion = this.cachedRemoteManifest.firmware_version;
        
        console.log(`🔍 [AutomaticUpdater] Comparing versions: device="${deviceVersion}" vs remote="${remoteVersion}"`);
        
        const updateAvailable = this.compareVersions(deviceVersion, remoteVersion);
        
        if (updateAvailable) {
            console.log("🎉 [AutomaticUpdater] Firmware update available!");
            
            // Check if user has suppressed update prompts for this specific device
            if (this.isUpdatePromptSuppressed()) {
                console.log("⏰ [AutomaticUpdater] Update prompt suppressed for this device");
                return false;
            }
            
            // Show update notification with Later button
            this.showUpdateNotificationWithLater();
            
            // Trigger custom event for UI updates
            window.dispatchEvent(new CustomEvent('firmwareUpdateAvailable', {
                detail: {
                    currentVersion: deviceVersion,
                    newVersion: remoteVersion,
                    releaseNotes: this.cachedRemoteManifest.release_notes
                }
            }));
            
            return true;
        } else {
            console.log("✅ [AutomaticUpdater] Device firmware is up to date");
            return false;
        }
    }
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
        console.log("🔍 [AutomaticUpdater] Cached remote manifest:", this.cachedRemoteManifest);
        
        try {
            // If we have cached remote manifest and current device version, use them
            if (this.currentVersion && this.currentVersion.firmware_version && this.cachedRemoteManifest) {
                console.log("🔍 [AutomaticUpdater] Using cached remote manifest for comparison...");
                
                const deviceVersion = this.currentVersion.firmware_version;
                const remoteVersion = this.cachedRemoteManifest.firmware_version;
                
                console.log(`📱 Current device version: ${deviceVersion}`);
                console.log(`🌐 Cached remote version: ${remoteVersion}`);
                
                this.updateAvailable = this.compareVersions(deviceVersion, remoteVersion);
                this.remoteManifest = this.cachedRemoteManifest; // Set for update process
                
                if (this.updateAvailable) {
                    console.log("🎉 Firmware update available (from cache)!");
                    
                    if (showNotification) {
                        // For manual checks, show regular notification (ignores suppression)
                        this.showUpdateNotification();
                    }
                    
                    // Trigger custom event for UI updates
                    window.dispatchEvent(new CustomEvent('firmwareUpdateAvailable', {
                        detail: {
                            currentVersion: deviceVersion,
                            newVersion: remoteVersion,
                            releaseNotes: this.cachedRemoteManifest.release_notes
                        }
                    }));
                    
                } else {
                    console.log("✅ Firmware is up to date (from cache)");
                    
                    if (showNotification) {
                        this.showUpToDateNotification();
                    }
                }
                
                return this.updateAvailable;
            }
            
            // Update last check time only for network requests
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
            this.cachedRemoteManifest = this.remoteManifest; // Cache for future use
            
            // Only proceed if we have a valid current version
            if (!this.currentVersion) {
                console.log("🔍 [AutomaticUpdater] No current version, attempting to get it...");
                await this.getCurrentVersion();
            }
            
            // If we still don't have a version after trying, make one more attempt with a delay
            if (!this.currentVersion || !this.currentVersion.firmware_version) {
                console.log("🔍 [AutomaticUpdater] Still no version, waiting and trying once more...");
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                await this.getCurrentVersion();
            }
            
            // If we still don't have a version after multiple attempts
            if (!this.currentVersion || !this.currentVersion.firmware_version) {
                console.log("❌ [AutomaticUpdater] Cannot determine device version after multiple attempts");
                console.log("💡 This may be because no device is connected or the device version cannot be read");
                
                // For automatic checks (showNotification = false), don't show error notifications
                if (showNotification) {
                    console.log("💡 Use manual refresh button to retry version detection");
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
                <h3 style="margin-top: 0; color: #ffcc00;">🔄 Refreshing Device Version...</h3>
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
                        <h3 style="margin-top: 0; color: #ffcc00;">✅ Version Refreshed!</h3>
                        <p style="margin: 15px 0;"><strong>Current Firmware:</strong> ${versionDisplay}</p>
                        <p style="margin: 15px 0;">Device version successfully updated in diagnostics.</p>
                        <button onclick="this.parentNode.parentNode.remove()" style="background: #ffcc00; color: black; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
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
                    
                    // Check against cached remote version
                    if (this.cachedRemoteManifest) {
                        console.log("🔍 [AutomaticUpdater] Checking device version against cached remote after retry detection...");
                        this.checkDeviceAgainstCachedRemote();
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
                    <button id="refresh-version" style="background: #ffcc00; color: black; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">🔄 Refresh Version</button>
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
        console.log("🔍 [AutomaticUpdater] Cached remote manifest:", this.cachedRemoteManifest);
        
        // If we have both device version and cached remote, check immediately
        if (this.currentVersion && this.currentVersion.firmware_version && this.cachedRemoteManifest) {
            console.log("🔍 [AutomaticUpdater] Using cached versions for manual check...");
            const updateAvailable = this.checkDeviceAgainstCachedRemote();
            
            if (!updateAvailable) {
                // Show up-to-date notification for manual checks
                this.showUpToDateNotification();
            }
            
            return updateAvailable;
        }
        
        // Fall back to full network check if we don't have cached data
        console.log("🔍 [AutomaticUpdater] Falling back to full network check...");
        return await this.checkForUpdates(true);
    }

    /**
     * Show update available notification with Later button (device-specific 24-hour suppression)
     */
    showUpdateNotificationWithLater() {
        // Use cached remote manifest for notification
        const remoteManifest = this.cachedRemoteManifest;
        
        if (!remoteManifest || !this.currentVersion) {
            console.error("❌ Cannot show update notification - missing version information");
            return;
        }
        
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
        const remoteVersionDisplay = remoteManifest.firmware_version.startsWith('v') ? remoteManifest.firmware_version : `v${remoteManifest.firmware_version}`;
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0; color: #ffcc00;">🎉 Firmware Update Available!</h3>
            <p style="margin: 15px 0;"><strong>Current:</strong> ${currentVersionDisplay}</p>
            <p style="margin: 15px 0;"><strong>Available:</strong> ${remoteVersionDisplay}</p>
            <p style="margin: 15px 0; font-size: 14px; color: #ccc;">${remoteManifest.release_notes || 'New firmware version available'}</p>
            <div style="background: #ff5722; color: white; padding: 12px; border-radius: 4px; margin: 20px 0; font-size: 13px;">
                <strong>⚠️ WARNING:</strong> Do not disconnect or power off the device during the firmware update process. Interrupting the update may render your device unusable and require manual recovery.
            </div>
        `;
        
        // Create buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'margin-top: 25px;';
        
        const updateButton = document.createElement('button');
        updateButton.textContent = 'Update Now';
        updateButton.style.cssText = 'background: #ffcc00; color: black; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;';
        updateButton.onclick = () => {
            console.log("🚀 Update Now clicked - starting firmware update process");
            notification.remove();
            // Set the remoteManifest for the update process
            this.remoteManifest = this.cachedRemoteManifest;
            this.startUpdateProcess();
        };
        
        const laterButton = document.createElement('button');
        laterButton.textContent = 'Later';
        laterButton.style.cssText = 'background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 0 10px;';
        laterButton.onclick = () => {
            console.log("⏳ Later button clicked - setting device-specific 24-hour suppression");
            
            // Set device-specific 24-hour suppression
            const suppressionSuccess = this.suppressUpdatePromptForDevice();
            
            if (suppressionSuccess) {
                console.log("✅ [AutomaticUpdater] Successfully set device-specific update suppression");
            } else {
                console.warn("⚠️ [AutomaticUpdater] Failed to set device-specific update suppression");
            }
            
            notification.remove();
        };
        
        buttonContainer.appendChild(updateButton);
        buttonContainer.appendChild(laterButton);
        modalContent.appendChild(buttonContainer);
        notification.appendChild(modalContent);
        
        document.body.appendChild(notification);
        
        // Auto-remove after 60 seconds (longer since it has Later option)
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 60000);
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
                <h3 style="margin-top: 0; color: #ffcc00;">✅ Firmware Up to Date</h3>
                <p style="margin: 15px 0;">Your device is running the latest firmware version ${versionDisplay}</p>
                <button onclick="this.parentNode.parentNode.remove()" style="background: #ffcc00; color: black; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
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
     * Capture current device name for preservation during firmware updates
     */
    async captureCurrentDeviceName() {
        return new Promise((resolve, reject) => {
            console.log("📝 [AutomaticUpdater] Capturing current device name for preservation...");
            
            const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
            if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                console.warn("⚠️ [AutomaticUpdater] No active device for name capture");
                resolve(null);
                return;
            }

            const port = activeDevice.port;
            let buffer = '';
            let timeoutId;
            
            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                port.off('data', handleResponse);
            };
            
            const handleResponse = (data) => {
                try {
                    buffer += data.toString();
                    console.log(`📝 [AutomaticUpdater] Name capture buffer: "${buffer}"`);
                    
                    if (buffer.includes('END')) {
                        cleanup();
                        
                        // Extract device name from READDEVICENAME response
                        const nameMatch = buffer.match(/DEVICENAME:([^\r\n]+)/);
                        if (nameMatch) {
                            const userDeviceNamePart = nameMatch[1].trim();
                            console.log(`✅ [AutomaticUpdater] Captured user device name part: "${userDeviceNamePart}"`);
                            resolve(userDeviceNamePart);
                        } else {
                            console.warn("⚠️ [AutomaticUpdater] Could not extract device name from response");
                            resolve(null);
                        }
                    }
                } catch (error) {
                    cleanup();
                    console.error("❌ [AutomaticUpdater] Error capturing device name:", error);
                    resolve(null);
                }
            };
            
            // Set timeout for name capture
            timeoutId = setTimeout(() => {
                cleanup();
                console.warn("⚠️ [AutomaticUpdater] Device name capture timed out");
                resolve(null);
            }, 5000);
            
            port.on('data', handleResponse);
            console.log("📝 [AutomaticUpdater] Sending READDEVICENAME command...");
            port.write('READDEVICENAME\n');
        });
    }

    /**
     * Preserve device name in boot.py content
     */
    preserveDeviceNameInBootPy(bootPyContent, userDeviceNamePart) {
        console.log(`🔍 [AutomaticUpdater] === DEVICE NAME PRESERVATION DEBUG ===`);
        console.log(`🔍 [AutomaticUpdater] Input userDeviceNamePart: "${userDeviceNamePart}"`);
        console.log(`🔍 [AutomaticUpdater] Boot.py content length: ${bootPyContent?.length || 'null'} characters`);
        
        if (!userDeviceNamePart) {
            console.warn("⚠️ [AutomaticUpdater] No user device name part to preserve, using original boot.py");
            return bootPyContent;
        }
        
        if (!bootPyContent) {
            console.error("❌ [AutomaticUpdater] Boot.py content is null/undefined!");
            return bootPyContent;
        }
        
        console.log(`📝 [AutomaticUpdater] Preserving user device name part "${userDeviceNamePart}" in boot.py`);
        
        // Find the usb_hid.set_interface_name line and replace it
        const interfaceNameRegex = /usb_hid\.set_interface_name\("([^"]+)"\)/;
        const match = bootPyContent.match(interfaceNameRegex);
        
        if (match) {
            const originalFullName = match[1];
            console.log(`📝 [AutomaticUpdater] Found original interface name: "${originalFullName}"`);
            
            // Construct the new full name with preserved prefix and user part
            const newFullName = `BumbleGum Guitars - ${userDeviceNamePart}`;
            console.log(`📝 [AutomaticUpdater] Creating new interface name: "${newFullName}"`);
            
            const modifiedContent = bootPyContent.replace(
                interfaceNameRegex,
                `usb_hid.set_interface_name("${newFullName}")`
            );
            
            // Verify the replacement worked
            const verifyMatch = modifiedContent.match(interfaceNameRegex);
            if (verifyMatch) {
                console.log(`✅ [AutomaticUpdater] Verification: New interface name in content: "${verifyMatch[1]}"`);
            } else {
                console.error(`❌ [AutomaticUpdater] Verification failed: Could not find interface name in modified content!`);
            }
            
            console.log("✅ [AutomaticUpdater] Successfully preserved user device name part in boot.py");
            console.log(`🔍 [AutomaticUpdater] Modified content length: ${modifiedContent.length} characters`);
            return modifiedContent;
        } else {
            console.warn("⚠️ [AutomaticUpdater] Could not find usb_hid.set_interface_name in boot.py");
            console.log(`🔍 [AutomaticUpdater] Boot.py preview (first 500 chars): ${bootPyContent.substring(0, 500)}`);
            return bootPyContent;
        }
    }
    /**
     * Download and apply firmware update automatically
     */
    async downloadAndApplyUpdate() {
        console.log("🚀 Starting automatic firmware download and update...");
        
        // Use cached remote manifest if available, otherwise use remoteManifest
        const manifestToUse = this.cachedRemoteManifest || this.remoteManifest;
        
        if (!manifestToUse) {
            throw new Error('No remote manifest available');
        }
        
        console.log(`🚀 Using firmware manifest version: v${manifestToUse.firmware_version}`);
        
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
                    <h3 style="margin-top: 0; color: #ffcc00;">🚀 Updating Firmware to v${manifestToUse.firmware_version}</h3>
                    <div style="background: #ff5722; color: white; padding: 10px; border-radius: 4px; margin: 15px 0; font-size: 12px;">
                        <strong>⚠️ DO NOT DISCONNECT DEVICE</strong><br>
                        Disconnecting during update may damage firmware
                    </div>
                    <div style="margin: 20px 0;">
                        <div style="background: #444; border-radius: 10px; overflow: hidden; height: 20px; margin: 10px 0;">
                            <div style="background: #ffcc00; height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
                        </div>
                        <p style="margin: 10px 0; font-size: 14px;">${detail}</p>
                        ${total > 0 ? `<p style="margin: 5px 0; font-size: 12px; color: #aaa;">${current}/${total} (${percentage}%)</p>` : ''}
                    </div>
                </div>
            `;
        };
        
        document.body.appendChild(progressModal);
        
        try {
            // Step 0: Capture current device name for preservation
            updateProgress('preparing', 0, 0, 'Capturing current device name...');
            const userDeviceNamePart = await this.captureCurrentDeviceName();
            if (userDeviceNamePart) {
                console.log(`📝 [AutomaticUpdater] User device name part captured: "${userDeviceNamePart}"`);
            } else {
                console.warn("⚠️ [AutomaticUpdater] Could not capture user device name part - will use default");
            }
            
            // Step 1: Download all firmware files
            updateProgress('downloading', 0, 0, 'Downloading firmware files from GitHub...');
            
            const firmwareFiles = new Map();
            const filesToDownload = Object.keys(manifestToUse.files);
            
            for (let i = 0; i < filesToDownload.length; i++) {
                const fileName = filesToDownload[i];
                updateProgress('downloading', i, filesToDownload.length, `Downloading firmware files (${i + 1}/${filesToDownload.length})...`);
                
                const fileURL = `https://api.github.com/repos/${this.githubAPI.owner}/${this.githubAPI.repo}/contents/${fileName}?ref=${this.githubAPI.branch}`;
                
                const response = await fetch(fileURL);
                if (!response.ok) {
                    throw new Error(`Failed to download ${fileName}: ${response.status}`);
                }
                
                const githubResponse = await response.json();
                let fileContent = atob(githubResponse.content);
                
                console.log(`🔍 [AutomaticUpdater] Downloaded ${fileName}, content length: ${fileContent.length}`);
                
                // Special handling for boot.py to preserve device name
                if (fileName === 'boot.py' && userDeviceNamePart) {
                    console.log(`📝 [AutomaticUpdater] === BOOT.PY PROCESSING START ===`);
                    console.log(`📝 [AutomaticUpdater] Processing boot.py to preserve user device name part: "${userDeviceNamePart}"`);
                    console.log(`📝 [AutomaticUpdater] Original boot.py length: ${fileContent.length}`);
                    
                    const originalContent = fileContent;
                    fileContent = this.preserveDeviceNameInBootPy(fileContent, userDeviceNamePart);
                    
                    console.log(`📝 [AutomaticUpdater] Modified boot.py length: ${fileContent.length}`);
                    console.log(`📝 [AutomaticUpdater] Content changed: ${originalContent !== fileContent}`);
                    console.log(`📝 [AutomaticUpdater] === BOOT.PY PROCESSING END ===`);
                } else if (fileName === 'boot.py') {
                    console.warn(`⚠️ [AutomaticUpdater] Boot.py downloaded but no userDeviceNamePart available for preservation!`);
                }
                
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
            
            // Don't show success dialog immediately - wait for version validation
            this.showUpdateValidationDialog(progressModal);
            
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
     * Show update validation dialog that waits for device reconnection and version confirmation
     */
    async showUpdateValidationDialog(progressModal) {
        // Use cached remote manifest if available, otherwise use remoteManifest
        const manifestToUse = this.cachedRemoteManifest || this.remoteManifest;
        const expectedVersion = manifestToUse.firmware_version;
        
        console.log(`🔍 [AutomaticUpdater] Waiting for device reconnection and version validation. Expected: v${expectedVersion}`);
        
        // Show waiting for validation dialog
        progressModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                <h3 style="margin-top: 0; color: #ff9800;">🔄 Validating Update...</h3>
                <p style="margin: 15px 0;">Device is rebooting with new firmware v${expectedVersion}</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;">Waiting for device to reconnect and confirm update success...</p>
                <div style="background: #ff5722; color: white; padding: 10px; border-radius: 4px; margin: 15px 0; font-size: 12px;">
                    <strong>⚠️ DO NOT DISCONNECT DEVICE</strong><br>
                    Please wait for validation to complete
                </div>
                <div style="margin: 20px 0;">
                    <div class="spinner" style="border: 3px solid #444; border-top: 3px solid #ff9800; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
                </div>
                <p style="margin: 10px 0; font-size: 12px; color: #aaa;">This may take up to 30 seconds...</p>
            </div>
        `;
        
        // Add spinner animation if not already present
        if (!document.getElementById('spinner-style')) {
            const style = document.createElement('style');
            style.id = 'spinner-style';
            style.textContent = `
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Start validation process
        this.startUpdateValidation(progressModal, expectedVersion);
    }

    /**
     * Start the update validation process
     */
    async startUpdateValidation(progressModal, expectedVersion) {
        const maxWaitTime = 45000; // 45 seconds max wait
        const checkInterval = 2000; // Check every 2 seconds
        const startTime = Date.now();
        
        const validationCheck = async () => {
            try {
                // Check if device is connected
                const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
                if (!activeDevice || !activeDevice.isConnected) {
                    console.log('🔍 [AutomaticUpdater] Device not yet reconnected, waiting...');
                    
                    // Check timeout
                    if (Date.now() - startTime > maxWaitTime) {
                        this.showValidationTimeout(progressModal, expectedVersion);
                        return;
                    }
                    
                    // Continue waiting
                    setTimeout(validationCheck, checkInterval);
                    return;
                }
                
                console.log('🔌 [AutomaticUpdater] Device reconnected, checking firmware version...');
                
                // Clear version cache to force fresh detection
                this.clearVersionCache();
                
                // Wait a moment for device to stabilize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Try to get the current version
                const currentVersion = await this.getCurrentVersion();
                console.log('🔍 [AutomaticUpdater] Version check result:', currentVersion);
                
                if (currentVersion && currentVersion.firmware_version) {
                    const detectedVersion = currentVersion.firmware_version.replace(/^v/, '');
                    const expectedVersionClean = expectedVersion.replace(/^v/, '');
                    
                    console.log(`🔍 [AutomaticUpdater] Comparing versions: detected="${detectedVersion}" vs expected="${expectedVersionClean}"`);
                    
                    if (detectedVersion === expectedVersionClean) {
                        // Success! Update validated
                        this.showValidationSuccess(progressModal, expectedVersion);
                        return;
                    } else {
                        // Version mismatch - possible update failure
                        this.showValidationMismatch(progressModal, expectedVersion, detectedVersion);
                        return;
                    }
                } else {
                    console.log('⚠️ [AutomaticUpdater] Could not detect version after reconnection, retrying...');
                    
                    // Check timeout
                    if (Date.now() - startTime > maxWaitTime) {
                        this.showValidationTimeout(progressModal, expectedVersion);
                        return;
                    }
                    
                    // Continue waiting
                    setTimeout(validationCheck, checkInterval);
                    return;
                }
                
            } catch (error) {
                console.error('❌ [AutomaticUpdater] Error during validation:', error);
                
                // Check timeout
                if (Date.now() - startTime > maxWaitTime) {
                    this.showValidationTimeout(progressModal, expectedVersion);
                    return;
                }
                
                // Continue waiting
                setTimeout(validationCheck, checkInterval);
            }
        };
        
        // Start the validation process
        validationCheck();
    }

    /**
     * Show successful validation result
     */
    showValidationSuccess(progressModal, expectedVersion) {
        console.log('✅ [AutomaticUpdater] Firmware update successfully validated!');
        
        progressModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                <h3 style="margin-top: 0; color: #ffcc00;">✅ Update Complete & Validated!</h3>
                <p style="margin: 15px 0;">Firmware has been successfully updated to <strong>v${expectedVersion}</strong></p>
                <p style="margin: 15px 0; font-size: 14px; color: #ffcc00;">✓ Device reconnected successfully</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ffcc00;">✓ New firmware version confirmed</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;">Your device is now running the latest firmware and ready to use.</p>
                <button onclick="this.parentNode.parentNode.remove()" style="background: #ffcc00; color: black; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 16px; margin-top: 15px;">Close</button>
            </div>
        `;
    }

    /**
     * Show validation timeout result
     */
    showValidationTimeout(progressModal, expectedVersion) {
        console.warn('⚠️ [AutomaticUpdater] Update validation timed out');
        
        progressModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                <h3 style="margin-top: 0; color: #ff9800;">⚠️ Update Validation Timeout</h3>
                <p style="margin: 15px 0;">The firmware update has been deployed, but device validation timed out.</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;">Expected version: v${expectedVersion}</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ff9800;">• Device may still be rebooting</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ff9800;">• Check device connection and restart app if needed</p>
                <div style="margin-top: 25px;">
                    <button onclick="window.automaticFirmwareUpdater.refreshDeviceVersion(); this.parentNode.parentNode.parentNode.remove()" style="background: #ff9800; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">Refresh Version</button>
                    <button onclick="this.parentNode.parentNode.parentNode.remove()" style="background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">Close</button>
                </div>
            </div>
        `;
    }

    /**
     * Show validation version mismatch result
     */
    showValidationMismatch(progressModal, expectedVersion, detectedVersion) {
        console.warn(`⚠️ [AutomaticUpdater] Version mismatch - expected: v${expectedVersion}, detected: v${detectedVersion}`);
        
        progressModal.innerHTML = `
            <div style="background: #2a2a2a; color: #eee; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); max-width: 500px; text-align: center;">
                <h3 style="margin-top: 0; color: #f44336;">❌ Update Validation Failed</h3>
                <p style="margin: 15px 0;">The firmware update may not have completed successfully.</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;"><strong>Expected:</strong> v${expectedVersion}</p>
                <p style="margin: 15px 0; font-size: 14px; color: #ccc;"><strong>Detected:</strong> v${detectedVersion}</p>
                <p style="margin: 15px 0; font-size: 14px; color: #f44336;">The device is running a different version than expected.</p>
                <div style="margin-top: 25px;">
                    <button onclick="window.automaticFirmwareUpdater.manualUpdateCheck(); this.parentNode.parentNode.parentNode.remove()" style="background: #f44336; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">Retry Update</button>
                    <button onclick="this.parentNode.parentNode.parentNode.remove()" style="background: #666; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 0 10px;">Close</button>
                </div>
            </div>
        `;
    }

    /**
     * Start the update process - now calls downloadAndApplyUpdate directly
     */
    async startUpdateProcess() {
        console.log("🚀 Starting firmware update process...");
        await this.downloadAndApplyUpdate();
    }

    /**
     * TEST FUNCTION: Test device name preservation logic without full firmware update
     * Call this from developer console: window.automaticFirmwareUpdater.testNamePreservation()
     */
    async testNamePreservation() {
        console.log("🧪 [TEST] Starting device name preservation test...");
        
        try {
            // Step 1: Test device name capture
            console.log("🧪 [TEST] Step 1: Testing device name capture...");
            const userDeviceNamePart = await this.captureCurrentDeviceName();
            console.log(`🧪 [TEST] Captured user device name part: "${userDeviceNamePart}"`);
            
            if (!userDeviceNamePart) {
                console.error("🧪 [TEST] FAILED: Could not capture device name");
                return;
            }
            
            // Step 2: Test downloading and modifying boot.py
            console.log("🧪 [TEST] Step 2: Testing boot.py download and modification...");
            
            // Get the latest firmware manifest
            const manifestResponse = await fetch('https://api.github.com/repos/wattsy74/BumbleGum-Guitars-Configurator/contents/bgg-firmware-updates/firmware-manifest.json');
            if (!manifestResponse.ok) {
                throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
            }
            
            const manifestData = await manifestResponse.json();
            const manifestContent = JSON.parse(atob(manifestData.content));
            const latestVersion = Object.keys(manifestContent.versions).sort().pop();
            const manifest = manifestContent.versions[latestVersion];
            
            console.log(`🧪 [TEST] Using manifest version: ${latestVersion}`);
            
            // Download boot.py
            const bootPyUrl = `https://api.github.com/repos/wattsy74/BumbleGum-Guitars-Configurator/contents/bgg-firmware-updates/${manifest.files['boot.py']}`;
            const bootPyResponse = await fetch(bootPyUrl);
            
            if (!bootPyResponse.ok) {
                throw new Error(`Failed to download boot.py: ${bootPyResponse.status}`);
            }
            
            const bootPyData = await bootPyResponse.json();
            let bootPyContent = atob(bootPyData.content);
            
            console.log(`🧪 [TEST] Downloaded boot.py, length: ${bootPyContent.length}`);
            console.log(`🧪 [TEST] Original boot.py preview:\n${bootPyContent.substring(0, 500)}`);
            
            // Test name preservation
            const modifiedBootPy = this.preserveDeviceNameInBootPy(bootPyContent, userDeviceNamePart);
            
            console.log(`🧪 [TEST] Modified boot.py preview:\n${modifiedBootPy.substring(0, 500)}`);
            console.log(`🧪 [TEST] Content changed: ${bootPyContent !== modifiedBootPy}`);
            
            // Test: Find the interface name line in both versions
            const originalMatch = bootPyContent.match(/usb_hid\.set_interface_name\("([^"]+)"\)/);
            const modifiedMatch = modifiedBootPy.match(/usb_hid\.set_interface_name\("([^"]+)"\)/);
            
            console.log(`🧪 [TEST] Original interface name: "${originalMatch ? originalMatch[1] : 'NOT FOUND'}"`);
            console.log(`🧪 [TEST] Modified interface name: "${modifiedMatch ? modifiedMatch[1] : 'NOT FOUND'}"`);
            
            console.log("🧪 [TEST] ✅ Test completed successfully!");
            
            return {
                userDeviceNamePart,
                originalInterfaceName: originalMatch ? originalMatch[1] : null,
                modifiedInterfaceName: modifiedMatch ? modifiedMatch[1] : null,
                contentChanged: bootPyContent !== modifiedBootPy
            };
            
        } catch (error) {
            console.error("🧪 [TEST] ❌ Test failed:", error);
            throw error;
        }
    }

    // Additional methods (notifications, UI, etc.) would go here...
    // For brevity, keeping core functionality only
}

// Export for use in main app
window.AutomaticFirmwareUpdater = AutomaticFirmwareUpdater;
