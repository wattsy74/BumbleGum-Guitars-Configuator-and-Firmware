const { SerialPort } = require('serialport');

// Debug logging for serialport
console.log('SerialPort module loaded:', !!SerialPort);
console.log('SerialPort.list method available:', typeof SerialPort.list);

const fs = require('fs');
const path = require('path');
const sudo = require('sudo-prompt');
const { ipcRenderer } = require('electron');
const { exec } = require('child_process');

// Global variables
let originalConfig = null;

// Get app version from package.json
function getAppVersion() {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return `v${packageData.version}`;
  } catch (err) {
    console.error('Error reading package.json:', err);
    return 'v2.2.0'; // Fallback version
  }
}

// Get presets version from presets.json metadata
function getPresetsVersion() {
  try {
    // Try to get from global presets variable first (if already loaded)
    if (window.loadedPresets && window.loadedPresets._metadata) {
      return `v${window.loadedPresets._metadata.version}`;
    }
    return 'Not loaded';
  } catch (err) {
    console.error('Error reading presets version:', err);
    return 'Unknown';
  }
}

// ===== Shared/global variables and functions =====
let connectedPort = null;
let bootselPrompted = false;
let isFlashingFirmware = false;
let selectedElements = [];
let awaitingFile = null;
let responseBuffers = {};
let currentPreviewColor = null;
let previewPending = false;
let isDirty = false;
let configDirty = false;
const fretIndexMap = [6, 5, 4, 3, 2];
const liveColors = new Map();
let readQueue = [];

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
let activeUserPreset = null;

function closeConfigMenu() {
  const configMenu = document.getElementById('config-menu');
  if (configMenu) configMenu.style.display = 'none';
}

const updateStatus = (text, isConnected = false) => {
  const statusText = document.getElementById('status-text');
  if (statusText) {
    statusText.textContent = text;
    statusText.style.color = isConnected ? '#2ecc40' : '#ff4136';
  }
};

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
  const allButtons = document.querySelectorAll('.fret-button, .strum-button');
  const presetData = {};
  allButtons.forEach(btn => {
    const name = btn.id;
    let rawColor = btn.style.backgroundColor;
    if (rawColor) {
      const hexColor = rawColor.startsWith('rgb') ? rgbToHex(rawColor) : rawColor;
      presetData[name] = hexColor;
    }
  });
  return presetData;
};

const initFileQueue = () => ['config.json', 'presets.json', 'user_presets.json'];

const populatePresetDropdown = (presets, isUserPresets = false) => {
  const id = isUserPresets ? 'user-preset-select' : 'preset-select';
  const select = document.getElementById(id);
  if (!select || !presets) return;

  // Handle new versioned structure - extract just the presets
  const presetsData = presets.presets || presets;

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

  for (const key of keys) {
    const value = presetsData[key];
    const opt = document.createElement('option');
    opt.value = JSON.stringify(value);
    opt.textContent = key;
    select.appendChild(opt);
  }
};

const applyConfig = config => {
  originalConfig = config;

  fretIndexMap.forEach((ledIndex, i) => {
    const pressedBtn = document.querySelectorAll('.pressed-set .fret-button')[i];
    const releasedBtn = document.querySelectorAll('.released-set .fret-button')[i];

    if (pressedBtn) {
      const bg = config.led_color[ledIndex];
      const text = getTextColor(bg);
      pressedBtn.style.backgroundColor = bg;
      pressedBtn.style.color = text;
      liveColors.set(pressedBtn, { bg, text });
    }

    if (releasedBtn) {
      const bg = config.released_color[ledIndex];
      const text = getTextColor(bg);
      releasedBtn.style.backgroundColor = bg;
      releasedBtn.style.color = text;
      liveColors.set(releasedBtn, { bg, text });
    }
  });

  document.querySelectorAll('.active-set .strum-button').forEach((el, i) => {
    const bg = config.led_color[i];
    const text = getTextColor(bg);
    el.style.backgroundColor = bg;
    el.style.color = text;
    liveColors.set(el, { bg, text });
  });

  document.querySelectorAll('.released-set .strum-button').forEach((el, i) => {
    const bg = config.released_color[i];
    const text = getTextColor(bg);
    el.style.backgroundColor = bg;
    el.style.color = text;
    liveColors.set(el, { bg, text });
  });

  document.querySelector('.fret-toggle-button.selected')?.click();
  
  // Update hat status display when config is loaded
  if (typeof setupHatStatusDisplay === 'function') {
    setupHatStatusDisplay();
  }
  
  // Update toggle button text based on current mode
  updateToggleButtonText();
  updateTiltWaveButtonText();
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
    connectedPort?.on('data', whammyLiveHandler);
  }

  function stopWhammyLiveFeedback() {
    if (whammyLiveInterval) clearInterval(whammyLiveInterval);
    whammyLiveInterval = null;
    connectedPort?.off('data', whammyLiveHandler);
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

  // On apply, save values
  whammyApplyBtn?.addEventListener('click', () => {
    if (!originalConfig) return;
    originalConfig.whammy_min = whammyMinValue;
    originalConfig.whammy_max = whammyMaxValue;
    originalConfig.whammy_reverse = whammyReverse.checked;
    try {
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      updateStatus("Whammy calibration applied ✅", true);
      hideWhammyModal();
    } catch (err) {
      console.error("Failed to apply whammy calibration:", err);
      updateStatus("Failed to write config", false);
    }
  });

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
    
    // Set minimum with padding (subtract 10% of range or minimum 100, whichever is larger)
    const restPadding = Math.max(100, Math.floor((restMax - restMin) * 0.1 + 200));
    const calibratedMin = Math.max(0, Math.floor(restMin - restPadding));
    
    whammyMinValue = calibratedMin;
    whammyMinVal.value = calibratedMin;
    
    // Move to step 2
    autoCalStep = 2;
    autoCalSamples = [];
    whammyAutoCalStatus.textContent = "Step 2: Fully depress whammy and hold for 3 seconds";
    whammyAutoCalStatus.style.color = "#66ccff";
    
    updateWhammyVals();
    drawWhammyGraph();
    
    // Auto-advance after 3 more seconds
    setTimeout(() => {
      if (autoCalStep === 2) {
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
    
    // Set maximum with padding (add 10% of range or minimum 100, whichever is larger)  
    const fullPadding = Math.max(100, Math.floor((fullMax - fullMin) * 0.1 + 200));
    const calibratedMax = Math.min(65535, Math.floor(fullMax + fullPadding));
    
    whammyMaxValue = calibratedMax;
    whammyMaxVal.value = calibratedMax;
    
    updateWhammyVals();
    drawWhammyGraph();
    
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

  whammyApplyBtn?.addEventListener('click', () => {
    console.log('[DEBUG] showWhammyModal called');
    if (!originalConfig) {
      console.log('[DEBUG] showWhammyModal: originalConfig missing');
      return;
    }
    // Update config
    originalConfig.whammy_min = Number(whammyMin.value);
    originalConfig.whammy_max = Number(whammyMax.value);
    originalConfig.whammy_reverse = whammyReverse.checked;
    // Save to device
    try {
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      updateStatus("Whammy calibration applied ✅", true);
      hideWhammyModal();
    } catch (err) {
      console.error("Failed to apply whammy calibration:", err);
      updateStatus("Failed to write config", false);
    }
  });
  console.log("🌱 App initialized and DOM fully loaded.");
  
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
          connectedPort.write("REBOOTBOOTSEL\n");
          updateStatus("Preparing to Reflash...", false);
          bootselPrompted = false;
          isFlashingFirmware = false;
        } catch (err) {
          console.error("❌ Failed to send reboot command:", err);
          updateStatus("Reboot failed ❌", false);
        }
      } else {
        errorMsg.style.display = 'block';
        input.focus();
      }
    }

    function onCancel() {
      cleanup();
      updateStatus("Reflash cancelled.", false);
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
    if (bootselPrompted || isFlashingFirmware || connectedPort) return;
    //console.log("👀 Checking for BOOTSEL volumes...");
    //updateStatus("Scanning for BOOTSEL devices...", false);
    if (bootselPrompted) return;

    for (let i = 65; i <= 90; i++) {
      const driveLetter = String.fromCharCode(i);
      const infoPath = `${driveLetter}:\\INFO_UF2.TXT`;

      try {
        console.log(`🔎 Scanning ${driveLetter}:\\INFO_UF2.TXT`);

        if (fs.existsSync(infoPath)) {
          const content = fs.readFileSync(infoPath, 'utf8');
          if (/RP2040|RPI-RP2|Board-ID/i.test(content)) {
            bootselPrompted = true;
            updateStatus("Controller detected in BOOTSEL mode", false);
            promptFirmwareFlash(`${driveLetter}:\\`);
            break;
          }
        }
      } catch (_) { }
    }
  }

  setInterval(detectUnprogrammedController, 3000); // Adjust to taste
  console.log("🔁 BOOTSEL detection polling set up.");

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
      const files = fs.readdirSync(__dirname);
      const firmwareFile = files.find(file => file.match(/^bgg-fw.*\.uf2$/i));
      if (firmwareFile) {
        return path.resolve(__dirname, firmwareFile);
      }
    } catch (err) {
      console.error("Error searching for firmware file:", err);
    }
    
    // Fallback to old hardcoded name if no pattern match found
    return path.resolve(__dirname, 'bgg-fw.uf2');
  }

  function flashFirmwareTo(drivePath) {
    const firmwarePath = findFirmwareFile();
    const targetPath = path.join(drivePath, path.basename(firmwarePath));
    const start = Date.now();

    updateStatus(`Flashing firmware please wait...`, false);
    console.log(`⚡ Attempting to copy ${firmwarePath} → ${targetPath}`);

    try {
      fs.copyFile(firmwarePath, targetPath, err => {
        if (err) {
          console.error("❌ Flash error:", err);
          updateStatus("Flash failed ❌", false);
          return;
        }

        const time = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`✅ Firmware copied in ${time}s`);
        updateStatus(`Firmware flashed in ${time}s ✅`, true);

        setTimeout(() => {
          updateStatus("Waiting for controller to reboot...", false);
          detectRebootedController();
        }, 3000);
      });
    } catch (err) {
      console.error("❌ Flash error:", err);
      updateStatus("Flash failed ❌", false);
    }
  }

  function detectRebootedController() {
    findSerialDeviceByVID(6997).then(device => {
      if (device) {
        updateStatus("Controller rebooted and ready 🎉", true);
        console.log("🔍 Checking for rebooted controller...");
        isFlashingFirmware = false; // ✅ Reset flag
        window.rp2040Detected = false;
        bootselPrompted = false;

        readQueue = initFileQueue();
        requestNextFile();
      } else {
        updateStatus("Waiting for controller...", false);
      }
    });
  }

  const requestNextFile = () => {
    awaitingFile = readQueue.shift();
    if (awaitingFile && connectedPort) {
      responseBuffers[awaitingFile] = '';
      connectedPort.write(`READFILE:${awaitingFile}\n`);
    } else {
      updateStatus('All files loaded ✅', true);
      
      // After all files are loaded, get device name for footer display
      requestDeviceName(name => {
        const footerDeviceName = document.getElementById('footer-device-name');
        if (footerDeviceName) {
          if (name) {
            footerDeviceName.textContent = `Connected: ${name}`;
            footerDeviceName.style.color = '#2ecc40'; // Green color for connected
          } else {
            footerDeviceName.textContent = 'Connected: Unknown device';
            footerDeviceName.style.color = '#ff851b'; // Orange for unknown
          }
        }
      });
    }
  };

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
        } catch (err) {
          console.error("❌ Serial preview failed:", err);
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

  document.getElementById('preset-select')?.addEventListener('change', e => {
    try {
      const selected = JSON.parse(e.target.value);
      for (const [label, hex] of Object.entries(selected)) {
        const match = Array.from(document.querySelectorAll('.fret-button, .strum-button')).find(el =>
          el.textContent === label || el.dataset.name === label || el.id === label
        );
        if (match) {
          match.style.backgroundColor = hex;
          match.style.color = getTextColor(hex);
          liveColors.set(match, { bg: hex, text: getTextColor(hex) });
        }
      }
      const activeState = document.querySelector('.fret-toggle-button.selected')?.dataset.state || 'pressed';
      sendPreviewForVisibleButtons(activeState);
      configDirty = true;
      document.getElementById('apply-config-btn').style.display = 'inline-block';

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
      const raw = e.target?.value;
      const preset = JSON.parse(raw);
      activeUserPreset = preset;
      isDirty = false;

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

      for (const [label, hex] of Object.entries(preset)) {
        const match = document.getElementById(label);
        if (match) {
          match.style.backgroundColor = hex;
          match.style.color = getTextColor(hex);
          liveColors.set(match, { bg: hex, text: getTextColor(hex) });
        }
      }

      const state = document.querySelector('.fret-toggle-button.selected')?.dataset.state || 'pressed';
      sendPreviewForVisibleButtons(state);

    } catch (err) {
      console.warn("Failed to auto-load preset:", err);
    }
  });


  const presetSelect = document.getElementById('preset-select');
  const userPresetSelect = document.getElementById('user-preset-select');

  presetSelect?.addEventListener('change', () => {
    if (userPresetSelect) userPresetSelect.selectedIndex = 0;
  });

  userPresetSelect?.addEventListener('change', () => {
    if (presetSelect) presetSelect.selectedIndex = 0;
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

    // ✅ Collect data and send IMPORTUSER command
    const data = collectCurrentColors();
    const payload = JSON.stringify({ [slot]: data });

    try {
      if (connectedPort) {
        connectedPort.write("IMPORTUSER\n");
        connectedPort.write(payload + "\n");
        connectedPort.write("END\n");
        updateStatus(`Saved to ${slot}`, true);
        awaitingFile = 'user_presets.json';
        responseBuffers[awaitingFile] = '';
        connectedPort.write("READFILE:user_presets.json\n");
      }
      isDirty = false;
      document.getElementById('save-custom-btn').style.display = 'none';
      activeUserPreset = collectCurrentColors(); // update reference
    } catch (err) {
      console.error("Failed to send preset data:", err);
      updateStatus("Save failed", false);
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
    const elements = [...document.querySelectorAll(fretSelector), ...document.querySelectorAll(strumSelector)];

    const previewLines = elements.map((el, i) => {
      const data = liveColors.get(el);
      let name = el.id || el.dataset.name || el.textContent || `button-${i}`;
      if (name === 'strum-up-released') name = 'strum-up';
      if (name === 'strum-down-released') name = 'strum-down';
      const bg = data?.bg || el.style.backgroundColor;
      return bg ? `PREVIEWLED:${name}:${bg}\n` : null;
    }).filter(Boolean).join('');

    try {
      if (connectedPort && previewLines) {
        connectedPort.write(previewLines);
      }
    } catch (err) {
      console.error("❌ Preview dispatch failed:", err);
    }
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

      sendPreviewForVisibleButtons(state);
    });
  });

  const pickerRoot = document.querySelector('#picker-root');
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

  function requestDeviceUid(callback) {
    if (!connectedPort) return callback(null);
    let buffer = '';
    console.log("🔍 Requesting device UID...");
    connectedPort.write("READUID\n");
    const onData = data => {
      const dataStr = data.toString();
      console.log("📥 UID Serial data received:", JSON.stringify(dataStr));
      buffer += dataStr;
      console.log("📥 UID Buffer so far:", JSON.stringify(buffer));
      if (buffer.includes('END')) {
        console.log("✅ UID END marker found, processing...");
        connectedPort.off('data', onData);
        console.log("🔍 UID Buffer content:", JSON.stringify(buffer));
        const match = buffer.match(/[0-9A-F]{16}/i);
        console.log("🎯 UID Regex match result:", match);
        callback(match ? match[0] : null);
      }
    };
    connectedPort.on('data', onData);
  }

  function requestDeviceName(callback) {
    if (!connectedPort) return callback(null);
    let buffer = '';
    connectedPort.write("READFILE:boot.py\n");
    const onData = data => {
      buffer += data.toString();
      if (buffer.includes('END')) {
        connectedPort.off('data', onData);
        let bootPy = buffer.replace(/END\s*$/, '');
        
        // Extract device name from usb_hid.set_interface_name() call
        const interfaceNameMatch = bootPy.match(/usb_hid\.set_interface_name\(\s*"(.+?)"\s*\)/);
        if (interfaceNameMatch) {
          callback(interfaceNameMatch[1]);
        } else {
          // Fallback to product name if interface name not found
          const productMatch = bootPy.match(/product\s*=\s*"(.+?)"/);
          callback(productMatch ? productMatch[1] : null);
        }
      }
    };
    connectedPort.on('data', onData);
  }

  function requestDeviceFirmwareVersion(callback) {
    if (!connectedPort) {
      console.log('❌ No connected port for firmware version request');
      return callback(null);
    }
    
    console.log('📱 Requesting device firmware version via READFILE:code.py');
    console.log('📡 Connected port state:', {
      path: connectedPort?.path,
      isOpen: connectedPort?.isOpen,
      readable: connectedPort?.readable,
      writable: connectedPort?.writable
    });
    
    let buffer = '';
    console.log('📤 Sending READFILE:code.py command...');
    connectedPort.write("READFILE:code.py\n");
    
    const onData = data => {
      console.log('📥 Received data chunk:', data.toString().length, 'chars');
      buffer += data.toString();
      console.log('📥 Total buffer length so far:', buffer.length);
      
      if (buffer.includes('END')) {
        console.log('✅ Received END marker, processing response...');
        connectedPort.off('data', onData);
        let codePy = buffer.replace(/END\s*$/, '');
        
        console.log('📄 Processed code.py content length:', codePy.length);
        console.log('📄 Received code.py content (first 300 chars):', codePy.substring(0, 300));
        console.log('📄 Last 200 chars:', codePy.substring(Math.max(0, codePy.length - 200)));
        
        // Extract firmware version from FIRMWARE_VERSIONS dictionary
        // Look for pattern: "code.py": "2.1" 
        console.log('🔍 Searching for FIRMWARE_VERSIONS with "code.py" key...');
        const firmwareVersionsMatch = codePy.match(/FIRMWARE_VERSIONS\s*=\s*{[^}]*"code\.py"\s*:\s*"([^"]+)"/);
        if (firmwareVersionsMatch) {
          console.log('✅ Device firmware version extracted from FIRMWARE_VERSIONS:', firmwareVersionsMatch[1]);
          callback(normalizeVersion(firmwareVersionsMatch[1]));
          return;
        }
        
        // Also try with single quotes
        console.log('🔍 Searching for FIRMWARE_VERSIONS with single quotes...');
        const firmwareVersionsMatchSingle = codePy.match(/FIRMWARE_VERSIONS\s*=\s*{[^}]*'code\.py'\s*:\s*'([^']+)'/);
        if (firmwareVersionsMatchSingle) {
          console.log('✅ Device firmware version extracted from FIRMWARE_VERSIONS (single quotes):', firmwareVersionsMatchSingle[1]);
          callback(normalizeVersion(firmwareVersionsMatchSingle[1]));
          return;
        }
        
        // Fallback 1: Look for direct __version__ in code.py
        console.log('🔍 Searching for __version__ variable...');
        const versionMatch = codePy.match(/__version__\s*=\s*["']([^"']+)["']/);
        if (versionMatch) {
          console.log('✅ Device firmware version extracted from __version__:', versionMatch[1]);
          callback(normalizeVersion(versionMatch[1]));
          return;
        }
        
        // Fallback 2: Look for any version pattern in the file
        console.log('🔍 Searching for generic version pattern...');
        const anyVersionMatch = codePy.match(/version\s*[:=]\s*["']([^"']+)["']/i);
        if (anyVersionMatch) {
          console.log('✅ Device firmware version extracted from generic pattern:', anyVersionMatch[1]);
          callback(normalizeVersion(anyVersionMatch[1]));
          return;
        }
        
        console.log('⚠️ No firmware version found in device code.py');
        console.log('📄 Full code.py content for debugging:');
        console.log('-----START CODE.PY DEBUG-----');
        console.log(codePy);
        console.log('-----END CODE.PY DEBUG-----');
        
        // Try searching for any version-like patterns
        console.log('🔍 Searching for any version-like patterns...');
        const versionPatterns = [
          /([0-9]+\.[0-9]+(?:\.[0-9]+)?)/g,
          /"([^"]*[0-9]+\.[0-9]+[^"]*)"/g,
          /'([^']*[0-9]+\.[0-9]+[^']*)'/g
        ];
        
        versionPatterns.forEach((pattern, index) => {
          const matches = [...codePy.matchAll(pattern)];
          console.log(`🎯 Pattern ${index + 1} (${pattern.toString()}) found ${matches.length} matches:`, matches.map(m => m[1] || m[0]));
        });
        
        callback(null);
      }
    };
    connectedPort.on('data', onData);
  }

  function requestDetailedFirmwareVersions(callback) {
    // Get detailed version information for all firmware components
    if (!connectedPort) return callback(null);
    let buffer = '';
    connectedPort.write("READFILE:code.py\n");
    const onData = data => {
      buffer += data.toString();
      if (buffer.includes('END')) {
        connectedPort.off('data', onData);
        let codePy = buffer.replace(/END\s*$/, '');
        
        // Extract the entire FIRMWARE_VERSIONS dictionary
        const firmwareVersionsMatch = codePy.match(/FIRMWARE_VERSIONS\s*=\s*({[^}]+})/);
        if (firmwareVersionsMatch) {
          try {
            // Parse the dictionary (convert Python dict syntax to JSON)
            let versionsStr = firmwareVersionsMatch[1]
              .replace(/'/g, '"')  // Convert single quotes to double quotes
              .replace(/(\w+):/g, '"$1":');  // Quote unquoted keys
            
            const versions = JSON.parse(versionsStr);
            callback(versions);
          } catch (e) {
            console.error('Error parsing firmware versions:', e);
            callback(null);
          }
        } else {
          callback(null);
        }
      }
    };
    connectedPort.on('data', onData);
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
    return normalizeVersion("v2.2");
  }



  document.getElementById('apply-config-btn')?.addEventListener('click', () => {
    if (!connectedPort || !originalConfig) {
      updateStatus("Device not connected or config missing", false);
      return;
    }

    const updatedConfig = { ...originalConfig };
    const sanitizeColor = color => color?.startsWith('rgb') ? rgbToHex(color) : color;

    const colorFromId = id => {
      const el = document.getElementById(id);
      const raw = el?.style.backgroundColor;
      return sanitizeColor(raw || originalConfig.default_color);
    };

    // ✅ Use actual button IDs from your DOM
    updatedConfig.led_color = [];
    updatedConfig.led_color[0] = colorFromId('strum-up-active');
    updatedConfig.led_color[1] = colorFromId('strum-down-active');
    updatedConfig.led_color[2] = colorFromId('orange-fret-pressed');
    updatedConfig.led_color[3] = colorFromId('blue-fret-pressed');
    updatedConfig.led_color[4] = colorFromId('yellow-fret-pressed');
    updatedConfig.led_color[5] = colorFromId('red-fret-pressed');
    updatedConfig.led_color[6] = colorFromId('green-fret-pressed');

    updatedConfig.released_color = [];
    updatedConfig.released_color[0] = colorFromId('strum-up-released');
    updatedConfig.released_color[1] = colorFromId('strum-down-released');
    updatedConfig.released_color[2] = colorFromId('orange-fret-released');
    updatedConfig.released_color[3] = colorFromId('blue-fret-released');
    updatedConfig.released_color[4] = colorFromId('yellow-fret-released');
    updatedConfig.released_color[5] = colorFromId('red-fret-released');
    updatedConfig.released_color[6] = colorFromId('green-fret-released');

    try {
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(updatedConfig) + "\n");
      connectedPort.write("END\n");

      updateStatus("Config applied and saved ✅", true);
      configDirty = false;
      document.getElementById('apply-config-btn').style.display = 'none';
    } catch (err) {
      console.error("Failed to apply config:", err);
      updateStatus("Failed to write config", false);
    }
  });


  setInterval(() => {
    findSerialDeviceByVID(6997).then(device => {
      if (device && (!connectedPort || connectedPort.path !== device.path)) {
        connectedPort = new SerialPort({ path: device.path, baudRate: 115200 });

        connectedPort.on('open', () => {
          updateStatus('Reading config...', true);
          readQueue = initFileQueue();
          requestNextFile();
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
                  // ⛑️ Trigger auto-restore
                  updateStatus("Config unreadable — restoring factory defaults", false);
                  try {
                    connectedPort.write("READFILE:factory_config.json\n");
                    awaitingFile = "factory_config.json";
                    responseBuffers[awaitingFile] = '';
                    return; // stop further parsing
                  } catch (err) {
                    console.error("Failed to restore factory config:", err);
                    updateStatus("Restore failed", false);
                  }
                }

                awaitingFile = null;
                requestNextFile();
                return;
              }

              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (awaitingFile === 'config.json') {
                  applyConfig(parsed);
                } else if (awaitingFile === 'factory_config.json') {
                  applyConfig(parsed);

                  try {
                    connectedPort.write("WRITEFILE:config.json\n");
                    connectedPort.write(JSON.stringify(parsed) + "\n");
                    connectedPort.write("END\n");
                    updateStatus("Factory config applied and saved ✅", true);
                  } catch (err) {
                    console.error("Restore write failed:", err);
                    updateStatus("Restore failed", false);
                  }
                } else if (awaitingFile === 'presets.json') {
                  // Store presets globally to access version info
                  window.loadedPresets = parsed;
                  populatePresetDropdown(parsed, false);
                  // Update presets version in diagnostics if modal is open
                  const presetsVersionElement = document.getElementById('diag-presets-version');
                  if (presetsVersionElement) {
                    presetsVersionElement.textContent = getPresetsVersion();
                  }
                } else if (awaitingFile === 'user_presets.json') {
                  populatePresetDropdown(parsed, true);
                }

                updateStatus(`Loaded ${awaitingFile}`, true);
              } catch (err) {
                console.warn(`Parse error in ${awaitingFile}:`, err);

                if (awaitingFile === 'config.json') {
                  updateStatus("Config corrupted — restoring factory defaults", false);
                  try {
                    connectedPort.write("READFILE:factory_config.json\n");
                    awaitingFile = "factory_config.json";
                    responseBuffers[awaitingFile] = '';
                    return;
                  } catch (err) {
                    console.error("Failed to restore factory config:", err);
                    updateStatus("Restore failed", false);
                  }
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
        });
      } else if (!device) {
        // Only update status if BOOTSEL detection hasn’t happened
        if (!bootselPrompted) {
          updateStatus('Disconnected');
          connectedPort = null;
          
          // Update footer on disconnection
          const footerDeviceName = document.getElementById('footer-device-name');
          if (footerDeviceName) {
            footerDeviceName.textContent = 'No device connected';
            footerDeviceName.style.color = '#bbb'; // Gray for disconnected
          }
        }
      }

    });
  }, 2000);
  // ✅ Restore Config to Default
  document.getElementById('restore-default-btn')?.addEventListener('click', () => {
    closeConfigMenu();
    if (!connectedPort) {
      updateStatus("Device not connected", false);
      return;
    }

    try {
      connectedPort.write("READFILE:factory_config.json\n");
      awaitingFile = "factory_config.json";
      responseBuffers[awaitingFile] = '';
      updateStatus("Restoring config to factory default...", true);
    } catch (err) {
      console.error("Failed to request factory config:", err);
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
      updateStatus(`Switched hat_mode to ${next} ✅`, true);
      
      // Update button text immediately
      updateToggleButtonText();
      
      // Reboot device to apply hat_mode change
      setTimeout(() => {
        connectedPort.write("REBOOT\n");
        updateStatus("Device rebooting to apply hat_mode change", true);
      }, 500);
    } catch (err) {
      console.error("Failed to toggle hat_mode:", err);
      updateStatus("Toggle failed", false);
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
      // Update config and save to device (this will cause a reboot to apply changes)
      originalConfig.tilt_wave_enabled = next;
      
      connectedPort.write("WRITEFILE:config.json\n");
      connectedPort.write(JSON.stringify(originalConfig) + "\n");
      connectedPort.write("END\n");
      
      updateStatus(`Tilt wave effect ${next ? 'enabled' : 'disabled'} - device will reboot to apply changes ✅`, true);
      updateTiltWaveButtonText();
    } catch (err) {
      console.error("Failed to toggle tilt wave:", err);
      updateStatus("Toggle failed", false);
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
    if (!file) return;

    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        customAlert("Invalid JSON format. Please select a valid presets.json file.");
        return;
      }

      // Basic validation: must be an object with at least one preset
      if (typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
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
        customAlert("Invalid presets file: must contain at least one valid preset with all required keys and hex color values.");
        return;
      }

      // If valid, send to device
      if (connectedPort) {
        connectedPort.write("WRITEFILE:presets.json\n");
        connectedPort.write(JSON.stringify(parsed) + "\n");
        connectedPort.write("END\n");
        updateStatus("Presets file uploaded and saved ✅", true);

        // Optionally reload presets dropdown
        populatePresetDropdown(parsed, false);
      }
    } catch (err) {
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
            updateStatus("Presets file downloaded ✅", true);
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
    const fullName = `BumbleGum Guitars - ${newName}`;

    // 1. Delete registry entry (no elevation)
    const uidHex = await getDeviceUid();
    const pid = getUniquePid(uidHex);
    const powershellCmd = `powershell -Command \"Get-ChildItem 'HKCU:\\System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\Joystick\\OEM' | Where-Object { $_.Name -like '*${pid}*' } | ForEach-Object { Remove-Item $_.PsPath -Force }\"`;
    exec(powershellCmd, (err, stdout, stderr) => {
      if (err) {
        console.warn('Registry delete failed:', err);
      } else {
        console.log('Registry entry deleted:', stdout);
      }
    });

    // 2. Rewrite boot.py
    connectedPort.write("READFILE:boot.py\n");
    let buffer = '';
    const onData = data => {
      buffer += data.toString();
      if (buffer.includes('END')) {
        connectedPort.off('data', onData);
        let bootPy = buffer.replace(/END\s*$/, '');
        bootPy = bootPy.replace(/^\s*import microcontroller/, 'import microcontroller');
        bootPy = bootPy.replace(/product\s*=\s*".*?"/, `product="${fullName}"`);
        bootPy = bootPy.replace(/usb_hid\.set_interface_name\(\s*".*?"\s*\)/, `usb_hid.set_interface_name("${fullName}")`);
        console.log("Writing boot.py to device:\n", bootPy);

        connectedPort.write("WRITEFILE:boot.py\n");
        connectedPort.write(bootPy + "\n");
        connectedPort.write("END\n");

        // 3. Verify boot.py
        setTimeout(() => {
          let verifyBuffer = '';
          const onVerifyData = data => {
            verifyBuffer += data.toString();
            if (verifyBuffer.includes('END')) {
              connectedPort.off('data', onVerifyData);
              let readBack = verifyBuffer.replace(/END\s*$/, '').trim();
              if (normalize(readBack) === normalize(bootPy)) {
                console.log("✅ boot.py write verified!");
                // 4. Reboot the device
                connectedPort.write("REBOOT\n");
              } else {
                console.warn("❌ boot.py write mismatch!");
                console.log("Expected:\n", bootPy);
                console.log("Actual:\n", readBack);
              }
            }
          };
          connectedPort.on('data', onVerifyData);
          connectedPort.write("READFILE:boot.py\n");
        }, 300);
      }
    };
    connectedPort.on('data', onData);
  }
  function getUniquePid(uidHex) {
    // uidHex should be a hex string, e.g. "50436360186D611C"
    const last4 = uidHex.slice(-4); // last 2 bytes (4 hex chars)
    return "PID_" + last4.toUpperCase();
  }

  function normalize(str) {
    return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

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
      const pinInput = buttonConfigTableBody.querySelector(`.pin-input[data-key='${key}']`);
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
    const buttonConfigTableBody = document.querySelector('#button-config-table tbody');
    const buttonInputs = [
      { name: 'Green Fret', key: 'GREEN_FRET' },
      { name: 'Red Fret', key: 'RED_FRET' },
      { name: 'Yellow Fret', key: 'YELLOW_FRET' },
      { name: 'Blue Fret', key: 'BLUE_FRET' },
      { name: 'Orange Fret', key: 'ORANGE_FRET' },
      { name: 'Strum Up', key: 'STRUM_UP' },
      { name: 'Strum Down', key: 'STRUM_DOWN' },
      { name: 'Tilt', key: 'TILT' },
      { name: 'Up', key: 'UP' },
      { name: 'Down', key: 'DOWN' },
      { name: 'Left', key: 'LEFT' },
      { name: 'Right', key: 'RIGHT' }
    ];

    function populateButtonConfigTable(config) {
      if (!buttonConfigTableBody || !config) return;
      buttonConfigTableBody.innerHTML = '';
      buttonInputs.forEach(input => {
        const pin = config[input.key] || '';
        const ledIndex = config[input.key + '_led'] ?? '';
        const row = document.createElement('tr');
        row.innerHTML = `
          <td style="text-align:center;vertical-align:middle;padding:2px 0;font-size:1em;">${input.name}</td>
          <td style="text-align:center;vertical-align:middle;padding:2px 0;">
            <div style="display:flex;flex-direction:row;align-items:center;justify-content:center;gap:7px;">
              <input type="text" class="pin-input" data-key="${input.key}" value="${pin}" style="width:70px;text-align:center;padding:3px 6px;font-size:0.98em;border-radius:4px;border:1px solid #ccc;background:#fff;" />
              <button class="discover-btn" data-key="${input.key}" style="padding:3px 10px;font-size:0.98em;border-radius:4px;border:none;background:#222;color:#ffcc00;cursor:pointer;transition:background 0.2s;">Detect</button>
              <span class="pin-status-box" data-key="${input.key}" style="display:inline-block;width:22px;height:22px;border-radius:6px;border:2px solid #ffe066;background:#111;margin-left:8px;vertical-align:middle;"></span>
            </div>
          </td>
          <td style="text-align:center;vertical-align:middle;padding:2px 0;">
            <input type="text" class="led-input" data-key="${input.key}_led" value="${ledIndex}" style="width:50px;text-align:center;padding:3px 6px;font-size:0.98em;border-radius:4px;border:1px solid #ccc;background:#fff;" />
          </td>
        `;
        buttonConfigTableBody.appendChild(row);
      });
      // Only center table headers, do not redeclare 'table'
      {
        const table = document.getElementById('button-config-table');
        if (table) {
          const ths = table.querySelectorAll('th');
          ths.forEach(th => {
            th.style.textAlign = 'center';
            th.style.verticalAlign = 'middle';
          });
        }
      }
      // Attach event listeners for all detect buttons
      buttonConfigTableBody.querySelectorAll('.discover-btn').forEach(btn => {
        btn.addEventListener('click', handleDiscoverClick);
      });
      // Attach input filter for LED Index fields (only allow 0-6)
      buttonConfigTableBody.querySelectorAll('.led-input').forEach(input => {
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

      // Find or create modalFooter
      let modalFooter = document.querySelector('#button-config-modal .modal-footer');
      if (!modalFooter) {
        modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';
        modalFooter.style.display = 'flex';
        modalFooter.style.justifyContent = 'center';
        modalFooter.style.alignItems = 'center';
        modalFooter.style.gap = '18px';
        modalFooter.style.position = 'static';
        modalFooter.style.width = '100%';
        modalFooter.style.marginTop = '32px';
        modalFooter.style.padding = '24px 0 0 0';
        modalFooter.style.background = 'transparent';
        const modalContent = document.getElementById('button-config-modal');
        if (modalContent) {
          const table = modalContent.querySelector('#button-config-table');
          if (table && table.parentNode) {
            table.parentNode.insertBefore(modalFooter, table.nextSibling);
          } else {
            modalContent.appendChild(modalFooter);
          }
        }
      }
      // Always remove any existing buttons before adding new ones
      const oldApply = modalFooter.querySelector('#apply-pin-config-btn');
      if (oldApply) oldApply.remove();
      const oldCancel = modalFooter.querySelector('#button-config-cancel');
      if (oldCancel) oldCancel.remove();

      // Create and style Cancel button
      const modalCancelBtn = document.createElement('button');
      modalCancelBtn.id = 'button-config-cancel';
      modalCancelBtn.textContent = 'Cancel';
      modalCancelBtn.style.background = '#111';
      modalCancelBtn.style.color = '#ffcc00';
      modalCancelBtn.style.border = 'none';
      modalCancelBtn.style.borderRadius = '6px';
      modalCancelBtn.style.padding = '8px 24px';
      modalCancelBtn.style.fontWeight = 'bold';
      modalCancelBtn.style.fontSize = '1.1em';
      modalCancelBtn.style.boxShadow = '0 0 8px #222';
      modalCancelBtn.style.cursor = 'pointer';
      modalCancelBtn.style.transition = 'background 0.2s, color 0.2s, box-shadow 0.2s';

      // Create and style Apply button
      const modalApplyBtn = document.createElement('button');
      modalApplyBtn.id = 'apply-pin-config-btn';
      modalApplyBtn.textContent = 'Apply';
      modalApplyBtn.style.background = '#ffcc00';
      modalApplyBtn.style.color = '#000';
      modalApplyBtn.style.border = 'none';
      modalApplyBtn.style.borderRadius = '6px';
      modalApplyBtn.style.padding = '8px  24px';
      modalApplyBtn.style.fontWeight = 'bold';
      modalApplyBtn.style.fontSize = '1.1em';
      modalApplyBtn.style.boxShadow = '0 0 8px #ffe066';
      modalApplyBtn.style.cursor = 'pointer';
      modalApplyBtn.style.transition = 'background 0.2s, color 0.2s, box-shadow 0.2s';
      modalApplyBtn.disabled = false;

      // Insert Cancel and Apply buttons side by side in modal footer
      modalFooter.appendChild(modalCancelBtn);
      modalFooter.appendChild(modalApplyBtn);
      // --- Validation Logic ---
      function validatePins() {
        const pinInputs = Array.from(buttonConfigTableBody.querySelectorAll('.pin-input'));
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

        // LED Index validation
        const ledInputs = Array.from(buttonConfigTableBody.querySelectorAll('.led-input'));
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
      // Attach event listeners for Detect buttons (only once)
      buttonConfigTableBody.querySelectorAll('.discover-btn').forEach(btn => {
        btn.onclick = function(e) {
          handleDiscoverClick(e);
        };
      });
      // Add validation on manual input
      buttonConfigTableBody.querySelectorAll('.pin-input').forEach(input => {
        input.oninput = validatePins;
      });
      // Add validation on LED Index input
      buttonConfigTableBody.querySelectorAll('.led-input').forEach(input => {
        input.oninput = validatePins;
      });
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
      // --- Fix: Restore Apply button event handler ---
      modalApplyBtn.onclick = function() {
        if (!originalConfig) return;
        // Collect pin and LED assignments from table
        buttonInputs.forEach(input => {
          const pinInput = buttonConfigTableBody.querySelector(`.pin-input[data-key='${input.key}']`);
          const ledInput = buttonConfigTableBody.querySelector(`.led-input[data-key='${input.key}_led']`);
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
          updateStatus("Button config applied and saved ✅", true);
          const buttonConfigModal = document.getElementById('button-config-modal');
          if (buttonConfigModal) buttonConfigModal.style.display = 'none';
          stopPinStatusPolling(); // Fix: Stop polling when modal is closed after apply
        } catch (err) {
          console.error("Failed to apply button config:", err);
          updateStatus("Failed to write button config", false);
        }
      };
    }
    // Modal-scoped pin status polling and handler
    // --- Live Pin Status Polling ---
    let pinStatusInterval = null;
    let pinStatusMap = {};
    function startPinStatusPolling(config) {
      if (!connectedPort || !config) return;
      stopPinStatusPolling();
      const keys = buttonInputs.map(b => b.key);
      pinStatusInterval = setInterval(() => {
        keys.forEach(key => {
          connectedPort.write(`READPIN:${key}\n`);
        });
      }, 250);
      connectedPort.on('data', pinStatusHandler);
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
      // Parse PIN:<key>:<val> responses
      const pinMatch = str.match(/PIN:([A-Z_]+):(\d+)/);
      if (pinMatch) {
        const key = pinMatch[1];
        const val = pinMatch[2];
        pinStatusMap[key] = val;
        updatePinStatusUI();
      }
    }

    function updatePinStatusUI() {
      buttonInputs.forEach(input => {
        const key = input.key;
        const status = pinStatusMap[key];
        const box = buttonConfigTableBody.querySelector(`.pin-status-box[data-key='${key}']`);
        if (box) {
          if (status === '1') {
            box.style.background = '#ffe066';
            box.style.borderColor = '#ffe066';
          } else if (status === '0') {
            box.style.background = '#111';
            box.style.borderColor = '#ffe066';
          } else {
            box.style.background = '#333';
            box.style.borderColor = '#bbb';
          }
        }
      });
    }

    // Start polling when modal opens, stop when closed
    if (buttonConfigBtn && buttonConfigModal) {
      buttonConfigBtn.addEventListener('click', function() {
        buttonConfigModal.style.display = 'flex';
        if (typeof originalConfig !== 'undefined' && originalConfig) {
          populateButtonConfigTable(originalConfig);
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

    if (buttonConfigBtn && buttonConfigModal) {
      buttonConfigBtn.addEventListener('click', function() {
        buttonConfigModal.style.display = 'flex';
        if (typeof originalConfig !== 'undefined' && originalConfig) {
          populateButtonConfigTable(originalConfig);
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
    
    if (diagInputBoxesRow1 && diagInputStatus) {
      // Clear existing content
      diagInputBoxesRow1.innerHTML = '';
      
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

      // Create table
      const diagInputTable = document.createElement('table');
      diagInputTable.style.borderCollapse = 'separate';
      diagInputTable.style.borderSpacing = '12px 8px';
      diagInputTable.style.margin = '0 auto';
      diagInputTable.style.background = 'transparent';
      diagInputTable.style.tableLayout = 'fixed';
      diagInputTable.style.width = '100%';

      // Top labels row
      const topLabelsRow = document.createElement('tr');
      buttonInputsRow1.forEach(input => {
        const th = document.createElement('th');
        th.textContent = input.name;
        th.style.textAlign = 'center';
        th.style.fontWeight = 'normal';
        th.style.fontSize = '0.85em';
        th.style.color = '#ffe066';
        th.style.opacity = '0.85';
        th.style.padding = '0 4px 0 4px';
        th.style.width = '19%';
        th.style.minWidth = '90px';
        th.style.whiteSpace = 'nowrap';
        th.style.background = 'transparent';
        topLabelsRow.appendChild(th);
      });
      diagInputTable.appendChild(topLabelsRow);

      // Input box row 1
      const boxRow1 = document.createElement('tr');
      buttonInputsRow1.forEach(input => {
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.style.background = 'transparent';
        td.style.padding = '0 4px';
        td.style.verticalAlign = 'middle';
        td.style.width = '19%';
        td.style.minWidth = '90px';
        
        const el = document.createElement('div');
        el.className = 'diag-input-box';
        el.style.width = '44px';
        el.style.height = '44px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.margin = '0 auto';
        el.style.borderRadius = '8px';
        el.style.border = '2px solid #ffe066';
        el.style.background = '#111';
        el.style.transition = 'background 0.2s, color 0.2s';
        el.setAttribute('data-key', input.key);
        td.appendChild(el);
        boxRow1.appendChild(td);
      });
      diagInputTable.appendChild(boxRow1);

      // Input box row 2
      const boxRow2 = document.createElement('tr');
      buttonInputsRow2.forEach(input => {
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.style.background = 'transparent';
        td.style.padding = '0 4px';
        td.style.verticalAlign = 'middle';
        td.style.width = '19%';
        td.style.minWidth = '90px';
        
        const el = document.createElement('div');
        el.className = 'diag-input-box';
        el.style.width = '44px';
        el.style.height = '44px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.margin = '0 auto';
        el.style.borderRadius = '8px';
        el.style.border = '2px solid #ffe066';
        el.style.background = '#111';
        el.style.transition = 'background 0.2s, color 0.2s';
        el.setAttribute('data-key', input.key);
        td.appendChild(el);
        boxRow2.appendChild(td);
      });
      diagInputTable.appendChild(boxRow2);

      // Bottom labels row
      const bottomLabelsRow = document.createElement('tr');
      buttonInputsRow2.forEach(input => {
        const th = document.createElement('th');
        th.textContent = input.name;
        th.style.textAlign = 'center';
        th.style.fontWeight = 'normal';
        th.style.fontSize = '0.85em';
        th.style.color = '#ffe066';
        th.style.opacity = '0.85';
        th.style.padding = '0 4px 0 4px';
        th.style.width = '19%';
        th.style.minWidth = '90px';
        th.style.whiteSpace = 'nowrap';
        th.style.background = 'transparent';
        bottomLabelsRow.appendChild(th);
      });
      diagInputTable.appendChild(bottomLabelsRow);

      // Insert table into input status container
      diagInputBoxesRow1.appendChild(diagInputTable);
      
      // Clear row2 since we're using table layout
      const diagInputBoxesRow2 = document.getElementById('diag-input-boxes-row2');
      if (diagInputBoxesRow2) {
        diagInputBoxesRow2.innerHTML = '';
      }
    }
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
      const str = data.toString().trim();
      const match = str.match(/WHAMMY:([0-9]+)/);
      if (match) {
        // Hide buffer clearing popover when whammy data arrives
        if (bufferClearingActive) {
          hideBufferClearingPopover();
        }
        
        const diagLastWhammyValue = Number(match[1]);
        const diagWhammyLiveVal = document.getElementById('diag-whammy-live-val');
        if (diagWhammyLiveVal) {
          diagWhammyLiveVal.textContent = `Live: ${diagLastWhammyValue}`;
        }
        
        // Update visual slider position
        const slider = document.getElementById('diag-whammy-slider');
        if (slider && diagLastWhammyValue !== null && originalConfig) {
          const whammyMin = originalConfig.whammy_min || 0;
          const whammyMax = originalConfig.whammy_max || 65535;
          // Calculate position (0 to 134px, accounting for 6px dot width in 140px container)
          const range = whammyMax - whammyMin;
          const normalizedValue = Math.max(0, Math.min(1, (diagLastWhammyValue - whammyMin) / range));
          const position = normalizedValue * 134; // 140px container - 6px dot width
          slider.style.left = position + 'px';
        }
      } else if (str.startsWith("WHAMMY")) {
        const diagWhammyLiveVal = document.getElementById('diag-whammy-live-val');
        if (diagWhammyLiveVal) {
          diagWhammyLiveVal.textContent = "No whammy value received!";
        }
        // Reset slider to start position
        const slider = document.getElementById('diag-whammy-slider');
        if (slider) {
          slider.style.left = '0px';
        }
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
          { key: 'DOWN', row: 3, col: 2, symbol: '▼' },
          { key: 'RIGHT', row: 2, col: 3, symbol: '▶' }
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
            cell.style.fontSize = '14px';
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
        dpadDesc.textContent = 'D-Pad directional buttons';
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
  
  function setupDeviceInformation() {
    console.log('🔧 Setting up device information...');
    // Get the device information elements
    const deviceNameElement = document.getElementById('diag-device-name');
    const deviceUidElement = document.getElementById('diag-device-uid');
    const deviceFirmwareElement = document.getElementById('diag-device-firmware-version');
    const embeddedFirmwareElement = document.getElementById('diag-embedded-firmware-version');
    const presetsVersionElement = document.getElementById('diag-presets-version');
    
    // Update app version from package.json
    const appVersionElement = document.querySelector('#diag-version-info div:first-child + div div:first-child');
    if (appVersionElement) {
      appVersionElement.textContent = `App Version: ${getAppVersion()}`;
    }
    
    // Update presets version
    if (presetsVersionElement) {
      presetsVersionElement.textContent = getPresetsVersion();
    }
    
    // Always show embedded firmware version (doesn't require device connection)
    if (embeddedFirmwareElement) {
      embeddedFirmwareElement.textContent = getEmbeddedFirmwareVersion();
    }
    
    console.log('🔌 Connected port status:', !!connectedPort);
    if (connectedPort) {
      // Chain requests sequentially to avoid data handler conflicts
      console.log('🔄 Starting sequential device information requests...');
      
      // Step 1: Request device name first
      if (deviceNameElement) {
        requestDeviceName(name => {
          const deviceName = name || 'Unable to read name';
          deviceNameElement.textContent = deviceName;
          
          // Also update the footer device name
          const footerDeviceName = document.getElementById('footer-device-name');
          if (footerDeviceName) {
            if (name) {
              footerDeviceName.textContent = `Connected: ${name}`;
              footerDeviceName.style.color = '#2ecc40'; // Green color for connected
            } else {
              footerDeviceName.textContent = 'Connected: Unknown device';
              footerDeviceName.style.color = '#ff851b'; // Orange for unknown
            }
          }
          
          // Step 2: Request device UID after name completes
          if (deviceUidElement) {
            setTimeout(() => { // Small delay to ensure clean serial state
              requestDeviceUid(uid => {
                if (uid) {
                  deviceUidElement.textContent = uid;
                } else {
                  deviceUidElement.textContent = 'Unable to read UID';
                }
                
                // Step 3: Request firmware version after UID completes
                if (deviceFirmwareElement) {
                  setTimeout(() => { // Small delay to ensure clean serial state
                    console.log('📱 Starting device firmware version request process...');
                    deviceFirmwareElement.textContent = 'Reading...';
                    
                    setTimeout(() => {
                      console.log('📱 Making initial firmware version request...');
                      requestDeviceFirmwareVersion(version => {
                        console.log('📱 Initial firmware version callback received:', version);
                        if (version) {
                          console.log('✅ Successfully got firmware version:', version);
                          deviceFirmwareElement.textContent = version;
                        } else {
                          console.log('❌ Initial firmware version request failed, showing fallback message');
                          deviceFirmwareElement.textContent = 'Unable to read version';
                        }
                      });
                    }, 200);
                  }, 200);
                }
              });
            }, 200);
          } else {
            // If no UID element, proceed directly to firmware version
            if (deviceFirmwareElement) {
              setTimeout(() => {
                console.log('📱 Starting device firmware version request process...');
                deviceFirmwareElement.textContent = 'Reading...';
                
                setTimeout(() => {
                  console.log('📱 Making initial firmware version request...');
                  requestDeviceFirmwareVersion(version => {
                    console.log('📱 Initial firmware version callback received:', version);
                    if (version) {
                      console.log('✅ Successfully got firmware version:', version);
                      deviceFirmwareElement.textContent = version;
                    } else {
                      console.log('❌ Initial firmware version request failed, showing fallback message');
                      deviceFirmwareElement.textContent = 'Unable to read version';
                    }
                  });
                }, 200);
              }, 200);
            }
          }
        });
      } else {
        // If no name element, start with UID
        if (deviceUidElement) {
          requestDeviceUid(uid => {
            if (uid) {
              deviceUidElement.textContent = uid;
            } else {
              deviceUidElement.textContent = 'Unable to read UID';
            }
            
            // Then proceed to firmware version
            if (deviceFirmwareElement) {
              setTimeout(() => {
                console.log('📱 Starting device firmware version request process...');
                deviceFirmwareElement.textContent = 'Reading...';
                
                setTimeout(() => {
                  console.log('� Making initial firmware version request...');
                  requestDeviceFirmwareVersion(version => {
                    console.log('📱 Initial firmware version callback received:', version);
                    if (version) {
                      console.log('✅ Successfully got firmware version:', version);
                      deviceFirmwareElement.textContent = version;
                    } else {
                      console.log('❌ Initial firmware version request failed, showing fallback message');
                      deviceFirmwareElement.textContent = 'Unable to read version';
                    }
                  });
                }, 200);
              }, 200);
            }
          });
        } else {
          // If no name or UID elements, proceed directly to firmware version
          if (deviceFirmwareElement) {
            console.log('📱 Starting device firmware version request process...');
            deviceFirmwareElement.textContent = 'Reading...';
            
            setTimeout(() => {
              console.log('📱 Making initial firmware version request...');
              requestDeviceFirmwareVersion(version => {
                console.log('📱 Initial firmware version callback received:', version);
                if (version) {
                  console.log('✅ Successfully got firmware version:', version);
                  deviceFirmwareElement.textContent = version;
                } else {
                  console.log('❌ Initial firmware version request failed, showing fallback message');
                  deviceFirmwareElement.textContent = 'Unable to read version';
                }
              });
            }, 200);
          }
        }
      }
    } else {
      // Device not connected
      if (deviceNameElement) {
        deviceNameElement.textContent = 'Device not connected';
      }
      if (deviceUidElement) {
        deviceUidElement.textContent = 'Device not connected';
      }
      if (deviceFirmwareElement) {
        deviceFirmwareElement.textContent = 'Device not connected';
      }
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
      diagPinStatusInterval = setInterval(() => {
        if (document.getElementById('diag-input-enable')?.checked) {
          keys.forEach(key => {
            connectedPort.write(`READPIN:${key}\n`);
          });
        }
      }, 50); // High frequency for smooth real-time feedback
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
        // Poll DPAD buttons
        const dpadKeys = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        diagHatStatusInterval = setInterval(() => {
          if (document.getElementById('diag-hat-enable')?.checked) {
            dpadKeys.forEach(key => {
              connectedPort.write(`READPIN:${key}\n`);
            });
          }
        }, 50); // High frequency for smooth real-time feedback
      } else {
        // Poll joystick values
        diagHatStatusInterval = setInterval(() => {
          if (document.getElementById('diag-hat-enable')?.checked) {
            connectedPort.write('READJOYSTICK\n');
          }
        }, 20); // Very high frequency for smooth joystick tracking
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
        if (document.getElementById('diag-whammy-enable')?.checked) {
          connectedPort.write('READWHAMMY\n');
        }
      }, 20); // Very high frequency for smooth whammy tracking
      
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
    const str = data.toString();
    const pinMatch = str.match(/PIN:([A-Z_]+):(\d+)/);
    if (pinMatch) {
      // Hide buffer clearing popover when pin data arrives
      if (bufferClearingActive) {
        hideBufferClearingPopover();
      }
      
      const key = pinMatch[1];
      const val = pinMatch[2];
      diagPinStatusMap[key] = val;
      updateDiagInputBoxes();
    }
    
    // Also hide popover for PREVIEWLED confirmations (LED test commands)
    if (str.includes('🔍 PREVIEWLED applied') || str.includes('PREVIEWLED')) {
      if (bufferClearingActive) {
        hideBufferClearingPopover();
      }
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
        if (status === '1') {
          box.style.background = '#ffe066';
          box.style.borderColor = '#ffe066';
          box.style.color = '#222';
        } else if (status === '0') {
          box.style.background = '#111';
          box.style.borderColor = '#ffe066';
          box.style.color = '#ffe066';
        } else {
          box.style.background = '#333';
          box.style.borderColor = '#bbb';
          box.style.color = '#ffe066';
        }
      }
    });
  }
  
  function diagHatStatusHandler(data) {
    const str = data.toString();
    
    // Handle DPAD pin responses (PIN:UP:1, etc.)
    const pinMatch = str.match(/PIN:(UP|DOWN|LEFT|RIGHT):(\d+)/);
    if (pinMatch) {
      // Hide buffer clearing popover when hat pin data arrives
      if (bufferClearingActive) {
        hideBufferClearingPopover();
      }
      
      const key = pinMatch[1];
      const val = pinMatch[2];
      diagHatStatusMap[key] = val;
      updateDiagHatStatus();
      return;
    }
    
    // Handle joystick responses (JOYSTICK:X:value:Y:value)
    const joyMatch = str.match(/JOYSTICK:X:(\d+):Y:(\d+)/);
    if (joyMatch) {
      // Hide buffer clearing popover when joystick data arrives
      if (bufferClearingActive) {
        hideBufferClearingPopover();
      }
      
      diagHatStatusMap.X = parseInt(joyMatch[1]);
      diagHatStatusMap.Y = parseInt(joyMatch[2]);
      updateDiagHatStatus();
      return;
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
          console.error("❌ Serial preview failed:", err);
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
          console.error("❌ Serial preview failed:", err);
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
  // Override modal close to ensure LED test stops
  const diagCloseBtn = document.getElementById('diag-close-btn');
  if (diagCloseBtn) {
    diagCloseBtn.addEventListener('click', () => {
      console.log('Diagnostics modal close button clicked');
      if (window.stopLedTest) {
        window.stopLedTest(); // Ensure LED test is stopped
      }
      // Close the modal
      const diagnosticsModal = document.getElementById('diagnostics-modal');
      if (diagnosticsModal) {
        diagnosticsModal.style.display = 'none';
      }
    });
  }
  
  // Stop LED test when modal loses focus
  const diagnosticsModal = document.getElementById('diagnostics-modal');
  if (diagnosticsModal) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'style') {
          const display = diagnosticsModal.style.display;
          if (display === 'none' && window.ledTestActive) {
            console.log('Modal hidden - stopping LED test');
            if (window.stopLedTest) {
              window.stopLedTest();
            }
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
