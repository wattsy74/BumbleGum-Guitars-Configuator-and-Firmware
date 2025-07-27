const { SerialPort } = require('serialport');

// Shared state references (to be injected from app.js)
let connectedPort = null;
let awaitingFile = null;
let responseBuffers = {};
let readQueue = [];
let updateDeviceSelector = () => {};
let requestNextFile = () => {};
let showToast = () => {};

class MultiDeviceManager {
  constructor() {
    this.devices = new Map();
    this.connectedDevices = new Map();
    this.activeDevice = null;
    this.lastActiveDeviceInfo = null; // Store info for auto-reconnection
    this.scanning = false;
    this.scanInterval = null;
    this.eventListeners = new Map();
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
    try {
      const ports = await SerialPort.list();
      const guitarDevices = ports.filter(port => 
        port.vendorId && port.productId &&
        port.vendorId.toLowerCase() === '6997' &&
        port.pnpId && port.pnpId.includes('MI_02') // Only the 02 interface (serial)
      );

      // ...existing code...
      // (rest of scanForDevices logic unchanged)
    } catch (error) {
      console.error('Error scanning for devices:', error);
      return [];
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
      this.scanForDevices();
    }, intervalMs);
  }

  // ...existing code...
  // (rest of MultiDeviceManager methods unchanged)
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
