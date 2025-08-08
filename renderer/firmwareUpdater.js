// ===== FIRMWARE UPDATE SYSTEM =====
// Safe firmware update system using staged updates folder

class FirmwareUpdater {
    constructor() {
        this.updateInProgress = false;
        this.updateFiles = new Map(); // filename -> content
    }

    /**
     * Add a file to the pending update package
     * @param {string} filename - Name of the firmware file (e.g., 'code.py', 'hardware.py')
     * @param {string} content - File content as string
     */
    addUpdateFile(filename, content) {
        this.updateFiles.set(filename, content);
        console.log(`[FirmwareUpdater] Added ${filename} to update package (${content.length} bytes)`);
    }

    /**
     * Clear all pending update files
     */
    clearUpdatePackage() {
        this.updateFiles.clear();
        console.log('[FirmwareUpdater] Update package cleared');
    }

    /**
     * Get list of files in current update package
     */
    getUpdateFileList() {
        return Array.from(this.updateFiles.keys());
    }

    /**
     * Deploy the staged update package to device
     * Files are written to /updates/ folder and device is rebooted
     * Boot process will move files to root and restart automatically
     */
    async deployUpdate(progressCallback = null) {
        if (this.updateInProgress) {
            throw new Error('Update already in progress');
        }

        if (this.updateFiles.size === 0) {
            throw new Error('No files in update package');
        }

        // Check for active device like automaticFirmwareUpdater does
        const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
        if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
            throw new Error('No device connected');
        }

        this.updateInProgress = true;
        
        try {
            console.log(`[FirmwareUpdater] Deploying update with ${this.updateFiles.size} files`);
            
            // Use the existing pauseScanningDuringOperation to prevent scanning interference
            // AND temporarily set isFlashingFirmware to prevent BOOTSEL scanning interference
            return await window.multiDeviceManager.pauseScanningDuringOperation(async () => {
                // Temporarily disable BOOTSEL scanning during firmware update
                const originalFlashingState = window.getFlashingFirmware();
                window.setFlashingFirmware(true);
                console.log('[FirmwareUpdater] BOOTSEL detection disabled during firmware update');
                
                try {
                    // Create /updates/ directory first
                    if (progressCallback) {
                        progressCallback({
                            phase: 'deploying',
                            detail: 'Preparing device for update...'
                        });
                    }
                    await this.createUpdatesDirectory();
                    
                    // Write each file to /updates/ folder with progress tracking
                    const totalFiles = this.updateFiles.size;
                    let completedFiles = 0;
                    
                    for (const [filename, content] of this.updateFiles) {
                        if (progressCallback) {
                            progressCallback({
                                phase: 'deploying',
                                current: completedFiles,
                                total: totalFiles,
                                detail: `Installing firmware files...` // Generic message without filename
                            });
                        }
                        
                        await this.writeUpdateFile(filename, content);
                        completedFiles++;
                        
                        if (progressCallback) {
                            progressCallback({
                                phase: 'deploying',
                                current: completedFiles,
                                total: totalFiles,
                                detail: `Installing firmware files...` // Generic message without filename
                            });
                        }
                        
                        // Small delay between files to make progress visible
                        if (completedFiles < totalFiles) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                    
                    console.log('[FirmwareUpdater] All update files written successfully');
                    
                    // Trigger reboot - boot.py will process the updates
                    if (progressCallback) {
                        progressCallback({
                            phase: 'rebooting',
                            detail: 'Restarting device to apply updates...'
                        });
                    }
                    await this.triggerUpdateReboot();
                    
                    return true;
                } finally {
                    // Restore original BOOTSEL scanning state
                    window.setFlashingFirmware(originalFlashingState);
                    console.log('[FirmwareUpdater] BOOTSEL detection restored after firmware update');
                }
            });
            
        } catch (error) {
            console.error('[FirmwareUpdater] Update deployment failed:', error);
            throw error;
        } finally {
            this.updateInProgress = false;
        }
    }

    /**
     * Create the /updates/ directory on device
     */
    async createUpdatesDirectory() {
        return new Promise((resolve, reject) => {
            // Get active device port like automaticFirmwareUpdater does
            const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
            if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                reject(new Error('No active device connected'));
                return;
            }
            const port = activeDevice.port;
            let responseBuffer = '';
            
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Timeout creating updates directory'));
            }, 5000);
            
            const dataHandler = (data) => {
                console.log('[FirmwareUpdater] MKDIR response data:', data);
                responseBuffer += data;
                console.log('[FirmwareUpdater] MKDIR response buffer:', responseBuffer);
                if (responseBuffer.includes('MKDIR:SUCCESS:')) {
                    console.log('[FirmwareUpdater] MKDIR success detected');
                    cleanup();
                    resolve();
                } else if (responseBuffer.includes('MKDIR:ERROR:')) {
                    console.log('[FirmwareUpdater] MKDIR error detected');
                    cleanup();
                    reject(new Error('Failed to create updates directory'));
                }
            };
            
            const cleanup = () => {
                clearTimeout(timeout);
                port.removeListener('data', dataHandler);
            };
            
            port.on('data', dataHandler);
            
            console.log('[FirmwareUpdater] Sending MKDIR:updates command');
            try {
                port.write('MKDIR:updates\n');
                console.log('[FirmwareUpdater] MKDIR command sent successfully');
            } catch (err) {
                console.log('[FirmwareUpdater] Error sending MKDIR command:', err);
                cleanup();
                reject(err);
            }
        });
    }

    /**
     * Write a single file to the /updates/ folder
     */
    async writeUpdateFile(filename, content) {
        console.log(`[FirmwareUpdater] Writing update file: /updates/${filename}`);
        
        if (window.serialFileIO && typeof window.serialFileIO.writeFile === 'function') {
            // Get active device port first
            const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
            if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                throw new Error('No active device connected');
            }
            // Use existing serialFileIO system with correct parameter order
            return await window.serialFileIO.writeFile(activeDevice.port, `updates/${filename}`, content);
        } else {
            // Fallback to direct write
            return new Promise((resolve, reject) => {
                // Get active device port like automaticFirmwareUpdater does
                const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
                if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                    reject(new Error('No active device connected'));
                    return;
                }
                const port = activeDevice.port;
                let responseBuffer = '';
                
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout writing ${filename}`));
                }, 30000);
                
                const dataHandler = (data) => {
                    responseBuffer += data;
                    if (responseBuffer.includes('WRITE_OK')) {
                        cleanup();
                        resolve();
                    } else if (responseBuffer.includes('WRITE_ERROR')) {
                        cleanup();
                        reject(new Error(`Failed to write ${filename}`));
                    }
                };
                
                const cleanup = () => {
                    clearTimeout(timeout);
                    port.removeListener('data', dataHandler);
                };
                
                port.on('data', dataHandler);
                
                try {
                    port.write(`WRITEFILE:updates/${filename}\n`);
                    port.write(content + '\n');
                    port.write('END\n');
                } catch (err) {
                    cleanup();
                    reject(err);
                }
            });
        }
    }

    /**
     * Trigger device reboot to process updates
     */
    async triggerUpdateReboot() {
        console.log('[FirmwareUpdater] Triggering update reboot...');
        
        // Use existing rebootAndReload system if available
        if (window.rebootAndReload && typeof window.rebootAndReload === 'function') {
            return window.rebootAndReload('code.py');
        } else {
            // Direct reboot command
            return new Promise((resolve) => {
                // Get active device port like automaticFirmwareUpdater does
                const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
                if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
                    console.log('[FirmwareUpdater] No active device for reboot');
                    resolve(); // Don't fail the update process
                    return;
                }
                const port = activeDevice.port;
                try {
                    port.write('REBOOT\n');
                    // Don't wait for response as device will restart
                    setTimeout(resolve, 1000);
                } catch (err) {
                    console.warn('[FirmwareUpdater] Reboot command failed, but may still work:', err);
                    resolve();
                }
            });
        }
    }

    /**
     * Create firmware update from current device files (for backup/rollback)
     */
    async createBackupPackage() {
        const backupFiles = ['code.py', 'hardware.py', 'utils.py', 'gamepad.py', 'serial_handler.py', 'pin_detect.py'];
        const backup = new Map();
        
        if (!window.serialFileIO || typeof window.serialFileIO.readFile !== 'function') {
            throw new Error('File reading system not available');
        }
        
        for (const filename of backupFiles) {
            try {
                const content = await window.serialFileIO.readFile(filename);
                backup.set(filename, content);
                console.log(`[FirmwareUpdater] Backed up ${filename}`);
            } catch (error) {
                console.warn(`[FirmwareUpdater] Could not backup ${filename}:`, error);
            }
        }
        
        return backup;
    }
}

// Global firmware updater instance
window.firmwareUpdater = new FirmwareUpdater();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FirmwareUpdater;
}
