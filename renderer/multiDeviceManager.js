
const { SerialPort } = require('serialport');
const { readFile, writeFile } = require('./serialFileIO');

// Flag to control automatic file reading (set to true to enable automatic loading)
const ENABLE_AUTOMATIC_FILE_READING = true;

// Shared state references (to be injected from app.js)
let connectedPort = null;
let awaitingFile = null;
let responseBuffers = {};
let readQueue = [];
let updateDeviceSelector = () => {};
let requestNextFile = () => {};
let showToast = () => {};

class MultiDeviceManager {
  /**
   * Reads all device files sequentially: config.json, presets.json, user_presets.json.
   * Returns { config, presets, userPresets } (parsed if possible).
   * Retries each file up to 2 times on failure.
   * @param {object} device - The device object (must have .port)
   * @returns {Promise<{config: any, presets: any, userPresets: any}>}
   */
  async readAllDeviceFilesSequentially(device) {
    // Mark file operation in progress to pause scanning
    this._fileOperationInProgress = true;
    
    // Stop auto-scanning while reading device files to prevent conflicts
    const wasAutoScanning = !!this._autoScanTimer;
    if (wasAutoScanning) {
      clearInterval(this._autoScanTimer);
      this._autoScanTimer = null;
      console.log('[MultiDeviceManager] Auto-scanning paused for file operation');
    }

    const results = { config: null, presets: null, userPresets: null };
    const files = [
      { key: 'config', name: 'config.json' },
      { key: 'presets', name: 'presets.json' },
      { key: 'userPresets', name: 'user_presets.json' }
    ];
    
    try {
      for (const { key, name } of files) {
        let attempts = 0;
        let lastErr = null;
        while (attempts < 2) {
          try {
            // Enhanced buffer clearing - flush multiple times and add delay
            await this.flushSerialBuffer(device.port);
            await new Promise(res => setTimeout(res, 300));
            await this.flushSerialBuffer(device.port);
            console.log(`[MultiDeviceManager] Reading ${name} for device ${device.id}, attempt ${attempts + 1}`);
            // Use longer timeout for larger files like presets.json
            const timeout = name.includes('presets') ? 20000 : 12000;
            const raw = await readFile(device.port, name, timeout);
            console.log(`[MultiDeviceManager] ${name} read success - length: ${raw.length} chars`);
            let parsed = raw;
            try {
              parsed = JSON.parse(raw);
              console.log(`[MultiDeviceManager] ${name} JSON parsing: SUCCESS`);
            } catch (e) {
              console.warn(`[MultiDeviceManager] ${name} JSON parsing: FAILED - ${e.message}`);
              console.warn(`[MultiDeviceManager] ${name} Raw content that failed parsing:`, raw);
              // If not JSON, keep as string
            }
            results[key] = parsed;
            break;
          } catch (err) {
            console.warn(`[MultiDeviceManager] ${name} read FAILED (attempt ${attempts + 1}): ${err.message}`);
            lastErr = err;
            attempts++;
            await new Promise(res => setTimeout(res, 200));
          }
        }
        if (results[key] == null && lastErr) {
          console.error(`[MultiDeviceManager] FINAL FAILURE for ${name}: ${lastErr.message}`);
        }
        // Increased delay between file reads to prevent firmware buffer contamination
        await new Promise(res => setTimeout(res, 1000));
      }
    } finally {
      // Always restart auto-scanning and clear operation flag, even if errors occurred
      this._fileOperationInProgress = false;
      if (wasAutoScanning) {
        this.startAutoScan(3000);
        console.log('[MultiDeviceManager] Auto-scanning resumed after file operation');
      }
    }

    return results;
  }

  /**
   * Force reload config, presets, and user_presets from the device, updating UI and window state.
   * @param {object} device - The device object (must have readFile method)
   */
  async forceReloadDeviceFiles(device) {
    // Clear the file read cache to force reload
    this._activeDeviceFileRead = null;
    
    // Always reload config, presets, and user presets from the device and update the UI
    await this.setActiveDevice(device, true);
  }
  /**
   * Returns the base label for a button, stripping any state suffix.
   * E.g., 'green-fret-pressed' -> 'green-fret'
   * @param {string} label
   * @returns {string}
   */
  getReleasedLedName(label) {
    if (typeof label !== 'string') return label;
    // Remove '-pressed', '-released', '-active', etc.
    return label.replace(/-(pressed|released|active)$/, '');
  }
  /**
   * Sends a PREVIEWLED command to the device to preview a specific LED color.
   * Accepts either a button name (e.g., 'fret-1', 'strum-up') or a numeric index.
   * @param {string|number} buttonOrIndex - Button name or LED index
   * @param {string} colorValue - The color value (e.g., '#FF0000' or 'FF0000')
   */


  /**
   * Preview all released colors for a given preset object.
   * Only previews released (not pressed) colors.
   * @param {object} presetObj - The preset object mapping button names to colors
   */
  previewReleasedColorsForPreset(presetObj) {
    if (!presetObj || typeof presetObj !== 'object') return;
    console.log('[MultiDeviceManager] previewReleasedColorsForPreset called with:', presetObj);
    
    // Check if we have an active device before attempting LED preview
    const device = this.getActiveDevice();
    if (!device || !device.port || !device.port.isOpen) {
      console.warn('[MultiDeviceManager] No active device available for LED preview. Triggering reconnection attempt...');
      // Trigger an immediate scan and potential reconnection
      this.scanForDevices().then(() => {
        // Try again after scan
        const deviceAfterScan = this.getActiveDevice();
        if (deviceAfterScan && deviceAfterScan.port && deviceAfterScan.port.isOpen) {
          console.log('[MultiDeviceManager] Device reconnected after scan, retrying LED preview');
          // Retry the preview after a short delay to ensure device is ready
          setTimeout(() => this.previewReleasedColorsForPreset(presetObj), 1000);
        } else {
          console.warn('[MultiDeviceManager] Device still not available after scan attempt');
        }
      });
      return;
    }
    
    // Debug: log active device and port
    console.debug('[MultiDeviceManager][DEBUG] activeDevice:', this.activeDevice);
    if (this.activeDevice && this.activeDevice.port) {
      console.debug('[MultiDeviceManager][DEBUG] activeDevice.port:', this.activeDevice.port);
    } else {
      console.warn('[MultiDeviceManager][DEBUG] No active device or port when previewing colors');
    }
    const releasedKeys = Object.keys(presetObj).filter(k => k.endsWith('-released'));
    if (releasedKeys.length > 0) {
      for (const key of releasedKeys) {
        const baseLabel = this.getReleasedLedName(key);
        let color = presetObj[key];
        // Always send HEX with leading #
        if (typeof color === 'string') {
          if (color.startsWith('rgb')) {
            const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (rgbMatch) {
              const r = parseInt(rgbMatch[1]);
              const g = parseInt(rgbMatch[2]);
              const b = parseInt(rgbMatch[3]);
              color = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
            }
          } else if (!color.startsWith('#')) {
            color = '#' + color;
          }
        }
        console.log(`[MultiDeviceManager] Previewing released color: label=${baseLabel}, color=${color}`);
        this.previewLed(baseLabel, color);
      }
    } else {
      // Fallback: preview all keys using base label and HEX color
      console.warn('[MultiDeviceManager] No -released keys found in preset. Previewing all keys as fallback.');
      for (const key of Object.keys(presetObj)) {
        const baseLabel = this.getReleasedLedName(key);
        let color = presetObj[key];
        if (typeof color === 'string') {
          if (color.startsWith('rgb')) {
            const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (rgbMatch) {
              const r = parseInt(rgbMatch[1]);
              const g = parseInt(rgbMatch[2]);
              const b = parseInt(rgbMatch[3]);
              color = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
            }
          } else if (!color.startsWith('#')) {
            color = '#' + color;
          }
        }
        console.log(`[MultiDeviceManager] Fallback preview: label=${baseLabel}, color=${color}`);
        this.previewLed(baseLabel, color);
      }
    }
  }
  // ...existing code...
  /**
   * Sends a PREVIEWLED command to the device to preview a specific LED color.
   * Always uses released LED name for preview after preset selection.
   * @param {string|number} buttonOrIndex - Button name or LED index
   * @param {string} colorValue - The color value (e.g., '#FF0000' or 'FF0000')
   */
  previewLed(buttonOrIndex, colorValue, opts = {}) {
    // Always send base label (no state suffix) for PREVIEWLED
    console.log('[MultiDeviceManager] previewLed called:', { buttonOrIndex, colorValue, opts });
    // Debug: log active device and port state
    console.debug('[MultiDeviceManager][DEBUG] activeDevice:', this.activeDevice);
    console.debug('[MultiDeviceManager][DEBUG] connectedDevices:', Array.from(this.connectedDevices.keys()));
    
    let ledName = this.getReleasedLedName(buttonOrIndex);
    // Always send HEX with leading #
    let color = colorValue;
    if (typeof color === 'string') {
      // Convert rgb() to HEX if needed
      if (color.startsWith('rgb')) {
        const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]);
          const g = parseInt(rgbMatch[2]);
          const b = parseInt(rgbMatch[3]);
          color = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        }
      } else if (!color.startsWith('#')) {
        color = '#' + color;
      }
    }
    const device = this.getActiveDevice();
    
    // Enhanced debugging for device connection state
    if (!device) {
      console.warn('[MultiDeviceManager] No active device for LED preview. Checking for available devices...');
      const connectedDevicesList = this.getConnectedDevices();
      if (connectedDevicesList.length > 0) {
        console.warn('[MultiDeviceManager] Found connected devices but no active device set:', connectedDevicesList.map(d => d.id));
      } else {
        console.warn('[MultiDeviceManager] No connected devices available');
      }
      return;
    }
    
    if (!device.port) {
      console.warn('[MultiDeviceManager] Active device has no port:', device.id);
      return;
    }
    
    if (!device.port.isOpen) {
      console.warn('[MultiDeviceManager] Active device port is not open:', device.id, 'isOpen:', device.port.isOpen);
      return;
    }
    
    if (typeof ledName !== 'string') {
      console.warn('[MultiDeviceManager] Invalid LED name:', ledName, 'from buttonOrIndex:', buttonOrIndex);
      return;
    }
    
    const cmd = `PREVIEWLED:${ledName}:${color}`;
    // Log the PREVIEWLED command and color for debugging
    console.log('[PREVIEWLED DEBUG]', cmd);
    device.port.write(cmd + '\n');
    console.log('[MultiDeviceManager] Sent LED preview command:', cmd, 'to device:', device.id);
  }
  /**
   * Flushes the serial buffer for the given port, with logging.
   * @param {SerialPort} port - The serial port to flush
   * @returns {Promise<void>}
   */
  async flushSerialBuffer(port) {
    if (typeof port.flush === 'function') {
      try {
        await new Promise((resolve, reject) => {
          port.flush(err => {
            if (err) reject(err);
            else resolve();
          });
        });
        // Remove excessive buffer flush logging
      } catch (flushErr) {
        console.warn('[MultiDeviceManager] Serial buffer flush failed for port', port.path, flushErr);
      }
    }
  }
  getConnectedDevices() {
    return Array.from(this.connectedDevices.values());
  }
  async setActiveDevice(device, force = false) {
    // Always update this.activeDevice and re-validate port, even if duplicate file read is prevented
    let skipFileRead = false;
    if (!force && this._activeDeviceFileRead && device && device.port && device.id === this._activeDeviceFileRead) {
      // Check if the port is still open and valid
      if (device.port.isOpen) {
        console.log('[MultiDeviceManager] setActiveDevice: Duplicate file read prevented for device', device.id);
        skipFileRead = true;
      } else {
        console.warn('[MultiDeviceManager] setActiveDevice: Port was closed, reloading device', device.id);
      }
    }
    this.activeDevice = device;
    if (device && device.port) {
      device.isConnected = true;
      this.connectedDevices.set(device.id, device);
      this._activeDeviceFileRead = device.id;
      // Store device info for auto-reconnection
      this.lastActiveDeviceInfo = {
        id: device.id,
        displayName: device.displayName,
        portInfo: device.portInfo
      };
    } else {
      this._activeDeviceFileRead = null;
    }
    this.emit('activeDeviceChanged', device, null);
    if (typeof window !== 'undefined') {
      if (typeof window.updateFooterDeviceName === 'function') {
        window.updateFooterDeviceName();
      }
      if (typeof window.updateActiveButtonText === 'function') {
        window.updateActiveButtonText(device);
      }
      if (typeof window.updateHeaderStatus === 'function') {
        window.updateHeaderStatus(device);
      }
    }
    // Only skip file reads if port is open and valid
    if (skipFileRead) return;
    // Trigger file reads when a device is made active, but only if automatic file reading is enabled
    if (device && device.port && ENABLE_AUTOMATIC_FILE_READING) {
      if (typeof this.emit === 'function') {
        this.emit('deviceFilesRequested', device);
      }
      try {
        console.log('[MultiDeviceManager] Starting device file reading...');
        const { config, presets, userPresets } = await this.readAllDeviceFilesSequentially(device);
        console.log('[MultiDeviceManager] Device file reading completed');
        
        // Validate presets
        let validPresets = null;
        if (
          presets &&
          typeof presets === 'object' &&
          presets._metadata &&
          presets.presets &&
          typeof presets.presets === 'object'
        ) {
          validPresets = presets;
          console.log('[MultiDeviceManager] Valid factory presets.json loaded');
        } else {
          console.error('[MultiDeviceManager] presets.json structure invalid:', presets);
        }
        device.presets = validPresets;
        // Validate userPresets
        let validUserPresets = null;
        if (
          userPresets &&
          typeof userPresets === 'object' &&
          !Array.isArray(userPresets)
        ) {
          // Check if it has factory structure (_metadata + presets)
          if (userPresets._metadata && userPresets.presets) {
            console.warn('[MultiDeviceManager] user_presets.json has factory structure, ignoring as user presets:', userPresets);
          } else {
            // It's a valid user presets object (direct preset mapping)
            validUserPresets = userPresets;
            console.log('[MultiDeviceManager] Valid user_presets.json loaded');
          }
        } else {
          console.error('[MultiDeviceManager] user_presets.json structure invalid:', userPresets);
        }
        device.userPresets = validUserPresets;
        device.config = config;
        console.log(`[MultiDeviceManager] Files loaded - config: ${config ? 'OK' : 'NULL'}, presets: ${validPresets ? 'OK' : 'NULL'}, userPresets: ${validUserPresets ? 'OK' : 'NULL'}`);
        
        // Update UI to show "Ready" state now that files are loaded
        if (typeof window !== 'undefined' && typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(device);
        }
        if (typeof window !== 'undefined' && typeof window.updateHeaderStatus === 'function') {
          window.updateHeaderStatus(device);
        }
        
        if (typeof this.emit === 'function') {
          this.emit('deviceFilesLoaded', device, { config, presets, userPresets });
        }
        if (typeof window !== 'undefined') {
          if (typeof window.updateDeviceFiles === 'function') {
            window.updateDeviceFiles(device);
          } else if (typeof window.dispatchEvent === 'function') {
            const event = new CustomEvent('deviceFilesLoaded', { detail: { device, config, presets, userPresets } });
            window.dispatchEvent(event);
          }
        }
      } catch (err) {
        console.warn('[MultiDeviceManager] Error reading device files on setActiveDevice:', err);
      }
    }
  }

  getActiveDevice() {

    return this.activeDevice;
  }
  async connectDevice(deviceId) {
    console.log('[MultiDeviceManager] connectDevice called for', deviceId);
    const device = this.devices.get(deviceId);
    if (!device) throw new Error('Device not found');
    if (device.isConnected) return;
    // Robust port cleanup before connect
    if (device.port && device.port.isOpen) {
      try {
        await new Promise((resolve, reject) => {
          device.port.close(err => {
            if (err) reject(err);
            else resolve();
          });
        });
        device.port = null;
      } catch (err) {
        console.warn(`[MultiDeviceManager] Could not close lingering port before connect for ${deviceId}:`, err);
      }
    }
    // Retry logic for port open failures
    let port;
    let openSuccess = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        port = new SerialPort({ path: deviceId, baudRate: 115200, autoOpen: false });
        await new Promise((resolve, reject) => {
          port.open(err => {
            if (err) reject(err);
            else resolve();
          });
        });
        openSuccess = true;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[MultiDeviceManager] Port open attempt ${attempt} failed for ${deviceId}:`, err);
        
        // Clean up the failed port object before retrying
        if (port) {
          try {
            if (port.isOpen) {
              await new Promise((resolve) => {
                port.close(() => resolve());
              });
            }
          } catch (cleanupErr) {
            console.warn(`[MultiDeviceManager] Error cleaning up failed port for ${deviceId}:`, cleanupErr);
          }
          port = null;
        }
        
        // Wait longer between retries for device restart scenarios
        const retryDelay = attempt === 1 ? 1000 : (attempt === 2 ? 2000 : 3000);
        console.log(`[MultiDeviceManager] Waiting ${retryDelay}ms before retry attempt ${attempt + 1} for ${deviceId}`);
        await new Promise(res => setTimeout(res, retryDelay));
      }
    }
    if (!openSuccess) {
      const errorMsg = `Failed to connect to device ${deviceId}`;
      const isAccessDenied = lastError && lastError.message && lastError.message.includes('Access denied');
      
      if (isAccessDenied) {
        showToast && showToast(`${errorMsg}: Device may be busy or in use by another application. Try disconnecting and reconnecting the device.`, 'error');
      } else {
        showToast && showToast(`${errorMsg}. ${lastError && lastError.message ? lastError.message : ''}`, 'error');
      }
      throw new Error(`Failed to open device port: ${deviceId}`);
    }
    device.port = port;
    if (typeof window !== 'undefined') {
      window.connectedPort = port;
    }
    device.isConnected = true;
    this.connectedDevices.set(deviceId, device);
    
    // Clear manual disconnect flag when device is manually connected
    this._manuallyDisconnectedDevices.delete(deviceId);
    console.log('[MultiDeviceManager] Manual disconnect flag cleared for device:', deviceId);
    
    // Set device as active but mark as loading files
    this.setActiveDevice(device);
    
    // Show "Please wait..." state immediately after connection
    if (typeof window !== 'undefined' && typeof window.updateActiveButtonText === 'function') {
      // Clear any reboot override and show loading state
      window._deviceRebootingOverride = false;
      // The updateActiveButtonText will show "Please wait..." because device files aren't loaded yet
      window.updateActiveButtonText(device);
    }
    
    // Show success notification for connection
    const deviceName = device.getDisplayName ? device.getDisplayName() : (device.displayName || deviceId);
    showToast && showToast(`Connected to ${deviceName}`, 'success');
    
    this.emit('deviceConnected', device);
    if (typeof window !== 'undefined') {
      if (typeof window.updateFooterDeviceName === 'function') {
        window.updateFooterDeviceName();
      }
      if (typeof window.updateActiveButtonText === 'function') {
        window.updateActiveButtonText(device);
      }
      if (typeof window.updateHeaderStatus === 'function') {
        window.updateHeaderStatus(device);
      }
    }
    // Re-scan devices after connect
    if (typeof window !== 'undefined' && window.multiDeviceManager) {
      window.multiDeviceManager.scanForDevices().then(() => {
        console.log('[MultiDeviceManager] scanForDevices after connect. Devices:', window.multiDeviceManager.getConnectedDevices());
      });
    }
    // Device name will be retrieved via READDEVICENAME command when needed
    // boot.py is only read when writing a new device name, not for reading the current name
    
    // Debug log connection state
    console.log('[MultiDeviceManager] Device connected:', deviceId, device.displayName);
  }

  async disconnectDevice(deviceId, skipManualFlag = false) {
    console.log('[MultiDeviceManager] disconnectDevice called for', deviceId);
    const device = this.devices.get(deviceId);
    // Log disconnect reason and stack
    console.warn(`[MultiDeviceManager] disconnectDevice called for ${deviceId}. Stack:`, new Error().stack);
    if (!device || !device.isConnected || !device.port) return;
    
    // Mark device as manually disconnected to prevent auto-reconnection (unless skipped for firmware flash)
    if (!skipManualFlag) {
      this._manuallyDisconnectedDevices.add(deviceId);
      console.log('[MultiDeviceManager] Device marked as manually disconnected:', deviceId);
    } else {
      console.log('[MultiDeviceManager] Skipping manual disconnect flag for automated disconnect:', deviceId);
    }
    
    // Robust port cleanup on disconnect
    try {
      await new Promise((resolve, reject) => {
        device.port.close(err => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      console.warn(`[MultiDeviceManager] Error closing port on disconnect for ${deviceId}:`, err);
    }
    device.isConnected = false;
    device.port = null;
    this.connectedDevices.delete(deviceId);
    
    // Check if the disconnected device was the active device
    let wasActiveDevice = false;
    if (this.activeDevice && this.activeDevice.id === deviceId) {
      wasActiveDevice = true;
      this.setActiveDevice(null);
    }
    
    this.emit('deviceDisconnected', device);
    
    // Update UI based on remaining connected devices
    if (typeof window !== 'undefined') {
      if (typeof window.updateFooterDeviceName === 'function') {
        window.updateFooterDeviceName();
      }
      
      // If we disconnected the active device, check for other connected devices
      if (wasActiveDevice) {
        const remainingConnectedDevices = this.getConnectedDevices();
        if (remainingConnectedDevices.length > 0) {
          // There are still connected devices, but none active
          console.log('[MultiDeviceManager] Active device disconnected, but other devices remain connected:', remainingConnectedDevices.map(d => d.id));
          if (typeof window.updateActiveButtonText === 'function') {
            window.updateActiveButtonText(null); // Show "No active device" state
          }
          if (typeof window.updateHeaderStatus === 'function') {
            window.updateHeaderStatus(null); // Show "No active device" state
          }
        } else {
          // No devices left connected
          if (typeof window.updateActiveButtonText === 'function') {
            window.updateActiveButtonText(null);
          }
          if (typeof window.updateHeaderStatus === 'function') {
            window.updateHeaderStatus(null);
          }
        }
      } else {
        // Non-active device was disconnected, just update the current active device state
        if (typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(this.activeDevice);
        }
        if (typeof window.updateHeaderStatus === 'function') {
          window.updateHeaderStatus(this.activeDevice);
        }
      }
    }
    // Re-scan devices after disconnect
    if (typeof window !== 'undefined' && window.multiDeviceManager) {
      window.multiDeviceManager.scanForDevices().then(() => {
        console.log('[MultiDeviceManager] scanForDevices after disconnect. Devices:', window.multiDeviceManager.getConnectedDevices());
      });
    }
  }
  /**
   * Try to quickly connect to a device, get its name, and disconnect
   * This allows showing device names in the selector before connection
   */
  async tryGetDeviceNameBeforeConnection(portInfo) {
    let tempPort = null;
    try {
      // Quick connection attempt with short timeout
      tempPort = new SerialPort({
        path: portInfo.path,
        baudRate: 115200,
        autoOpen: false
      });
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 2000); // 2 second timeout
        
        tempPort.open((err) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Wait a moment for device to be ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Try to get device name using direct command
      const deviceName = await this.requestDeviceNameQuick(tempPort);
      return deviceName;
      
    } catch (err) {
      console.log(`[MultiDeviceManager] Quick device name check failed for ${portInfo.path}:`, err.message);
      return null;
    } finally {
      if (tempPort && tempPort.isOpen) {
        try {
          tempPort.close();
        } catch (closeErr) {
          console.warn(`[MultiDeviceManager] Failed to close temp port ${portInfo.path}:`, closeErr.message);
        }
      }
    }
  }

  /**
   * Quick device name request with short timeout
   */
  async requestDeviceNameQuick(port) {
    return new Promise((resolve, reject) => {
      let responseBuffer = '';
      let timeoutHandle;
      let dataHandler;
      
      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (dataHandler) port.removeListener('data', dataHandler);
      };
      
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Device name request timeout'));
      }, 1500); // 1.5 second timeout
      
      dataHandler = (data) => {
        responseBuffer += data.toString();
        
        if (responseBuffer.includes('END\n')) {
          cleanup();
          
          // Parse the response
          const lines = responseBuffer.split('\n').map(line => line.trim()).filter(line => line);
          
          // Find device name (skip ACK and UID-like responses)
          for (const line of lines) {
            if (line === 'END' || line.startsWith('ACK:') || /^[0-9A-F]{16}$/i.test(line)) {
              continue;
            }
            if (line && line !== 'Unknown') {
              resolve(line);
              return;
            }
          }
          
          resolve('Unknown');
        }
      };
      
      port.on('data', dataHandler);
      
      // Send the command
      port.write('READDEVICENAME\n', (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }

  constructor() {
    this.devices = new Map();
    this.connectedDevices = new Map();
    this.activeDevice = null;
    this.lastActiveDeviceInfo = null; // Store info for auto-reconnection
    this.scanning = false;
    this.scanInterval = null;
    this.eventListeners = new Map();
    this._fileOperationInProgress = false; // Track when file operations are active
    this._scanningInProgress = false; // Prevent concurrent scans
    this._configWriteReconnectDelay = 3000; // Delay before auto-reconnection after config write (3 seconds)
    this._lastConfigWriteTime = 0; // Track when config was last written
    this._manuallyDisconnectedDevices = new Set(); // Track devices manually disconnected by user
    this._lastScanTime = 0; // Track last scan time for throttling
    this._minScanInterval = 500; // Minimum 500ms between scans
  }

  /**
   * Marks that a config write has occurred, which will delay auto-reconnection
   * to allow time for device restart. Also clears manual disconnect flag since
   * device restart is expected after config write.
   */
  markConfigWrite() {
    this._lastConfigWriteTime = Date.now();
    // Clear manual disconnect flag for the active device since we expect it to restart
    if (this.activeDevice) {
      this._manuallyDisconnectedDevices.delete(this.activeDevice.id);
      console.log('[MultiDeviceManager] Manual disconnect flag cleared for config write restart:', this.activeDevice.id);
    }
    console.log('[MultiDeviceManager] Config write marked, auto-reconnection will be delayed');
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  emit(event, ...args) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => callback(...args));
    }
  }

  async scanForDevices() {
    // Check if scanning is paused (for BOOTSEL mode)
    if (this.scanningPaused) {
      console.log('[MultiDeviceManager] Scanning paused, skipping scan');
      return;
    }
    
    // Prevent concurrent scans which can cause "Access denied" errors
    if (this._scanningInProgress) {
      console.log('[MultiDeviceManager] Scan already in progress, skipping');
      return;
    }
    
    // Throttle scanning when devices are connected to prevent excessive loops
    const now = Date.now();
    if (this._lastScanTime && (now - this._lastScanTime) < this._minScanInterval) {
      console.log('[MultiDeviceManager] Scan throttled, too soon since last scan');
      return;
    }
    
    this._scanningInProgress = true;
    this._lastScanTime = now;
    
    try {
      const ports = await SerialPort.list();
      console.log('[MultiDeviceManager] SerialPort.list() returned:', ports.length, ports);
      // Detailed logging for each port
      ports.forEach((port, idx) => {
        console.log(`[MultiDeviceManager] Port ${idx}:`, JSON.stringify(port, null, 2));
      });
      // Filter for guitar devices
      const guitarDevices = ports.filter(port => {
        const isGuitar = port.pnpId && port.pnpId.includes('MI_02');
        console.log(`[MultiDeviceManager] Filter check for port ${port.path}: pnpId=${port.pnpId} => ${isGuitar ? 'INCLUDED' : 'EXCLUDED'}`);
        if (!isGuitar) {
          console.log('[MultiDeviceManager] Port filtered out:', port);
        }
        return isGuitar;
      });
      console.log('[MultiDeviceManager] Filtered guitarDevices:', guitarDevices);
      // Log device map population
      const newDevices = new Map();
      for (const port of guitarDevices) {
        const deviceId = port.path;
        let displayName = port.friendlyName || port.path;
        let cachedName = null;
        let bootPyName = null;
        let isConnected = false;
        let portObj = null;
        // If device is currently active/connected, use its open port to read boot.py
        if (this.connectedDevices.has(deviceId)) {
          const activeDevice = this.connectedDevices.get(deviceId);
          isConnected = true;
          portObj = activeDevice.port;
          
          // Validate the port is still open and functional
          if (!portObj || !portObj.isOpen) {
            console.warn(`[MultiDeviceManager] Connected device ${deviceId} has invalid port, removing from connectedDevices`);
            this.connectedDevices.delete(deviceId);
            if (this.activeDevice && this.activeDevice.id === deviceId) {
              this.activeDevice = null; // Clear active device since port is invalid
            }
            isConnected = false;
            portObj = null;
          } else {
            // Device name will be retrieved via READDEVICENAME command when needed
            // boot.py is only read when writing a new device name, not for reading the current name
          }
          
          if (isConnected) {
            // Try to get fresh device name for connected devices if we don't have one
            if (!activeDevice.displayName || activeDevice.displayName === activeDevice.portInfo.friendlyName || activeDevice.displayName === activeDevice.portInfo.path) {
              try {
                const freshName = await this.requestDeviceNameQuick(portObj);
                if (freshName && freshName !== 'Unknown' && freshName.trim()) {
                  bootPyName = freshName.trim();
                  console.log(`[MultiDeviceManager] Got fresh device name for connected device: ${deviceId} -> ${bootPyName}`);
                }
              } catch (err) {
                console.log(`[MultiDeviceManager] Could not get fresh device name for connected device ${deviceId}:`, err.message);
              }
            }
            
            // Prefer bootPyName, then cachedName, then friendlyName
            if (bootPyName) {
              displayName = bootPyName;
            } else if (activeDevice.displayName && activeDevice.displayName !== activeDevice.portInfo.friendlyName && activeDevice.displayName !== activeDevice.portInfo.path) {
              displayName = activeDevice.displayName.replace(/^BumbleGum Guitars - /, '').trim();
            }
            newDevices.set(deviceId, {
              ...activeDevice,
              displayName,
              getDisplayName: function() { return this.displayName || this.portInfo.friendlyName || this.portInfo.path; },
            });
            if (typeof this.emit === 'function') this.emit('deviceNameUpdated', newDevices.get(deviceId));
            console.log(`[MultiDeviceManager] Updated connected device during scan:`, deviceId, displayName);
            continue;
          }
        }
        // If device already exists, preserve its displayName
        if (this.devices.has(deviceId)) {
          const prevDevice = this.devices.get(deviceId);
          if (prevDevice.displayName && prevDevice.displayName !== prevDevice.portInfo.friendlyName && prevDevice.displayName !== prevDevice.portInfo.path) {
            cachedName = prevDevice.displayName;
          }
        }
        // Try to get device name before connection for better UX
        let deviceNameBeforeConnection = null;
        const isNewDevice = !this.devices.has(deviceId);
        // Always try to get device name if we don't have a cached name, regardless of new/existing
        if (!cachedName) {
          try {
            deviceNameBeforeConnection = await this.tryGetDeviceNameBeforeConnection(port);
            if (deviceNameBeforeConnection && deviceNameBeforeConnection !== 'Unknown') {
              displayName = deviceNameBeforeConnection;
              console.log(`[MultiDeviceManager] Got device name before connection: ${deviceId} -> ${displayName}`);
            }
          } catch (err) {
            console.log(`[MultiDeviceManager] Could not get device name before connection for ${deviceId}:`, err.message);
          }
        }
        
        // Prefer device name from firmware, cached name, then friendlyName
        if (deviceNameBeforeConnection && deviceNameBeforeConnection !== 'Unknown') {
          displayName = deviceNameBeforeConnection;
        } else if (cachedName) {
          displayName = cachedName.replace(/^BumbleGum Guitars - /, '').trim();
        } else {
          displayName = port.friendlyName || port.path;
        }
        newDevices.set(deviceId, {
          id: deviceId,
          portInfo: port,
          displayName,
          getDisplayName: function() { return this.displayName || this.portInfo.friendlyName || this.portInfo.path; },
          isConnected: false,
          port: null
        });
        if (typeof this.emit === 'function') this.emit('deviceNameUpdated', newDevices.get(deviceId));
        console.log('[MultiDeviceManager] Device after scan:', deviceId, displayName);
      }
      console.log('[MultiDeviceManager] Finished processing all guitar devices, synchronizing connection state');
      // Synchronize connection state for all devices
      for (const [id, connectedDevice] of this.connectedDevices.entries()) {
        if (newDevices.has(id)) {
          const dev = newDevices.get(id);
          dev.isConnected = true;
          dev.port = connectedDevice.port;
        }
      }
      this.devices = newDevices;
      // Log the map after population
      console.log('[MultiDeviceManager] devices map after scan:', Array.from(this.devices.entries()));
      if (typeof window !== 'undefined' && typeof window.updateDeviceList === 'function') {
        console.log('[MultiDeviceManager] Forcing UI update after scanForDevices');
        window.updateDeviceList();
      }
      if (typeof window !== 'undefined') {
        if (typeof window.updateFooterDeviceName === 'function') {
          window.updateFooterDeviceName();
        }
        if (typeof window.updateActiveButtonText === 'function') {
          // Pass active device or null
          window.updateActiveButtonText(this.activeDevice);
        }
        if (typeof window.updateHeaderStatus === 'function') {
          window.updateHeaderStatus(this.activeDevice);
        }
      }
      // After scan, check if any device needs auto-reconnection
      let needsReconnection = null;
      
      // Check if active device needs reconnection
      if (this.activeDevice) {
        if (this.connectedDevices.has(this.activeDevice.id)) {
          // Device is still connected, reload files/UI
          const stillActive = this.connectedDevices.get(this.activeDevice.id);
          if (stillActive && stillActive.isConnected && stillActive.port && stillActive.port.isOpen) {
            // Only call setActiveDevice if it's actually a different device or first time
            if (!this.activeDevice || this.activeDevice.id !== stillActive.id || this.activeDevice.port !== stillActive.port) {
              console.log('[MultiDeviceManager] Setting active device during scan (device changed):', stillActive.id);
              this.setActiveDevice(stillActive);
            } else {
              // Device is the same, just update the devices map without triggering events
              console.log('[MultiDeviceManager] Active device unchanged during scan:', stillActive.id);
            }
          } else {
            // Connected device has invalid port state, remove it and attempt reconnection
            console.warn('[MultiDeviceManager] Active device has invalid port state, scheduling reconnection:', this.activeDevice.id);
            this.connectedDevices.delete(this.activeDevice.id);
            // Only auto-reconnect if device wasn't manually disconnected
            if (!this._manuallyDisconnectedDevices.has(this.activeDevice.id)) {
              needsReconnection = this.activeDevice.id;
            } else {
              console.log('[MultiDeviceManager] Skipping auto-reconnection for manually disconnected device:', this.activeDevice.id);
            }
          }
        } else if (this.devices.has(this.activeDevice.id)) {
          // Device was detected but is disconnected (likely restarted) - auto-reconnect only if not manually disconnected
          if (!this._manuallyDisconnectedDevices.has(this.activeDevice.id)) {
            needsReconnection = this.activeDevice.id;
            console.log('[MultiDeviceManager] Active device needs auto-reconnection after restart:', needsReconnection);
          } else {
            console.log('[MultiDeviceManager] Skipping auto-reconnection for manually disconnected device:', this.activeDevice.id);
          }
        }
      } else {
        // If no active device but we have a lastActiveDeviceInfo, try to reconnect
        if (this.lastActiveDeviceInfo && this.devices.has(this.lastActiveDeviceInfo.id)) {
          // Only reconnect if the device is not already connected AND not manually disconnected
          if (!this.connectedDevices.has(this.lastActiveDeviceInfo.id) && !this._manuallyDisconnectedDevices.has(this.lastActiveDeviceInfo.id)) {
            needsReconnection = this.lastActiveDeviceInfo.id;
            console.log('[MultiDeviceManager] Last active device needs auto-reconnection after restart:', needsReconnection);
          } else if (this._manuallyDisconnectedDevices.has(this.lastActiveDeviceInfo.id)) {
            console.log('[MultiDeviceManager] Skipping auto-reconnection for manually disconnected last active device:', this.lastActiveDeviceInfo.id);
          } else {
            console.log('[MultiDeviceManager] Last active device is already connected, checking if setActiveDevice needed:', this.lastActiveDeviceInfo.id);
            const alreadyConnected = this.connectedDevices.get(this.lastActiveDeviceInfo.id);
            // Only call setActiveDevice if it's not already the active device
            if (!this.activeDevice || this.activeDevice.id !== alreadyConnected.id) {
              this.setActiveDevice(alreadyConnected);
            } else {
              console.log('[MultiDeviceManager] Device already active, no setActiveDevice needed');
            }
          }
        }
      }

      // Perform auto-reconnection with delay if needed
      if (needsReconnection) {
        // Check if we should delay reconnection due to recent config write
        const timeSinceConfigWrite = Date.now() - this._lastConfigWriteTime;
        const shouldDelayReconnection = timeSinceConfigWrite < this._configWriteReconnectDelay;
        
        if (shouldDelayReconnection) {
          const remainingDelay = this._configWriteReconnectDelay - timeSinceConfigWrite;
          console.log(`[MultiDeviceManager] Delaying auto-reconnection for ${remainingDelay}ms after config write`);
          setTimeout(async () => {
            try {
              console.log('[MultiDeviceManager] Starting delayed auto-reconnection for device:', needsReconnection);
              // Clear reboot override to allow proper UI state progression
              if (typeof window !== 'undefined') {
                window._deviceRebootingOverride = false;
              }
              await this.connectDevice(needsReconnection);
              console.log('[MultiDeviceManager] Delayed auto-reconnection successful for device:', needsReconnection);
            } catch (err) {
              console.warn('[MultiDeviceManager] Failed to auto-reconnect device after delay:', needsReconnection, err);
            }
          }, remainingDelay);
        } else {
          // No recent config write, reconnect immediately
          try {
            console.log('[MultiDeviceManager] Starting immediate auto-reconnection for device:', needsReconnection);
            // Clear reboot override to allow proper UI state progression
            if (typeof window !== 'undefined') {
              window._deviceRebootingOverride = false;
            }
            await this.connectDevice(needsReconnection);
            console.log('[MultiDeviceManager] Auto-reconnection successful for device:', needsReconnection);
          } catch (err) {
            console.warn('[MultiDeviceManager] Failed to auto-reconnect device:', needsReconnection, err);
          }
        }
      }
    } catch (error) {
      console.error('Error scanning for devices:', error);
      return [];
    } finally {
      this._scanningInProgress = false;
    }
  }
  
  /**
   * Pauses scanning during file operations to prevent conflicts
   * @param {Function} operation - The async operation to perform
   * @returns {Promise<any>} - The result of the operation
   */
  async pauseScanningDuringOperation(operation) {
    this._fileOperationInProgress = true;
    const wasAutoScanning = !!this._autoScanTimer;
    
    if (wasAutoScanning) {
      clearInterval(this._autoScanTimer);
      this._autoScanTimer = null;
      console.log('[MultiDeviceManager] Auto-scanning paused for operation');
    }

    try {
      return await operation();
    } finally {
      this._fileOperationInProgress = false;
      if (wasAutoScanning) {
        this.startAutoScan(3000);
        console.log('[MultiDeviceManager] Auto-scanning resumed after operation');
      }
    }
  }

  /**
   * Starts automatic device scanning at the given interval (ms).
   * @param {number} intervalMs - Interval in milliseconds
   */
  startAutoScan(intervalMs = 3000) {
    if (this._autoScanTimer) {
      clearInterval(this._autoScanTimer);
    }
    this._autoScanTimer = setInterval(() => {
      // Skip scanning if file operations are in progress or scan already running
      if (this._fileOperationInProgress) {
        console.log('[MultiDeviceManager] Skipping scan - file operation in progress');
        return;
      }
      if (this._scanningInProgress) {
        console.log('[MultiDeviceManager] Skipping scan - scanning already in progress');
        return;
      }
      this.scanForDevices();
    }, intervalMs);
  }

  // ...existing code...
  // (rest of MultiDeviceManager methods unchanged)

  // Methods to pause/resume scanning for BOOTSEL mode
  pauseScanning() {
    this.scanningPaused = true;
    console.log('🛑 Multi-device scanning paused for BOOTSEL mode');
  }

  resumeScanning() {
    this.scanningPaused = false;
    console.log('▶️ Multi-device scanning resumed');
    // Immediately scan for devices
    this.scanForDevices();
  }
}

// Dependency injection for shared state/functions
MultiDeviceManager.inject = function(deps) {
  if (deps.connectedPort !== undefined) connectedPort = deps.connectedPort;
  if (deps.awaitingFile !== undefined) awaitingFile = deps.awaitingFile;
  if (deps.responseBuffers !== undefined) responseBuffers = deps.responseBuffers;
  if (deps.readQueue !== undefined) readQueue = deps.readQueue;
  if (deps.updateDeviceSelector) updateDeviceSelector = deps.updateDeviceSelector;
  if (deps.requestNextFile) requestNextFile = deps.requestNextFile;
  if (deps.showToast) showToast = deps.showToast;
};

module.exports = MultiDeviceManager;
