// compare_user_presets.js
// Run with: node compare_user_presets.js
// This script will:
// 1. Read user_presets.json directly from the filesystem
// 2. Read user_presets.json from the device using serialFileIO.js
// 3. Print both outputs for comparison

const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { readFile } = require('./renderer/serialFileIO');

const DEVICE_PORT = 'COM24'; // Change to your device's port if needed
const BAUD_RATE = 115200;
const LOCAL_USER_PRESETS_PATH = path.join(__dirname, 'firmware', 'user_presets.json');

async function main() {
  // 1. Read from local filesystem
  let localContent = '';
  try {
    localContent = fs.readFileSync(LOCAL_USER_PRESETS_PATH, 'utf8');
    console.log('----- Local user_presets.json (filesystem) -----');
    console.log(localContent.trim());
    console.log('----- End Local user_presets.json -----\n');
  } catch (err) {
    console.error('Error reading local user_presets.json:', err);
  }

  // 2. Read from device using serialFileIO.js
  const port = new SerialPort({ path: DEVICE_PORT, baudRate: BAUD_RATE, autoOpen: false });
  port.open(async err => {
    if (err) {
      console.error('Error opening serial port:', err);
      return;
    }
    try {
      const deviceContent = await readFile(port, 'user_presets.json');
      console.log('----- Device user_presets.json (serial) -----');
      console.log(deviceContent.trim());
      console.log('----- End Device user_presets.json -----');
    } catch (err) {
      console.error('Error reading user_presets.json from device:', err);
    } finally {
      port.close();
    }
  });
}

main();
