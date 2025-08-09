// ===== MANUAL DEVICE FILE LOADING FUNCTIONS =====
// These functions allow users to manually load device files when needed,
// avoiding automatic file reads that cause cycling behavior

window.manuallyRefreshDeviceName = async function() {
  const activeDevice = window.multiDeviceManager?.getActiveDevice();
  if (!activeDevice || !activeDevice.isConnected) {
    showToastError('No device connected');
    return;
  }
  
  console.log('[manuallyRefreshDeviceName] Refreshing device name using direct command');
  showToast('Refreshing device name...', 'info');
  
  requestDeviceNameDirect((deviceName) => {
    if (deviceName && deviceName.trim()) {
      console.log('[manuallyRefreshDeviceName] Got device name:', deviceName);
      activeDevice.displayName = deviceName.trim();
      activeDevice.nameNeedsRefresh = false;
      
      // Update UI
      if (typeof window.updateActiveButtonText === 'function') {
        window.updateActiveButtonText(activeDevice);
      }
      
      // Update diagnostic modal if open
      const diagnosticsModal = document.getElementById('diagnostics-modal');
      if (diagnosticsModal && diagnosticsModal.style.display === 'flex') {
        setupDeviceInformation();
      }
      
      showToastSuccess('Device name refreshed: ' + deviceName);
    } else {
      console.warn('[manuallyRefreshDeviceName] Failed to get device name');
      showToastError('Failed to get device name');
    }
  });
};

window.manuallyLoadDeviceFiles = async function() {
  const activeDevice = window.multiDeviceManager?.getActiveDevice();
  if (!activeDevice || !activeDevice.isConnected) {
    showToastError('No device connected');
    return;
  }
  
  console.log('[manuallyLoadDeviceFiles] Loading device files manually');
  showToast('Loading device files...', 'info');
  
  try {
    // Set loading state
    window._deviceLoadingOverride = true;
    if (typeof window.updateActiveButtonText === 'function') {
      const selectorBtn = document.getElementById('deviceSelectorButton');
      if (selectorBtn) {
        selectorBtn.textContent = 'Loading device files...';
        selectorBtn.style.background = '#f39c12';
        selectorBtn.style.color = '#fff';
      }
    }
    
    // Load config.json
    const configResult = await window.serialFileIO.readFile('config.json', 5000);
    if (configResult) {
      console.log('[manuallyLoadDeviceFiles] Loaded config.json');
      activeDevice.config = configResult;
      
      // Apply config to UI
      if (typeof applyConfig === 'function') {
        applyConfig(configResult);
      }
    }
    
    // Load presets.json  
    const presetsResult = await window.serialFileIO.readFile('presets.json', 5000);
    if (presetsResult) {
      console.log('[manuallyLoadDeviceFiles] Loaded presets.json');
      activeDevice.presets = presetsResult;
      
      // Update presets dropdown
      if (typeof populatePresetDropdown === 'function') {
        populatePresetDropdown(presetsResult);
      }
    }
    
    // Load user_presets.json
    const userPresetsResult = await window.serialFileIO.readFile('user_presets.json', 5000);
    if (userPresetsResult) {
      console.log('[manuallyLoadDeviceFiles] Loaded user_presets.json');
      activeDevice.userPresets = userPresetsResult;
      
      // Update user presets dropdown
      if (typeof populatePresetDropdown === 'function') {
        populatePresetDropdown(userPresetsResult, true);
      }
    }
    
    showToastSuccess('Device files loaded successfully');
    
  } catch (error) {
    console.error('[manuallyLoadDeviceFiles] Error loading files:', error);
    showToastError('Failed to load device files: ' + error.message);
  } finally {
    // Clear loading state
    window._deviceLoadingOverride = false;
    if (typeof window.updateActiveButtonText === 'function') {
      window.updateActiveButtonText(activeDevice);
    }
  }
};

// ===== OPTIMIZED DIRECT FIRMWARE COMMAND FUNCTIONS =====
// These functions use the efficient READUID, READVERSION, READDEVICENAME commands
// instead of reading entire files, eliminating the "cycling through files" behavior

function requestDeviceFirmwareVersionDirect(callback) {
  if (!connectedPort) {
    console.log('❌ No connected port for direct firmware version request');
    return callback(null);
  }
  
  // Prevent multiple simultaneous requests
  if (requestDeviceFirmwareVersionDirect.inProgress) {
    console.warn('[requestDeviceFirmwareVersionDirect] Request already in progress, skipping duplicate');
    return callback(null);
  }
  
  requestDeviceFirmwareVersionDirect.inProgress = true;
  
  console.log('📱 [requestDeviceFirmwareVersionDirect] Requesting device firmware version via READVERSION command');
  
  let buffer = '';
  let timeoutId = null;
  
  const cleanup = () => {
    serialListenerManager.removeListener(connectedPort, 'requestDeviceFirmwareVersionDirect');
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    requestDeviceFirmwareVersionDirect.inProgress = false;
  };
  
  const onData = data => {
    buffer += data.toString();
    console.log('📥 [requestDeviceFirmwareVersionDirect] Received data:', JSON.stringify(data.toString()));
    
    if (buffer.includes('END')) {
      cleanup();
      console.log('✅ [requestDeviceFirmwareVersionDirect] Found END marker, processing response');
      console.log('📄 [requestDeviceFirmwareVersionDirect] Full buffer:', JSON.stringify(buffer));
      
      // Parse the VERSION response
      const lines = buffer.split(/[\r\n]+/);
      console.log('📋 [requestDeviceFirmwareVersionDirect] Split lines:', lines);
      for (const line of lines) {
        const trimmed = line.trim();
        console.log('🔍 [requestDeviceFirmwareVersionDirect] Checking line:', JSON.stringify(trimmed));
        if (trimmed.startsWith('VERSION:')) {
          const version = trimmed.split('VERSION:')[1].trim();
          console.log('✅ [requestDeviceFirmwareVersionDirect] Device firmware version:', version);
          callback(normalizeVersion(version));
          return;
        }
      }
      
      // If no VERSION line found, fallback
      console.warn('⚠️ [requestDeviceFirmwareVersionDirect] No VERSION line found in response');
      callback(null);
    }
  };
  
  // Set timeout to prevent hanging
  timeoutId = setTimeout(() => {
    cleanup();
    console.warn('[requestDeviceFirmwareVersionDirect] Timeout waiting for READVERSION response');
    callback(null);
  }, 5000); // Increased timeout for debugging
  
  // Use new listener manager and send command
  serialListenerManager.addListener(connectedPort, 'requestDeviceFirmwareVersionDirect', onData);
  console.log('📤 [requestDeviceFirmwareVersionDirect] Sending READVERSION command...');
  connectedPort.write('READVERSION\n');
}

function requestDeviceUidDirect(callback) {
  if (!connectedPort) {
    console.warn('[requestDeviceUidDirect] No device connected.');
    callback(null);
    return;
  }
  
  // Prevent multiple simultaneous requests
  if (requestDeviceUidDirect.inProgress) {
    console.warn('[requestDeviceUidDirect] Request already in progress, skipping duplicate');
    return callback(null);
  }
  
  requestDeviceUidDirect.inProgress = true;
  
  console.log('[requestDeviceUidDirect] Requesting UID via READUID command');
  
  let buffer = '';
  let timeoutId = null;
  
  const cleanup = () => {
    serialListenerManager.removeListener(connectedPort, 'requestDeviceUidDirect');
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    requestDeviceUidDirect.inProgress = false;
  };
  
  const onData = data => {
    buffer += data.toString();
    console.log('[requestDeviceUidDirect] Received data:', JSON.stringify(data.toString()));
    
    if (buffer.includes('END')) {
      cleanup();
      console.log('[requestDeviceUidDirect] Found END marker, processing response');
      console.log('[requestDeviceUidDirect] Full buffer:', JSON.stringify(buffer));
      
      // Split by lines and look for the UID (16-character hex string)
      const lines = buffer.split(/[\r\n]+/);
      console.log('[requestDeviceUidDirect] Split lines:', lines);
      for (const line of lines) {
        const trimmed = line.trim();
        console.log('[requestDeviceUidDirect] Checking line:', JSON.stringify(trimmed));
        // Check if it's a 16-character hex string (the UID)
        if (/^[0-9A-Fa-f]{16}$/.test(trimmed)) {
          console.log('[requestDeviceUidDirect] Found valid UID:', trimmed);
          callback(trimmed);
          return;
        }
      }
      
      // If we get here, no valid UID was found
      console.warn('[requestDeviceUidDirect] No valid UID found in response');
      callback(null);
    }
  };
  
  // Set a timeout to avoid hanging forever
  timeoutId = setTimeout(() => {
    cleanup();
    console.warn('[requestDeviceUidDirect] Timeout waiting for UID response');
    callback(null);
  }, 5000); // Increased timeout for debugging
  
  // Use new listener manager and send command
  serialListenerManager.addListener(connectedPort, 'requestDeviceUidDirect', onData);
  console.log('[requestDeviceUidDirect] Sending READUID command...');
  connectedPort.write('READUID\n');
  console.log('[requestDeviceUidDirect] READUID command sent');
}

function requestDeviceNameDirect(callback) {
  if (!connectedPort) {
    console.warn('[requestDeviceNameDirect] No connected port');
    return callback(null);
  }
  
  // Prevent multiple simultaneous requests
  if (requestDeviceNameDirect.inProgress) {
    console.warn('[requestDeviceNameDirect] Request already in progress, skipping duplicate');
    return callback(null);
  }
  
  requestDeviceNameDirect.inProgress = true;
  
  let buffer = '';
  let timeoutId = null;
  
  const cleanup = () => {
    serialListenerManager.removeListener(connectedPort, 'requestDeviceNameDirect');
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    requestDeviceNameDirect.inProgress = false;
  };
  
  const onData = data => {
    buffer += data.toString();
    console.log('[requestDeviceNameDirect] Received data:', JSON.stringify(data.toString()));
    
    if (buffer.includes('END')) {
      cleanup();
      console.log('[requestDeviceNameDirect] Found END marker, processing response');
      
      // Split by lines and look for the device name
      const lines = buffer.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines, END marker, error messages, ACK responses, and UID-like strings
        if (!trimmed || 
            trimmed === 'END' ||
            trimmed.startsWith('ERROR:') ||
            trimmed.startsWith('ACK:') ||
            /^[0-9A-Fa-f]{16}$/.test(trimmed)) { // Skip UID format strings
          continue;
        }
        
        // Additional validation: device names should be reasonable
        if (trimmed.length > 50 || trimmed.includes('.json') || trimmed.includes('.py')) {
          console.warn('[requestDeviceNameDirect] Skipping invalid device name format:', trimmed);
          continue;
        }
        
        // This should be the device name
        console.log('[requestDeviceNameDirect] Found device name:', trimmed);
        callback(trimmed);
        return;
      }
      
      // If we get here, no valid device name was found
      console.warn('[requestDeviceNameDirect] No valid device name found in response, buffer was:', JSON.stringify(buffer));
      callback('Unknown Device');
    }
  };
  
  // Set a timeout to avoid hanging forever
  timeoutId = setTimeout(() => {
    cleanup();
    console.warn('[requestDeviceNameDirect] Timeout waiting for device name response');
    callback(null);
  }, 3000); // Fast timeout
  
  // Use new listener manager and send command
  serialListenerManager.addListener(connectedPort, 'requestDeviceNameDirect', onData);
  connectedPort.write('READDEVICENAME\n');
  console.log('[requestDeviceNameDirect] READDEVICENAME command sent');
}

// Make direct command functions globally available
window.requestDeviceNameDirect = requestDeviceNameDirect;
window.requestDeviceUidDirect = requestDeviceUidDirect;
window.requestDeviceFirmwareVersionDirect = requestDeviceFirmwareVersionDirect;

// ===== ORIGINAL FUNCTIONS =====

// Helper: Request device name from firmware (for diagnostics, etc)
function requestDeviceName(callback) {
  console.log('🔄 [requestDeviceName] Redirecting to optimized direct command');
  
  // Use the new direct command function for better performance
  requestDeviceNameDirect(callback);
}

// --- Serial helper: Request device UID ---
// Usage: requestDeviceUid(uid => { ... })
function requestDeviceUid(callback) {
  console.log('🔄 [requestDeviceUid] Redirecting to optimized direct command');
  
  // Use the new direct command function for better performance
  requestDeviceUidDirect(callback);
}
// Call this function from your color picker logic when a pressed color is changed
function callPressedPreviewFromColorPicker(btnId) {
  if (window.triggerPressedLedPreview && typeof window.triggerPressedLedPreview === 'function') {
    window.triggerPressedLedPreview(btnId);
  }
}

// Example usage (uncomment and adapt as needed):

// Global response buffer for serial file operations
let responseBuffers = {};
// document.getElementById('orange-fret-pressed-color').addEventListener('input', function(e) {
//   callPressedPreviewFromColorPicker('orange-fret-pressed');
// });
// Basic stub for device selector initialization to prevent ReferenceError
// Ensure footer device name element exists
// Removed footer device name element and update logic

const deviceUI = require('./deviceUI');

// Update the device selector button text to reflect connection status
window.updateActiveButtonText = function(device) {
  const selectorBtn = document.getElementById('deviceSelectorButton');
  if (!selectorBtn) return;
  
  // Don't override during rename operations
  if (window._renameInProgress) return;
  
  // Don't override rebooting state during device reboot sequence
  if (window._deviceRebootingOverride || (selectorBtn.textContent === 'Device rebooting...' && (!device || !device.isConnected))) {
    return;
  }
  
  // Don't override loading state during file loading sequence
  if (window._deviceLoadingOverride) {
    return;
  }
  
  const multiDeviceManager = window.multiDeviceManager;
  let connected = [];
  let activeDevice = null;
  if (multiDeviceManager) {
    connected = multiDeviceManager.getConnectedDevices ? multiDeviceManager.getConnectedDevices() : [];
    activeDevice = multiDeviceManager.getActiveDevice ? multiDeviceManager.getActiveDevice() : null;
  }
  if (connected.length === 0) {
    selectorBtn.textContent = 'No devices connected';
    selectorBtn.style.background = '#e74c3c';
    selectorBtn.style.color = '#fff';
    selectorBtn.style.boxShadow = 'none';
    selectorBtn.style.fontWeight = 'bold';
  } else if (!activeDevice || !activeDevice.isConnected) {
    selectorBtn.textContent = `${connected.length} device${connected.length > 1 ? 's' : ''} connected - Select one`;
    selectorBtn.style.background = '#f39c12';
    selectorBtn.style.color = '#fff';
    selectorBtn.style.boxShadow = 'none';
    selectorBtn.style.fontWeight = 'bold';
  } else {
    let name = '';
    if (activeDevice.getDisplayName && typeof activeDevice.getDisplayName === 'function') {
      name = activeDevice.getDisplayName();
    }
    if (!name) {
      name = activeDevice.displayName || (activeDevice.portInfo && (activeDevice.portInfo.friendlyName || activeDevice.portInfo.path)) || 'Unknown Device';
    }
    
    // Check if device files are loaded (config, presets, or userPresets exist)
    const filesLoaded = activeDevice.config || activeDevice.presets || activeDevice.userPresets;
    if (filesLoaded) {
      selectorBtn.textContent = `Connected: ${name} : Ready`;
      selectorBtn.style.background = '#2ecc40';
      selectorBtn.style.color = '#222';
    } else {
      // Show connected but indicate files need manual loading
      selectorBtn.textContent = `Connected: ${name}`;
      selectorBtn.style.background = '#3498db';
      selectorBtn.style.color = '#fff';
    }
    selectorBtn.style.boxShadow = 'none';
    selectorBtn.style.fontWeight = 'bold';
  }
  
  // Also update header status to match
  if (typeof window.updateHeaderStatus === 'function') {
    window.updateHeaderStatus(device);
  }
}

let isDirty = false;
let connectedPort = null;
let isFlashingFirmware = false;
const liveColors = new Map();
// Global flag for bootsel prompt state
let bootselPrompted = false;

// Expose functions to control isFlashingFirmware flag for firmwareUpdater
window.setFlashingFirmware = function(value) {
  isFlashingFirmware = value;
  console.log('[app.js] isFlashingFirmware set to:', value);
};

window.getFlashingFirmware = function() {
  return isFlashingFirmware;
};
let originalConfig = null;
// Fret index mapping for config <-> UI
// 0: orange, 1: blue, 2: yellow, 3: red, 4: green
const fretIndexMap = [2, 3, 4, 5, 6];

// Always sync with window.originalConfig if available
Object.defineProperty(window, 'originalConfig', {
  get() { return originalConfig; },
  set(val) {
    console.log('[app.js][DEBUG] window.originalConfig set:', val);
    originalConfig = val;
  },
  configurable: true
});
function initializeDeviceSelector() {
  // Use the dropdown in the footer for device selection
  const dropdown = document.getElementById('deviceDropdown');
  const deviceList = document.getElementById('deviceList');
  // REMOVED: Refresh button logic
  if (!dropdown || !deviceList || !window.multiDeviceManager) return;

  // Only create one interval at a time
  if (!window.__deviceSelectorRefresh) window.__deviceSelectorRefresh = {};
  if (window.__deviceSelectorRefresh.interval) {
    clearInterval(window.__deviceSelectorRefresh.interval);
    window.__deviceSelectorRefresh.interval = null;
  }


  const opening = dropdown.style.display !== 'block';
  dropdown.style.display = opening ? 'block' : 'none';

  // --- Add click-outside-to-close logic ---
  if (opening) {
    // Handler to close dropdown if click is outside
    function handleClickOutside(event) {
      if (!dropdown.contains(event.target) && event.target !== document.getElementById('deviceSelectorButton')) {
        dropdown.style.display = 'none';
        if (window.__deviceSelectorRefresh && window.__deviceSelectorRefresh.interval) {
          clearInterval(window.__deviceSelectorRefresh.interval);
          window.__deviceSelectorRefresh.interval = null;
        }
        document.removeEventListener('mousedown', handleClickOutside);
      }
    }
    // Remove any previous handler to avoid duplicates
    document.removeEventListener('mousedown', handleClickOutside);
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
  } else {
    document.removeEventListener('mousedown', handleClickOutside);
  }

  function buildDeviceList() {
    let devices = Array.from(window.multiDeviceManager.devices.values());
    // Sort devices alphabetically by display name (case-insensitive)
    devices.sort((a, b) => {
      const nameA = (a.getDisplayName ? a.getDisplayName() : a.displayName || a.id || '').toLowerCase();
      const nameB = (b.getDisplayName ? b.getDisplayName() : b.displayName || b.id || '').toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });
    let html = '';
    if (devices.length === 0) {
      html += '<button style="margin:16px 0; background:#e74c3c !important; color:#fff; border-radius:6px; padding:10px 24px; font-size:1.1em; font-weight:bold; cursor:default;">No devices connected</button>';
    } else {
      devices.forEach(device => {
        const isActive = window.multiDeviceManager.activeDevice && window.multiDeviceManager.activeDevice.id === device.id;
        const isConnected = device.isConnected;
        html += `<div style="display:flex; align-items:center; justify-content:space-between; background:${isActive ? '#333a' : 'none'}; border-radius:6px; margin-bottom:6px; padding:6px 8px;">`;
        html += `<span style="display:flex; align-items:center;">`;
        html += `<span style="width:14px; height:14px; border-radius:50%; background:${isConnected ? '#2ecc40' : '#e74c3c'}; display:inline-block; margin-right:8px;"></span>`;
        html += `<span style="font-weight:bold; margin-right:8px;">${device.getDisplayName ? device.getDisplayName() : device.displayName || device.id}</span>`;
        html += `</span>`;
        html += `<span>`;
        // Identify button (always shown)
        html += `<button class="device-identify-btn" data-id="${device.id}" style="background:#f1c40f; color:#222; border:none; border-radius:4px; padding:4px 10px; margin-right:6px; cursor:pointer;">Identify</button>`;
        if (isConnected && isActive) {
          html += `<button style="background:#00c800; color:#fff; border:none; border-radius:4px; padding:4px 10px; margin-right:6px; cursor:pointer;" disabled>Active</button>`;
          html += `<button class="device-disconnect-btn" data-id="${device.id}" style="background:#e74c3c; color:#fff; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">Disconnect</button>`;
        } else if (isConnected) {
          html += `<button class="device-active-btn" data-id="${device.id}" style="background:#bbb; color:#222; border:none; border-radius:4px; padding:4px 10px; margin-right:6px; cursor:pointer;">Inactive</button>`;
          html += `<button class="device-disconnect-btn" data-id="${device.id}" style="background:#e74c3c; color:#fff; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">Disconnect</button>`;
        } else {
          html += `<button class="device-connect-btn" data-id="${device.id}" style="background:#3498db; color:#fff; border:none; border-radius:4px; padding:4px 10px; cursor:pointer;">Connect</button>`;
        }
        html += `</span>`;
        html += `</div>`;
      });
    }
    const connectedCount = devices.filter(d => d.isConnected).length;
    html += `<div style="margin-top:10px; font-size:0.95em; color:#ccc;">${connectedCount} connected${window.multiDeviceManager.activeDevice ? ` (${window.multiDeviceManager.activeDevice.getDisplayName ? window.multiDeviceManager.activeDevice.getDisplayName() : window.multiDeviceManager.activeDevice.displayName} active)` : ' (none active)'}</div>`;
    
    deviceList.innerHTML = html;

    // Add event listeners for buttons
    deviceList.querySelectorAll('.device-connect-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const id = btn.getAttribute('data-id');
        await window.multiDeviceManager.connectDevice(id);
        buildDeviceList();
      };
    });
    deviceList.querySelectorAll('.device-disconnect-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const id = btn.getAttribute('data-id');
        await window.multiDeviceManager.disconnectDevice(id);
        buildDeviceList();
      };
    });
    deviceList.querySelectorAll('.device-active-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const id = btn.getAttribute('data-id');
        const device = window.multiDeviceManager.devices.get(id);
        if (device) {
          await window.multiDeviceManager.setActiveDevice(device);
          buildDeviceList();
        }
      };
    });
    // Identify button event (use PREVIEWLED to flash LEDs)
    deviceList.querySelectorAll('.device-identify-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const id = btn.getAttribute('data-id');
        const device = window.multiDeviceManager.devices.get(id);
        // Try to get port path from device info
        const portPath = device && device.portInfo && device.portInfo.path ? device.portInfo.path : (device && device.path ? device.path : null);
        // If already connected, use the open port, else open a temporary one
        let port = null;
        let tempPort = null;
        if (device && device.isConnected && device.port && typeof device.port.write === 'function') {
          port = device.port;
        } else if (portPath) {
          // Open a temporary port for identify only
          try {
            tempPort = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
            await new Promise((resolve, reject) => tempPort.open(err => err ? reject(err) : resolve()));
            port = tempPort;
          } catch (err) {
            window.customAlert && window.customAlert('Failed to open port for Identify: ' + err.message);
            return;
          }
        }
        if (port && typeof port.write === 'function') {
          try {
            const fretNames = ['orange-fret', 'blue-fret', 'yellow-fret', 'red-fret', 'green-fret'];
            const fretColors = {
              'orange-fret': '#ff6600',
              'blue-fret': '#0066ff',
              'yellow-fret': '#ffff00',
              'red-fret': '#ff0000',
              'green-fret': '#00ff00'
            };
            let step = 0;
            const flashNext = () => {
              if (step >= fretNames.length) {
                fretNames.forEach(fret => {
                  const color = fretColors[fret] || '#000000';
                  const cmd = `PREVIEWLED:${fret}:${color}\r\n`;
                  port.write(cmd, (err) => {
                    if (err) console.error('[IDENTIFY] Write error (final set):', err);
                  });
                });
                // If we opened a temp port, close it after a short delay
                if (tempPort) setTimeout(() => tempPort.close(), 400);
                return;
              }
              fretNames.forEach(fret => {
                const offCmd = `PREVIEWLED:${fret}:#000000\r\n`;
                port.write(offCmd, (err) => {
                  if (err) console.error('[IDENTIFY] Write error (off):', err);
                });
              });
              const fret = fretNames[step];
              const color = fretColors[fret] || '#ffffff';
              const onCmd = `PREVIEWLED:${fret}:${color}\r\n`;
              port.write(onCmd, (err) => {
                if (err) console.error('[IDENTIFY] Write error (flash):', err);
              });
              step++;
              setTimeout(flashNext, 300);
            };
            flashNext();
          } catch (err) {
            console.error('Failed to send PREVIEWLED identify sequence:', err);
            if (tempPort) tempPort.close();
          }
        } else {
          window.customAlert && window.customAlert('Device not found or port unavailable for Identify.');
        }
      };
    });
  }

  async function refreshAndBuild() {
    await window.multiDeviceManager.scanForDevices();
    buildDeviceList();
  }

  if (opening) {
    refreshAndBuild();
    // Use adaptive scanning: faster when no devices connected, slower when connected
    const getScanInterval = () => {
      const connectedDevices = window.multiDeviceManager?.getConnectedDevices?.() || [];
      return connectedDevices.length > 0 ? 5000 : 2000; // 5s when connected, 2s when disconnected
    };
    
    const startAdaptiveScanning = () => {
      if (window.__deviceSelectorRefresh.interval) {
        clearInterval(window.__deviceSelectorRefresh.interval);
      }
      window.__deviceSelectorRefresh.interval = setInterval(refreshAndBuild, getScanInterval());
    };
    
    startAdaptiveScanning();
    
    // Listen for device connection changes to adjust scan interval
    window.multiDeviceManager.on('activeDeviceChanged', () => {
      setTimeout(startAdaptiveScanning, 100); // Small delay to let connection settle
    });
  } else {
    if (window.__deviceSelectorRefresh.interval) {
      clearInterval(window.__deviceSelectorRefresh.interval);
      window.__deviceSelectorRefresh.interval = null;
    }
  }

  // REMOVED: Refresh button event handler
}
const { SerialPort } = require('serialport');

// Configure SerialPort to allow more event listeners to prevent memory leak warnings
// This is necessary because we may have multiple async requests running simultaneously
SerialPort.prototype.setMaxListeners(20);

// Helper function to safely clean up existing data listeners before adding new ones
// Serial listener management to prevent memory leaks
const serialListenerManager = {
  activeListeners: new Map(),
  
  addListener(port, listenerId, handler) {
    if (!port) return;
    
    // Remove any existing listener with this ID
    this.removeListener(port, listenerId);
    
    // Add the new listener
    port.on('data', handler);
    this.activeListeners.set(listenerId, { port, handler });
    
    console.log(`[SerialListener] Added listener '${listenerId}'. Total listeners: ${port.listenerCount('data')}`);
    
    // Warn if too many listeners
    if (port.listenerCount('data') > 5) {
      console.warn(`[SerialListener] WARNING: ${port.listenerCount('data')} data listeners active!`);
    }
  },
  
  removeListener(port, listenerId) {
    const existing = this.activeListeners.get(listenerId);
    if (existing && existing.port === port) {
      port.off('data', existing.handler);
      this.activeListeners.delete(listenerId);
      console.log(`[SerialListener] Removed listener '${listenerId}'. Remaining: ${port.listenerCount('data')}`);
    }
  },
  
  removeAllListeners(port) {
    if (!port) return;
    
    console.log(`[SerialListener] Removing all listeners. Current count: ${port.listenerCount('data')}`);
    
    // Remove all tracked listeners
    for (const [listenerId, listener] of this.activeListeners.entries()) {
      if (listener.port === port) {
        port.off('data', listener.handler);
        this.activeListeners.delete(listenerId);
      }
    }
    
    // Force remove any remaining listeners
    port.removeAllListeners('data');
    
    console.log(`[SerialListener] All listeners removed. Final count: ${port.listenerCount('data')}`);
  }
};

function cleanupSerialDataListeners(port, keepListeners = []) {
  if (!port || !port.listenerCount) return;
  
  console.log(`[cleanupSerialDataListeners] DEPRECATED - Use serialListenerManager instead`);
  
  // Use new manager for cleanup
  serialListenerManager.removeAllListeners(port);
}

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
// ===== MODULAR MULTI-DEVICE SUPPORT =====
const MultiDeviceManager = require('./multiDeviceManager');
const serialFileIO = require('./serialFileIO');

// Global multi-device manager instance
const multiDeviceManager = new MultiDeviceManager();
window.multiDeviceManager = multiDeviceManager;

// Make serialFileIO available globally for firmware updater
window.serialFileIO = {
  writeFile: (port, filename, content, timeoutMs) => {
    const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
    if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
      return Promise.reject(new Error('No active device connected'));
    }
    return serialFileIO.writeFile(port, filename, content, timeoutMs);
  },
  readFile: (filename, timeoutMs) => {
    const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
    if (!activeDevice || !activeDevice.isConnected || !activeDevice.port) {
      return Promise.reject(new Error('No active device connected'));
    }
    return serialFileIO.readFile(activeDevice.port, filename, timeoutMs);
  }
};

// Inject dependencies into multiDeviceManager
MultiDeviceManager.inject({
  showToast: showToast
});

// ===== Custom Dialog Functions =====
function customConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-confirm-modal');
    const messageEl = document.getElementById('custom-confirm-message');
    const yesBtn = document.getElementById('custom-confirm-yes');
    const noBtn = document.getElementById('custom-confirm-no');
    
    messageEl.textContent = message;
    modal.style.display = 'flex';
    
    function cleanup() {
      modal.style.display = 'none';
      yesBtn.removeEventListener('click', handleYes);
      noBtn.removeEventListener('click', handleNo);
      document.removeEventListener('keydown', handleKeydown);
    }
    
    function handleYes() {
      cleanup();
      resolve(true);
    }
    
    function handleNo() {
      cleanup();
      resolve(false);
    }
    
    function handleKeydown(e) {
      if (e.key === 'Enter') {
        handleYes();
      } else if (e.key === 'Escape') {
        handleNo();
      }
    }
    
    yesBtn.addEventListener('click', handleYes);
    noBtn.addEventListener('click', handleNo);
    document.addEventListener('keydown', handleKeydown);
    yesBtn.focus();
  });
}

function customAlert(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-alert-modal');
    const messageEl = document.getElementById('custom-alert-message');
    const okBtn = document.getElementById('custom-alert-ok');
    
    messageEl.textContent = message;
    modal.style.display = 'flex';
    
    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      document.removeEventListener('keydown', handleKeydown);
    }
    
    function handleOk() {
      cleanup();
      resolve();
    }
    
    function handleKeydown(e) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        handleOk();
      }
    }
    
    okBtn.addEventListener('click', handleOk);
    document.addEventListener('keydown', handleKeydown);
    okBtn.focus();
  });
}


function normalizeVersion(version) {
  // Example normalization: trim and return string
  return version ? version.trim() : '';
}
let activeUserPreset = null;

function closeConfigMenu() {
  const configMenu = document.getElementById('config-menu');
  if (configMenu) configMenu.style.display = 'none';
}

const updateStatus = (text, isConnected = false, customColor = null) => {
  // Don't override status during rename operations
  if (window._renameInProgress) return;
  
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = text;
    if (customColor) {
      statusText.style.color = customColor;
    } else {
      statusText.style.color = isConnected ? '#2ecc40' : '#ff4136';
    }
  }
};

// Enhanced status update that mirrors device selector button logic
window.updateHeaderStatus = function(device) {
  // Don't override status during rename operations
  if (window._renameInProgress) return;
  
  // Don't override rebooting state during device reboot sequence
  if (window._deviceRebootingOverride) {
    updateStatus('Device rebooting...', false, '#f39c12'); // Orange for rebooting
    return;
  }
  
  const multiDeviceManager = window.multiDeviceManager;
  let connected = [];
  let activeDevice = null;
  if (multiDeviceManager) {
    connected = multiDeviceManager.getConnectedDevices ? multiDeviceManager.getConnectedDevices() : [];
    activeDevice = multiDeviceManager.getActiveDevice ? multiDeviceManager.getActiveDevice() : null;
  }
  
  if (connected.length === 0) {
    updateStatus('No device connected', false, '#f39c12'); // Orange for no connection
  } else if (!activeDevice || !activeDevice.isConnected) {
    updateStatus(`${connected.length} device${connected.length > 1 ? 's' : ''} available`, false, '#f39c12'); // Orange for devices available but none active
  } else {
    // Check if device files are loaded (config, presets, or userPresets exist)
    const filesLoaded = activeDevice.config || activeDevice.presets || activeDevice.userPresets;
    if (filesLoaded) {
      updateStatus('Ready', true, '#2ecc40'); // Green for ready
    } else {
      updateStatus('Loading device files...', false, '#f39c12'); // Orange for loading
    }
  }
};

// ===== TOAST NOTIFICATION SYSTEM =====
function showToast(message, type = 'info', duration = 4000) {
  // Remove any existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  // Add to DOM
  document.body.appendChild(toast);
  
  // Trigger show animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Auto-hide after duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 300); // Wait for transition to complete
  }, duration);
}

// Convenience functions for different toast types
window.showToast = showToast;
window.showToastSuccess = (message, duration) => showToast(message, 'success', duration);
window.showToastError = (message, duration) => showToast(message, 'error', duration);
window.showToastWarning = (message, duration) => showToast(message, 'warning', duration);
window.showToastInfo = (message, duration) => showToast(message, 'info', duration);

// ===== FOOTER DEVICE NAME UPDATE =====
window.updateFooterDeviceName = function() {
  // Function exists for compatibility but does nothing - footer text not wanted
  // Device name is shown in the device selector button instead
};

// ===== DEVICE REBOOT AND RELOAD UTILITY =====
let rebootInProgress = false;
async function rebootAndReload(fileToReload = 'presets.json') {
  try {
    if (rebootInProgress) {
      console.warn('[rebootAndReload] Reboot already in progress, ignoring duplicate call');
      return;
    }
    if (!connectedPort) {
      console.warn('[rebootAndReload] No connected port, cannot reboot');
      
      // Clear rename flag when no port available
      window._renameInProgress = false;
      rebootInProgress = false;
      return;
    }
    rebootInProgress = true;
    // --- Identify the device before reboot ---
    let rebootDeviceId = null;
    let rebootPID = null;
    let rebootSerial = null;
    let rebootPnpId = null;
    let rebootPath = null;
    if (window.multiDeviceManager && typeof window.multiDeviceManager.getActiveDevice === 'function') {
      const activeDevice = window.multiDeviceManager.getActiveDevice();
      if (activeDevice) {
        rebootDeviceId = activeDevice.id;
        rebootPID = activeDevice.productId || (activeDevice.portInfo && activeDevice.portInfo.productId);
        rebootSerial = activeDevice.serialNumber || (activeDevice.portInfo && activeDevice.portInfo.serialNumber);
        rebootPnpId = activeDevice.pnpId || (activeDevice.portInfo && activeDevice.portInfo.pnpId);
        rebootPath = activeDevice.path || (activeDevice.portInfo && activeDevice.portInfo.path);
        console.log('[rebootAndReload] Remembering device before reboot:', { rebootDeviceId, rebootPID, rebootSerial, rebootPnpId, rebootPath });
      }
    }
    connectedPort.write("REBOOT\n", err => {
      if (err) console.error('[rebootAndReload] Error sending REBOOT:', err);
      else console.log('[rebootAndReload] Sent REBOOT');
    });
    updateStatus("Device rebooting to reload...", true);
    
    // Wait a moment for the REBOOT command to be processed before disconnecting
    setTimeout(() => {
      // --- PATCH: Force disconnect after REBOOT ---
      if (window.multiDeviceManager && typeof window.multiDeviceManager.getActiveDevice === 'function' && typeof window.multiDeviceManager.disconnectDevice === 'function') {
        const activeDevice = window.multiDeviceManager.getActiveDevice();
        if (activeDevice && activeDevice.id) {
          console.log('[rebootAndReload] Forcing device disconnect after REBOOT');
          window.multiDeviceManager.disconnectDevice(activeDevice.id);
        }
      }
    }, 1000); // Give the device time to receive the REBOOT command
    // Poll for device reconnect for up to 20s (increased from 10s)
    const pollInterval = 500;
    const maxTries = 40;
    let tries = 0;
    let found = false;
    async function pollForReconnect() {
      tries++;
      if (window.multiDeviceManager && typeof window.multiDeviceManager.scanForDevices === 'function') {
        await window.multiDeviceManager.scanForDevices();
        let activeDevice = window.multiDeviceManager.getActiveDevice?.();
        let devicesArr = [];
        if (typeof window.multiDeviceManager.devices === 'object') {
          devicesArr = window.multiDeviceManager.devices instanceof Map
            ? Array.from(window.multiDeviceManager.devices.values())
            : Object.values(window.multiDeviceManager.devices);
        }
        console.log(`[rebootAndReload][poll ${tries}/${maxTries}] Devices after scan:`, devicesArr.map(d => ({
          id: d.id,
          isConnected: d.isConnected,
          path: d.path,
          productId: d.productId || (d.portInfo && d.portInfo.productId),
          serialNumber: d.serialNumber || (d.portInfo && d.portInfo.serialNumber),
          pnpId: d.pnpId || (d.portInfo && d.portInfo.pnpId),
          displayName: d.getDisplayName?.(),
        })));
        console.log('[rebootAndReload] Active device:', activeDevice ? {
          id: activeDevice.id,
          isConnected: activeDevice.isConnected,
          path: activeDevice.path,
          productId: activeDevice.productId || (activeDevice.portInfo && activeDevice.portInfo.productId),
          serialNumber: activeDevice.serialNumber || (activeDevice.portInfo && activeDevice.portInfo.serialNumber),
          pnpId: activeDevice.pnpId || (activeDevice.portInfo && activeDevice.portInfo.pnpId),
          displayName: activeDevice.getDisplayName?.(),
        } : null);
        // If not active, but device is present, try to auto-connect to the one matching the pre-reboot device PID (productId)
        if ((!activeDevice || !activeDevice.isConnected) && devicesArr.length > 0) {
          const match = devicesArr.find(d => {
            const dPID = d.productId || (d.portInfo && d.portInfo.productId);
            const dSerial = d.serialNumber || (d.portInfo && d.portInfo.serialNumber);
            const dPnpId = d.pnpId || (d.portInfo && d.portInfo.pnpId);
            const dPath = d.path || (d.portInfo && d.portInfo.path);
            return (
              (rebootPID && dPID && dPID === rebootPID) ||
              (rebootSerial && dSerial && dSerial === rebootSerial) ||
              (rebootPnpId && dPnpId && dPnpId === rebootPnpId) ||
              (rebootPath && dPath && dPath === rebootPath) ||
              (rebootDeviceId && d.id && d.id === rebootDeviceId)
            );
          });
          if (match && typeof window.multiDeviceManager.connectDevice === 'function') {
            console.log('[rebootAndReload] Attempting to auto-connect to rebooted device:', match.id || match.path || match.getDisplayName?.());
            try {
              await window.multiDeviceManager.connectDevice(match.id, false); // Suppress toast during auto-reconnection after reboot
              // Wait a moment for connection to establish
              await new Promise(res => setTimeout(res, 300));
              activeDevice = window.multiDeviceManager.getActiveDevice?.();
              // --- PATCH: If device is found but not set as active, force setActiveDevice ---
              if (activeDevice && typeof window.multiDeviceManager.setActiveDevice === 'function') {
                if (!activeDevice.isConnected) {
                  console.log('[rebootAndReload] Forcing setActiveDevice after reconnect:', match);
                  await window.multiDeviceManager.setActiveDevice(match);
                  console.log('[rebootAndReload] setActiveDevice complete after reconnect');
                }
              }
              console.log('[rebootAndReload] After auto-connect, activeDevice:', activeDevice ? {
                id: activeDevice.id,
                isConnected: activeDevice.isConnected,
                path: activeDevice.path,
                productId: activeDevice.productId || (activeDevice.portInfo && activeDevice.portInfo.productId),
                serialNumber: activeDevice.serialNumber || (activeDevice.portInfo && activeDevice.portInfo.serialNumber),
                pnpId: activeDevice.pnpId || (activeDevice.portInfo && activeDevice.portInfo.pnpId),
                displayName: activeDevice.getDisplayName?.(),
              } : null);
            } catch (err) {
              console.warn('[rebootAndReload] Auto-connect failed:', err);
            }
          } else {
            console.log('[rebootAndReload] No matching device to auto-connect.');
          }
        }
        // --- PATCH: If device is present but not active, force setActiveDevice ---
        if ((!activeDevice || !activeDevice.isConnected) && devicesArr.length > 0 && typeof window.multiDeviceManager.setActiveDevice === 'function') {
          const match = devicesArr.find(d => {
            const dPID = d.productId || (d.portInfo && d.portInfo.productId);
            const dSerial = d.serialNumber || (d.portInfo && d.portInfo.serialNumber);
            const dPnpId = d.pnpId || (d.portInfo && d.portInfo.pnpId);
            const dPath = d.path || (d.portInfo && d.portInfo.path);
            return (
              (rebootPID && dPID && dPID === rebootPID) ||
              (rebootSerial && dSerial && dSerial === rebootSerial) ||
              (rebootPnpId && dPnpId && dPnpId === rebootPnpId) ||
              (rebootPath && dPath && dPath === rebootPath) ||
              (rebootDeviceId && d.id && d.id === rebootDeviceId)
            );
          });
          if (match) {
            console.log('[rebootAndReload] Forcing setActiveDevice (fallback):', match);
            await window.multiDeviceManager.setActiveDevice(match);
            activeDevice = window.multiDeviceManager.getActiveDevice?.();
          }
        }
        if (activeDevice && activeDevice.isConnected) {
          found = true;
          console.log('[rebootAndReload] Device reconnected after reboot, polling for firmware ready...');
          
          // Clear ALL blocking flags immediately when device reconnects successfully so file loading can proceed
          window._renameInProgress = false;
          window._deviceLoadingOverride = false;
          console.log('[rebootAndReload] Cleared all blocking flags for file loading');
          
          try {
            // Wait for firmware ready before any file reads
            if (activeDevice.port) {
              console.log('[rebootAndReload] Attempting to wait for firmware ready...');
              await waitForFirmwareReady(activeDevice.port, 40, 300);
              console.log('[rebootAndReload] Firmware ready after reboot, proceeding with reload');
            } else {
              throw new Error('No port on activeDevice after reconnect');
            }
            
            console.log('[rebootAndReload] Starting forceReloadDeviceFiles...');
            if (window.multiDeviceManager && typeof window.multiDeviceManager.forceReloadDeviceFiles === 'function') {
              console.log('[rebootAndReload] About to call forceReloadDeviceFiles with device:', activeDevice.id);
              await window.multiDeviceManager.forceReloadDeviceFiles(activeDevice);
              console.log('[rebootAndReload] forceReloadDeviceFiles completed successfully');
              
              // Force refresh device name after boot.py changes
              console.log('[rebootAndReload] Forcing device name refresh after boot.py update...');
              if (typeof window.multiDeviceManager.requestDeviceNameQuick === 'function' && activeDevice.port) {
                try {
                  const freshDeviceName = await window.multiDeviceManager.requestDeviceNameQuick(activeDevice.port);
                  if (freshDeviceName && freshDeviceName !== 'Unknown' && freshDeviceName.trim()) {
                    console.log(`[rebootAndReload] Got fresh device name: ${freshDeviceName}`);
                    activeDevice.displayName = freshDeviceName.trim();
                    // Update UI elements
                    if (window.updateFooterDeviceName) window.updateFooterDeviceName();
                    if (window.multiDeviceManager.emit) window.multiDeviceManager.emit('deviceNameUpdated', activeDevice);
                  }
                } catch (err) {
                  console.warn('[rebootAndReload] Could not refresh device name:', err.message);
                }
              }
              
              // Update header status after successful reload
              if (typeof window.updateHeaderStatus === 'function') {
                window.updateHeaderStatus(activeDevice);
              }
              
              showToast('Device reconnected and UI fully refreshed', 'success');
            } else if (typeof activeDevice.readFile === 'function') {
              // fallback: manual reload
              const configText = await activeDevice.readFile('config.json');
              const configObj = JSON.parse(configText);
              if (typeof applyConfig === 'function') applyConfig(configObj);
              const presetsText = await activeDevice.readFile('presets.json');
              const presetsObj = JSON.parse(presetsText);
              populatePresetDropdown(presetsObj, false);
              if (typeof restoreLiveColors === 'function') restoreLiveColors('.released-set .fret-button');
              if (typeof previewAllLeds === 'function') previewAllLeds();
              
              // Update header status after manual reload
              if (typeof window.updateHeaderStatus === 'function') {
                window.updateHeaderStatus(activeDevice);
              }
              
              showToast('Device reconnected and UI fully refreshed', 'success');
            } else {
              console.warn('[rebootAndReload] activeDevice.readFile is not a function');
            }
          } catch (err) {
            console.warn('[rebootAndReload] Could not fully reload config/presets after reconnect:', err);
            showToast('Device reconnected but failed to fully reload config/presets', 'error');
          }
          
          rebootInProgress = false;
          return;
        }
      } else {
        console.warn('[rebootAndReload] multiDeviceManager or scanForDevices not available');
      }
      if (tries < maxTries) {
        setTimeout(pollForReconnect, pollInterval);
      } else {
        if (!found) {
          console.warn('[rebootAndReload] Device did not reconnect after reboot');
          showToast('Device did not reconnect after reboot', 'error');
          customAlert('Device did not reconnect after reboot. Please unplug and replug the device.');
          
          // Clear rename flag when reboot fails
          window._renameInProgress = false;
          rebootInProgress = false;
        }
      }
    }
    setTimeout(pollForReconnect, 3500); // Wait for reboot + disconnect delay
  } catch (err) {
    console.error('[rebootAndReload] Error sending REBOOT or reloading UI:', err);
    showToast('Error during reboot and reload', 'error');
    
    // Clear rename flag when reboot encounters error
    window._renameInProgress = false;
    rebootInProgress = false;
  }
}

// ===== FIRMWARE READY POLLING UTILITY =====
function waitForFirmwareReady(port, maxAttempts = 10, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    let buffer = '';
    async function handleReady() {
      // Flush the serial buffer after FIRMWARE_READY:OK before resolving
      if (typeof port.flush === 'function') {
        try {
          await new Promise((res, rej) => {
            port.flush(err => err ? rej(err) : res());
          });
          console.log('[waitForFirmwareReady] Serial buffer flushed after FIRMWARE_READY:OK');
        } catch (flushErr) {
          console.warn('[waitForFirmwareReady] Serial buffer flush failed after FIRMWARE_READY:OK', flushErr);
        }
      }
      resolve();
    }
    function onData(data) {
      buffer += data.toString();
      if (buffer.includes('FIRMWARE_READY:OK')) {
        port.off('data', onData);
        handleReady();
      } else if (buffer.match(/ERROR|Unknown command/)) {
        port.off('data', onData);
        reject(new Error('Firmware not ready or error response: ' + buffer));
      }
    }
    function poll() {
      if (attempts++ >= maxAttempts) {
        port.off('data', onData);
        reject(new Error('Firmware not ready after polling'));
        return;
      }
      buffer = '';
      port.on('data', onData);
      port.write('FIRMWARE_READY?\n');
      setTimeout(() => {
        port.off('data', onData);
        if (attempts < maxAttempts) poll();
      }, intervalMs);
    }
    poll();
  });
}

function normalizeVersion(version) {
  if (!version || version === '-' || version === 'Unable to read version') {
    return version; // Return as-is for special cases
  }
  
  // Remove any existing 'v' prefix
  let cleanVersion = version.replace(/^v/i, '');
  
  // Split into parts
  const parts = cleanVersion.split('.');
  
  // Ensure we have at least major.minor.patch
  while (parts.length < 3) {
    parts.push('0');
  }
  
  // Take only first 3 parts and ensure they're numbers
  const [major, minor, patch] = parts.slice(0, 3).map(part => {
    const num = parseInt(part, 10);
    return isNaN(num) ? '0' : num.toString();
  });
  
  return `v${major}.${minor}.${patch}`;
}

function rgbToHex(rgbString) {
  const match = rgbString.match(/\d+/g);
  if (!match || match.length < 3) return rgbString; // fallback
  const [r, g, b] = match.map(Number);
  return "#" + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function sanitizeColor(color) {
  return color.startsWith('rgb') ? rgbToHex(color) : color;
}

const getTextColor = bgColor => {
  let r, g, b;
  if (bgColor.startsWith('#')) {
    const rgb = parseInt(bgColor.slice(1), 16);
    r = (rgb >> 16) & 0xff;
    g = (rgb >> 8) & 0xff;
    b = rgb & 0xff;
  } else {
    const parts = bgColor.match(/\d+/g);
    [r, g, b] = parts.map(Number);
  }
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#000' : '#fff';
};

const collectCurrentColors = () => {
  // Use the explicit button ID list for consistency and mapping
  const ids = [
    'strum-up-active', 'strum-down-active',
    'orange-fret-pressed', 'blue-fret-pressed', 'yellow-fret-pressed', 'red-fret-pressed', 'green-fret-pressed',
    'strum-up-released', 'strum-down-released',
    'orange-fret-released', 'blue-fret-released', 'yellow-fret-released', 'red-fret-released', 'green-fret-released'
  ];
  const preset = {};
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      let color = el.style.backgroundColor;
      if (color?.startsWith('rgb')) color = rgbToHex(color);
      preset[id] = color || '#ffffff';
    }
  });
  return preset;
};

const initFileQueue = () => ['config.json', 'presets.json', 'user_presets.json'];

const populatePresetDropdown = (presets, isUserPresets = false) => {
// ...existing code...
  const id = isUserPresets ? 'user-preset-select' : 'preset-select';
  const select = document.getElementById(id);
  console.log(`[populatePresetDropdown] Called for ${id}. select:`, select, 'presets:', presets);
  if (!select) {
    console.error(`[populatePresetDropdown] No select element found for id: ${id}`);
    return;
  }
  if (!presets) {
    console.error('[populatePresetDropdown] No presets data provided');
    return;
  }

  // Handle new versioned structure - extract just the presets
  const presetsData = presets.presets || presets;
  if (!presetsData || Object.keys(presetsData).length === 0) {
    console.error('[populatePresetDropdown] presetsData is empty or missing:', presetsData);
    return;
  }
  console.log('[populatePresetDropdown] presetsData:', presetsData);

  select.innerHTML = '';
  const top = document.createElement('option');
  top.textContent = isUserPresets ? 'User Preset Slots:' : 'Presets:';
  top.disabled = true;
  top.selected = true;
  select.appendChild(top);

  const keys = Object.keys(presetsData).sort((a, b) => {
    const aNum = parseInt(a.replace(/\D/g, '')) || 0;
    const bNum = parseInt(b.replace(/\D/g, '')) || 0;
    return aNum - bNum;
  });
  console.log('[populatePresetDropdown] keys:', keys);

  for (const key of keys) {
    const value = presetsData[key];
    if (!value) {
      console.error(`[populatePresetDropdown] No value for key: ${key}`);
      continue;
    }
    const opt = document.createElement('option');
    opt.value = key; // Use the preset name as the value, not the JSON object
    opt.textContent = key;
    select.appendChild(opt);
    console.log(`[populatePresetDropdown] Added option: key=${key}, value=`, value);
  }
};

const applyConfig = config => {
  console.log('[DEBUG][applyConfig] Called with config:', config);
  if (!config) {
    console.error('[DEBUG][applyConfig] No config provided!');
  }
  if (typeof config !== 'object') {
    console.error('[DEBUG][applyConfig] Config is not an object:', config);
  }
  if (config && (!config.led_color || !config.released_color)) {
    console.error('[DEBUG][applyConfig] Config missing led_color or released_color:', config);
  }
  console.log('[DEBUG][applyConfig] originalConfig before assignment:', originalConfig);

// Listen for deviceFilesLoaded event and update UI
window.applyConfig = applyConfig;
window.populatePresetDropdown = populatePresetDropdown;
  console.log('[applyConfig] Called with config:', config);
  originalConfig = config;
  console.log('[DEBUG][applyConfig] originalConfig after assignment:', originalConfig);

  fretIndexMap.forEach((ledIndex, i) => {
    if (!config.led_color || !config.released_color) {
      console.error('[DEBUG][applyConfig] Missing led_color or released_color in config:', config);
      return;
    }
    const pressedBtn = document.querySelectorAll('.pressed-set .fret-button')[i];
    const releasedBtn = document.querySelectorAll('.released-set .fret-button')[i];
    if (!pressedBtn) {
      console.error(`[applyConfig] Missing pressedBtn for fret ${i}`);
    }
    if (!releasedBtn) {
      console.error(`[applyConfig] Missing releasedBtn for fret ${i}`);
    }
    console.log(`[applyConfig] Fret ${i}: pressedBtn=`, pressedBtn, 'releasedBtn=', releasedBtn);

    if (pressedBtn) {
      const bg = config.led_color[ledIndex];
      const text = getTextColor(bg);
      pressedBtn.style.backgroundColor = bg;
      pressedBtn.style.color = text;
      liveColors.set(pressedBtn, { bg, text });
      console.log(`[applyConfig] Updated pressedBtn ${i}: bg=${bg}, text=${text}`);
    }

    if (releasedBtn) {
      const bg = config.released_color[ledIndex];
      const text = getTextColor(bg);
      releasedBtn.style.backgroundColor = bg;
      releasedBtn.style.color = text;
      liveColors.set(releasedBtn, { bg, text });
      console.log(`[applyConfig] Updated releasedBtn ${i}: bg=${bg}, text=${text}`);
    }
  });

  const activeStrumButtons = document.querySelectorAll('.active-set .strum-button');
  if (!config.led_color) {
    console.error('[DEBUG][applyConfig] No led_color in config:', config);
  }
  if (!activeStrumButtons.length) {
    console.error('[applyConfig] No .active-set .strum-button elements found');
  }
  activeStrumButtons.forEach((el, i) => {
    const bg = config.led_color[i];
    const text = getTextColor(bg);
    el.style.backgroundColor = bg;
    el.style.color = text;
    liveColors.set(el, { bg, text });
    console.log(`[applyConfig] Updated active-set strum-button ${i}: bg=${bg}, text=${text}`);
  });

  const releasedStrumButtons = document.querySelectorAll('.released-set .strum-button');
  if (!config.released_color) {
    console.error('[DEBUG][applyConfig] No released_color in config:', config);
  }
  if (!releasedStrumButtons.length) {
    console.error('[applyConfig] No .released-set .strum-button elements found');
  }
  releasedStrumButtons.forEach((el, i) => {
    const bg = config.released_color[i];
    const text = getTextColor(bg);
    el.style.backgroundColor = bg;
    el.style.color = text;
    liveColors.set(el, { bg, text });
    console.log(`[applyConfig] Updated released-set strum-button ${i}: bg=${bg}, text=${text}`);
  });

  const toggleBtn = document.querySelector('.fret-toggle-button.selected');
  console.log('[DEBUG][applyConfig] End of applyConfig.');
  if (!toggleBtn) {
    console.error('[applyConfig] No .fret-toggle-button.selected element found');
  } else {
    toggleBtn.click();
    console.log('[applyConfig] Clicked .fret-toggle-button.selected');
  }
  
  // Update hat status display when config is loaded
  if (typeof setupHatStatusDisplay === 'function') {
    setupHatStatusDisplay();
    console.log('[applyConfig] Called setupHatStatusDisplay');
  }
  
  // Update toggle button text based on current mode
  updateToggleButtonText();
  updateTiltWaveButtonText();
  console.log('[applyConfig] Updated toggle and tilt wave button text');
  
  // Update device information in diagnostics if modal is open
  const diagnosticsModal = document.getElementById('diagnostics-modal');
  if (diagnosticsModal && diagnosticsModal.style.display === 'flex') {
    setTimeout(() => {
      setupDeviceInformation();
      console.log('[applyConfig] Updated device information in diagnostics modal');
    }, 100);
  }
};

// Function to update the toggle button text based on current hat_mode
function updateToggleButtonText() {
  const toggleBtn = document.getElementById('toggle-hat-mode-btn');
  if (!toggleBtn) return;
  
  // If no config loaded yet, show default text
  if (!originalConfig) {
    toggleBtn.textContent = "Switch to D-Pad";
    return;
  }
  
  const current = originalConfig.hat_mode || "joystick";
  const nextMode = current === "joystick" ? "D-Pad" : "Joystick";
  toggleBtn.textContent = `Switch to ${nextMode}`;
}

function updateTiltWaveButtonText() {
  const tiltWaveBtn = document.getElementById('toggle-tilt-wave-btn');
  if (!tiltWaveBtn) return;
  
  // If no config loaded yet, show default text
  if (!originalConfig) {
    tiltWaveBtn.textContent = "Turn On Tiltwave";
    return;
  }
  
  const current = originalConfig.tilt_wave_enabled || false;
  tiltWaveBtn.textContent = current ? "Turn Off Tiltwave" : "Turn On Tiltwave";
}

// ===== DOM-dependent code =====
document.addEventListener('DOMContentLoaded', () => {
  // --- Device disconnect/reconnect event handlers ---
  if (window.multiDeviceManager) {
    window.multiDeviceManager.on('deviceDisconnected', (device) => {
      // Clear in-memory config and update UI
      window.originalConfig = null;
      // Force clear active device in manager
      if (window.multiDeviceManager.activeDevice === device) {
        window.multiDeviceManager.setActiveDevice(null);
      }
      // Always update device list and selector
      if (typeof updateDeviceList === 'function') updateDeviceList();
      if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
      if (window.updateFooterDeviceName) window.updateFooterDeviceName();
      if (window.updateActiveButtonText) window.updateActiveButtonText(null);
      // Optionally clear UI fields here
      console.log('[app.js][EVENT] Device disconnected (UI forced):', device?.id);
    });
    window.multiDeviceManager.on('activeDeviceChanged', (newDevice, previousDevice) => {
      if (newDevice && newDevice.isConnected) {
        // Skip automatic config reading if diagnostic setup is in progress
        if (window.setupDeviceInformationInProgress) {
          console.log('[app.js][EVENT] Skipping automatic config read - diagnostic setup in progress');
          return;
        }
        
        // Only use direct firmware commands for basic device information
        // File loading (config, presets) will be done manually by user request
        console.log('[app.js][EVENT] Device connected - using direct commands only, no automatic file reading');
        
        // Update UI immediately with basic device info using direct commands
        if (typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(newDevice);
        }
        
        // Note: Config file loading will be done when user explicitly requests it
        // through "Load Device Files" buttons or when opening specific functionality
        
        // Update device information in diagnostics if modal is open (using direct commands only)
        setTimeout(() => {
          const diagnosticsModal = document.getElementById('diagnostics-modal');
          if (diagnosticsModal && diagnosticsModal.style.display === 'flex') {
            setupDeviceInformation();
            console.log('[app.js][EVENT] Updated device information in diagnostics modal using direct commands');
          }
          
          // Clear automatic updater version cache after device reconnection
          // This ensures fresh version detection after firmware updates
          if (window.automaticUpdater && typeof window.automaticUpdater.clearVersionCache === 'function') {
            window.automaticUpdater.clearVersionCache();
            console.log('[app.js][EVENT] Cleared automatic updater version cache after device reconnection');
          }
        }, 500); // Shorter delay since we're not waiting for file reads
      }
      
      // Update device information immediately when active device changes
      setTimeout(() => {
        const diagnosticsModal = document.getElementById('diagnostics-modal');
        if (diagnosticsModal && diagnosticsModal.style.display === 'flex') {
          setupDeviceInformation();
          console.log('[app.js][EVENT] Updated device information after active device changed');
        }
      }, 100);
    });

  }
  // Device Selector Button logic
  // Hide save button by default
  const saveCustomBtn = document.getElementById('save-custom-btn');
  if (saveCustomBtn) saveCustomBtn.style.display = 'none';
  // Ensure pickerRoot is defined before any usage
  const pickerRoot = document.querySelector('#picker-root');
  const deviceSelectorButton = document.getElementById('deviceSelectorButton');
  if (deviceSelectorButton) {
    deviceSelectorButton.addEventListener('click', () => {
      // Show device selector UI/modal
      initializeDeviceSelector();
    });
  }

  // Auto-scan for devices and update selector on load
  window.multiDeviceManager.scanForDevices().then(() => {
    initializeDeviceSelector();
  });
  
  // Listen for device files loaded events to update diagnostics
  document.addEventListener('deviceFilesLoaded', (event) => {
    console.log('[app.js][EVENT] Device files loaded:', event.detail);
    
    // Update device information in diagnostics if modal is open
    setTimeout(() => {
      const diagnosticsModal = document.getElementById('diagnostics-modal');
      if (diagnosticsModal && diagnosticsModal.style.display === 'flex') {
        setupDeviceInformation();
        console.log('[app.js][EVENT] Updated device information after files loaded');
      }
    }, 200); // Small delay to ensure files are fully processed
  });
  // Whammy Calibration Modal logic
  // Live whammy feedback polling (must be top-level in DOMContentLoaded)
  let whammyLiveInterval = null;
  let lastWhammyValue = null;
  const whammyCalBtn = document.getElementById('whammy-cal-btn');
  const whammyModal = document.getElementById('whammy-modal');
  const whammyApplyBtn = document.getElementById('whammy-apply');
  const whammyCancelBtn = document.getElementById('whammy-cancel');
  const whammyAutoCalBtn = document.getElementById('whammy-auto-cal-btn');
  const whammyAutoCalStatus = document.getElementById('whammy-auto-cal-status');
  // Checkbox and value display elements
  const whammyReverse = document.getElementById('whammy-reverse');
  const whammyMinVal = document.getElementById('whammy-min-val');
  const whammyMaxVal = document.getElementById('whammy-max-val');
  const whammyGraph = document.getElementById('whammy-graph');
  let whammyLiveVal = document.getElementById('whammy-live-val');
  // If not present, create it above the graph
  if (!whammyLiveVal && whammyGraph) {
    whammyLiveVal = document.createElement('div');
    whammyLiveVal.id = 'whammy-live-val';
    whammyLiveVal.style.fontWeight = 'bold';
    whammyLiveVal.style.marginBottom = '8px';
    whammyGraph.parentNode.insertBefore(whammyLiveVal, whammyGraph);
  }

  let whammyConfig = null;

  function showWhammyModal() {
    if (!originalConfig) return;
    whammyConfig = {
      min: Number(originalConfig.whammy_min ?? 0),
      max: Number(originalConfig.whammy_max ?? 65535),
      reverse: !!originalConfig.whammy_reverse
    };
    whammyMinValue = whammyConfig.min;
    whammyMaxValue = whammyConfig.max;
    if (whammyMinVal) {
      whammyMinVal.value = whammyMinValue;
      whammyMinVal.defaultValue = whammyMinValue;
      whammyMinVal.setAttribute('value', whammyMinValue);
      whammyMinVal.setAttribute('min', 0);
      whammyMinVal.setAttribute('max', whammyMaxValue - 1);
    }
    if (whammyMaxVal) {
      whammyMaxVal.value = whammyMaxValue;
      whammyMaxVal.defaultValue = whammyMaxValue;
      whammyMaxVal.setAttribute('value', whammyMaxValue);
      whammyMaxVal.setAttribute('min', whammyMinValue + 1);
      whammyMaxVal.setAttribute('max', 65535);
    }
    // After modal is displayed, force input values again to override browser restore
    setTimeout(() => {
      if (whammyMinVal) {
        whammyMinVal.value = whammyMinValue;
        const parent = whammyMinVal.parentNode;
        parent.removeChild(whammyMinVal);
        parent.appendChild(whammyMinVal);
      }
      if (whammyMaxVal) {
        whammyMaxVal.value = whammyMaxValue;
        const parent = whammyMaxVal.parentNode;
        parent.removeChild(whammyMaxVal);
        parent.appendChild(whammyMaxVal);
      }
      updateWhammyVals();
      drawWhammyGraph();
    }, 10);
    // Directly update UI and state after setting values
    updateWhammyVals();
    drawWhammyGraph();
    whammyReverse.checked = whammyConfig.reverse;
    updateWhammyVals();
    drawWhammyGraph();
    whammyModal.style.display = 'flex';
    startWhammyLiveFeedback();
  }

  function hideWhammyModal() {
    whammyModal.style.display = 'none';
    stopWhammyLiveFeedback();
  }

  function startWhammyLiveFeedback() {
    if (whammyLiveInterval) clearInterval(whammyLiveInterval);
    console.log('[DEBUG] startWhammyLiveFeedback: polling started');
    whammyLiveInterval = setInterval(() => {
      if (!connectedPort) return;
      console.log('[DEBUG] Polling device for whammy value');
      connectedPort.write("READWHAMMY\n");
    }, 100);
    serialListenerManager.addListener(connectedPort, 'whammyLiveFeedback', whammyLiveHandler);
  }

  function stopWhammyLiveFeedback() {
    if (whammyLiveInterval) clearInterval(whammyLiveInterval);
    whammyLiveInterval = null;
    serialListenerManager.removeListener(connectedPort, 'whammyLiveFeedback');
    lastWhammyValue = null;
    drawWhammyGraph();
  }

  function whammyLiveHandler(data) {
  const str = data.toString();
  console.log('[DEBUG] whammyLiveHandler received:', str);
  const match = str.match(/WHAMMY:([0-9]+)/);
  if (match) {
    lastWhammyValue = Number(match[1]);
    console.log('[DEBUG] Parsed whammy value:', lastWhammyValue);
    drawWhammyGraph();
  }
}

  function updateWhammyVals() {
    if (whammyMinVal) whammyMinVal.value = whammyMinValue;
    if (whammyMaxVal) whammyMaxVal.value = whammyMaxValue;
  }

  // --- DRAGGABLE MIN/MAX BARS ---
  let draggingBar = null; // 'min' or 'max'
  let dragOffsetX = 0;
  let whammyMinValue = 0;
  let whammyMaxValue = 65535;

  function drawWhammyGraph() {
    if (!whammyGraph) return;
    const ctx = whammyGraph.getContext('2d');
    ctx.clearRect(0, 0, whammyGraph.width, whammyGraph.height);
    // White background and border
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, whammyGraph.width, whammyGraph.height);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, whammyGraph.width, whammyGraph.height);
    ctx.restore();

    // Add horizontal padding so draggable handles stay visible
    const PAD = 18; // px
    const graphW = whammyGraph.width;
    const barY = whammyGraph.height / 2;
    const barHeight = 16;
    ctx.save();
    ctx.fillStyle = '#eee';
    ctx.fillRect(PAD, barY - barHeight / 2, graphW - PAD * 2, barHeight);
    ctx.restore();

    // Shade left (PAD to Min)
    const minX = PAD + ((whammyMinValue / 65535) * (graphW - PAD * 2));
    ctx.save();
    ctx.fillStyle = '#444';
    ctx.fillRect(PAD, barY - barHeight / 2, minX - PAD, barHeight);
    ctx.restore();

    // Shade right (Max to end)
    const maxX = PAD + ((whammyMaxValue / 65535) * (graphW - PAD * 2));
    ctx.save();
    ctx.fillStyle = '#444';
    ctx.fillRect(maxX, barY - barHeight / 2, graphW - PAD - maxX, barHeight);
    ctx.restore();

    // Draw Min/Max draggable markers
    function drawBar(x, label) {
      ctx.save();
      ctx.strokeStyle = '#bfa500';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, barY - barHeight / 2);
      ctx.lineTo(x, barY + barHeight / 2);
      ctx.stroke();
      // Draw handle
      ctx.fillStyle = draggingBar === label ? '#ffe066' : '#bfa500';
      ctx.beginPath();
      ctx.arc(x, barY, 10, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
    drawBar(minX, 'min');
    drawBar(maxX, 'max');

    // Draw green dot for live value
    if (lastWhammyValue !== null && lastWhammyValue !== undefined) {
      const liveX = PAD + ((lastWhammyValue / 65535) * (graphW - PAD * 2));
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      ctx.arc(liveX, barY, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#006400';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Remove Min/Max labels below the graph

    // Update live value outside the graph
    if (whammyLiveVal) {
      whammyLiveVal.textContent = `Live: ${lastWhammyValue !== null && lastWhammyValue !== undefined ? lastWhammyValue : '-'}`;
    }
  }

  // --- DRAG LOGIC ---
  // Allow direct editing of Min/Max values
  whammyMinVal?.addEventListener('input', e => {
    let val = Number(e.target.value);
    val = Math.max(0, Math.min(val, whammyMaxValue - 1));
    whammyMinValue = val;
    updateWhammyVals();
    drawWhammyGraph();
  });
  whammyMaxVal?.addEventListener('input', e => {
    let val = Number(e.target.value);
    val = Math.max(whammyMinValue + 1, Math.min(val, 65535));
    whammyMaxValue = val;
    updateWhammyVals();
    drawWhammyGraph();
  });
  function getBarAt(x, y) {
    const PAD = 18;
    const graphW = whammyGraph.width;
    const barY = whammyGraph.height / 2;
    const minX = PAD + ((whammyMinValue / 65535) * (graphW - PAD * 2));
    const maxX = PAD + ((whammyMaxValue / 65535) * (graphW - PAD * 2));
    // Check if mouse is near min or max bar handle
    if (Math.abs(x - minX) < 14 && Math.abs(y - barY) < 16) return 'min';
    if (Math.abs(x - maxX) < 14 && Math.abs(y - barY) < 16) return 'max';
    return null;
  }

  whammyGraph.addEventListener('mousedown', e => {
    const PAD = 18;
    const graphW = whammyGraph.width;
    const rect = whammyGraph.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bar = getBarAt(x, y);
    if (bar) {
      draggingBar = bar;
      const value = bar === 'min' ? whammyMinValue : whammyMaxValue;
      dragOffsetX = x - (PAD + ((value / 65535) * (graphW - PAD * 2)));
      document.body.style.cursor = 'ew-resize';
    }
  });

  window.addEventListener('mousemove', e => {
    if (!draggingBar) return;
    const PAD = 18;
    const graphW = whammyGraph.width;
    const rect = whammyGraph.getBoundingClientRect();
    let x = e.clientX - rect.left - dragOffsetX;
    x = Math.max(PAD, Math.min(graphW - PAD, x));
    let value = Math.round(((x - PAD) / (graphW - PAD * 2)) * 65535);
    if (draggingBar === 'min') {
      value = Math.min(value, whammyMaxValue - 1); // can't cross max
      whammyMinValue = value;
      if (whammyMinVal) whammyMinVal.value = value;
    } else if (draggingBar === 'max') {
      value = Math.max(value, whammyMinValue + 1); // can't cross min
      whammyMaxValue = value;
      if (whammyMaxVal) whammyMaxVal.value = value;
    }
    drawWhammyGraph();
    updateWhammyVals();
  });

  window.addEventListener('mouseup', () => {
    if (draggingBar) {
      draggingBar = null;
      document.body.style.cursor = '';
      drawWhammyGraph();
    }
  });

  // Touch support
  whammyGraph.addEventListener('touchstart', e => {
    const PAD = 18;
    const graphW = whammyGraph.width;
    const rect = whammyGraph.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const bar = getBarAt(x, y);
    if (bar) {
      draggingBar = bar;
      const value = bar === 'min' ? whammyMinValue : whammyMaxValue;
      dragOffsetX = x - (PAD + ((value / 65535) * (graphW - PAD * 2)));
      e.preventDefault();
    }
  });
  window.addEventListener('touchmove', e => {
    if (!draggingBar) return;
    const PAD = 18;
    const graphW = whammyGraph.width;
    const rect = whammyGraph.getBoundingClientRect();
    const touch = e.touches[0];
    let x = touch.clientX - rect.left - dragOffsetX;
    x = Math.max(PAD, Math.min(graphW - PAD, x));
    let value = Math.round(((x - PAD) / (graphW - PAD * 2)) * 65535);
    if (draggingBar === 'min') {
      value = Math.min(value, whammyMaxValue - 1);
      whammyMinValue = value;
    } else if (draggingBar === 'max') {
      value = Math.max(value, whammyMinValue + 1);
      whammyMaxValue = value;
    }
    drawWhammyGraph();
    updateWhammyVals();
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', () => {
    if (draggingBar) {
      draggingBar = null;
      drawWhammyGraph();
    }
  });

  // Remove slider event handlers
  // Live update handlers (no sliders)
  // Update whammyMinVal/whammyMaxVal text
  function updateWhammyVals() {
    const minEl = document.getElementById('whammy-min-val');
    const maxEl = document.getElementById('whammy-max-val');
    if (minEl) minEl.textContent = whammyMinValue;
    if (maxEl) maxEl.textContent = whammyMaxValue;
  }

  // On modal open, set values from config
  function showWhammyModal() {
    if (!originalConfig) return;
    whammyConfig = {
      min: Number(originalConfig.whammy_min ?? 0),
      max: Number(originalConfig.whammy_max ?? 65535),
      reverse: !!originalConfig.whammy_reverse
    };
    whammyMinValue = whammyConfig.min;
    whammyMaxValue = whammyConfig.max;
    // Set input fields to config values before showing modal
    if (whammyMinVal) {
      whammyMinVal.value = whammyMinValue;
      whammyMinVal.defaultValue = whammyMinValue;
      whammyMinVal.setAttribute('value', whammyMinValue);
      whammyMinVal.setAttribute('min', 0);
      whammyMinVal.setAttribute('max', whammyMaxValue - 1);
    }
    if (whammyMaxVal) {
      whammyMaxVal.value = whammyMaxValue;
      whammyMaxVal.defaultValue = whammyMaxValue;
      whammyMaxVal.setAttribute('value', whammyMaxValue);
      whammyMaxVal.setAttribute('min', whammyMinValue + 1);
      whammyMaxVal.setAttribute('max', 65535);
    }
    whammyReverse.checked = whammyConfig.reverse;
    // Update UI before showing modal
    updateWhammyVals();
    drawWhammyGraph();
    whammyModal.style.display = 'flex';
    startWhammyLiveFeedback();
  }

  // Only reverse checkbox needs event handler
  whammyReverse?.addEventListener('change', drawWhammyGraph);

  // Auto-calibration functionality
  let autoCalStep = 0; // 0=idle, 1=waiting for rest, 2=waiting for full depression
  let autoCalSamples = [];
  let autoCalInterval = null;

  function startAutoCalibration() {
    if (!connectedPort) {
      updateStatus("No device connected", false);
      return;
    }
    
    autoCalStep = 1;
    autoCalSamples = [];
    whammyAutoCalBtn.disabled = true;
    whammyAutoCalBtn.textContent = "Calibrating...";
    whammyAutoCalStatus.textContent = "Step 1: Keep whammy at rest position for 3 seconds";
    whammyAutoCalStatus.style.color = "#ffe066";
    
    // Start collecting samples
    autoCalInterval = setInterval(collectAutoCalSample, 100);
    
    // Auto-advance to next step after 3 seconds
    setTimeout(() => {
      if (autoCalStep === 1) {
        processRestPosition();
      }
    }, 3000);
  }

  function collectAutoCalSample() {
    if (lastWhammyValue !== null && lastWhammyValue !== undefined) {
      autoCalSamples.push(lastWhammyValue);
    }
  }

  function processRestPosition() {
    if (autoCalSamples.length === 0) {
      stopAutoCalibration("No whammy readings received");
      return;
    }

    // Calculate average rest position
    const restAvg = autoCalSamples.reduce((a, b) => a + b, 0) / autoCalSamples.length;
    const restMin = Math.min(...autoCalSamples);
    const restMax = Math.max(...autoCalSamples);

    console.log(`[AutoCal] Rest - Avg: ${restAvg.toFixed(1)}, Min: ${restMin}, Max: ${restMax}`);

    // Set minimum to restMax plus buffer (to avoid noise below restMax)
    const restBuffer = Math.max(100, Math.floor((restMax - restMin) * 0.1 + 200));
    // The new min should be above the highest rest reading, plus buffer
    const calibratedMin = Math.min(65534, restMax + restBuffer);

    whammyMinValue = calibratedMin;
    if (whammyMinVal) whammyMinVal.value = calibratedMin;
    if (typeof updateWhammyVals === 'function') updateWhammyVals();
    if (typeof drawWhammyGraph === 'function') drawWhammyGraph();

    // Move to step 2
    autoCalStep = 2;
    autoCalSamples = [];
    if (whammyAutoCalStatus) {
      whammyAutoCalStatus.textContent = "Step 2: Fully depress whammy and hold for 3 seconds";
      whammyAutoCalStatus.style.color = "#66ccff";
    }

    // Auto-advance after 3 more seconds
    setTimeout(() => {
      if (autoCalStep === 2 && typeof processFullDepressionPosition === 'function') {
        processFullDepressionPosition();
      }
    }, 3000);
  }

  function processFullDepressionPosition() {
    if (autoCalSamples.length === 0) {
      stopAutoCalibration("No whammy readings received");
      return;
    }

    // Calculate average full depression position
    const fullAvg = autoCalSamples.reduce((a, b) => a + b, 0) / autoCalSamples.length;
    const fullMin = Math.min(...autoCalSamples);
    const fullMax = Math.max(...autoCalSamples);

    console.log(`[AutoCal] Full - Avg: ${fullAvg.toFixed(1)}, Min: ${fullMin}, Max: ${fullMax}`);

    // Set maximum to just below the lowest full depression reading, minus a small buffer
    // Buffer is 100 or 10% of noise, whichever is greater, but never more than 300
    let fullNoise = fullMax - fullMin;
    let fullBuffer = Math.max(100, Math.floor(fullNoise * 0.1));
    fullBuffer = Math.min(fullBuffer, 300); // never more than 300
    let calibratedMax = fullMax - fullBuffer;
    // Clamp: must be above min and below 65535, but never below the lowest full depression reading minus 20
    calibratedMax = Math.max(whammyMinValue + 1, Math.min(65535, Math.max(calibratedMax, fullMin - 20)));

    whammyMaxValue = calibratedMax;
    if (whammyMaxVal) whammyMaxVal.value = calibratedMax;
    if (typeof updateWhammyVals === 'function') updateWhammyVals();
    if (typeof drawWhammyGraph === 'function') drawWhammyGraph();

    stopAutoCalibration(`Auto-calibration complete! Min: ${whammyMinValue}, Max: ${whammyMaxValue}`, true);
  }

  function stopAutoCalibration(message, success = false) {
    autoCalStep = 0;
    autoCalSamples = [];
    if (autoCalInterval) {
      clearInterval(autoCalInterval);
      autoCalInterval = null;
    }
    
    whammyAutoCalBtn.disabled = false;
    whammyAutoCalBtn.textContent = "Auto Calibrate";
    whammyAutoCalStatus.textContent = message;
    whammyAutoCalStatus.style.color = success ? "#66ff66" : "#ff6666";
    
    // Clear status after a few seconds
    setTimeout(() => {
      if (whammyAutoCalStatus.textContent === message) {
        whammyAutoCalStatus.textContent = "";
      }
    }, 4000);
  }

  whammyAutoCalBtn?.addEventListener('click', startAutoCalibration);

  whammyCalBtn?.addEventListener('click', () => {
    closeConfigMenu();
    showWhammyModal();
  });
  whammyCancelBtn?.addEventListener('click', hideWhammyModal);

  whammyApplyBtn?.addEventListener('click', async () => {
    console.log('[DEBUG] showWhammyModal called');
    if (!originalConfig) {
      console.log('[DEBUG] showWhammyModal: originalConfig missing');
      return;
    }
    // Update config
    originalConfig.whammy_min = whammyMinValue;
    originalConfig.whammy_max = whammyMaxValue;
    originalConfig.whammy_reverse = whammyReverse.checked;
    // Save to device and robustly reload
    try {
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      showToast("Whammy calibration applied, rebooting...", "success");
      hideWhammyModal();
      // Use robust reboot and reload procedure
      setTimeout(() => rebootAndReload('config.json'), 500);
    } catch (err) {
      console.error("Failed to apply whammy calibration:", err);
      showToast("Failed to write config", "error");
    }
  });
  console.log("🌱 App initialized and DOM fully loaded.");
  
  // Initialize multi-device system
  initializeDeviceSelector();
  
  // Add multi-device event handlers for legacy compatibility
  multiDeviceManager.on('deviceData', (data, device) => {
    // The existing code already uses connectedPort which is updated by the active device change
    // This event can be used for device-specific logging or processing if needed
    console.log(`📥 Data from ${device.getDisplayName()}:`, data.length, 'chars');
  });
  
  multiDeviceManager.on('activeDeviceChanged', (newDevice, previousDevice) => {
    if (newDevice) {
      // Clear all serial listeners from previous device if there was one
      if (previousDevice && previousDevice.port) {
        serialListenerManager.removeAllListeners(previousDevice.port);
      }
      
      // Set global connectedPort for legacy/compatibility and ensure window.connectedPort is always in sync
      if (newDevice.port) {
        connectedPort = newDevice.port;
        window.connectedPort = newDevice.port;
      } else {
        connectedPort = null;
        window.connectedPort = null;
      }
      // Request device info for the newly active device
      console.log('🔄 Active device changed, requesting device info...');
      
      // Throttle device info requests to prevent excessive commands
      if (window._lastDeviceInfoRequest && (Date.now() - window._lastDeviceInfoRequest) < 1000) {
        console.log('🔄 Device info request throttled');
        return;
      }
      window._lastDeviceInfoRequest = Date.now();
      
      setTimeout(() => {
        if (connectedPort) {
          // Get device UID first
          requestDeviceUid(uid => {
            console.log('📱 Device UID:', uid);
            
            // Wait a moment before requesting device name to avoid command collision
            setTimeout(() => {
              if (connectedPort) {
                // Get device name from boot.py
                requestDeviceName(name => {
                  if (name && newDevice) {
                    newDevice.deviceName = name;
                    console.log('📱 Device name from boot.py:', name);
                    
                    // Update UI elements
                    if (typeof updateDeviceList === 'function') updateDeviceList();
                    if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
                    if (window.updateFooterDeviceName) window.updateFooterDeviceName();
                    
                    // Note: Device files will be loaded automatically by multiDeviceManager
                    // since ENABLE_AUTOMATIC_FILE_READING is now enabled
                  }
                });
              }
            }, 50); // Small delay to avoid command collision
          });
        }
      }, 50); // Reduced delay since we fixed the listener conflicts
    } else {
      // No active device - clear all listeners
      if (connectedPort) {
        serialListenerManager.removeAllListeners(connectedPort);
      }
      connectedPort = null;
      window.connectedPort = null;
      if (window.updateFooterDeviceName) window.updateFooterDeviceName();
    }
  });
  
  // Set initial button text
  updateToggleButtonText();
  updateTiltWaveButtonText();

  document.getElementById('reboot-to-bootsel')?.addEventListener('click', () => {
    closeConfigMenu();
    if (!connectedPort) {
      updateStatus("No controller connected", false);
      return;
    }

    // Show passcode modal
    const modal = document.getElementById('passcode-modal');
    const input = document.getElementById('passcode-input');
    const okBtn = document.getElementById('passcode-ok');
    const cancelBtn = document.getElementById('passcode-cancel');
    const errorMsg = document.getElementById('passcode-error');

    modal.style.display = 'flex';
    input.value = '';
    errorMsg.style.display = 'none';
    input.focus();

    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeyDown);
    }

    function onOk() {
      if (input.value === "6997") {
        cleanup();
        try {
          // Reset BOOTSEL detection flags before sending command
          bootselPrompted = false;
          isFlashingFirmware = false;
          
          connectedPort.write("REBOOTBOOTSEL\n");
          updateStatus("Preparing to Reflash...", false);
          
          // Force disconnect from multi-device manager to avoid interference
          setTimeout(() => {
            const activeDevice = window.multiDeviceManager?.getActiveDevice();
            if (activeDevice && window.multiDeviceManager.disconnectDevice) {
              // Use skipManualFlag=true to avoid marking as manually disconnected during firmware flash
              window.multiDeviceManager.disconnectDevice(activeDevice.id, true);
            }
          }, 2000);
          
        } catch (err) {
          console.error("❌ Failed to send reboot command:", err);
          showToast("Reboot failed ❌", 'error');
        }
      } else {
        errorMsg.style.display = 'block';
        input.focus();
      }
    }

    function onCancel() {
      cleanup();
      showToast("Reflash cancelled.", 'info');
    }

    function onKeyDown(e) {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeyDown);
  });


  function detectUnprogrammedController() {
    // Don't detect if already prompted, currently flashing
    if (bootselPrompted || isFlashingFirmware) {
      console.log("🛑 BOOTSEL detection skipped - bootselPrompted:", bootselPrompted, "isFlashingFirmware:", isFlashingFirmware);
      return;
    }
    
    // Pause multi-device scanning during BOOTSEL detection
    if (window.multiDeviceManager && window.multiDeviceManager.pauseScanning) {
      window.multiDeviceManager.pauseScanning();
    }
    
    console.log("👀 Checking for BOOTSEL volumes... bootselPrompted:", bootselPrompted, "isFlashingFirmware:", isFlashingFirmware);
    
    for (let i = 65; i <= 90; i++) {
      const driveLetter = String.fromCharCode(i);
      const infoPath = driveLetter + ':\\INFO_UF2.TXT';
      try {
        if (fs.existsSync(infoPath)) {
          const content = fs.readFileSync(infoPath, 'utf8');
          console.log(`📁 Found INFO_UF2.TXT at ${driveLetter}:\\`);
          console.log(`📄 Content preview:`, content.substring(0, 200));
          
          if (/RP2040|RPI-RP2|Board-ID.*RP2|Model.*RP2/i.test(content)) {
            console.log('✅ RP2040 BOOTSEL device detected at ' + driveLetter + ':\\');
            console.log('🚀 Setting bootselPrompted = true and calling promptFirmwareFlash');
            bootselPrompted = true;
            updateStatus('Controller detected in BOOTSEL mode', false);
            promptFirmwareFlash(driveLetter + ':\\');
            return; // Exit early when BOOTSEL device is found, don't resume scanning
          } else {
            console.log('❌ Content does not match RP2040 pattern');
          }
        }
      } catch (err) {
        console.log(`⚠️ Error accessing ${driveLetter}:\\INFO_UF2.TXT:`, err.message);
      }
    }
    
    console.log("🔍 BOOTSEL scan complete");
    
    // Resume multi-device scanning after BOOTSEL detection completes
    if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
      window.multiDeviceManager.resumeScanning();
    }
  }

  setInterval(detectUnprogrammedController, 1000); // Changed from 3000 to 1000ms for better responsiveness
  console.log("🔁 BOOTSEL detection polling set up.");

  // Debug function to manually reset BOOTSEL flags (remove after testing)
  window.resetBootselFlags = function() {
    bootselPrompted = false;
    isFlashingFirmware = false;
    console.log("🔄 BOOTSEL flags reset manually");
    if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
      window.multiDeviceManager.resumeScanning();
    }
  };

  // Debug function to manually trigger BOOTSEL detection (remove after testing)
  window.testBootselDetection = function() {
    console.log("🧪 Manual BOOTSEL detection test");
    detectUnprogrammedController();
  };

  function promptFirmwareFlash(drivePath) {
    updateStatus("Controller detected in BOOTSEL mode", false);
    console.log("✅ RP2040 detected, ready to flash...");
    customConfirm("New controller detected.\n\nWould you like to flash BumbleGum firmware?").then(confirmFlash => {
      if (confirmFlash) {
        flashFirmwareTo(drivePath);
      } else { 
        console.log("❌ Flash was cancelled or dialog failed."); 
      }
    });
  }

  function findFirmwareFile() {
    // Look for any firmware file matching bgg-fw*.uf2 pattern (with or without version)
    try {
      // First check the parent directory (project root)
      const parentDir = path.resolve(__dirname, '..');
      console.log('[findFirmwareFile] Checking parent directory:', parentDir);
      const parentFiles = fs.readdirSync(parentDir);
      const parentFirmwareFile = parentFiles.find(file => file.match(/^bgg-fw.*\.uf2$/i));
      if (parentFirmwareFile) {
        const firmwarePath = path.resolve(parentDir, parentFirmwareFile);
        console.log('[findFirmwareFile] Found firmware in parent:', firmwarePath);
        return firmwarePath;
      }
      
      // Then check the current directory (renderer folder)
      console.log('[findFirmwareFile] Checking current directory:', __dirname);
      const files = fs.readdirSync(__dirname);
      const firmwareFile = files.find(file => file.match(/^bgg-fw.*\.uf2$/i));
      if (firmwareFile) {
        const firmwarePath = path.resolve(__dirname, firmwareFile);
        console.log('[findFirmwareFile] Found firmware in renderer:', firmwarePath);
        return firmwarePath;
      }
      
      console.log('[findFirmwareFile] No firmware file found in either location');
    } catch (err) {
      console.error("Error searching for firmware file:", err);
    }
    
    // Fallback to old hardcoded name in parent directory if no pattern match found
    const fallbackPath = path.resolve(__dirname, '..', 'bgg-fw.uf2');
    console.log('[findFirmwareFile] Fallback to:', fallbackPath);
    return fallbackPath;
  }

  function flashFirmwareTo(drivePath) {
    const firmwarePath = findFirmwareFile();
    
    // Check if firmware file actually exists
    if (!fs.existsSync(firmwarePath)) {
      console.error("❌ Firmware file not found:", firmwarePath);
      showToast("Firmware file not found. Please run UF2MakerScript.ps1 to generate firmware.", 'error');
      // Reset flags on error
      isFlashingFirmware = false;
      bootselPrompted = false;
      // Resume scanning on error
      if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
        window.multiDeviceManager.resumeScanning();
      }
      return;
    }
    
    const targetPath = path.join(drivePath, path.basename(firmwarePath));
    const start = Date.now();

    updateStatus(`Flashing firmware please wait...`, false);
    console.log('Attempting to copy ' + firmwarePath + ' -> ' + targetPath);
    isFlashingFirmware = true; // Set flag during flashing

    try {
      fs.copyFile(firmwarePath, targetPath, err => {
        if (err) {
          console.error("❌ Flash error:", err);
          showToast("Flash failed ❌", "error");
          // Reset flags on error
          isFlashingFirmware = false;
          bootselPrompted = false;
          // Resume multi-device scanning
          if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
            window.multiDeviceManager.resumeScanning();
          }
          return;
        }

        const time = ((Date.now() - start) / 1000).toFixed(2);
        console.log('Firmware copied in ' + time + 's');
        showToast('Firmware flashed in ' + time + 's', 'success');

        // Reset flags after successful flash
        isFlashingFirmware = false;
        bootselPrompted = false;

        setTimeout(() => {
          updateStatus("Waiting for controller to reboot...", false);
          
          // Resume multi-device scanning after device reboots
          if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
            window.multiDeviceManager.resumeScanning();
          }
          
          detectRebootedController();
        }, 5000); // Increased from 3000 to 5000ms to give more time for device to reboot
      });
    } catch (err) {
      console.error("❌ Flash error:", err);
      showToast("Flash failed ❌", "error");
      // Reset flags on error
      isFlashingFirmware = false;
      bootselPrompted = false;
      // Resume scanning on error
      if (window.multiDeviceManager && window.multiDeviceManager.resumeScanning) {
        window.multiDeviceManager.resumeScanning();
      }
    }
  }

  function detectRebootedController() {
    console.log("🔍 Starting to detect rebooted controller after firmware flash...");
    
    // Reset flags
    isFlashingFirmware = false;
    window.rp2040Detected = false;
    bootselPrompted = false;
    
    // Clear manually disconnected flag to allow auto-reconnection after firmware flash
    if (window.multiDeviceManager && window.multiDeviceManager._manuallyDisconnectedDevices) {
      window.multiDeviceManager._manuallyDisconnectedDevices.clear();
      console.log("[detectRebootedController] Cleared manually disconnected devices to allow auto-reconnection");
    }
    
    // Start polling for the device to reappear with multi-device manager
    let attempts = 0;
    const maxAttempts = 20; // Poll for up to 10 seconds
    const pollInterval = 500; // Check every 500ms
    
    async function pollForDevice() {
      attempts++;
      console.log(`[detectRebootedController] Poll attempt ${attempts}/${maxAttempts}`);
      
      try {
        // Use multi-device manager to scan for devices
        if (window.multiDeviceManager && window.multiDeviceManager.scanForDevices) {
          await window.multiDeviceManager.scanForDevices();
          
          // Get all available devices (both connected and disconnected)
          const allDevices = window.multiDeviceManager.devices ? 
                            Array.from(window.multiDeviceManager.devices.values()) : [];
          
          const connectedDevices = allDevices.filter(d => d.isConnected);
          const availableDevices = allDevices.filter(d => !d.isConnected);
          
          console.log(`[detectRebootedController] Found ${connectedDevices.length} connected, ${availableDevices.length} available devices`);
          
          // First check if we already have a connected device
          if (connectedDevices.length > 0) {
            const device = connectedDevices[0];
            console.log("🎉 Controller already connected after firmware flash:", device.getDisplayName ? device.getDisplayName() : device.id);
            
            // Set as active device if not already
            if (window.multiDeviceManager.setActiveDevice) {
              await window.multiDeviceManager.setActiveDevice(device);
            }
            
            showToast("Controller rebooted and ready 🎉", "success");
            updateStatus("Controller reconnected successfully", true);
            
            // Update UI
            if (window.updateActiveButtonText) {
              window.updateActiveButtonText(device);
            }
            
            return; // Success - stop polling
          }
          
          // If no connected devices, try to connect to available ones
          if (availableDevices.length > 0) {
            const device = availableDevices[0];
            console.log("🔌 Attempting to connect to detected device after firmware flash:", device.getDisplayName ? device.getDisplayName() : device.id);
            
            try {
              // Force connect to the device
              if (window.multiDeviceManager.connectDevice) {
                await window.multiDeviceManager.connectDevice(device.id, false); // Suppress toast during auto-reconnection after firmware flash
                console.log("✅ Successfully connected to device after firmware flash");
                
                showToast("Controller rebooted and ready 🎉", "success");
                updateStatus("Controller reconnected successfully", true);
                
                // Update UI
                if (window.updateActiveButtonText) {
                  window.updateActiveButtonText(device);
                }
                
                return; // Success - stop polling
              }
            } catch (connectErr) {
              console.warn("⚠️ Failed to connect to device, will retry:", connectErr.message);
            }
          }
        }
        
        // Device not found yet, continue polling if we haven't exceeded max attempts
        if (attempts < maxAttempts) {
          updateStatus(`Waiting for controller... (${attempts}/${maxAttempts})`, false);
          // Use setTimeout to ensure proper timing
          setTimeout(() => {
            pollForDevice();
          }, pollInterval);
        } else {
          // Give up after max attempts
          console.warn("❌ Controller did not reconnect after firmware flash");
          showToast("Controller did not reconnect. Please unplug and replug the device.", "warning", 6000);
          updateStatus("Controller not detected - please unplug and replug", false);
        }
        
      } catch (err) {
        console.error("❌ Error during device detection poll:", err);
        if (attempts < maxAttempts) {
          setTimeout(() => {
            pollForDevice();
          }, pollInterval);
        }
      }
    }
    
    // Start polling after a short delay to let the device boot up
    setTimeout(pollForDevice, 1000);
  }

  // Function moved to global scope before use

  const colorPicker = new iro.ColorPicker("#picker-root", {
    width: 200,
    color: "#ffffff",
    layout: [
      { component: iro.ui.Wheel },
      { component: iro.ui.Slider, options: { sliderType: 'value' } }
    ]
  });
  
  // Enhance color picker with global mouse event handling
  enhanceColorPicker(colorPicker, "picker-root");
  
  const hexInput = document.getElementById("hexInput");

  // When user types a hex value
  hexInput.addEventListener("input", () => {
    const value = hexInput.value.trim();
    if (/^#?[0-9A-Fa-f]{6}$/.test(value)) {
      const hex = value.startsWith("#") ? value : `#${value}`;
      colorPicker.color.hexString = hex;

      // ✅ Trigger LED preview ONLY when sixth digit is reached
      if (hex.length === 7) { // includes the #
        // Only preview released-state buttons if UI is in released mode
        const isReleasedMode = document.querySelector('.fret-toggle-button[data-state="released"]')?.classList.contains('selected');
        if (isReleasedMode) {
          selectedElements.forEach(el => {
            let name = el.id || el.dataset.name || '';
            if (name.endsWith('-released') || name === 'strum-up' || name === 'strum-down') {
              if (window.multiDeviceManager && typeof window.multiDeviceManager.previewLed === 'function') {
                window.multiDeviceManager.previewLed(name.replace(/-(pressed|released|active)$/i, ''), hex);
              }
            }
          });
        }
      }
    }
  });

    colorPicker.on('color:change', color => {
    hexInput.value = color.hexString;
    currentPreviewColor = color;
    previewPending = true;
    isDirty = true;
    selectedElements.forEach(el => {
      const bg = color.hexString;
      const text = getTextColor(bg);
      el.style.backgroundColor = bg;
      el.style.color = text;
      liveColors.set(el, { bg, text });
    });
    checkIfUserPresetModified();
    configDirty = true;
    document.getElementById('apply-config-btn').style.display = 'inline-block';
  });
  
  // Only send PREVIEWLED on pointerup/mouseup
  pickerRoot?.addEventListener('pointerup', () => {
    const isReleasedMode = document.querySelector('.fret-toggle-button[data-state="released"]')?.classList.contains('selected');
    const isPressedMode = document.querySelector('.fret-toggle-button[data-state="pressed"]')?.classList.contains('selected');
    if (isReleasedMode) {
      selectedElements.forEach(el => {
        const data = liveColors.get(el);
        let name = el.id || el.dataset.name || '';
        if (name.endsWith('-released') || name === 'strum-up' || name === 'strum-down') {
          const bg = data?.bg || el.style.backgroundColor;
          if (bg && window.multiDeviceManager && typeof window.multiDeviceManager.previewLed === 'function') {
            window.multiDeviceManager.previewLed(name.replace(/-(pressed|released|active)$/i, ''), bg);
          }
        }
      });
    } else if (isPressedMode) {
      // Preview pressed-state buttons using deviceUI.js logic
      selectedElements.forEach(el => {
        let name = el.id || el.dataset.name || '';
        if (name.endsWith('-pressed')) {
          window.triggerPressedLedPreview(name);
        }
      });
    }
  });

  document.getElementById('preset-select')?.addEventListener('change', e => {
    try {
      const selectedKey = e.target.value;
      // --- PATCH: Always use window.presetsData, fallback to parsing window.presets if needed ---
      let presetsData = window.presetsData;
      if (!presetsData && window.presets) {
        if (typeof window.presets === 'string') {
          try {
            window.presets = JSON.parse(window.presets);
          } catch (err) {
            console.error('[preset-select] Failed to parse window.presets:', err);
            window.presets = {};
          }
        }
        presetsData = window.presets.presets || window.presets;
      }
      // Defensive: log type and keys
      console.log('[preset-select] presetsData type:', typeof presetsData, 'keys:', presetsData ? Object.keys(presetsData) : null);
      let presetObj = presetsData && presetsData[selectedKey];
      if (!presetObj || typeof presetObj !== 'object') {
        console.warn('Preset not found or invalid:', selectedKey, presetObj);
        return;
      }
      // --- PATCH: Ensure originalConfig is set if not loaded ---
      if (!originalConfig) {
        // Create a default config structure if missing
        originalConfig = {
          led_color: Array(7).fill('#ffffff'),
          released_color: Array(7).fill('#ffffff'),
          // Add other config fields as needed
        };
      }
      // Defensive: convert all color values to hex if needed (handles legacy rgb)
      const safePresetObj = Object.fromEntries(Object.entries(presetObj).map(([k, v]) => [k, v && v.startsWith('rgb') ? rgbToHex(v) : v]));
      for (const [label, hex] of Object.entries(safePresetObj)) {
        if (label.endsWith('-pressed')) {
          // Only update pressed buttons
          const pressedMatch = Array.from(document.querySelectorAll('.pressed-set .fret-button, .active-set .strum-button')).find(el =>
            el.textContent === label || el.dataset.name === label || el.id === label
          );
          if (pressedMatch) {
            pressedMatch.style.backgroundColor = hex;
            pressedMatch.style.color = getTextColor(hex);
            liveColors.set(pressedMatch, { bg: hex, text: getTextColor(hex) });
          }
        } else if (label.endsWith('-released')) {
          // Only update released buttons
          const releasedMatch = Array.from(document.querySelectorAll('.released-set .fret-button, .released-set .strum-button')).find(el =>
            el.textContent === label || el.dataset.name === label || el.id === label
          );
          if (releasedMatch) {
            releasedMatch.style.backgroundColor = hex;
            releasedMatch.style.color = getTextColor(hex);
            liveColors.set(releasedMatch, { bg: hex, text: getTextColor(hex) });
          }
        } else {
          // For strum-up-active, strum-down-active, etc., update both sets if present
          const pressedMatch = Array.from(document.querySelectorAll('.active-set .strum-button')).find(el =>
            el.textContent === label || el.dataset.name === label || el.id === label
          );
          if (pressedMatch) {
            pressedMatch.style.backgroundColor = hex;
            pressedMatch.style.color = getTextColor(hex);
            liveColors.set(pressedMatch, { bg: hex, text: getTextColor(hex) });
          }
          const releasedMatch = Array.from(document.querySelectorAll('.released-set .strum-button')).find(el =>
            el.textContent === label || el.dataset.name === label || el.id === label
          );
          if (releasedMatch) {
            releasedMatch.style.backgroundColor = hex;
            releasedMatch.style.color = getTextColor(hex);
            liveColors.set(releasedMatch, { bg: hex, text: getTextColor(hex) });
          }
        }
      }
      // --- PATCH: Update originalConfig with new preset colors ---
      // Map safePresetObj colors to the correct config arrays
      // Assume safePresetObj keys match button ids: e.g. 'orange-fret-pressed', 'orange-fret-released', etc.
      fretIndexMap.forEach((ledIndex, i) => {
        // Pressed
        const pressedKey = document.querySelectorAll('.pressed-set .fret-button')[i]?.id;
        if (pressedKey && safePresetObj[pressedKey]) {
          originalConfig.led_color[ledIndex] = safePresetObj[pressedKey];
        }
        // Released
        const releasedKey = document.querySelectorAll('.released-set .fret-button')[i]?.id;
        if (releasedKey && safePresetObj[releasedKey]) {
          originalConfig.released_color[ledIndex] = safePresetObj[releasedKey];
        }
      });
      // Strum buttons (if present in preset)
      const strumPressed = document.querySelectorAll('.active-set .strum-button');
      const strumReleased = document.querySelectorAll('.released-set .strum-button');
      strumPressed.forEach((el, i) => {
        if (el.id && safePresetObj[el.id]) {
          originalConfig.led_color[i] = safePresetObj[el.id];
        }
      });
      strumReleased.forEach((el, i) => {
        if (el.id && safePresetObj[el.id]) {
          originalConfig.released_color[i] = safePresetObj[el.id];
        }
      });
      // --- END PATCH ---
      // Always start in released state after preset load
      document.querySelectorAll('.fret-toggle-button').forEach(b => b.classList.remove('selected'));
      const releasedToggle = document.querySelector('.fret-toggle-button[data-state="released"]');
      if (releasedToggle) releasedToggle.classList.add('selected');
      document.querySelector('.pressed-set').style.display = 'none';
      document.querySelector('.released-set.fret-set').style.display = 'flex';
      document.querySelector('.active-set').style.display = 'none';
      document.querySelector('.released-set.strum-set').style.display = 'flex';
      restoreLiveColors('.released-set .fret-button');
      restoreLiveColors('.released-set .strum-button');
      // --- PATCH: Always enable Apply to Config button and set configDirty ---
      configDirty = true;
      const applyBtn = document.getElementById('apply-config-btn');
      if (applyBtn) applyBtn.style.display = 'inline-block';
    } catch (err) {
      console.warn('Invalid preset format:', err);
    }
  });


  function checkIfUserPresetModified() {
    if (!activeUserPreset) return;

    const current = collectCurrentColors();
    const changed = JSON.stringify(current) !== JSON.stringify(activeUserPreset);

    const btn = document.getElementById('save-custom-btn');
    btn.style.display = changed ? 'inline-block' : 'none';
    isDirty = changed;
    configDirty = true;
    document.getElementById('apply-config-btn').style.display = 'inline-block';

  }

  document.getElementById('user-preset-select')?.addEventListener('change', e => {
    try {
      const slot = e.target?.value;
      // --- PATCH: Always use window.userPresetsData, fallback to parsing window.userPresets if needed ---
      let userPresetsData = window.userPresetsData;
      if (!userPresetsData && window.userPresets) {
        if (typeof window.userPresets === 'string') {
          try {
            window.userPresets = JSON.parse(window.userPresets);
          } catch (err) {
            console.error('[user-preset-select] Failed to parse window.userPresets:', err);
            window.userPresets = {};
          }
        }
        userPresetsData = window.userPresets;
      }
      // Defensive: log type and keys
      console.log('[user-preset-select] userPresetsData type:', typeof userPresetsData, 'keys:', userPresetsData ? Object.keys(userPresetsData) : null);
      const preset = userPresetsData?.[slot];
      if (!preset || typeof preset !== 'object') {
        console.warn('User preset not found or invalid:', slot, preset);
        return;
      }
      // Convert all color values in preset to hex (handles legacy rgb() values)
      const rgbToHex = (rgb) => {
        if (typeof rgb !== 'string') return rgb;
        if (rgb.startsWith('#')) return rgb;
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) return rgb;
        return (
          '#' +
          [1, 2, 3]
            .map(i => parseInt(match[i], 10).toString(16).padStart(2, '0'))
            .join('')
        ).toUpperCase();
      };
      const presetHex = {};
      for (const [k, v] of Object.entries(preset)) {
        presetHex[k] = rgbToHex(v);
      }
      activeUserPreset = presetHex;
      isDirty = false;

      // Defensive: Only update color arrays, never overwrite required fields
      if (!originalConfig) {
        // Skip automatic config reading if diagnostic setup is in progress
        if (window.setupDeviceInformationInProgress) {
          console.log('[applyUserPreset] Skipping config reload - diagnostic setup in progress');
          customAlert('Diagnostic setup in progress. Please try again in a moment.');
          return;
        }
        
        // Try to reload config from device
        if (window.connectedPort) {
          updateStatus('No config loaded, reloading from device...', false);
          try {
            window.connectedPort.write("READFILE:config.json\n");
            window.awaitingFile = "config.json";
            window.responseBuffers = window.responseBuffers || {};
            window.responseBuffers[window.awaitingFile] = '';
            // Optionally, you could set a timeout to retry applying the preset after config loads
            customAlert('No configuration loaded. Reloading from device. Please try again in a moment.');
          } catch (err) {
            console.error('Failed to request config from device:', err);
            customAlert('Failed to reload configuration from device. Please reconnect your device.');
          }
        } else {
          customAlert('No configuration loaded and no device connected. Please load a preset or reconnect your device before applying a user preset.');
        }
        return;
      }
      // Only update color arrays, never overwrite the rest of the config
      const configUtils = require('./configUtils.js');
      // Deep copy to avoid accidental mutation
      const safeConfig = JSON.parse(JSON.stringify(originalConfig));
      configUtils.applyPresetToConfig(safeConfig, presetHex);
      // Copy only color arrays back to originalConfig
      if (safeConfig.led_color) originalConfig.led_color = safeConfig.led_color;
      if (safeConfig.released_color) originalConfig.released_color = safeConfig.released_color;

      const btn = document.getElementById('save-custom-btn');
      btn.style.display = 'none';

      configDirty = true;
      document.getElementById('apply-config-btn').style.display = 'inline-block';

      const slotLabel = e.target.selectedOptions[0]?.textContent.trim();
      if (btn && slotLabel && /^User \d$/.test(slotLabel)) {
        btn.textContent = `Update ${slotLabel}`;
      } else {
        btn.textContent = `Save changes`;
      }

      // Update UI colors for buttons
      for (const [label, hex] of Object.entries(presetHex)) {
        const match = document.getElementById(label);
        if (match) {
          match.style.backgroundColor = hex;
          match.style.color = getTextColor(hex);
          liveColors.set(match, { bg: hex, text: getTextColor(hex) });
        }
      }

      // Always preview released colors if released state is selected, otherwise pressed
      let state = document.querySelector('.fret-toggle-button.selected')?.dataset.state;
      if (!state) state = 'released';
      setTimeout(() => {
        console.log(`[PREVIEW] User preset select, previewing state: ${state}`);
        sendPreviewForVisibleButtons(state);
      }, 30);

    } catch (err) {
      console.warn("Failed to auto-load preset:", err);
    }
  });


  const presetSelect = document.getElementById('preset-select');
  const userPresetSelect = document.getElementById('user-preset-select');

  presetSelect?.addEventListener('change', () => {
    if (userPresetSelect) userPresetSelect.selectedIndex = 0;
    // Removed undefined bg conversion block
  });

  userPresetSelect?.addEventListener('change', () => {
    if (presetSelect) presetSelect.selectedIndex = 0;
    // Show save button if a valid user slot is selected
    const btn = document.getElementById('save-custom-btn');
    const slotLabel = userPresetSelect.selectedOptions[0]?.textContent.trim();
    if (btn && slotLabel && /^User \d$/.test(slotLabel)) {
      btn.style.display = 'inline-block';
      btn.textContent = `Update ${slotLabel}`;
    } else if (btn) {
      btn.style.display = 'none';
      btn.textContent = `Save changes`;
    }
  });


  document.querySelectorAll('.fret-button, .strum-button').forEach(button => {
    button.addEventListener('click', () => {
      if (selectedElements.includes(button)) {
        button.classList.remove('selected');
        selectedElements = selectedElements.filter(el => el !== button);
      } else {
        button.classList.add('selected');
        selectedElements.push(button);
      }

      // 🟡 Update hexInput with first selected button’s color
      if (selectedElements.length > 0) {
        const first = selectedElements[0];
        const raw = first.style.backgroundColor;
        const hex = sanitizeColor(raw || "#FFFFFF");
        hexInput.value = hex;
        colorPicker.color.hexString = hex;
      }
    });
  });


  document.getElementById('close-btn')?.addEventListener('click', () => {
    if (isDirty) {
      customConfirm("You have unsaved changes. Click 'Apply' to save them before exiting.\n\nAre you sure you want to close?").then(confirmClose => {
        if (confirmClose) {
          window.close();
        }
      });
    } else {
      window.close();
    }
  });
  document.getElementById('save-custom-btn')?.addEventListener('click', () => {
    console.log("Save button clicked");

    // ✅ Pull slot label from dropdown, not prompt
    const select = document.getElementById('user-preset-select');
    const slot = select?.selectedOptions[0]?.textContent.trim();

    // ✅ Validate slot
    const allowed = ["User 1", "User 2", "User 3", "User 4", "User 5"];
    if (!allowed.includes(slot)) {
      customAlert(`Invalid slot "${slot}". Please choose one from the dropdown.`);
      return;
    }

    // ✅ Collect data and send IMPORTUSER command (guaranteed hex colors)
    const data = collectCurrentColors();
    // Defensive: ensure all values are hex (in case of legacy data)
    Object.keys(data).forEach(k => {
      if (data[k]?.startsWith('rgb')) data[k] = rgbToHex(data[k]);
    });
    const payload = JSON.stringify({ [slot]: data });

    try {
      if (connectedPort) {
        connectedPort.write("IMPORTUSER\n");
        connectedPort.write(payload + "\n");
        connectedPort.write("END\n");
        awaitingFile = 'user_presets.json';
        responseBuffers[awaitingFile] = '';
        connectedPort.write("READFILE:user_presets.json\n");
      }
      isDirty = false;
      document.getElementById('save-custom-btn').style.display = 'none';
      activeUserPreset = collectCurrentColors(); // update reference
    } catch (err) {
      console.error("Failed to send preset data:", err);
      showToast("Save failed", 'error');
    }
  });

  const restoreLiveColors = selector => {
    document.querySelectorAll(selector).forEach(el => {
      const data = liveColors.get(el);
      if (data) {
        el.style.backgroundColor = data.bg;
        el.style.color = data.text;
      }
    });
  };

  const sendPreviewForVisibleButtons = state => {
    const fretSelector = state === 'pressed' ? '.pressed-set .fret-button' : '.released-set .fret-button';
    const strumSelector = state === 'pressed' ? '.active-set .strum-button' : '.released-set .strum-button';
    const controlSelector = state === 'pressed' ? '.active-set .control-button' : '.released-set .control-button';
    const elements = [...document.querySelectorAll(fretSelector), ...document.querySelectorAll(strumSelector), ...document.querySelectorAll(controlSelector)];

    elements.forEach((el, i) => {
      let name = el.id || el.dataset.name || el.textContent || `button-${i}`;
      let data = liveColors.get(el);
      let bg = data?.bg || el.style.backgroundColor;
      // If no color found, try fallback by label
      if ((!bg || bg === '') && liveColors.has(name)) {
        data = liveColors.get(name);
        bg = data?.bg;
      }
      // Always send preview using MultiDeviceManager
      if (window.multiDeviceManager && typeof window.multiDeviceManager.previewLed === 'function') {
        // Always send base label (e.g., green-fret) for preview
        const baseLabel = name.replace(/-(pressed|released|active)$/i, '');
        window.multiDeviceManager.previewLed(baseLabel, bg);
      }
    });
  };

  document.querySelectorAll('.fret-toggle-button').forEach(btn => {
    btn.addEventListener('pointerup', () => {
      document.querySelectorAll('.fret-toggle-button').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      clearSelections();

      const state = btn.dataset.state;

      document.querySelector('.pressed-set').style.display = state === 'pressed' ? 'flex' : 'none';
      document.querySelector('.released-set.fret-set').style.display = state === 'released' ? 'flex' : 'none';
      document.querySelector('.active-set').style.display = state === 'pressed' ? 'flex' : 'none';
      document.querySelector('.released-set.strum-set').style.display = state === 'released' ? 'flex' : 'none';

      restoreLiveColors(state === 'pressed' ? '.pressed-set .fret-button' : '.released-set .fret-button');
      restoreLiveColors(state === 'pressed' ? '.active-set .strum-button' : '.released-set .strum-button');

      // Preview correct colors for visible buttons on toggle, after DOM/UI update
      setTimeout(() => {
        sendPreviewForVisibleButtons(state);
      }, 10);
    });
  });

  if (pickerRoot) {
    pickerRoot.addEventListener('pointerup', () => {
      if (previewPending && currentPreviewColor && selectedElements.length > 0) {
        const hex = currentPreviewColor.hexString;
        const previewLines = selectedElements.map(el => {
          let name = el.id || el.dataset.name || '';
          if (name === 'strum-up-released') name = 'strum-up';
          if (name === 'strum-down-released') name = 'strum-down';
          return `PREVIEWLED:${name}:${hex}\n`;
        }).join('');

        try {
          if (connectedPort && previewLines) {
            connectedPort.write(previewLines);
          }
          checkIfUserPresetModified();
        } catch (err) {
          console.error("❌ Serial write failed:", err);
        }

        previewPending = false;
      }
    });
  }

  const clearSelections = () => {
    document.querySelectorAll('.fret-button.selected, .strum-button.selected').forEach(btn => {
      btn.classList.remove('selected');
    });
    selectedElements = [];
  };

  const findSerialDeviceByVID = vid => {
    const matchVID = vid.toString().toLowerCase().padStart(4, '0');
    console.log('🔍 Looking for device with VID:', matchVID);
    return SerialPort.list().then(ports => {
      console.log('📋 Available ports:', ports);
      const foundDevice = ports.find(port =>
        port.vendorId?.toLowerCase() === matchVID &&
        port.pnpId?.includes('MI_02')
      );
      console.log('🎯 Found matching device:', foundDevice);
      return foundDevice;
    }).catch(error => {
      console.error('❌ Error listing ports:', error);
      return null;
    });
  };

  // Function moved to global scope before use

  // Function moved to global scope before use

  function requestDeviceFirmwareVersion(callback) {
    if (!connectedPort) {
      console.log('❌ No connected port for firmware version request');
      return callback(null);
    }
    
    // Prevent multiple simultaneous requests
    if (requestDeviceFirmwareVersion.inProgress) {
      console.warn('[requestDeviceFirmwareVersion] Request already in progress, skipping duplicate');
      return callback(null);
    }
    
    requestDeviceFirmwareVersion.inProgress = true;
    
    // Skip firmware version request if file operations are in progress
    if (window.multiDeviceManager && window.multiDeviceManager._fileOperationInProgress) {
      console.log('📱 Skipping firmware version request - file operation in progress');
      requestDeviceFirmwareVersion.inProgress = false;
      return callback(null);
    }
    
    // Skip if automatic updater is currently running version detection
    if (window.automaticUpdater && window.automaticUpdater._versionDetectionInProgress) {
      console.log('📱 Skipping firmware version request - automatic updater version detection in progress');
      requestDeviceFirmwareVersion.inProgress = false;
      return callback(null);
    }
    
    console.log('📱 Using optimized READVERSION command instead of file reading');
    
    // Use the new direct command function
    requestDeviceFirmwareVersionDirect((version) => {
      requestDeviceFirmwareVersion.inProgress = false;
      console.log('✅ Got firmware version via direct command:', version);
      callback(version);
    });
    return; // Exit early since we're using the direct command
  }

  function requestDetailedFirmwareVersions(callback) {
    console.log('🔄 [requestDetailedFirmwareVersions] Using optimized READVERSION command instead of file reading');
    
    // Use the direct version command instead of reading code.py file
    requestDeviceFirmwareVersionDirect((version) => {
      if (version) {
        // Return version info in the expected format
        const versionInfo = {
          main: version,
          boot: version, // Assume same version for all components
          gamepad: version,
          hardware: version
        };
        callback(versionInfo);
      } else {
        callback(null);
      }
    });
  }

  function getAppVersion() {
    // Get app version from package.json
    try {
      const packagePath = path.join(__dirname, '..', 'package.json');
      const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return normalizeVersion(packageData.version || 'Unknown');
    } catch (err) {
      console.error("Error reading app version from package.json:", err);
      return 'Unknown';
    }
  }

  function getPresetsVersion() {
    // Get presets version from active device or default
    try {
      const activeDevice = window.multiDeviceManager?.getActiveDevice();
      if (activeDevice && activeDevice.presets) {
        // Check if presets has _metadata.version info first
        if (activeDevice.presets._metadata && activeDevice.presets._metadata.version) {
          return normalizeVersion(activeDevice.presets._metadata.version);
        }
        // Check if presets has version info at root level
        if (activeDevice.presets.version) {
          return normalizeVersion(activeDevice.presets.version);
        }
        // Fallback to counting preset entries for version indicator
        const presetsData = activeDevice.presets.presets || activeDevice.presets;
        const presetCount = Object.keys(presetsData || {}).length;
        return `${presetCount} presets loaded`;
      }
      return 'No presets loaded';
    } catch (err) {
      console.error("Error getting presets version:", err);
      return 'Unknown';
    }
  }

  function getEmbeddedFirmwareVersion() {
    // Parse version from the firmware filename (e.g., bgg-fw-v2.3.uf2 -> v2.3)
    try {
      const files = fs.readdirSync(__dirname);
      const firmwareFile = files.find(file => file.match(/^bgg-fw.*\.uf2$/i));
      if (firmwareFile) {
        // Extract version from filename pattern: bgg-fw-v2.3.uf2 -> v2.3
        const match = firmwareFile.match(/^bgg-fw-(.+)\.uf2$/i);
        if (match && match[1]) {
          return normalizeVersion(match[1]); // Normalize the version format
        }
      }
    } catch (err) {
      console.error("Error parsing firmware version from filename:", err);
    }
    
    // Fallback to static version if parsing fails
    return normalizeVersion("v3.0.1");
  }



document.getElementById('apply-config-btn')?.addEventListener('click', () => {
  // DEBUG: Start of apply-config handler
  console.log('[DEBUG][apply-config] Handler triggered');
  // Always use the current active device's port from the multi-device manager
  const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
  console.log('[DEBUG][apply-config] activeDevice:', activeDevice);
  const port = activeDevice?.port;
  console.log('[DEBUG][apply-config] port:', port);
  if (!port || !activeDevice || !activeDevice.isConnected) {
    alert('[DEBUG] No device connected or active. See console.');
    console.warn('[DEBUG][apply-config] No device connected or active:', { port, activeDevice });
    updateStatus('No device connected', false);
    customAlert('No device is currently connected or active.');
    return;
  }
  // Fallback: try to use window.originalConfig if local is missing
  if (!originalConfig && window.originalConfig) {
    alert('[DEBUG] Local originalConfig missing, using window.originalConfig');
    console.warn('[DEBUG][apply-config] Local originalConfig missing, using window.originalConfig');
    originalConfig = window.originalConfig;
  }
  if (!originalConfig) {
    alert('[DEBUG] No config loaded (originalConfig is null/undefined, even after fallback)');
    console.warn('[DEBUG][apply-config] No config loaded (originalConfig is null/undefined, even after fallback)');
    updateStatus('No config loaded', false);
    customAlert('No configuration loaded to apply.\n\nPlease load a preset, or disconnect and reconnect your device to reload the configuration from the device.');
    return;
  }

  // Modular: Use configUtils to update color arrays in config
  const configUtils = require('./configUtils.js');
  // Collect current UI colors into a preset-like object
  // Use the unified collectCurrentColors (always converts rgb to hex)
  const currentColors = collectCurrentColors();
  console.log('[DEBUG][apply-config] currentColors collected:', currentColors);
  configUtils.applyPresetToConfig(originalConfig, currentColors);
  console.log('[DEBUG][apply-config] originalConfig after applyPresetToConfig:', JSON.stringify(originalConfig, null, 2));

  // Modular: Use configUtils to validate config before writing
  const requiredFields = [
    'UP','DOWN','LEFT','RIGHT','GREEN_FRET','GREEN_FRET_led','RED_FRET','RED_FRET_led','YELLOW_FRET','YELLOW_FRET_led','BLUE_FRET','BLUE_FRET_led','ORANGE_FRET','ORANGE_FRET_led','STRUM_UP','STRUM_UP_led','STRUM_DOWN','STRUM_DOWN_led','TILT','SELECT','START','GUIDE','WHAMMY','neopixel_pin','joystick_x_pin','joystick_y_pin','hat_mode','led_brightness','whammy_min','whammy_max','whammy_reverse','tilt_wave_enabled','led_color','released_color'
  ];

  const missing = configUtils.validateConfigFields(originalConfig, requiredFields);
  if (missing) {
    alert('[DEBUG] Config validation failed, missing: ' + missing);
    console.error('[DEBUG][apply-config] Config validation failed, missing:', missing, originalConfig);
    updateStatus(`Config missing required field: ${missing}`, false);
    customAlert(`Config is missing required field: ${missing}.\n\nRestore factory defaults or reconnect your device.`);
    return;
  }

  try {
    console.log('[DEBUG][apply-config] Writing config to device:', JSON.stringify(originalConfig, null, 2));
    
    // Mark config write in multi-device manager to delay auto-reconnection
    if (window.multiDeviceManager && typeof window.multiDeviceManager.markConfigWrite === 'function') {
      window.multiDeviceManager.markConfigWrite();
    }
    
    port.write('WRITEFILE:config.json\n');
    port.write(JSON.stringify(originalConfig) + '\n');
    port.write('END\n');

    showToast('Config applied and saved ✅ (device will reboot)', 'success');
    configDirty = false;
    document.getElementById('apply-config-btn').style.display = 'none';
    console.log('[DEBUG][apply-config] Config write complete, UI updated. Device will reboot, expect disconnect.');

    // Use robust reboot and reload procedure
    setTimeout(() => {
      showToast("Device rebooting to apply configuration", 'info');
      rebootAndReload('config.json');
    }, 500);
  } catch (err) {
    console.error('[DEBUG][apply-config] Failed to apply config:', err);
    showToast('Failed to write config', 'error');
    customAlert('Failed to write config to device. See console for details.');
  }
});



  // DISABLED: Legacy connection system - now handled by multi-device system
  /*
  setInterval(() => {
    findSerialDeviceByVID(6997).then(device => {
      if (device && (!connectedPort || connectedPort.path !== device.path)) {
        connectedPort = new SerialPort({ path: device.path, baudRate: 115200 });

        connectedPort.on('open', () => {
          updateStatus('Reading config...', true);
          readQueue = initFileQueue();
          requestNextFile();
          
          // Notify multi-device system of legacy connection
          console.log('🔗 Legacy connection established, integrating with multi-device system...');
          setTimeout(() => {
            multiDeviceManager.scanForDevices().then(() => {
              // Find the device that matches this connection
              for (const [deviceId, device] of multiDeviceManager.devices) {
                if (device.portInfo.path === connectedPort.path) {
                  console.log('✅ Integrated legacy connection with multi-device system:', device.getDisplayName());
                  device.port = connectedPort;
                  device.isConnected = true;
                  multiDeviceManager.connectedDevices.set(deviceId, device);
                  multiDeviceManager.setActiveDevice(device);
                  
                  // Update UI
                  if (typeof updateDeviceList === 'function') updateDeviceList();
                  if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
                  break;
                }
              }
            });
          }, 200);
        });

        connectedPort.on('data', data => {
          const chunk = data.toString();

          if (awaitingFile) {
            responseBuffers[awaitingFile] += chunk;

            if (responseBuffers[awaitingFile].includes('END')) {
              const jsonMatch = responseBuffers[awaitingFile].match(/\{[\s\S]*\}/);
              const buffer = responseBuffers[awaitingFile];
              responseBuffers[awaitingFile] = '';

              if (!jsonMatch) {
                updateStatus(`${awaitingFile} returned no valid JSON`, false);

                if (awaitingFile === 'config.json') {
                  // Legacy auto-restore (disabled - now using multi-device system)
                  updateStatus("Config unreadable — please use 'Restore Config to Default' button", false);
                }

                awaitingFile = null;
                requestNextFile();
                return;
              }

              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (awaitingFile === 'config.json') {
                  applyConfig(parsed);
                } else if (awaitingFile === 'presets.json') {
                  // Store presets globally to access version info
                  window.loadedPresets = parsed;
                  // Always dispatch deviceFilesLoaded event with both presets and userPresets (never undefined)
                  const event = new CustomEvent('deviceFilesLoaded', {
                    detail: {
                      presets: JSON.stringify(parsed),
                      userPresets: window.loadedUserPresets ? JSON.stringify(window.loadedUserPresets) : JSON.stringify({})
                    }
                  });
                  window.dispatchEvent(event);
                  // Also update dropdown directly for legacy code
                  populatePresetDropdown(parsed, false);
                  // Update presets version in diagnostics if modal is open
                  const presetsVersionElement = document.getElementById('diag-presets-version');
                  if (presetsVersionElement) {
                    presetsVersionElement.textContent = getPresetsVersion();
                  }
                } else if (awaitingFile === 'user_presets.json') {
                  // Always dispatch deviceFilesLoaded event with both userPresets and presets (never undefined)
                  const event = new CustomEvent('deviceFilesLoaded', {
                    detail: {
                      userPresets: JSON.stringify(parsed),
                      presets: window.loadedPresets ? JSON.stringify(window.loadedPresets) : JSON.stringify({})
                    }
                  });
                  window.dispatchEvent(event);
                  // Also update dropdown directly for legacy code
                  populatePresetDropdown(parsed, true);
                }

                updateStatus(`Loaded ${awaitingFile}`, true);
              } catch (err) {
                console.warn(`Parse error in ${awaitingFile}:`, err);

                if (awaitingFile === 'config.json') {
                  // Legacy auto-restore (disabled - now using multi-device system)
                  updateStatus("Config corrupted — please use 'Restore Config to Default' button", false);
                } else {
                  updateStatus(`Error parsing ${awaitingFile}`, false);
                }
              }

              awaitingFile = null;
              requestNextFile();
            }
          }

        });

        connectedPort.on('error', err => {
          console.error('Serial error:', err);
          updateStatus('Serial error', false);
          connectedPort = null;
          
          // Update footer on error
          const footerDeviceName = document.getElementById('footer-device-name');
          if (footerDeviceName) {
            footerDeviceName.textContent = 'Connection error';
            footerDeviceName.style.color = '#ff4136'; // Red for error
          }
          
          // Notify multi-device system of disconnection
          if (multiDeviceManager.activeDevice) {
            multiDeviceManager.setActiveDevice(null);
            if (typeof updateDeviceList === 'function') updateDeviceList();
            if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
          }
        });
      } else if (!device) {
        // Only update status if BOOTSEL detection hasn’t happened
        if (!bootselPrompted) {
          updateStatus('Disconnected');
          connectedPort = null;
          
          // Update footer on disconnection
          if (window.updateFooterDeviceName) window.updateFooterDeviceName();
          
          // Notify multi-device system of disconnection
          if (multiDeviceManager.activeDevice) {
            multiDeviceManager.setActiveDevice(null);
            if (typeof updateDeviceList === 'function') updateDeviceList();
            if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
          }
        }
      }

    });
  }, 2000);
  */
  
  // ✅ Restore Config to Default
  document.getElementById('restore-default-btn')?.addEventListener('click', async () => {
    closeConfigMenu();
    
    const activeDevice = multiDeviceManager.getActiveDevice();
    if (!activeDevice || !activeDevice.port || !activeDevice.port.isOpen) {
      updateStatus("Device not connected", false);
      showToast("No device connected", 'error');
      return;
    }

    try {
      updateStatus("Restoring config to factory default...", true);
      showToast("Reading factory config...", 'info');
      
      // Use the proper file I/O system to read factory config
      await multiDeviceManager.pauseScanningDuringOperation(async () => {
        await multiDeviceManager.flushSerialBuffer(activeDevice.port);
        
        const factoryConfig = await serialFileIO.readFile(activeDevice.port, 'factory_config.json', 8000);
        console.log('[Restore] Factory config read:', factoryConfig);
        
        let parsedConfig;
        try {
          parsedConfig = JSON.parse(factoryConfig);
        } catch (parseErr) {
          console.error('[Restore] Failed to parse factory config:', parseErr);
          throw new Error('Invalid factory config format');
        }
        
        // Apply the factory config to the UI immediately (so user sees the change)
        applyConfig(parsedConfig);
        
        // Write the factory config as the new config.json
        await serialFileIO.writeFile(activeDevice.port, 'config.json', JSON.stringify(parsedConfig), 8000);
        
        console.log('[Restore] Factory config written successfully. Starting reboot and reload...');
        
        showToast("Factory config restored - rebooting device...", 'info');
        updateStatus("Factory config restored - rebooting...", true);
      });
      
      // Use the proper rebootAndReload function to handle device restart and file reload
      await rebootAndReload('config.json');
      
      console.log('[Restore] Reboot and reload completed successfully');
      showToast("Factory config restored successfully ✅", 'success');
      updateStatus("Factory config restored successfully", true);
      
    } catch (err) {
      console.error("Failed to restore factory config:", err);
      showToast(`Restore failed: ${err.message}`, 'error');
      updateStatus("Restore failed", false);
    }
  });

  document.getElementById('toggle-hat-mode-btn')?.addEventListener('click', () => {
    closeConfigMenu();
    if (!connectedPort || !originalConfig) {
      updateStatus("Device not connected or config missing", false);
      return;
    }

    // Toggle hat_mode
    const current = originalConfig.hat_mode || "joystick";
    const next = current === "joystick" ? "dpad" : "joystick";
    originalConfig.hat_mode = next;

    try {
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      showToast(`Switched hat_mode to ${next} ✅`, 'success');
      
      // Update button text immediately
      updateToggleButtonText();
      
      // Reboot device to apply hat_mode change
      setTimeout(() => {
        showToast("Device rebooting to apply hat_mode change", 'info');
        rebootAndReload('config.json');
      }, 500);
    } catch (err) {
      console.error("Failed to toggle hat_mode:", err);
      showToast("Toggle failed", "error");
    }
  });

  document.getElementById('toggle-tilt-wave-btn')?.addEventListener('click', () => {
    closeConfigMenu();
    if (!connectedPort || !originalConfig) {
      updateStatus("Device not connected or config missing", false);
      return;
    }

    // Toggle tilt_wave_enabled
    const current = originalConfig.tilt_wave_enabled || false;
    const next = !current;

    try {
      // Update config directly without demo
      originalConfig.tilt_wave_enabled = next;
      
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      
      showToast(`Tilt wave effect ${next ? 'enabled' : 'disabled'} ✅`, 'success');
      updateTiltWaveButtonText();
      
      // Reboot device to apply tilt wave change
      setTimeout(() => {
        showToast("Device rebooting to apply tilt wave change", 'info');
        rebootAndReload('config.json');
      }, 500);
    } catch (err) {
      console.error("Failed to toggle tilt wave:", err);
      showToast("Toggle failed", "error");
    }
  });

  // Trigger Tilt Wave for demo purposes
  document.getElementById('trigger-tilt-wave-btn')?.addEventListener('click', () => {
    closeConfigMenu();
    if (!connectedPort) {
      updateStatus("Device not connected", false);
      return;
    }

    try {
      // Send the TILTWAVE command to manually trigger the effect
      connectedPort.write("TILTWAVE\n");
      showToast("Tilt wave effect triggered! 🌊", 'success');
    } catch (err) {
      console.error("Failed to trigger tilt wave:", err);
      showToast("Failed to trigger tilt wave", 'error');
    }
  });

  const releasedToggle = document.querySelector('.fret-toggle-button[data-state="released"]');
  if (releasedToggle) {
    releasedToggle.classList.add('selected');
    releasedToggle.dispatchEvent(new PointerEvent('pointerup'));
  }

  // Toggle the pop-up menu
  const toggle = document.getElementById('config-menu-toggle');
  const menu = document.getElementById('config-menu');

  toggle?.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });

  // Close menu when clicking outside
  document.addEventListener('click', e => {
    const toggle = document.getElementById('config-menu-toggle');
    const menu = document.getElementById('config-menu');
    if (!toggle.contains(e.target) && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  document.getElementById('upload-presets-btn')?.addEventListener('click', () => {
    closeConfigMenu();
    document.getElementById('presets-file-input').click();
  });

  document.getElementById('presets-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
      console.log('[UPLOAD PRESETS] No file selected.');
      return;
    }

    try {
      console.log('[UPLOAD PRESETS] Reading file:', file.name);
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
        console.log('[UPLOAD PRESETS] Parsed JSON:', parsed);
      } catch (err) {
        console.error('[UPLOAD PRESETS] Invalid JSON:', err);
        customAlert("Invalid JSON format. Please select a valid presets.json file.");
        return;
      }

      // Basic validation: must be an object with at least one preset
      if (typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
        console.error('[UPLOAD PRESETS] Invalid presets file: not a non-empty object.');
        customAlert("Invalid presets file: must be a non-empty JSON object.");
        return;
      }

      const REQUIRED_KEYS = [
        "green-fret-pressed", "red-fret-pressed", "yellow-fret-pressed", "blue-fret-pressed", "orange-fret-pressed",
        "green-fret-released", "red-fret-released", "yellow-fret-released", "blue-fret-released", "orange-fret-released",
        "strum-up-active", "strum-down-active", "strum-up-released", "strum-down-released"
      ];

      function isValidHex(val) {
        return typeof val === "string" && /^#[0-9A-Fa-f]{6}$/.test(val);
      }

      // Handle both old and new presets format
      const presetsData = parsed.presets || parsed;
      const presetKeys = Object.keys(presetsData);
      const hasValidPreset = presetKeys.some(key => {
        const preset = presetsData[key];
        if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return false;
        // Must have all required keys
        if (!REQUIRED_KEYS.every(k => k in preset)) return false;
        // All values must be valid hex color strings
        return Object.values(preset).every(isValidHex);
      });

      if (!hasValidPreset) {
        console.error('[UPLOAD PRESETS] No valid preset found in file.');
        customAlert("Invalid presets file: must contain at least one valid preset with all required keys and hex color values.");
        return;
      }

      // If valid, send to device
      if (connectedPort) {
        console.log('[UPLOAD PRESETS] Writing to device...');
        
        // Show upload progress popover
        showPresetUploadPopover();
        
        // Safety timeout to hide popover if upload takes too long (30 seconds)
        const uploadTimeout = setTimeout(() => {
          console.warn('[UPLOAD PRESETS] Upload timeout reached, hiding popover');
          hidePresetUploadPopover();
        }, 30000);
        
        // Attach data handler BEFORE sending END to avoid missing response
        let buffer = '';
        let rebooted = false;
        const onData = (data) => {
          const chunk = data.toString();
          buffer += chunk;
          console.log('[UPLOAD PRESETS] Device response chunk:', chunk);
          // Accept either END or file write confirmation as success
          if (!rebooted && (buffer.includes('END') || /file\s*\/presets\.json\s*written/i.test(buffer) || /presets\.json\s*written/i.test(chunk) || /presets\.json\s*saved/i.test(chunk) || /presets\.json\s*ok/i.test(chunk))) {
            rebooted = true;
            connectedPort.off('data', onData);
            clearTimeout(uploadTimeout);
            hidePresetUploadPopover();
            showToast("Presets file uploaded and saved ✅", 'success');
            populatePresetDropdown(parsed, false);
            setTimeout(() => {
              rebootAndReload('presets.json');
            }, 500);
          }
        };
        connectedPort.on('data', onData);
        // Write file in order, flush after each
        connectedPort.write("WRITEFILE:presets.json\n", err => {
          if (err) {
            console.error('[UPLOAD PRESETS] Error sending WRITEFILE:', err);
            clearTimeout(uploadTimeout);
            hidePresetUploadPopover();
            return;
          }
          console.log('[UPLOAD PRESETS] Sent WRITEFILE:presets.json');
          const jsonString = JSON.stringify(parsed) + "\n";
          connectedPort.write(jsonString, err2 => {
            if (err2) {
              console.error('[UPLOAD PRESETS] Error sending JSON:', err2);
              clearTimeout(uploadTimeout);
              hidePresetUploadPopover();
              return;
            }
            console.log('[UPLOAD PRESETS] Sent JSON:', jsonString);
            connectedPort.write("END\n", err3 => {
              if (err3) {
                console.error('[UPLOAD PRESETS] Error sending END:', err3);
                clearTimeout(uploadTimeout);
                hidePresetUploadPopover();
              } else {
                console.log('[UPLOAD PRESETS] Sent END, waiting for device confirmation...');
              }
            });
          });
        });
      } else {
        console.error('[UPLOAD PRESETS] No device connected (connectedPort is null).');
        customAlert('No device connected. Please connect a device before uploading presets.');
      }
    } catch (err) {
      console.error('[UPLOAD PRESETS] Exception:', err);
      hidePresetUploadPopover();
      customAlert("Failed to upload presets file: " + err.message);
    }
  });

  document.getElementById('download-presets-btn')?.addEventListener('click', async () => {
    closeConfigMenu();
    if (!connectedPort) {
      customAlert("No device connected.");
      return;
    }

    try {
      // Request the file from the device
      connectedPort.write("READFILE:presets.json\n");
      let buffer = '';
      let timeout;

      // Listen for data
      const onData = (data) => {
        buffer += data.toString();
        if (buffer.includes('END')) {
          connectedPort.off('data', onData);
          clearTimeout(timeout);

          const match = buffer.match(/\{[\s\S]*\}/);
          if (!match) {
            customAlert("Failed to download: No valid JSON found.");
            return;
          }
          const json = match[0];

          // Save to disk
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);

          // Create a temporary link to trigger download
          const a = document.createElement('a');
          a.href = url;
          a.download = "presets.json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          // Only show status after cleanup
          setTimeout(() => {
            showToast("Presets file downloaded ✅", 'success');
          }, 100);
        }
      };

      connectedPort.on('data', onData);

      // Timeout in case device doesn't respond
      timeout = setTimeout(() => {
        connectedPort.off('data', onData);
        customAlert("Timed out waiting for device.");
      }, 5000);

    } catch (err) {
      customAlert("Failed to download presets file: " + err.message);
    }
  });

  document.getElementById('rename-device-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    const applyBtn = document.getElementById('rename-apply');
    const cancelBtn = document.getElementById('rename-cancel');
    const errorMsg = document.getElementById('rename-error');

    modal.style.display = 'flex';
    input.value = '';
    errorMsg.style.display = 'none';
    input.focus();

    function cleanup() {
      modal.style.display = 'none';
      applyBtn.removeEventListener('click', onApply);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeyDown);
    }

    function validateName(name) {
      return name && name.length >= 3 && /^[\w\s\-]+$/.test(name);
    }

    function onApply() {
      const newName = input.value.trim();
      if (!validateName(newName)) {
        errorMsg.textContent = "Name must be at least 3 characters and contain only letters, numbers, spaces, or dashes.";
        errorMsg.style.display = 'block';
        input.focus();
        return;
      }
      cleanup();
      updateDeviceName(newName);
    }

    function onCancel() {
      cleanup();
    }

    function onKeyDown(e) {
      if (e.key === "Enter") onApply();
      if (e.key === "Escape") onCancel();
    }

    applyBtn.addEventListener('click', onApply);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeyDown);
  });

  async function getDeviceUid() {
    return new Promise(resolve => {
      requestDeviceUid(uid => resolve(uid));
    });
  }

  async function updateDeviceName(newName) {
    const activeDevice = multiDeviceManager.getActiveDevice();
    if (!activeDevice || !activeDevice.port || !activeDevice.port.isOpen) {
      showToast('No active device connected', 'error');
      return;
    }
    
    const fullName = `BumbleGum Guitars - ${newName}`;
    
    // Set global flag to prevent status overrides during rename
    window._renameInProgress = true;
    
    // Set both status and button to "Please wait..." during rename operation - use direct DOM manipulation
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = 'Please wait...';
      statusText.style.color = '#f39c12'; // Orange
    }
    
    const selectorBtn = document.getElementById('deviceSelectorButton');
    if (selectorBtn) {
      selectorBtn.textContent = 'Please wait...';
      selectorBtn.style.background = '#f39c12'; // Orange
      selectorBtn.style.color = '#fff';
    }
    showToast(`Updating device name to "${newName}"...`, 'info');

    // Use pauseScanningDuringOperation to prevent conflicts
    return await multiDeviceManager.pauseScanningDuringOperation(async () => {
      try {
        console.log(`[updateDeviceName] Starting device rename process for "${newName}"`);
        
        // 0. Clear all pending states and stop any ongoing polling
        console.log(`[updateDeviceName] Clearing serial buffer and stopping polling...`);
        await multiDeviceManager.flushSerialBuffer(activeDevice.port);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Longer wait to let device settle
        
        // Stop any running FIRMWARE_READY polling to prevent interference
        if (window.devicePollingInterval) {
          clearInterval(window.devicePollingInterval);
          window.devicePollingInterval = null;
          console.log(`[updateDeviceName] Stopped device polling during rename`);
        }

        // 1. Delete registry entry (no elevation)
        const uidHex = await getDeviceUid();
        const pid = getUniquePid(uidHex);
        const powershellCmd = `powershell -Command "Get-ChildItem 'HKCU:\\System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\Joystick\\OEM' | Where-Object { $_.Name -like '*${pid}*' } | ForEach-Object { Remove-Item $_.PsPath -Force }"`;
        exec(powershellCmd, (err, stdout, stderr) => {
          if (err) {
            console.warn('Registry delete failed:', err);
          } else {
            console.log('Registry entry deleted:', stdout);
          }
        });

        // 2. Read current boot.py using serialFileIO with extended timeout
        console.log(`[updateDeviceName] Reading current boot.py...`);
        await multiDeviceManager.flushSerialBuffer(activeDevice.port);
        await new Promise(resolve => setTimeout(resolve, 800)); // Longer wait for buffer to clear
        // Use a much longer timeout for boot.py since it's a large file (~13KB)
        let bootPy = await serialFileIO.readFile(activeDevice.port, 'boot.py', 45000); // 45 second timeout for read
        
        // DEBUG: Log the length and first/last parts of the file to verify complete read
        console.log(`[updateDeviceName] Read boot.py - Length: ${bootPy.length} characters`);
        console.log(`[updateDeviceName] First 200 chars:`, bootPy.substring(0, 200));
        console.log(`[updateDeviceName] Last 200 chars:`, bootPy.substring(bootPy.length - 200));
        
        // Verify we have the complete file by checking for key markers
        if (!bootPy.includes('__version__') || !bootPy.includes('print(f"BGG Guitar Controller v{__version__} boot complete!")')) {
          console.warn(`[updateDeviceName] WARNING: boot.py appears incomplete!`);
          console.warn(`[updateDeviceName] Contains version: ${bootPy.includes('__version__')}`);
          console.warn(`[updateDeviceName] Contains final print: ${bootPy.includes('print(f"BGG Guitar Controller v{__version__} boot complete!")')}`);
          throw new Error('boot.py file appears to be incomplete - aborting rename to prevent corruption');
        }
      
        // 3. Update the device name in boot.py content
        console.log(`[updateDeviceName] Updating device name in boot.py content...`);
        // Handle multiline supervisor.set_usb_identification() calls
        bootPy = bootPy.replace(/(product\s*=\s*)"[^"]*"/, `$1"${fullName}"`);
        bootPy = bootPy.replace(/(usb_hid\.set_interface_name\(\s*)"[^"]*"(\s*\))/, `$1"${fullName}"$2`);
        
        // Verify the replacements were successful
        if (!bootPy.includes(`product="${fullName}"`)) {
          throw new Error('Failed to update product name in boot.py');
        }
        if (!bootPy.includes(`usb_hid.set_interface_name("${fullName}")`)) {
          throw new Error('Failed to update USB interface name in boot.py');
        }
        
        // DEBUG: Verify the file is still complete after modifications
        console.log(`[updateDeviceName] After modification - Length: ${bootPy.length} characters`);
        if (!bootPy.includes('__version__') || !bootPy.includes('print(f"BGG Guitar Controller v{__version__} boot complete!")')) {
          console.error(`[updateDeviceName] ERROR: boot.py became corrupted during modification!`);
          throw new Error('boot.py file became corrupted during name replacement - aborting');
        }
        
        console.log(`[updateDeviceName] boot.py content updated successfully`);

        // 4. Write updated boot.py using serialFileIO with proper timeout and error handling
        await multiDeviceManager.flushSerialBuffer(activeDevice.port);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for buffer to clear
        console.log(`[updateDeviceName] Starting boot.py write operation...`);
        
        try {
          // Use longer timeout for boot.py write since it's a critical system file and large
          console.log(`[updateDeviceName] Starting boot.py write operation...`);
          await serialFileIO.writeFile(activeDevice.port, 'boot.py', bootPy, 30000); // 30 second timeout
          console.log(`[updateDeviceName] boot.py write completed successfully`);
        } catch (writeError) {
          console.error(`[updateDeviceName] boot.py write failed:`, writeError);
          showToast(`Failed to write boot.py: ${writeError.message}`, 'error');
          throw writeError;
        }      
        
        console.log("✅ boot.py write completed! Device rename successful.");
        showToast(`Device renamed to "${newName}" successfully!`, 'success');
        
        // Update stored device info with new name before reboot for auto-reconnection
        if (multiDeviceManager.lastActiveDeviceInfo) {
          multiDeviceManager.lastActiveDeviceInfo.deviceName = fullName;
          console.log('📝 Updated stored device info with new name for auto-reconnection:', fullName);
        }
        
        // Clear the rename flag before reboot
        window._renameInProgress = false;
        
        // CircuitPython will automatically reboot when boot.py is written
        // Use the global rebootAndReload function for proper reconnection after a longer delay
        setTimeout(() => {
          rebootAndReload();
        }, 2000); // Longer delay to account for CircuitPython's automatic reboot
        
      } catch (error) {
        console.error('Error updating device name:', error);
        showToast(`Failed to rename device: ${error.message}`, 'error');
        
        // Clear the rename flag on error
        window._renameInProgress = false;
        
        // Restore status and button after error
        if (typeof window.updateHeaderStatus === 'function') {
          window.updateHeaderStatus(activeDevice);
        }
        if (typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(activeDevice);
        }
        
        // Restart device polling if it was stopped
        if (window.multiDeviceManager && typeof window.multiDeviceManager.resumeScanning === 'function') {
          window.multiDeviceManager.resumeScanning();
        }
      }
    }); // End of pauseScanningDuringOperation
  }
  function getUniquePid(uidHex) {
    // uidHex should be a hex string, e.g. "50436360186D611C"
    const last4 = uidHex.slice(-4); // last 2 bytes (4 hex chars)
    return "PID_" + last4.toUpperCase();
  }

  function normalize(str) {
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

// --- PATCH: Robust device disconnect/reconnect and LED preview logic ---
// Listen for device disconnect/reconnect events from multiDeviceManager
if (window.multiDeviceManager) {
  window.multiDeviceManager.on('deviceDisconnected', (device) => {
    // Disable UI and show disconnected state
    // Removed status update - device selector button provides status
    if (window.updateFooterDeviceName) window.updateFooterDeviceName();
    // Optionally, disable config controls here
    const applyBtn = document.getElementById('apply-config-btn');
    if (applyBtn) applyBtn.disabled = true;
  });
  window.multiDeviceManager.on('deviceConnected', (device) => {
    // Re-enable UI and show connected state
    // Removed status update - device selector button provides status
    if (window.updateFooterDeviceName) window.updateFooterDeviceName();
    // Optionally, re-enable config controls here
    const applyBtn = document.getElementById('apply-config-btn');
    if (applyBtn) applyBtn.disabled = false;
    // Always preview LEDs after reconnect
    if (typeof previewAllLeds === 'function') previewAllLeds();
  });
}

// Apply button enabling and LED preview functionality moved to deviceUI.js applyConfig

  // Button Config Modal logic
  window.addEventListener('DOMContentLoaded', function() {
    // --- Pin Discover Modal ---
    // Add modal HTML if not present
    let discoverModal = document.getElementById('discover-modal');
    if (!discoverModal) {
      discoverModal = document.createElement('div');
      discoverModal.id = 'discover-modal';
      discoverModal.style.position = 'fixed';
      discoverModal.style.top = '0';
      discoverModal.style.left = '0';
      discoverModal.style.width = '100vw';
      discoverModal.style.height = '100vh';
      discoverModal.style.background = 'rgba(30,30,30,0.85)'; // match other modals
      discoverModal.style.display = 'none';
      discoverModal.style.zIndex = '9999';
      discoverModal.style.justifyContent = 'center';
      discoverModal.style.alignItems = 'center';
      discoverModal.innerHTML = `
        <div style="background:#222;color:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 2px 16px #0003;min-width:320px;text-align:center;">
          <h2 style="margin-bottom:16px;">Discover Pin</h2>
          <div id="discover-modal-msg" style="font-size:1.1em;margin-bottom:18px;">Press the desired button on your controller now...</div>
          <div style="font-size:0.98em;color:#ffd966;margin-bottom:18px;">Lay the device flat before starting detection to avoid false positives from the tilt sensor.</div>
          <button id="discover-modal-cancel" style="margin-top:8px;background:#444;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;">Cancel</button>
        </div>
      `;
      document.body.appendChild(discoverModal);
    }

    function showDiscoverModal(msg = "Press the desired button on your controller now...") {
      discoverModal.style.display = 'flex';
      document.getElementById('discover-modal-msg').textContent = msg;
    }
    function hideDiscoverModal() {
      discoverModal.style.display = 'none';
    }
    document.getElementById('discover-modal-cancel').onclick = hideDiscoverModal;

    function handleDiscoverClick(e) {
      const btn = e.target.closest('.discover-btn');
      if (!btn || !connectedPort) return;
      const key = btn.getAttribute('data-key');
      // Look for pin input in both table bodies
      const pinInput = document.querySelector(`#button-config-table-left .pin-input[data-key='${key}'], #button-config-table-right .pin-input[data-key='${key}']`);
      let countdown = 10;
      let countdownInterval;
      function updateCountdown(msg) {
        showDiscoverModal(`${msg}\n(${countdown}s left)`);
      }
      updateCountdown("Press the desired button on your controller now...");
      connectedPort.write(`DETECTPIN:${key}\n`);
      let resolved = false;
      countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          updateCountdown("Press the desired button on your controller now...");
        } else {
          clearInterval(countdownInterval);
        }
      }, 1000);
      function cleanupModal() {
        clearInterval(countdownInterval);
        hideDiscoverModal();
      }
      function onDetectData(data) {
        const str = data.toString();
        // Firmware sends PINDETECT:START:<key>
        if (str.includes(`PINDETECT:START:${key}`)) {
          updateCountdown("Press the desired button on your controller now...");
        }
        // Firmware sends PINDETECT:DETECTED:<key>:<pin>
        const detectedMatch = str.match(new RegExp(`PINDETECT:DETECTED:${key}:([A-Za-z0-9_]+)`));
        if (detectedMatch && pinInput && !resolved) {
          pinInput.value = detectedMatch[1];
          // Trigger input event to ensure all validation and change handlers fire
          pinInput.dispatchEvent(new Event('input', { bubbles: true }));
          if (typeof window.validatePins === 'function') window.validatePins();
          cleanupModal();
          connectedPort.off('data', onDetectData);
          resolved = true;
          return;
        }
        // Firmware sends PINDETECT:NONE:<key>
        if (str.includes(`PINDETECT:NONE:${key}`) && !resolved) {
          pinInput.value = '';
          showDiscoverModal("No pin press detected. Please try again.");
          setTimeout(() => {
            cleanupModal();
          }, 1800);
          connectedPort.off('data', onDetectData);
          resolved = true;
          return;
        }
      }
      connectedPort.on('data', onDetectData);
      // Cancel button should also remove listener and clear field
      document.getElementById('discover-modal-cancel').onclick = function() {
        cleanupModal();
        if (pinInput) pinInput.value = '';
        connectedPort.off('data', onDetectData);
        resolved = true;
      };
    }

    const buttonConfigBtn = document.getElementById('button-config-btn');
    const buttonConfigModal = document.getElementById('button-config-modal');
    // Remove reference to bottom cancel button
    // const buttonConfigCancel = document.getElementById('button-config-cancel');
    const buttonInputs = [
      { name: 'Green Fret', key: 'GREEN_FRET' },
      { name: 'Red Fret', key: 'RED_FRET' },
      { name: 'Yellow Fret', key: 'YELLOW_FRET' },
      { name: 'Blue Fret', key: 'BLUE_FRET' },
      { name: 'Orange Fret', key: 'ORANGE_FRET' },
      { name: 'Strum Up', key: 'STRUM_UP' },
      { name: 'Strum Down', key: 'STRUM_DOWN' },
      { name: 'Start', key: 'START' },
      { name: 'Select', key: 'SELECT' },
      { name: 'Guide*', key: 'GUIDE', tooltip: 'Not available on all devices' },
      { name: 'Tilt', key: 'TILT' },
      { name: 'Up', key: 'UP' },
      { name: 'Down', key: 'DOWN' },
      { name: 'Left', key: 'LEFT' },
      { name: 'Right', key: 'RIGHT' }
    ];

    function createButtonConfigRow(input, config, includeLed = false) {
      const pin = config[input.key] || '';
      const ledIndex = config[input.key + '_led'] ?? '';
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #444';
      
      const nameCell = input.tooltip 
        ? `<td class="tooltip-cell" style="text-align:center;vertical-align:middle;padding:6px;font-size:0.9em;border:1px solid #444;cursor:help;position:relative;" title="${input.tooltip}">${input.name}</td>`
        : `<td style="text-align:center;vertical-align:middle;padding:6px;font-size:0.9em;border:1px solid #444;">${input.name}</td>`;
      
      const pinCell = `<td style="text-align:center;vertical-align:middle;padding:6px;border:1px solid #444;">
        <div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;">
          <input type="text" class="pin-input" data-key="${input.key}" value="${pin}" style="width:50px;text-align:center;padding:3px 5px;font-size:0.8em;border-radius:3px;border:1px solid #ccc;background:#fff;" />
          <button class="discover-btn" data-key="${input.key}" style="padding:3px 6px;font-size:0.75em;border-radius:3px;border:none;background:#444;color:#ffcc00;cursor:pointer;transition:background 0.2s;">Detect</button>
          <span class="pin-status-box" data-key="${input.key}" style="display:inline-block;width:14px;height:14px;border-radius:2px;border:1px solid #ffe066;background:#111;margin-left:3px;vertical-align:middle;"></span>
        </div>
      </td>`;
      
      if (includeLed) {
        const ledCell = `<td style="text-align:center;vertical-align:middle;padding:6px;border:1px solid #444;">
          <input type="text" class="led-input" data-key="${input.key}_led" value="${ledIndex}" style="width:40px;text-align:center;padding:3px 5px;font-size:0.8em;border-radius:3px;border:1px solid #ccc;background:#fff;" />
        </td>`;
        row.innerHTML = nameCell + pinCell + ledCell;
      } else {
        row.innerHTML = nameCell + pinCell;
      }
      
      return row;
    }

    function populateButtonConfigTable(config) {
      console.log('populateButtonConfigTable called with config:', config);
      
      // Query elements dynamically each time
      const buttonConfigTableLeftBody = document.querySelector('#button-config-table-left');
      const buttonConfigTableRightBody = document.querySelector('#button-config-table-right');
      const modalFooter = buttonConfigModal.querySelector('div[style*="justify-content:center"]');
      
      console.log('buttonConfigTableLeftBody:', buttonConfigTableLeftBody);
      console.log('buttonConfigTableRightBody:', buttonConfigTableRightBody);
      
      if (!buttonConfigTableLeftBody || !buttonConfigTableRightBody) {
        console.error('Table bodies not found!');
        return;
      }
      
      if (!config) {
        console.log('No config provided, using empty config');
        config = {};
      }
      
      buttonConfigTableLeftBody.innerHTML = '';
      buttonConfigTableRightBody.innerHTML = '';
      
      // Split inputs: Frets & Strum on left, everything else on right with Guide at bottom
      const leftInputs = buttonInputs.filter(input => 
        input.key.includes('FRET') || input.key.includes('STRUM')
      );
      
      const rightInputs = buttonInputs.filter(input => 
        !input.key.includes('FRET') && !input.key.includes('STRUM')
      );
      
      // Sort right inputs to put Guide at the bottom
      const rightInputsSorted = rightInputs.filter(input => input.key !== 'GUIDE')
        .concat(rightInputs.filter(input => input.key === 'GUIDE'));
      
      // Populate left table (Frets & Strum with LED column)
      leftInputs.forEach(input => {
        const row = createButtonConfigRow(input, config, true); // Include LED column
        buttonConfigTableLeftBody.appendChild(row);
      });
      
      // Populate right table (Other controls without LED column)
      rightInputsSorted.forEach(input => {
        const row = createButtonConfigRow(input, config, false); // No LED column
        buttonConfigTableRightBody.appendChild(row);
      });
      
      // Attach event listeners for all detect buttons in both tables
      document.querySelectorAll('.discover-btn').forEach(btn => {
        btn.addEventListener('click', handleDiscoverClick);
      });
      
      // Attach input filter for LED Index fields (only allow 0-6) - only for left table
      document.querySelectorAll('#button-config-table-left .led-input').forEach(input => {
        input.addEventListener('input', function(e) {
          // Remove non-digit characters
          let val = input.value.replace(/[^0-9]/g, '');
          // Clamp to 0-6
          if (val !== '' && (isNaN(val) || Number(val) < 0 || Number(val) > 6)) {
            val = '';
          }
          input.value = val;
        });
      });
      
      // Add validation event listeners for manual input
      document.querySelectorAll('.pin-input').forEach(input => {
        input.addEventListener('input', () => {
          // Find validatePins function if it exists in scope
          if (typeof validatePins === 'function') {
            validatePins();
          }
        });
      });
      
      // Add validation event listeners for LED Index input (only left table)
      document.querySelectorAll('#button-config-table-left .led-input').forEach(input => {
        input.addEventListener('input', () => {
          // Find validatePins function if it exists in scope
          if (typeof validatePins === 'function') {
            validatePins();
          }
        });
      });

      // Get the existing modal buttons from HTML
      const modalCancelBtn = document.getElementById('button-config-cancel');
      const modalApplyBtn = document.getElementById('button-config-apply');
      
      // --- Validation Logic ---
      function validatePins() {
        const pinInputs = Array.from(document.querySelectorAll('#button-config-table-left .pin-input, #button-config-table-right .pin-input'));
        const pins = pinInputs.map(input => input.value.trim());
        const hasEmptyPin = pins.some(pin => pin === '');
        const pinCounts = pins.reduce((acc, pin) => {
          if (pin) acc[pin] = (acc[pin] || 0) + 1;
          return acc;
        }, {});
        let hasDuplicatePin = false;
        pinInputs.forEach((input, idx) => {
          const pin = pins[idx];
          // Remove previous error styles
          input.style.border = '';
          input.style.background = '';
          if (!pin) {
            input.style.border = '2px solid #d00';
            input.style.background = '#ffeaea';
          } else if (pinCounts[pin] > 1) {
            input.style.border = '2px solid #d00';
            input.style.background = '#ffeaea';
            hasDuplicatePin = true;
          }
        });

        // LED Index validation (only for left table - frets and strum)
        const ledInputs = Array.from(document.querySelectorAll('#button-config-table-left .led-input'));
        const ledVals = ledInputs.map(input => input.value.trim()).filter(val => val !== '');
        const ledCounts = ledVals.reduce((acc, val) => {
          acc[val] = (acc[val] || 0) + 1;
          return acc;
        }, {});
        let hasInvalidLed = false;
        let hasDuplicateLed = false;
        ledInputs.forEach(input => {
          const val = input.value.trim();
          // Always reset styles before validation
          input.style.border = '';
          input.style.background = '';
          if (val !== '') {
            // Only allow 0-6, block non-numeric, ensure uniqueness
            if (!/^([0-6])$/.test(val)) {
              input.style.border = '2px solid #d00';
              input.style.background = '#ffeaea';
              hasInvalidLed = true;
            } else if (ledCounts[val] > 1) {
              input.style.border = '2px solid #d00';
              input.style.background = '#ffeaea';
              hasDuplicateLed = true;
            }
          }
        });
        // Disable Apply if any error
        updateApplyBtnState?.(hasEmptyPin || hasDuplicatePin || hasInvalidLed || hasDuplicateLed);
      }
      // Attach event listeners for Detect buttons (only once) - these are now handled in populateButtonConfigTable
      // Add validation on manual input - these are now handled in populateButtonConfigTable
      // Add validation on LED Index input - these are now handled in populateButtonConfigTable
      // Initial validation
      validatePins();
      modalFooter.style.gap = '18px';
      modalFooter.style.position = 'static';
      // --- End of modal setup ---
      function updateApplyBtnState(disabled) {
        modalApplyBtn.disabled = disabled;
        if (disabled) {
          modalApplyBtn.style.background = '#bbb';
          modalApplyBtn.style.color = '#222';
          modalApplyBtn.style.boxShadow = 'none';
          modalApplyBtn.style.cursor = 'not-allowed';
        } else {
          modalApplyBtn.style.background = '#ffcc00';
          modalApplyBtn.style.color = '#000';
          modalApplyBtn.style.boxShadow = '0 0 8px #ffe066';
          modalApplyBtn.style.cursor = 'pointer';
        }
      }
      window.updateApplyBtnState = updateApplyBtnState;
      modalCancelBtn.onclick = function() {
        const buttonConfigModal = document.getElementById('button-config-modal');
        if (buttonConfigModal) buttonConfigModal.style.display = 'none';
        stopPinStatusPolling(); // Fix: Stop polling when modal is cancelled
      };
      // --- Fix: Always re-validate after pin detection ---
      window.validatePins = validatePins;
      window.updatePinStatusUI = updatePinStatusUI;
      // --- Fix: Restore Apply button event handler ---
      modalApplyBtn.onclick = function() {
        if (!originalConfig) return;
        // Collect pin and LED assignments from table
        buttonInputs.forEach(input => {
          const pinInput = document.querySelector(`#button-config-table-left .pin-input[data-key='${input.key}'], #button-config-table-right .pin-input[data-key='${input.key}']`);
          // Only look for LED inputs in the left table (frets and strum)
          const ledInput = document.querySelector(`#button-config-table-left .led-input[data-key='${input.key}_led']`);
          if (pinInput) originalConfig[input.key] = pinInput.value.trim();
          if (ledInput) {
            const ledVal = ledInput.value.trim();
            if (ledVal === '') {
              delete originalConfig[input.key + '_led'];
            } else if (!isNaN(Number(ledVal)) && Number(ledVal) >= 0 && Number(ledVal) <= 6) {
              originalConfig[input.key + '_led'] = Number(ledVal);
            } else {
              delete originalConfig[input.key + '_led'];
            }
          }
        });
        try {
          connectedPort.write("WRITEFILE:config.json\n");
          connectedPort.write(JSON.stringify(originalConfig) + "\n");
          connectedPort.write("END\n");
          showToast("Button config applied and saved ✅", 'success');
          const buttonConfigModal = document.getElementById('button-config-modal');
          if (buttonConfigModal) buttonConfigModal.style.display = 'none';
          stopPinStatusPolling(); // Fix: Stop polling when modal is closed after apply
          
          // Reboot device to apply button config changes
          setTimeout(() => {
            showToast("Device rebooting to apply button config changes", 'info');
            rebootAndReload('config.json');
          }, 500);
        } catch (err) {
          console.error("Failed to apply button config:", err);
          showToast("Failed to write button config", 'error');
        }
      };
    }
    // Modal-scoped pin status polling and handler
    // --- Live Pin Status Polling ---
    let pinStatusInterval = null;
    let pinStatusMap = {};
    function startPinStatusPolling(config) {
      if (!connectedPort || !config) {
        console.log('Cannot start pin status polling: no port or config');
        return;
      }
      stopPinStatusPolling();
      const keys = buttonInputs.map(b => b.key);
      console.log('Starting pin status polling for keys:', keys);
      pinStatusInterval = setInterval(() => {
        keys.forEach(key => {
          console.log(`Sending READPIN:${key}`);
          connectedPort.write(`READPIN:${key}\n`);
        });
      }, 250);
      connectedPort.on('data', pinStatusHandler);
      console.log('Pin status polling started');
    }

    function stopPinStatusPolling() {
      if (pinStatusInterval) {
        clearInterval(pinStatusInterval);
        pinStatusInterval = null;
      }
      connectedPort?.off('data', pinStatusHandler);
    }

    function pinStatusHandler(data) {
      const str = data.toString();
      console.log('Pin status data received:', str);
      
      // Parse PIN:<key>:<val> responses
      const pinMatch = str.match(/PIN:([A-Z_]+):(\d+)/);
      if (pinMatch) {
        const key = pinMatch[1];
        const val = pinMatch[2];
        console.log(`Pin status update: ${key} = ${val}`);
        pinStatusMap[key] = val;
        updatePinStatusUI();
      }
    }

    function updatePinStatusUI() {
      console.log('Updating pin status UI, pinStatusMap:', pinStatusMap);
      buttonInputs.forEach(input => {
        const key = input.key;
        const status = pinStatusMap[key];
        const box = document.querySelector(`#button-config-table-left .pin-status-box[data-key='${key}'], #button-config-table-right .pin-status-box[data-key='${key}']`);
        console.log(`Looking for box with key: ${key}, status: ${status}, found box:`, box);
        if (box) {
          if (status === '1') {
            box.style.background = '#ffe066';
            box.style.borderColor = '#ffe066';
            console.log(`Set ${key} box to pressed (yellow)`);
          } else if (status === '0') {
            box.style.background = '#111';
            box.style.borderColor = '#ffe066';
            console.log(`Set ${key} box to not pressed (dark)`);
          } else {
            box.style.background = '#333';
            box.style.borderColor = '#bbb';
            console.log(`Set ${key} box to unknown status (gray)`);
          }
        } else {
          console.log(`Could not find box for key: ${key}`);
        }
      });
    }

    // Start polling when modal opens, stop when closed
    if (buttonConfigBtn && buttonConfigModal) {
      buttonConfigBtn.addEventListener('click', function() {
        buttonConfigModal.style.display = 'flex';
        // Populate table with current config or empty config
        const configToUse = originalConfig || {};
        populateButtonConfigTable(configToUse);
        if (originalConfig) {
          startPinStatusPolling(originalConfig);
        }
      });
      document.getElementById('button-config-cancel')?.addEventListener('click', function() {
        buttonConfigModal.style.display = 'none';
        stopPinStatusPolling();
      });
      buttonConfigModal.addEventListener('close', stopPinStatusPolling);
      
      // Handle clicking outside the modal to close it
      buttonConfigModal.addEventListener('click', function(e) {
        if (e.target === buttonConfigModal) {
          buttonConfigModal.style.display = 'none';
          stopPinStatusPolling();
        }
      });
      
      // Handle escape key to close modal
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && buttonConfigModal.style.display === 'flex') {
          buttonConfigModal.style.display = 'none';
          stopPinStatusPolling();
        }
      });
    }
  });

  // Diagnostics Modal Integration
  const diagnosticsModal = document.getElementById('diagnostics-modal');
  const diagCloseBtn = document.getElementById('diag-close-btn');
  
  console.log('Diagnostics modal setup:');
  console.log('diagnosticsModal:', diagnosticsModal);
  console.log('diagCloseBtn:', diagCloseBtn);

  // Add diagnostics menu item
  const diagnosticsMenuBtn = document.createElement('button');
  diagnosticsMenuBtn.id = 'diagnostics-menu-btn';
  diagnosticsMenuBtn.textContent = 'Diagnostics';
  // Remove custom styling - let it inherit the popup-menu button styles

  // Insert into menu before the reflash firmware button (assumes #config-menu exists)
  const configMenu = document.getElementById('config-menu');
  const reflashBtn = document.getElementById('reboot-to-bootsel');
  if (configMenu && reflashBtn) {
    configMenu.insertBefore(diagnosticsMenuBtn, reflashBtn);
  } else if (configMenu) {
    // Fallback: add at the end if reflash button not found
    configMenu.appendChild(diagnosticsMenuBtn);
  }

  // Function to initialize diagnostics sections with checkboxes
  function initializeDiagnosticsSections() {
    // Setup polling system
    setupDiagnosticsPolling();
    
    // Setup input status table
    setupInputStatusTable();
    
    // Setup whammy status display
    setupWhammyStatusDisplay();
    
    // Setup hat status based on mode
    setupHatStatusDisplay();
    
    // Setup LED test functionality
    setupLedTest();
    
    // Setup device information
    setupDeviceInformation();
    
    // Auto-restart the previously selected diagnostic mode after a brief delay
    setTimeout(() => {
      restartPreviouslySelectedMode();
    }, 300);
  }
  
  // Always set to "None" mode when modal opens
  function restartPreviouslySelectedMode() {
    console.log('Setting diagnostic mode to None (default)');
    
    // Always clear all radio buttons first
    document.querySelectorAll('input[name="diag-mode"]').forEach(radio => {
      radio.checked = false;
    });
    
    // Always set to "None" mode
    const noneRadio = document.getElementById('diag-none');
    if (noneRadio) {
      noneRadio.checked = true;
      lastSelectedDiagnosticMode = 'diag-none';
      console.log('Modal opened with None mode selected');
    } else {
      console.log('Could not find None radio button');
    }
  }
  
  function setupInputStatusTable() {
    // Create the input status table
    const diagInputStatus = document.getElementById('diag-input-status');
    const diagInputBoxesRow1 = document.getElementById('diag-input-boxes-row1');
    const diagInputBoxesRow2 = document.getElementById('diag-input-boxes-row2');
    
    if (!diagInputBoxesRow1 || !diagInputBoxesRow2) {
      console.warn('Input status containers not found');
      return;
    }
    
    // Clear existing content
    diagInputBoxesRow1.innerHTML = '';
    diagInputBoxesRow2.innerHTML = '';
    
    // Define button layouts (matching the ones used in polling system)
    const buttonInputsRow1 = [
      { name: 'Green', key: 'GREEN_FRET' },
      { name: 'Red', key: 'RED_FRET' },
      { name: 'Yellow', key: 'YELLOW_FRET' },
      { name: 'Blue', key: 'BLUE_FRET' },
      { name: 'Orange', key: 'ORANGE_FRET' }
    ];
    
    const buttonInputsRow2 = [
      { name: 'Strum Up', key: 'STRUM_UP' },
      { name: 'Strum Down', key: 'STRUM_DOWN' },
      { name: 'Start', key: 'START' },
      { name: 'Select', key: 'SELECT' },
      { name: 'Tilt', key: 'TILT' }
    ];
    
    // Create button status boxes for row 1
    buttonInputsRow1.forEach(button => {
      const box = document.createElement('div');
      box.className = 'diag-input-box';
      box.setAttribute('data-key', button.key);
      box.style.cssText = `
        width: 65px;
        height: 45px;
        background: #111;
        border: 2px solid #ffe066;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-size: 10px;
        font-weight: bold;
        color: #ffe066;
        text-align: center;
        transition: all 0.1s ease;
      `;
      box.innerHTML = `<div>${button.name}</div><div style="font-size:8px; margin-top:2px;">OFF</div>`;
      diagInputBoxesRow1.appendChild(box);
    });
    
    // Create button status boxes for row 2
    buttonInputsRow2.forEach(button => {
      const box = document.createElement('div');
      box.className = 'diag-input-box';
      box.setAttribute('data-key', button.key);
      box.style.cssText = `
        width: 65px;
        height: 45px;
        background: #111;
        border: 2px solid #ffe066;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        font-size: 10px;
        font-weight: bold;
        color: #ffe066;
        text-align: center;
        transition: all 0.1s ease;
      `;
      box.innerHTML = `<div>${button.name}</div><div style="font-size:8px; margin-top:2px;">OFF</div>`;
      diagInputBoxesRow2.appendChild(box);
    });
    
    console.log('✅ Input status table created with', buttonInputsRow1.length + buttonInputsRow2.length, 'buttons');
  }

  // Function to update input status display for diagnostic page
  function updateDiagnosticInputStatus(inputStates) {
    // Only update if diagnostic modal is open and input status is active
    const diagModal = document.getElementById('diagnosticsModal');
    const diagInputStatus = document.getElementById('diag-input-status');
    
    if (!diagModal?.style.display || diagModal.style.display === 'none' ||
        !diagInputStatus?.classList.contains('active')) {
      return; // Don't process if diagnostics isn't open/active
    }
    
    // Map of input keys to their diagnostic box IDs
    const inputMapping = {
      'GREEN_FRET': 'diag-input-green_fret',
      'RED_FRET': 'diag-input-red_fret', 
      'YELLOW_FRET': 'diag-input-yellow_fret',
      'BLUE_FRET': 'diag-input-blue_fret',
      'ORANGE_FRET': 'diag-input-orange_fret',
      'STRUM_UP': 'diag-input-strum_up',
      'STRUM_DOWN': 'diag-input-strum_down',
      'START': 'diag-input-start',
      'SELECT': 'diag-input-select',
      'TILT': 'diag-input-tilt'
    };
    
    // Update each input's visual state
    Object.entries(inputMapping).forEach(([inputKey, boxId]) => {
      const box = document.getElementById(boxId);
      if (box && inputStates.hasOwnProperty(inputKey)) {
        const isPressed = inputStates[inputKey];
        const statusText = box.querySelector('div:last-child');
        
        if (isPressed) {
          box.style.background = '#27ae60';
          box.style.borderColor = '#2ecc71';
          box.style.color = '#fff';
          if (statusText) statusText.textContent = 'ON';
        } else {
          box.style.background = '#444';
          box.style.borderColor = '#666';
          box.style.color = '#bbb';
          if (statusText) statusText.textContent = 'OFF';
        }
      }
    });
  }
  
  function setupWhammyStatusDisplay() {
    // Setup whammy min/max values and slider
    const diagWhammyStatus = document.getElementById('diag-whammy-status');
    const diagWhammyMinEl = document.getElementById('diag-whammy-min');
    const diagWhammyMaxEl = document.getElementById('diag-whammy-max');
    
    if (!diagWhammyStatus) return;
    
    // Get min/max values from config or use defaults
    let whammyMin = 0;
    let whammyMax = 65535;
    
    if (originalConfig) {
      whammyMin = originalConfig.whammy_min || 0;
      whammyMax = originalConfig.whammy_max || 65535;
    }
    
    // Always populate the min/max display
    if (diagWhammyMinEl) diagWhammyMinEl.textContent = whammyMin;
    if (diagWhammyMaxEl) diagWhammyMaxEl.textContent = whammyMax;
    
    // COMPREHENSIVE cleanup - remove all existing dynamic content except the min/max div
    const minMaxDiv = diagWhammyMinEl?.parentElement?.parentElement;
    
    // Remove all children except the Live value and min/max divs (keep HTML structure intact)
    const childrenToKeep = [
      document.getElementById('diag-whammy-live-val'),
      minMaxDiv
    ].filter(Boolean);
    
    Array.from(diagWhammyStatus.children).forEach(child => {
      if (!childrenToKeep.includes(child)) {
        child.remove();
      }
    });
    
    // Find the min/max div to insert slider after it
    
    // Create slider container (smaller size)
    const sliderContainer = document.createElement('div');
    sliderContainer.style.width = '140px';
    sliderContainer.style.height = '8px';
    sliderContainer.style.background = '#111';
    sliderContainer.style.border = '2px solid #ffe066';
    sliderContainer.style.borderRadius = '6px';
    sliderContainer.style.position = 'relative';
    sliderContainer.style.margin = '12px auto 8px auto';
    
    // Create slider indicator (smaller)
    const whammySlider = document.createElement('div');
    whammySlider.id = 'diag-whammy-slider';
    whammySlider.style.width = '6px';
    whammySlider.style.height = '6px';
    whammySlider.style.background = '#ffe066';
    whammySlider.style.borderRadius = '50%';
    whammySlider.style.position = 'absolute';
    whammySlider.style.top = '50%';
    whammySlider.style.left = '0px';
    whammySlider.style.transform = 'translateY(-50%)';
    whammySlider.style.transition = 'left 0.1s ease';
    sliderContainer.appendChild(whammySlider);
    
    // Create helper text
    const helperText = document.createElement('div');
    helperText.className = 'whammy-helper-text';
    helperText.style.color = '#bbb';
    helperText.style.fontSize = '0.8em';
    helperText.style.marginTop = '8px';
    helperText.textContent = 'Move the whammy bar to see live values.';
    
    // Insert slider after the min/max div
    if (minMaxDiv && minMaxDiv.nextSibling) {
      diagWhammyStatus.insertBefore(sliderContainer, minMaxDiv.nextSibling);
      diagWhammyStatus.insertBefore(helperText, sliderContainer.nextSibling);
    } else {
      diagWhammyStatus.appendChild(sliderContainer);
      diagWhammyStatus.appendChild(helperText);
    }
  }
  
  // Setup whammy handler
  window.diagWhammyLiveHandler = function(data) {
    try {
      const str = data.toString().trim();
      const match = str.match(/WHAMMY:([0-9]+)/);
      if (match) {
        // Hide buffer clearing popover when whammy data arrives
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        const whammyValue = Number(match[1]);
        
        // Validate whammy value is in expected range (0-65535)
        if (!isNaN(whammyValue) && whammyValue >= 0 && whammyValue <= 65535) {
          const diagWhammyLiveVal = document.getElementById('diag-whammy-live-val');
          if (diagWhammyLiveVal) {
            diagWhammyLiveVal.textContent = `Live: ${whammyValue}`;
          }
          
          // Update visual slider position
          const slider = document.getElementById('diag-whammy-slider');
          if (slider && originalConfig) {
            const whammyMin = originalConfig.whammy_min || 0;
            const whammyMax = originalConfig.whammy_max || 65535;
            
            // Validate config values
            if (whammyMin <= whammyMax) {
              // Calculate position (0 to 134px, accounting for 6px dot width in 140px container)
              const range = whammyMax - whammyMin;
              if (range > 0) {
                const normalizedValue = Math.max(0, Math.min(1, (whammyValue - whammyMin) / range));
                const position = normalizedValue * 134; // 140px container - 6px dot width
                slider.style.left = position + 'px';
              }
            }
          }
        }
      } else if (str.startsWith("WHAMMY")) {
        // Handle malformed whammy responses
        const diagWhammyLiveVal = document.getElementById('diag-whammy-live-val');
        if (diagWhammyLiveVal) {
          diagWhammyLiveVal.textContent = "Live: Error reading whammy";
        }
        // Reset slider to start position
        const slider = document.getElementById('diag-whammy-slider');
        if (slider) {
          slider.style.left = '0px';
        }
      }
    } catch (err) {
      console.warn('[DIAG] Whammy handler error:', err);
    }
  };
  
  function setupHatStatusDisplay() {
    console.log('setupHatStatusDisplay called');
    console.log('originalConfig:', originalConfig);
    
    // Default to joystick mode if config not available yet
    const hatMode = (originalConfig && originalConfig.hat_mode) || 'joystick';
    console.log('hatMode determined as:', hatMode);
    
    // Update the hat section title (the h3 element with id="diag-hat-title")
    const hatTitleElement = document.getElementById('diag-hat-title');
    console.log('hatTitleElement found:', hatTitleElement);
    if (hatTitleElement) {
      const newText = hatMode === 'dpad' ? 'D-Pad Status' : 'Joystick Status';
      console.log('Setting hatTitleElement.textContent to:', newText);
      hatTitleElement.textContent = newText;
    }
    
    // Update the radio button label as well
    const hatLabelElement = document.getElementById('diag-hat-label');
    console.log('hatLabelElement found:', hatLabelElement);
    if (hatLabelElement) {
      const labelText = hatMode === 'dpad' ? 'D-Pad' : 'Joystick';
      console.log('Setting hatLabelElement.textContent to:', labelText);
      hatLabelElement.textContent = labelText;
    }
    
    const diagHatStatus = document.getElementById('diag-hat-status');
    
    if (diagHatStatus) {
      
      // Update title - find existing h3 or create one
      let titleElement = diagHatStatus.querySelector('h3');
      if (!titleElement) {
        titleElement = document.createElement('h3');
        titleElement.style.margin = '0 0 8px 0';
        titleElement.style.fontSize = '1.1em';
        titleElement.style.fontWeight = 'bold';
        titleElement.style.color = '#ffe066';
        diagHatStatus.insertBefore(titleElement, diagHatStatus.firstChild);
      }
      titleElement.textContent = hatMode === 'dpad' ? 'D-Pad Status' : 'Joystick Status';
      
      // Clear content after title (keep title, remove everything else)
      const elementsToRemove = Array.from(diagHatStatus.children).slice(1);
      elementsToRemove.forEach(el => el.remove());
      
      if (hatMode === 'dpad') {
        // DPAD mode - show directional buttons
        const dpadContainer = document.createElement('div');
        dpadContainer.style.display = 'grid';
        dpadContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
        dpadContainer.style.gap = '4px';
        dpadContainer.style.width = '80px';
        dpadContainer.style.height = '80px';
        dpadContainer.style.margin = '0 auto 8px auto';
        
        const dpadButtons = [
          { key: 'UP', row: 1, col: 2, symbol: '▲' },
          { key: 'LEFT', row: 2, col: 1, symbol: '◀' },
          { key: 'GUIDE', row: 2, col: 2, symbol: 'G' },
          { key: 'RIGHT', row: 2, col: 3, symbol: '▶' },
          { key: 'DOWN', row: 3, col: 2, symbol: '▼' }
        ];
        
        // Create 3x3 grid
        for (let i = 1; i <= 9; i++) {
          const cell = document.createElement('div');
          cell.style.width = '24px';
          cell.style.height = '24px';
          cell.style.display = 'flex';
          cell.style.alignItems = 'center';
          cell.style.justifyContent = 'center';
          
          const button = dpadButtons.find(btn => {
            const row = Math.ceil(i / 3);
            const col = ((i - 1) % 3) + 1;
            return btn.row === row && btn.col === col;
          });
          
          if (button) {
            cell.textContent = button.symbol;
            cell.className = 'diag-dpad-btn';
            cell.setAttribute('data-key', button.key);
            cell.style.background = '#111';
            cell.style.color = '#ffe066';
            cell.style.border = '2px solid #ffe066';
            cell.style.borderRadius = '4px';
            cell.style.fontWeight = 'bold';
            cell.style.fontSize = button.key === 'GUIDE' ? '12px' : '14px';
            cell.style.transition = 'background 0.2s, color 0.2s';
          }
          
          dpadContainer.appendChild(cell);
        }
        
        diagHatStatus.appendChild(dpadContainer);
        
        // Add description
        const dpadDesc = document.createElement('div');
        dpadDesc.style.color = '#bbb';
        dpadDesc.style.fontSize = '12px';
        dpadDesc.style.marginTop = 'auto';
        dpadDesc.textContent = 'D-Pad directional buttons + Guide';
        diagHatStatus.appendChild(dpadDesc);
        
      } else {
        // Joystick mode - show visual joystick and X/Y axis values
        // Create visual joystick container
        const joystickVisual = document.createElement('div');
        joystickVisual.style.width = '80px';
        joystickVisual.style.height = '80px';
        joystickVisual.style.border = '2px solid #ffe066';
        joystickVisual.style.borderRadius = '50%';
        joystickVisual.style.position = 'relative';
        joystickVisual.style.background = '#111';
        joystickVisual.style.margin = '0 auto 12px auto';
        joystickVisual.style.flexShrink = '0';
        
        // Create joystick dot
        const joystickDot = document.createElement('div');
        joystickDot.id = 'diag-joystick-dot';
        joystickDot.style.width = '8px';
        joystickDot.style.height = '8px';
        joystickDot.style.background = '#ffe066';
        joystickDot.style.borderRadius = '50%';
        joystickDot.style.position = 'absolute';
        joystickDot.style.top = '50%';
        joystickDot.style.left = '50%';
        joystickDot.style.transform = 'translate(-50%, -50%)';
        joystickDot.style.transition = 'top 0.1s ease, left 0.1s ease';
        joystickVisual.appendChild(joystickDot);
        
        diagHatStatus.appendChild(joystickVisual);
        
        const valueContainer = document.createElement('div');
        valueContainer.style.display = 'flex';
        valueContainer.style.flexDirection = 'column';
        valueContainer.style.gap = '4px';
        valueContainer.style.marginBottom = '0';
        valueContainer.style.width = '100%';
        valueContainer.style.flexShrink = '0';
        
        // X Axis
        const xAxisDiv = document.createElement('div');
        xAxisDiv.style.color = '#bbb';
        xAxisDiv.style.textAlign = 'center';
        xAxisDiv.innerHTML = 'X: <span id="diag-hat-x" style="color:#ffe066; font-weight:bold;">-</span>';
        valueContainer.appendChild(xAxisDiv);
        
        // Y Axis
        const yAxisDiv = document.createElement('div');
        yAxisDiv.style.color = '#bbb';
        yAxisDiv.style.textAlign = 'center';
        yAxisDiv.innerHTML = 'Y: <span id="diag-hat-y" style="color:#ffe066; font-weight:bold;">-</span>';
        valueContainer.appendChild(yAxisDiv);
        
        diagHatStatus.appendChild(valueContainer);
      }
    }
  }
  
  function setupLedTest() {
    // LED test setup - controlled by radio buttons only
    
    // LED test variables (make ledTestActive global)
    window.ledTestActive = false; // Make it global so radio handler can access it
    let ledTestInterval = null;
    let ledTestStep = 0;
    const ledTestColors = [
      { r: 255, g: 0, b: 0 }, // Red
      { r: 0, g: 0, b: 0 },   // Black
      { r: 0, g: 255, b: 0 }, // Green
      { r: 0, g: 0, b: 0 },   // Black
      { r: 0, g: 0, b: 255 }, // Blue
      { r: 0, g: 0, b: 0 }    // Black
    ];
    
    function sendLedTestColor(color) {
      // Send color to all 7 LEDs using SETLED command with proper indexing
      // LED indices: 0=strum-up, 1=strum-down, 2=orange, 3=blue, 4=yellow, 5=red, 6=green
      const { r, g, b } = color;
      
      for (let ledIndex = 0; ledIndex < 7; ledIndex++) {
        if (connectedPort) {
          connectedPort.write(`SETLED:${ledIndex}:${r}:${g}:${b}\n`);
        }
      }
    }
    
    async function startLedTest() {
      if (ledTestInterval) clearInterval(ledTestInterval);
      
      // Clear serial buffer before starting LED test to prevent interference
      if (connectedPort) {
        console.log('🧹 Clearing serial buffer before LED test...');
        await clearSerialBuffer();
      }
      
      window.ledTestActive = true;
      ledTestStep = 0;
      ledTestInterval = setInterval(() => {
        // Hide popover on first LED command
        if (ledTestStep === 0 && bufferClearingActive) {
          console.log('🔲 Hiding popover - LED test started');
          hideBufferClearingPopover();
        }
        
        // Fade between colors
        const color = ledTestColors[ledTestStep % ledTestColors.length];
        sendLedTestColor(color);
        ledTestStep++;
      }, 600); // 600ms per color
    }
    
    function stopLedTest() {
      window.ledTestActive = false;
      if (ledTestInterval) {
        clearInterval(ledTestInterval);
        ledTestInterval = null;
      }
      // Turn off all LEDs
      sendLedTestColor({ r: 0, g: 0, b: 0 });
      
      // Hide popover when LED test stops
      if (bufferClearingActive) {
        hideBufferClearingPopover();
      }
    }
    
    // Store functions globally so they can be called when modal closes
    window.stopLedTest = stopLedTest;
    window.startLedTest = startLedTest;
  }
  
  // Add guard to prevent multiple simultaneous calls
  let setupDeviceInformationInProgress = false;
  let pendingAsyncRequests = 0;
  
  function resetSetupDeviceInformationGuard() {
    if (pendingAsyncRequests <= 0) {
      setupDeviceInformationInProgress = false;
      window.setupDeviceInformationInProgress = false;
      console.log('🔧 setupDeviceInformation guard flag reset (all async operations complete)');
    } else {
      console.log('🔧 Waiting for', pendingAsyncRequests, 'async operations to complete before resetting guard');
    }
  }
  
  function setupDeviceInformation() {
    // Prevent multiple simultaneous calls
    if (setupDeviceInformationInProgress) {
      console.log('🔧 setupDeviceInformation already in progress, skipping duplicate call');
      return;
    }
    
    setupDeviceInformationInProgress = true;
    window.setupDeviceInformationInProgress = true;
    
    // Shorter failsafe timeout since we're using direct commands
    setTimeout(() => {
      if (setupDeviceInformationInProgress) {
        console.warn('🔧 setupDeviceInformation guard reset by failsafe timeout');
        setupDeviceInformationInProgress = false;
        window.setupDeviceInformationInProgress = false;
      }
    }, 5000); // Reduced to 5 seconds since direct commands are fast
    
    console.log('🔧 Setting up device information using optimized direct commands...');
    
    // Get the device information elements
    const deviceNameElement = document.getElementById('diag-device-name');
    const deviceUidElement = document.getElementById('diag-device-uid');
    const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
    const embeddedFirmwareElement = document.getElementById('diag-embedded-firmware-version');
    const presetsVersionElement = document.getElementById('diag-presets-version');
    
    // Update app version from package.json
    const appVersionElement = document.querySelector('#diag-version-info div:first-child + div div:first-child');
    if (appVersionElement) {
      const appVersion = getAppVersion();
      appVersionElement.textContent = `App Version: ${appVersion}`;
      console.log('✅ Set app version to:', appVersion);
    }
    
    // Update presets version
    if (presetsVersionElement) {
      const presetsVersion = getPresetsVersion();
      presetsVersionElement.textContent = presetsVersion;
      console.log('✅ Set presets version to:', presetsVersion);
    }
    
    // Always show embedded firmware version (doesn't require device connection)
    if (embeddedFirmwareElement) {
      const embeddedVersion = getEmbeddedFirmwareVersion();
      embeddedFirmwareElement.textContent = embeddedVersion;
      console.log('✅ Set embedded firmware version to:', embeddedVersion);
    }
    
    // Get active device from multi-device manager
    const activeDevice = window.multiDeviceManager?.getActiveDevice();
    
    if (!activeDevice || !activeDevice.isConnected || !connectedPort) {
      console.log('🔌 No active device or device not connected');
      if (deviceNameElement) deviceNameElement.textContent = 'No device connected';
      if (deviceUidElement) deviceUidElement.textContent = '-';
      if (deviceFirmwareElement) deviceFirmwareElement.textContent = '-';
      
      setupDeviceInformationInProgress = false;
      window.setupDeviceInformationInProgress = false;
      return;
    }
    
    console.log('🔌 Using sequential direct commands to prevent serial collisions');
    
    // Execute commands sequentially to prevent serial collision issues
    
    // === Device Name (READDEVICENAME) ===
    if (deviceNameElement) {
      deviceNameElement.textContent = 'Loading...';
      
      requestDeviceNameDirect((name) => {
        if (name && deviceNameElement) {
          deviceNameElement.textContent = name;
          console.log('✅ Device name:', name);
          // Cache in active device
          if (activeDevice) activeDevice.deviceName = name;
        } else if (deviceNameElement) {
          // Fallback to display name or port info
          const fallbackName = activeDevice.displayName || 
                              (activeDevice.portInfo && activeDevice.portInfo.friendlyName) || 
                              'Unknown Device';
          deviceNameElement.textContent = fallbackName;
          console.log('⚠️ Using fallback device name:', fallbackName);
        }
        
        // === Device UID (READUID) - Sequential after device name ===
        if (deviceUidElement) {
          deviceUidElement.textContent = 'Loading...';
          
          requestDeviceUidDirect((uid) => {
            if (uid && deviceUidElement) {
              deviceUidElement.textContent = uid;
              console.log('✅ Device UID:', uid);
              // Cache in active device
              if (activeDevice) activeDevice.uid = uid;
            } else if (deviceUidElement) {
              // Safe fallback that avoids COM port paths
              let fallbackUid = 'Unknown';
              if (activeDevice.portInfo && activeDevice.portInfo.serialNumber && 
                  !activeDevice.portInfo.serialNumber.includes('COM') &&
                  !activeDevice.portInfo.serialNumber.includes('&') &&
                  activeDevice.portInfo.serialNumber.length > 4) {
                fallbackUid = activeDevice.portInfo.serialNumber;
              }
              deviceUidElement.textContent = fallbackUid;
              console.log('⚠️ Using fallback UID:', fallbackUid);
            }
            
            // === Device Firmware Version (READVERSION) - Sequential after UID ===
            if (deviceFirmwareElement) {
              deviceFirmwareElement.textContent = 'Loading...';
              // Reset any previous styling
              deviceFirmwareElement.style.color = '';
              deviceFirmwareElement.style.fontWeight = '';
              
              requestDeviceFirmwareVersionDirect((version) => {
                if (version && deviceFirmwareElement) {
                  const normalizedVersion = normalizeVersion(version);
                  deviceFirmwareElement.textContent = normalizedVersion;
                  console.log('✅ Device firmware version:', normalizedVersion);
                  
                  // Cache in active device
                  if (activeDevice) activeDevice.firmwareVersion = normalizedVersion;
                  
                  setupDeviceInformationInProgress = false;
                  window.setupDeviceInformationInProgress = false;
                  console.log('✅ All device information operations completed');
                } else if (deviceFirmwareElement) {
                  console.log('⚠️ Could not determine firmware version');
                  deviceFirmwareElement.textContent = 'Unknown';
                  setupDeviceInformationInProgress = false;
                  window.setupDeviceInformationInProgress = false;
                  console.log('✅ All device information operations completed');
                }
              });
            } else {
              setupDeviceInformationInProgress = false;
              window.setupDeviceInformationInProgress = false;
              console.log('✅ All device information operations completed');
            }
          });
        } else {
          setupDeviceInformationInProgress = false;
          window.setupDeviceInformationInProgress = false;
          console.log('✅ All device information operations completed');
        }
      });
    } else {
      setupDeviceInformationInProgress = false;
      window.setupDeviceInformationInProgress = false;
      console.log('✅ All device information operations completed');
    }
  }

  // Global polling variables
  let diagPinStatusInterval = null;
  let diagHatStatusInterval = null;
  let diagWhammyInterval = null;
  let diagPinStatusMap = {};
  let diagHatStatusMap = {};
  
  let bufferClearingActive = false;

  function showBufferClearingPopover() {
    const popover = document.getElementById('buffer-clearing-popover');
    console.log('🧹 Attempting to show buffer clearing popover, element found:', !!popover);
    console.log('🧹 Popover element:', popover);
    if (popover) {
      popover.style.display = 'block';
      popover.style.visibility = 'visible';
      popover.style.opacity = '1';
      bufferClearingActive = true;
      console.log('🧹 Buffer clearing popover displayed, styles applied');
      console.log('🧹 Final popover styles:', window.getComputedStyle(popover).display, window.getComputedStyle(popover).visibility);
    } else {
      console.error('🧹 Buffer clearing popover element not found!');
    }
  }

  function hideBufferClearingPopover() {
    const popover = document.getElementById('buffer-clearing-popover');
    if (popover) {
      popover.style.display = 'none';
      bufferClearingActive = false;
    }
  }

  function showPresetUploadPopover() {
    const popover = document.getElementById('preset-upload-popover');
    console.log('📁 Attempting to show preset upload popover, element found:', !!popover);
    if (popover) {
      popover.style.display = 'block';
      popover.style.visibility = 'visible';
      popover.style.opacity = '1';
      console.log('📁 Preset upload popover displayed');
    } else {
      console.error('📁 Preset upload popover element not found!');
    }
  }

  function hidePresetUploadPopover() {
    const popover = document.getElementById('preset-upload-popover');
    if (popover) {
      popover.style.display = 'none';
      console.log('📁 Preset upload popover hidden');
    }
  }

  // Test function to manually show popover (for debugging)
  window.testPopover = function() {
    console.log('🧹 Testing popover display...');
    showBufferClearingPopover();
    setTimeout(() => {
      hideBufferClearingPopover();
    }, 3000);
  };

  async function clearSerialBuffer() {
    console.log('🧹 clearSerialBuffer called, connectedPort:', !!connectedPort);
    if (connectedPort) {
      // Show buffer clearing popover
      console.log('🧹 About to show popover...');
      showBufferClearingPopover();
      
      try {
        // For Web Serial API, we need to flush/clear differently
        // Since we can't directly access the buffer, we'll just pause briefly
        // and let the existing data handlers consume any backed up data
        console.log('🧹 Pausing to allow buffer to drain...');
        
        // Give time for any backed up data to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log('🧹 Buffer clearing completed');
      } catch (error) {
        console.log('Buffer clear error:', error.message);
        // Hide popover on error
        hideBufferClearingPopover();
      }
      // Note: Don't hide popover here - let data handlers hide it when correct data arrives
    } else {
      console.log('🧹 clearSerialBuffer skipped - no connected port');
    }
  }
  
  function setupDiagnosticsPolling() {
    // Setup all polling functions and event handlers
    setupPollingFunctions();
    setupCheckboxEventHandlers();
    initializePollingBasedOnCheckboxes();
  }
  
  function setupPollingFunctions() {
    // Connection health check function
    function isConnectionHealthy() {
      return connectedPort && 
             connectedPort.readable && 
             connectedPort.writable && 
             !connectedPort.closed;
    }
    
    // Define all polling start/stop functions
    window.startDiagPinStatusPolling = function() {
      const checkbox = document.getElementById('diag-input-enable');
      if (!connectedPort || !checkbox || !checkbox.checked) return;
      stopDiagPinStatusPolling();
      
      const buttonInputsRow1 = [
        { name: 'Green', key: 'GREEN_FRET' },
        { name: 'Red', key: 'RED_FRET' },
        { name: 'Yellow', key: 'YELLOW_FRET' },
        { name: 'Blue', key: 'BLUE_FRET' },
        { name: 'Orange', key: 'ORANGE_FRET' }
      ];
      const buttonInputsRow2 = [
        { name: 'Strum Up', key: 'STRUM_UP' },
        { name: 'Strum Down', key: 'STRUM_DOWN' },
        { name: 'Start', key: 'START' },
        { name: 'Select', key: 'SELECT' },
        { name: 'Tilt', key: 'TILT' }
      ];
      
      const keys = [...buttonInputsRow1, ...buttonInputsRow2].map(b => b.key);
      let currentKeyIndex = 0;
      
      // Round-robin polling: poll one button at a time to prevent serial buffer overflow
      diagPinStatusInterval = setInterval(() => {
        if (document.getElementById('diag-input-enable')?.checked && isConnectionHealthy()) {
          try {
            const key = keys[currentKeyIndex];
            connectedPort.write(`READPIN:${key}\n`);
            currentKeyIndex = (currentKeyIndex + 1) % keys.length;
          } catch (err) {
            console.warn('[DIAG] Pin status polling write error:', err);
            // Don't stop polling on individual write errors, just skip this cycle
          }
        }
      }, 20); // Faster individual polls but only one button at a time
      
      if (!connectedPort.listeners('data').includes(diagPinStatusHandler)) {
        connectedPort.on('data', diagPinStatusHandler);
      }
    };
    
    window.stopDiagPinStatusPolling = function() {
      if (diagPinStatusInterval) {
        clearInterval(diagPinStatusInterval);
        diagPinStatusInterval = null;
      }
      if (connectedPort) {
        connectedPort.off('data', diagPinStatusHandler);
      }
    };
    
    window.startDiagHatStatusPolling = function() {
      const checkbox = document.getElementById('diag-hat-enable');
      if (!connectedPort || !originalConfig || !checkbox || !checkbox.checked) return;
      stopDiagHatStatusPolling();
      
      const hatMode = originalConfig.hat_mode || 'joystick';
      
      if (hatMode === 'dpad') {
        // Round-robin polling for DPAD buttons including GUIDE
        const dpadKeys = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'GUIDE'];
        let currentDpadIndex = 0;
        
        diagHatStatusInterval = setInterval(() => {
          if (document.getElementById('diag-hat-enable')?.checked && isConnectionHealthy()) {
            try {
              const key = dpadKeys[currentDpadIndex];
              connectedPort.write(`READPIN:${key}\n`);
              currentDpadIndex = (currentDpadIndex + 1) % dpadKeys.length;
            } catch (err) {
              console.warn('[DIAG] Hat status polling write error:', err);
            }
          }
        }, 25); // Slower than individual pin polling since there are fewer buttons
      } else {
        // Poll joystick values - single command so no round-robin needed
        diagHatStatusInterval = setInterval(() => {
          if (document.getElementById('diag-hat-enable')?.checked && isConnectionHealthy()) {
            try {
              connectedPort.write('READJOYSTICK\n');
            } catch (err) {
              console.warn('[DIAG] Joystick polling write error:', err);
            }
          }
        }, 30); // Slightly slower for joystick to reduce data flood
      }
      
      if (!connectedPort.listeners('data').includes(diagHatStatusHandler)) {
        connectedPort.on('data', diagHatStatusHandler);
      }
    };
    
    window.stopDiagHatStatusPolling = function() {
      if (diagHatStatusInterval) {
        clearInterval(diagHatStatusInterval);
        diagHatStatusInterval = null;
      }
      if (connectedPort) {
        connectedPort.off('data', diagHatStatusHandler);
      }
    };
    
    window.startDiagWhammyPolling = function() {
      const checkbox = document.getElementById('diag-whammy-enable');
      if (!connectedPort || !checkbox || !checkbox.checked) return;
      stopDiagWhammyPolling();
      
      diagWhammyInterval = setInterval(() => {
        if (document.getElementById('diag-whammy-enable')?.checked && isConnectionHealthy()) {
          try {
            connectedPort.write('READWHAMMY\n');
          } catch (err) {
            console.warn('[DIAG] Whammy polling write error:', err);
          }
        }
      }, 25); // Slightly reduced frequency to prevent overwhelming the serial buffer
      
      if (!connectedPort.listeners('data').includes(window.diagWhammyLiveHandler)) {
        connectedPort.on('data', window.diagWhammyLiveHandler);
      }
    };
    
    window.stopDiagWhammyPolling = function() {
      if (diagWhammyInterval) {
        clearInterval(diagWhammyInterval);
        diagWhammyInterval = null;
      }
      if (connectedPort) {
        connectedPort.off('data', window.diagWhammyLiveHandler);
      }
    };
  }
  
  function setupCheckboxEventHandlers() {
    // Setup checkbox event listeners
    setTimeout(() => {
      const inputCheckbox = document.getElementById('diag-input-enable');
      const hatCheckbox = document.getElementById('diag-hat-enable');
      const whammyCheckbox = document.getElementById('diag-whammy-enable');
      
      if (inputCheckbox) {
        inputCheckbox.addEventListener('change', function() {
          if (this.checked) {
            window.startDiagPinStatusPolling();
          } else {
            window.stopDiagPinStatusPolling();
          }
        });
      }
      
      if (hatCheckbox) {
        hatCheckbox.addEventListener('change', function() {
          if (this.checked) {
            window.startDiagHatStatusPolling();
          } else {
            window.stopDiagHatStatusPolling();
          }
        });
      }
      
      if (whammyCheckbox) {
        whammyCheckbox.addEventListener('change', function() {
          if (this.checked) {
            window.startDiagWhammyPolling();
          } else {
            window.stopDiagWhammyPolling();
          }
        });
      }
    }, 100); // Small delay to ensure checkboxes are created
  }
  
  function initializePollingBasedOnCheckboxes() {
    setTimeout(() => {
      const noneRadio = document.getElementById('diag-none');
      const inputRadio = document.getElementById('diag-input-enable');
      const hatRadio = document.getElementById('diag-hat-enable');
      const whammyRadio = document.getElementById('diag-whammy-enable');
      const ledRadio = document.getElementById('diag-led-enable');
      
      // Add event listeners for radio button changes (one at a time behavior)
      [noneRadio, inputRadio, hatRadio, whammyRadio, ledRadio].forEach(radio => {
        if (radio) {
          radio.addEventListener('change', handleDiagnosticModeChange);
        }
      });
      
      // Initialize all boxes as inactive (yellow border)
      setBoxActive('diag-input-status', false);
      setBoxActive('diag-whammy-status', false);
      setBoxActive('diag-hat-status', false);
      
      // Stop any existing polling
      window.stopDiagPinStatusPolling();
      window.stopDiagHatStatusPolling();
      window.stopDiagWhammyPolling();
      
    }, 200); // Delay to ensure checkboxes and DOM are ready
    
    function setBoxActive(boxId, isActive) {
      const box = document.querySelector(`#${boxId}`);
      if (box) {
        if (isActive) {
          box.style.borderColor = '#4CAF50'; // Green border when active
          box.style.boxShadow = '0 0 8px rgba(76, 175, 80, 0.3)'; // Green glow
        } else {
          box.style.borderColor = '#ffe066'; // Original yellow border
          box.style.boxShadow = 'none'; // No glow
        }
      }
    }
    
    async function handleDiagnosticModeChange(event) {
      // Remember the selected mode for later restoration
      if (event.target.checked) {
        lastSelectedDiagnosticMode = event.target.id;
        console.log('Diagnostic mode changed to:', lastSelectedDiagnosticMode);
      }
      
      // Stop all polling first
      window.stopDiagPinStatusPolling();
      window.stopDiagHatStatusPolling();
      window.stopDiagWhammyPolling();
      if (window.stopLedTest) {
        console.log('Radio button change - stopping LED test');
        window.stopLedTest();
      }
      
      // Clear serial buffer to prevent backed up responses from interfering
      if (connectedPort && event.target.checked && event.target.id !== 'diag-none') {
        console.log('🧹 Clearing serial buffer before mode switch...');
        await clearSerialBuffer();
        // Small delay to ensure buffer is fully cleared
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Clear all LIVE status displays
      const diagWhammyLiveVal = document.getElementById('diag-whammy-live-val');
      if (diagWhammyLiveVal) {
        diagWhammyLiveVal.textContent = 'Live: -';
      }
      
      // Keep min/max values from config - they should never be cleared
      // Only update min/max if config is available
      const diagWhammyMin = document.getElementById('diag-whammy-min');
      const diagWhammyMax = document.getElementById('diag-whammy-max');
      if (originalConfig) {
        const whammyMin = originalConfig.whammy_min || 0;
        const whammyMax = originalConfig.whammy_max || 65535;
        if (diagWhammyMin) diagWhammyMin.textContent = whammyMin;
        if (diagWhammyMax) diagWhammyMax.textContent = whammyMax;
      }
      
      // Remove any existing polling indicators from radio buttons
      const pollingIndicators = document.querySelectorAll('.polling-indicator');
      pollingIndicators.forEach(indicator => indicator.remove());
      
      // Clear input button states
      diagPinStatusMap = {};
      updateDiagInputBoxes();
      
      // Clear joystick/hat status
      const diagHatX = document.getElementById('diag-hat-x');
      const diagHatY = document.getElementById('diag-hat-y');
      if (diagHatX) diagHatX.textContent = '-';
      if (diagHatY) diagHatY.textContent = '-';
      
      const hatStatus = document.getElementById('diag-hat-status');
      if (hatStatus) {
        const existingStatus = hatStatus.querySelector('.hat-status-display');
        if (existingStatus) {
          existingStatus.remove();
        }
      }
      
      // Set all boxes to inactive (yellow border)
      setBoxActive('diag-input-status', false);
      setBoxActive('diag-whammy-status', false);
      setBoxActive('diag-hat-status', false);
      
      // Start polling for the selected mode only (if not "None")
      if (connectedPort && event.target.checked && event.target.id !== 'diag-none') {
        const selectedMode = event.target.id;
        switch(selectedMode) {
          case 'diag-input-enable':
            window.startDiagPinStatusPolling();
            setBoxActive('diag-input-status', true);
            break;
          case 'diag-hat-enable':
            window.startDiagHatStatusPolling();
            setBoxActive('diag-hat-status', true);
            break;
          case 'diag-whammy-enable':
            window.startDiagWhammyPolling();
            setBoxActive('diag-whammy-status', true);
            break;
          case 'diag-led-enable':
            // Auto-start LED test when radio button is selected
            setTimeout(() => {
              console.log('🔲 LED radio button selected - starting LED test');
              if (window.startLedTest && !window.ledTestActive) {
                console.log('🔲 Auto-starting LED test from radio button selection');
                window.startLedTest();
              } else if (window.ledTestActive) {
                console.log('🔲 LED test already active, skipping auto-start');
              }
            }, 200); // Delay to ensure modal is fully rendered
            break;
          default:
            // For any other selection, hide the popover and stop LED test
            if (bufferClearingActive) {
              console.log('🔲 Hiding popover for other selection');
              hideBufferClearingPopover();
            }
            if (window.stopLedTest) {
              window.stopLedTest();
            }
            break;
        }
      } else if (event.target.checked && event.target.id === 'diag-none') {
        // Explicitly handle "None" selection
        console.log('🔲 None selected - hiding popover and stopping LED test');
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        if (window.stopLedTest) {
          window.stopLedTest();
        }
      }
    }
  }
  
  // Data handler functions for polling
  function diagPinStatusHandler(data) {
    try {
      const str = data.toString().trim();
      
      // Validate and parse PIN data
      const pinMatch = str.match(/PIN:([A-Z_]+):(\d+)/);
      if (pinMatch) {
        // Hide buffer clearing popover when pin data arrives
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        const key = pinMatch[1];
        const val = pinMatch[2];
        
        // Validate the key is one we expect
        const validKeys = ['GREEN_FRET', 'RED_FRET', 'YELLOW_FRET', 'BLUE_FRET', 'ORANGE_FRET', 
                          'STRUM_UP', 'STRUM_DOWN', 'START', 'SELECT', 'TILT'];
        if (validKeys.includes(key)) {
          diagPinStatusMap[key] = val;
          updateDiagInputBoxes();
        }
      }
      
      // Also hide popover for PREVIEWLED confirmations (LED test commands)
      if (str.includes('PREVIEWLED applied') || str.includes('PREVIEWLED')) {
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
      }
    } catch (err) {
      console.warn('[DIAG] Pin status handler error:', err);
    }
  }
  
  function updateDiagInputBoxes() {
    const buttonInputsRow1 = [
      { name: 'Green', key: 'GREEN_FRET' },
      { name: 'Red', key: 'RED_FRET' },
      { name: 'Yellow', key: 'YELLOW_FRET' },
      { name: 'Blue', key: 'BLUE_FRET' },
      { name: 'Orange', key: 'ORANGE_FRET' }
    ];
    const buttonInputsRow2 = [
      { name: 'Strum Up', key: 'STRUM_UP' },
      { name: 'Strum Down', key: 'STRUM_DOWN' },
      { name: 'Start', key: 'START' },
      { name: 'Select', key: 'SELECT' },
      { name: 'Tilt', key: 'TILT' }
    ];
    
    [...buttonInputsRow1, ...buttonInputsRow2].forEach(input => {
      const key = input.key;
      const status = diagPinStatusMap[key];
      const box = document.querySelector(`.diag-input-box[data-key='${key}']`);
      if (box) {
        const statusElement = box.querySelector('div:last-child');
        if (status === '1') {
          box.style.background = '#ffe066';
          box.style.borderColor = '#ffe066';
          box.style.color = '#222';
          if (statusElement) statusElement.textContent = 'ON';
        } else if (status === '0') {
          box.style.background = '#111';
          box.style.borderColor = '#ffe066';
          box.style.color = '#ffe066';
          if (statusElement) statusElement.textContent = 'OFF';
        } else {
          box.style.background = '#333';
          box.style.borderColor = '#bbb';
          box.style.color = '#ffe066';
          if (statusElement) statusElement.textContent = 'OFF';
        }
      }
    });
  }
  
  function diagHatStatusHandler(data) {
    try {
      const str = data.toString().trim();
      
      // Handle DPAD pin responses (PIN:UP:1, etc.) and GUIDE button
      const pinMatch = str.match(/PIN:(UP|DOWN|LEFT|RIGHT|GUIDE):(\d+)/);
      if (pinMatch) {
        // Hide buffer clearing popover when hat pin data arrives
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        const key = pinMatch[1];
        const val = pinMatch[2];
        
        // Validate the key is a valid D-pad key
        const validDpadKeys = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'GUIDE'];
        if (validDpadKeys.includes(key)) {
          diagHatStatusMap[key] = val;
          updateDiagHatStatus();
        }
        return;
      }
      
      // Handle joystick responses (JOYSTICK:X:value:Y:value)
      const joyMatch = str.match(/JOYSTICK:X:(\d+):Y:(\d+)/);
      if (joyMatch) {
        // Hide buffer clearing popover when joystick data arrives
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        const xVal = parseInt(joyMatch[1]);
        const yVal = parseInt(joyMatch[2]);
        
        // Validate joystick values are in expected range (0-65535)
        if (!isNaN(xVal) && !isNaN(yVal) && xVal >= 0 && xVal <= 65535 && yVal >= 0 && yVal <= 65535) {
          diagHatStatusMap.X = xVal;
          diagHatStatusMap.Y = yVal;
          updateDiagHatStatus();
        }
        return;
      }
    } catch (err) {
      console.warn('[DIAG] Hat status handler error:', err);
    }
  }
  
  function updateDiagHatStatus() {
    const hatMode = originalConfig?.hat_mode || 'joystick';
    
    if (hatMode === 'dpad') {
      // Update DPAD buttons
      ['UP', 'DOWN', 'LEFT', 'RIGHT'].forEach(key => {
        const status = diagHatStatusMap[key];
        const btn = document.querySelector(`.diag-dpad-btn[data-key='${key}']`);
        if (btn) {
          if (status === '1') {
            btn.style.background = '#ffe066';
            btn.style.color = '#222';
          } else {
            btn.style.background = '#111';
            btn.style.color = '#ffe066';
          }
        }
      });
      
      // Update GUIDE button (only visible in D-Pad mode)
      const guideStatus = diagHatStatusMap['GUIDE'];
      const guideBtn = document.querySelector(`.diag-dpad-btn[data-key='GUIDE']`);
      if (guideBtn) {
        if (guideStatus === '1') {
          guideBtn.style.background = '#ffe066';
          guideBtn.style.color = '#222';
        } else {
          guideBtn.style.background = '#111';
          guideBtn.style.color = '#ffe066';
        }
      }
    } else {
      // Update joystick display
      const xVal = diagHatStatusMap.X;
      const yVal = diagHatStatusMap.Y;
      
      const xElement = document.getElementById('diag-hat-x');
      const yElement = document.getElementById('diag-hat-y');
      const dotElement = document.getElementById('diag-joystick-dot');
      
      if (xElement && typeof xVal === 'number') {
        xElement.textContent = xVal.toString();
      }
      if (yElement && typeof yVal === 'number') {
        yElement.textContent = yVal.toString();
      }
      
      // Update visual indicator dot position
      if (dotElement && typeof xVal === 'number' && typeof yVal === 'number') {
        // Convert joystick values (0-65535) to position within circle
        // Assuming center is around 32768
        const centerX = 32768;
        const centerY = 32768;
        const maxOffset = 26; // pixels from center (60px diameter / 2 - dot size)
        
        const offsetX = ((xVal - centerX) / centerX) * maxOffset;
        const offsetY = -((yVal - centerY) / centerY) * maxOffset; // Invert Y for correct visual mapping
        
        // Clamp to circle bounds
        const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
        let finalX = offsetX;
        let finalY = offsetY;
        
        if (distance > maxOffset) {
          finalX = (offsetX / distance) * maxOffset;
          finalY = (offsetY / distance) * maxOffset;
        }
        
        dotElement.style.transform = `translate(calc(-50% + ${finalX}px), calc(-50% + ${finalY}px))`;
      }
    }
  }

  // Use the existing LED test section in the HTML instead of creating a new one

  diagnosticsMenuBtn.onclick = function() {
    closeConfigMenu();
    
    // Stop main application polling to reduce serial traffic
    stopWhammyLiveFeedback();
    if (typeof stopPinStatusPolling === 'function') stopPinStatusPolling();
    
    // Remove any existing polling indicators
    const pollingIndicators = document.querySelectorAll('.polling-indicator');
    pollingIndicators.forEach(indicator => indicator.remove());
    
    diagnosticsModal.style.display = 'flex';
    initializeDiagnosticsSections();
    
    // Refresh device information when modal opens
    setTimeout(() => {
      setupDeviceInformation();
    }, 100);
    
    // Force update the hat section title immediately after the modal is visible
    const hatMode = (originalConfig && originalConfig.hat_mode) || 'joystick';
    console.log('Force updating hat title immediately. hatMode:', hatMode);
    
    // Try multiple approaches to ensure the title gets updated
    const hatTitleElement = document.getElementById('diag-hat-title');
    if (hatTitleElement) {
      const newText = hatMode === 'dpad' ? 'D-Pad Status' : 'Joystick Status';
      console.log('Immediately setting title to:', newText);
      hatTitleElement.textContent = newText;
    }
    
    // Also update after a short delay in case the element gets recreated
    setTimeout(() => {
      console.log('Diagnostics modal timeout callback executing');
      const hatMode = (originalConfig && originalConfig.hat_mode) || 'joystick';
      console.log('hatMode in timeout:', hatMode);
      console.log('originalConfig in timeout:', originalConfig);
      
      const hatTitleElement = document.getElementById('diag-hat-title');
      console.log('hatTitleElement in timeout:', hatTitleElement);
      if (hatTitleElement) {
        const newText = hatMode === 'dpad' ? 'D-Pad Status' : 'Joystick Status';
        console.log('Setting title in timeout to:', newText);
        hatTitleElement.textContent = newText;
      }
    }, 50); // Small delay to ensure DOM elements are created
    
    // Setup close button
    if (diagCloseBtn) {
      diagCloseBtn.onclick = function() {
        diagnosticsModal.style.display = 'none';
        
        // Hide buffer clearing popover when modal closes
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        // Stop all diagnostics polling
        if (typeof stopDiagPinStatusPolling === 'function') stopDiagPinStatusPolling();
        if (typeof stopDiagHatStatusPolling === 'function') stopDiagHatStatusPolling();
        if (typeof stopDiagWhammyPolling === 'function') stopDiagWhammyPolling();
        if (typeof stopLedTest === 'function') stopLedTest();
        
        // Don't restart any polling - the main app should be quiet when not in use
        // Note: Polling should only restart when specific modals are opened
      };
    }
  };

});  // End of DOMContentLoaded

// ===== LED Test Implementation =====
// Global LED test variables
window.ledTestActive = false;
let ledTestInterval = null;

// Global diagnostic mode tracking
let lastSelectedDiagnosticMode = 'diag-none'; // Remember last selected mode
let ledTestColors = [
  [255, 0, 0],    // Red
  [255, 165, 0],  // Orange
  [255, 255, 0],  // Yellow
  [0, 255, 0],    // Green
  [0, 0, 255],    // Blue
  [75, 0, 130],   // Indigo
  [238, 130, 238] // Violet
];
let ledTestStep = 0;

function startLedTest() {
  if (window.ledTestActive || !connectedPort) return;
  
  window.ledTestActive = true;
  ledTestStep = 0;
  
  // Start cycling through colors
  ledTestInterval = setInterval(() => {
    if (!connectedPort || !window.ledTestActive) {
      stopLedTest();
      return;
    }
    
    // Set all LEDs to current color
    const color = ledTestColors[ledTestStep % ledTestColors.length];
    for (let i = 0; i < 7; i++) {
      try {
        connectedPort.write(`SETLED:${i}:${color[0]}:${color[1]}:${color[2]}\n`);
      } catch (err) {
        console.error('LED test write error:', err);
        stopLedTest();
        return;
      }
    }
    
    ledTestStep++;
  }, 500); // Change color every 500ms
}

function stopLedTest() {
  if (!window.ledTestActive) return;
  
  window.ledTestActive = false;
  
  // Clear interval
  if (ledTestInterval) {
    clearInterval(ledTestInterval);
    ledTestInterval = null;
  }
  
  // Restore normal LED colors if connected
  if (connectedPort) {
    try {
      // Send command to restore normal LED operation
      connectedPort.write('LEDRESTORE\n');
    } catch (err) {
      console.error('LED restore error:', err);
    }
  }
}

// ===== Color Picker Enhancement for Mouse Events =====
let colorPickerInstances = new Map();
let isMouseDown = false;

function updatePreview(elementId, hexColor) {
  // Update the button color immediately (visual feedback only)
  selectedElements.forEach(el => {
    const bg = hexColor;
    const text = getTextColor(bg);
    el.style.backgroundColor = bg;
    el.style.color = text;
    liveColors.set(el, { bg, text });
  });
  
  // Update hex input
  const hexInput = document.getElementById("hexInput");
  if (hexInput) {
    hexInput.value = hexColor;
  }
  
  // Mark as dirty
  isDirty = true;
  configDirty = true;
  checkIfUserPresetModified();
  
  // NO LED PREVIEW - only visual button update for responsiveness
}

function enhanceColorPicker(colorPicker, elementId) {
  if (!colorPicker || !colorPicker.el) return;
  
  const pickerElement = colorPicker.el;
  let wasMouseDownOnPicker = false;
  
  // Add global mouse event listeners to catch mouse up outside picker
  const handleGlobalMouseUp = (e) => {
    if (wasMouseDownOnPicker) {
      wasMouseDownOnPicker = false;
      
      console.log('[ColorPicker] Global mouseup detected, sending LED preview');
      
      // Trigger final color update with LED preview (only on release)
      const currentColor = colorPicker.color.hexString;
      if (currentColor && selectedElements.length > 0) {
        // Send LED preview command to device (only on final release)
        const previewLines = selectedElements.map(el => {
          let name = el.id || el.dataset.name || '';
          if (name === 'strum-up-released') name = 'strum-up';
          if (name === 'strum-down-released') name = 'strum-down';
          return `PREVIEWLED:${name}:${currentColor}\n`;
        }).join('');

        try {
          if (connectedPort && previewLines) {
            console.log('[ColorPicker] Sending LED preview commands:', previewLines);
            connectedPort.write(previewLines);
          }
        } catch (err) {
          console.error("Serial preview failed:", err);
        }
      }
    }
  };
  
  // Track mouse down on picker - use capture phase to ensure we catch it
  pickerElement.addEventListener('mousedown', (e) => {
    wasMouseDownOnPicker = true;
    console.log('[ColorPicker] Mouse down on picker detected');
  }, true);
  
  // Also track if mouse is released inside the picker
  pickerElement.addEventListener('mouseup', (e) => {
    if (wasMouseDownOnPicker) {
      wasMouseDownOnPicker = false;
      console.log('[ColorPicker] Mouse up inside picker detected, sending LED preview');
      
      // Send LED preview on mouse up inside picker too
      const currentColor = colorPicker.color.hexString;
      if (currentColor && selectedElements.length > 0) {
        const previewLines = selectedElements.map(el => {
          let name = el.id || el.dataset.name || '';
          if (name === 'strum-up-released') name = 'strum-up';
          if (name === 'strum-down-released') name = 'strum-down';
          return `PREVIEWLED:${name}:${currentColor}\n`;
        }).join('');

        try {
          if (connectedPort && previewLines) {
            console.log('[ColorPicker] Sending LED preview commands:', previewLines);
            connectedPort.write(previewLines);
          }
        } catch (err) {
          console.error("Serial preview failed:", err);
        }
      }
    }
  }, true);
  
  // Add global listeners - use capture phase
  document.addEventListener('mouseup', handleGlobalMouseUp, true);
  
  // Store cleanup function
  colorPickerInstances.set(elementId, {
    picker: colorPicker,
    cleanup: () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp, true);
    }
  });
}

function cleanupColorPicker(elementId) {
  const instance = colorPickerInstances.get(elementId);
  if (instance && instance.cleanup) {
    instance.cleanup();
    colorPickerInstances.delete(elementId);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Create a comprehensive modal close handler function
  window.handleDiagnosticsModalClose = async function() {
    console.log('Diagnostics modal closing - handling cleanup and reload...');
    
    // Stop LED test
    if (window.stopLedTest) {
      window.stopLedTest();
    }
    
    // Reload device files to refresh the main window state
    console.log('Reloading device files after diagnostics modal close...');
    const activeDevice = window.multiDeviceManager?.getActiveDevice();
    if (activeDevice && activeDevice.isConnected) {
      try {
        // Use the forceReloadDeviceFiles function if available (more comprehensive)
        if (window.multiDeviceManager && typeof window.multiDeviceManager.forceReloadDeviceFiles === 'function') {
          console.log('Using multiDeviceManager.forceReloadDeviceFiles...');
          await window.multiDeviceManager.forceReloadDeviceFiles(activeDevice);
          console.log('forceReloadDeviceFiles completed successfully');
        } else {
          // Fallback to manual loading
          console.log('Fallback to manuallyLoadDeviceFiles...');
          await window.manuallyLoadDeviceFiles();
        }
        
        // Update UI status after successful reload
        updateStatus('Ready', true, '#2ecc40');
        if (typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(activeDevice);
        }
        
        console.log('Device files reloaded successfully after diagnostics modal close');
      } catch (error) {
        console.error('Failed to reload device files after diagnostics modal close:', error);
        // Still update UI to show connection status
        if (typeof window.updateActiveButtonText === 'function') {
          window.updateActiveButtonText(activeDevice);
        }
      }
    } else {
      console.log('No active device - skipping file reload');
      // Update status for no device
      updateStatus('No device connected', false);
      if (typeof window.updateActiveButtonText === 'function') {
        window.updateActiveButtonText(null);
      }
    }
  };

  // Override modal close to ensure LED test stops and files reload
  const diagCloseBtn = document.getElementById('diag-close-btn');
  if (diagCloseBtn) {
    diagCloseBtn.addEventListener('click', async () => {
      console.log('Diagnostics modal close button clicked');
      
      // Close the modal first
      const diagnosticsModal = document.getElementById('diagnostics-modal');
      if (diagnosticsModal) {
        diagnosticsModal.style.display = 'none';
      }
      
      // Handle cleanup and reload (will be called by MutationObserver)
      // No need to call handleDiagnosticsModalClose here since MutationObserver will catch it
    });
  }
  
  // Stop LED test when modal loses focus and handle file reload
  const diagnosticsModal = document.getElementById('diagnostics-modal');
  if (diagnosticsModal) {
    let modalWasOpen = false;
    
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'style') {
          const display = diagnosticsModal.style.display;
          
          // Track when modal opens
          if (display === 'flex' || display === 'block') {
            modalWasOpen = true;
            console.log('Diagnostics modal opened');
          }
          
          // Handle when modal closes (from any method - outside click, escape, etc.)
          if (display === 'none' && modalWasOpen) {
            modalWasOpen = false;
            console.log('Diagnostics modal closed via MutationObserver');
            
            // Use setTimeout to ensure the modal close completes first
            setTimeout(() => {
              window.handleDiagnosticsModalClose();
            }, 100);
          }
        }
      });
    });
    
    observer.observe(diagnosticsModal, {
      attributes: true,
      attributeFilter: ['style']
    });
  }
  
  // Stop LED test when polling option checkboxes change
  ['diag-input-enable', 'diag-whammy-enable', 'diag-hat-enable'].forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        if (ledTestActive) {
          stopLedTest();
        }
      });
    }
  });
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopLedTest();
  colorPickerInstances.forEach((instance, elementId) => {
    cleanupColorPicker(elementId);
  });
});

// ===== AUTOMATIC FIRMWARE UPDATE SYSTEM INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
  console.log("🔍 [App] DOMContentLoaded event fired - starting firmware update initialization");
  
  // Get button references at the start
  const updateButton = document.getElementById('check-for-updates');
  const refreshButton = document.getElementById('refresh-device-version');
  
  console.log("🔍 [App] Button references obtained:");
  console.log("🔍 [App] - updateButton found:", !!updateButton);
  console.log("🔍 [App] - refreshButton found:", !!refreshButton);
  
  // Initialize firmware updater and automatic updater
  let firmwareUpdater = null;
  let automaticUpdater = null;
  
  // Wait for serial to be available
  const initializeUpdaters = () => {
    console.log("🔍 [App] initializeUpdaters() called");
    
    // Check if we have the classes and either window.serial or an active device with port
    const activeDevice = window.multiDeviceManager?.getActiveDevice?.();
    const hasSerial = window.serial || (activeDevice && activeDevice.port);
    
    console.log("🔍 [App] Checking initialization conditions:");
    console.log("🔍 [App] - FirmwareUpdater available:", typeof FirmwareUpdater !== 'undefined');
    console.log("🔍 [App] - AutomaticFirmwareUpdater available:", typeof AutomaticFirmwareUpdater !== 'undefined');
    console.log("🔍 [App] - window.serial:", !!window.serial);
    console.log("🔍 [App] - activeDevice:", !!activeDevice);
    console.log("🔍 [App] - activeDevice.port:", !!activeDevice?.port);
    console.log("🔍 [App] - hasSerial:", hasSerial);
    
    // FORCE BUTTON SETUP REGARDLESS OF CONDITIONS
    console.log("� [App] FORCING button setup regardless of serial conditions...");
    
    if (updateButton) {
      console.log("🔧 [App] Setting up check-for-updates button...");
      // Clear any existing event listeners by cloning the node
      let targetButton = updateButton;
      if (updateButton.parentNode) {
        const newUpdateButton = updateButton.cloneNode(true);
        updateButton.parentNode.replaceChild(newUpdateButton, updateButton);
        targetButton = newUpdateButton;
      } else {
        console.warn("🔍 [App] updateButton has no parent node, cannot replace. Using original button.");
      }
      
      targetButton.addEventListener('click', async () => {
        console.log("🔍 [App] CHECK FOR UPDATES BUTTON CLICKED!");
        
        console.log("🔍 [App] window.automaticUpdater type:", typeof window.automaticUpdater);
        console.log("🔍 [App] window.automaticUpdater instance:", window.automaticUpdater);
        
        if (window.automaticUpdater) {
          try {
            console.log("🔍 [App] Calling automaticUpdater.manualUpdateCheck()...");
            await window.automaticUpdater.manualUpdateCheck();
            console.log("🔍 [App] manualUpdateCheck() completed successfully");
          } catch (error) {
            console.error("🔍 [App] manualUpdateCheck() error:", error);
          }
        } else {
          console.log("🔍 [App] Creating new AutomaticFirmwareUpdater instance...");
          if (typeof AutomaticFirmwareUpdater !== 'undefined') {
            window.automaticUpdater = new AutomaticFirmwareUpdater();
            console.log("🔍 [App] New instance created, trying manualUpdateCheck...");
            try {
              await window.automaticUpdater.manualUpdateCheck();
              console.log("🔍 [App] manualUpdateCheck() completed with new instance");
            } catch (error) {
              console.error("🔍 [App] manualUpdateCheck() error with new instance:", error);
            }
          } else {
            console.log("❌ [App] AutomaticFirmwareUpdater class not available!");
          }
        }
      });
      console.log("✅ [App] Event listener added to check-for-updates button");
    } else {
      console.log("❌ [App] check-for-updates button not found!");
    }
    
    if (refreshButton) {
      console.log("🔧 [App] Setting up refresh-device-version button...");
      // Clear any existing event listeners by cloning the node
      const newRefreshButton = refreshButton.cloneNode(true);
      refreshButton.parentNode.replaceChild(newRefreshButton, refreshButton);
      
      newRefreshButton.addEventListener('click', async () => {
        console.log("🔍 [App] REFRESH DEVICE VERSION BUTTON CLICKED!");
        
        console.log("🔍 [App] window.automaticUpdater type:", typeof window.automaticUpdater);
        console.log("🔍 [App] window.automaticUpdater instance:", window.automaticUpdater);
        
        if (window.automaticUpdater) {
          try {
            console.log("🔍 [App] Calling automaticUpdater.refreshDeviceVersion()...");
            await window.automaticUpdater.refreshDeviceVersion();
            console.log("🔍 [App] refreshDeviceVersion() completed successfully");
          } catch (error) {
            console.error("🔍 [App] refreshDeviceVersion() error:", error);
          }
        } else {
          console.log("🔍 [App] Creating new AutomaticFirmwareUpdater instance...");
          if (typeof AutomaticFirmwareUpdater !== 'undefined') {
            window.automaticUpdater = new AutomaticFirmwareUpdater();
            console.log("🔍 [App] New instance created, trying refreshDeviceVersion...");
            try {
              await window.automaticUpdater.refreshDeviceVersion();
              console.log("🔍 [App] refreshDeviceVersion() completed with new instance");
            } catch (error) {
              console.error("🔍 [App] refreshDeviceVersion() error with new instance:", error);
            }
          } else {
            console.log("❌ [App] AutomaticFirmwareUpdater class not available!");
          }
        }
      });
      console.log("✅ [App] Event listener added to refresh-device-version button");
    } else {
      console.log("❌ [App] refresh-device-version button not found!");
    }
    
    if (typeof FirmwareUpdater !== 'undefined' && typeof AutomaticFirmwareUpdater !== 'undefined' && hasSerial) {
      console.log("🚀 Initializing firmware update system...");
      
      // Set up window.serial if not already available
      if (!window.serial && activeDevice && activeDevice.port) {
        window.serial = activeDevice.port;
        console.log("📡 Using active device port for automatic updater");
      }
      
      // Create firmware updater instance
      firmwareUpdater = new FirmwareUpdater();
      
      // Create automatic updater instance  
      automaticUpdater = new AutomaticFirmwareUpdater();
      
      // Initialize automatic updater with firmware updater and multiDeviceManager
      automaticUpdater.initialize(firmwareUpdater, window.multiDeviceManager);
      
      // Make instances available globally for debugging
      window.firmwareUpdater = firmwareUpdater;
      window.automaticUpdater = automaticUpdater;
      
      console.log("✅ Firmware update system initialized");
      
    } else {
      console.log("⚠️ [App] Not all conditions met for full initialization, but buttons are set up");
      
      // Still try to create instances even without full conditions
      if (typeof AutomaticFirmwareUpdater !== 'undefined') {
        window.automaticUpdater = new AutomaticFirmwareUpdater();
        console.log("✅ Created AutomaticFirmwareUpdater instance for button testing");
      }
      
      // Retry in 1 second if dependencies aren't ready
      setTimeout(initializeUpdaters, 1000);
    }
  };
  
  // Start initialization
  initializeUpdaters();
  
  // Also initialize when device connects
  window.addEventListener('deviceConnected', () => {
    console.log("🔌 Device connected, re-checking automatic updater...");
    setTimeout(initializeUpdaters, 500);
  });
});

// ===== DEBUGGING: Test button functionality directly =====
window.testButtons = function() {
  console.log("🔍 [Debug] Testing button functionality...");
  
  const updateButton = document.getElementById('check-for-updates');
  const refreshButton = document.getElementById('refresh-device-version');
  
  console.log("🔍 [Debug] check-for-updates button found:", !!updateButton);
  console.log("🔍 [Debug] refresh-device-version button found:", !!refreshButton);
  console.log("🔍 [Debug] AutomaticFirmwareUpdater class available:", typeof AutomaticFirmwareUpdater !== 'undefined');
  console.log("🔍 [Debug] window.automaticUpdater:", typeof window.automaticUpdater);
  
  return {
    updateButton: !!updateButton,
    refreshButton: !!refreshButton,
    automaticUpdater: typeof window.automaticUpdater
  };
};

// ===== DEBUGGING: Auto-test when diagnostics modal opens =====
document.addEventListener('click', function(event) {
  if (event.target && event.target.textContent && event.target.textContent.includes('Diagnostics')) {
    console.log("🔍 [Debug] Diagnostics clicked, will test buttons in 2 seconds...");
    setTimeout(() => {
      console.log("🔍 [Debug] Running button test...");
      window.testButtons();
    }, 2000);
  }
});

// ===== IMMEDIATE DEBUGGING: Log app startup =====
console.log("🚀 [DEBUG] app.js script loaded and executing!");
console.log("🚀 [DEBUG] Current DOM ready state:", document.readyState);

// Force button test immediately
setTimeout(() => {
  console.log("🚀 [DEBUG] 5-second delayed test starting...");
  window.testButtons();
}, 5000);