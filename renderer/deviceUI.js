// deviceUI.js
console.log('[deviceUI.js] Loaded. Assigning applyConfig and populatePresetDropdown to window.');
// Handles UI updates for device config, presets, and user presets

function applyConfig(config) {
  // Update fret buttons (pressed/released)
  const fretColors = {
    green: '#00FF00',
    red: '#FF0000',
    yellow: '#FFFF00',
    blue: '#0000FF',
    orange: '#FFA500'
  };
  // Map config color arrays to buttons
  // Mapping: [0] Strum Up, [1] Strum Down, [2] Orange, [3] Blue, [4] Yellow, [5] Red, [6] Green
  const ledColors = Array.isArray(config.led_color) ? config.led_color : [];
  const releasedColors = Array.isArray(config.released_color) ? config.released_color : [];
  // Strum buttons
  const strumMap = ["up", "down"];
  strumMap.forEach((strum, idx) => {
    const activeBtn = document.getElementById(`strum-${strum}-active`);
    if (activeBtn) {
      // Remove all child nodes (text, icons, etc.)
      while (activeBtn.firstChild) activeBtn.removeChild(activeBtn.firstChild);
      activeBtn.textContent = '';
      activeBtn.style.backgroundColor = ledColors[idx] !== undefined ? ledColors[idx] : '#FFFFFF';
    }
    const releasedBtn = document.getElementById(`strum-${strum}-released`);
    if (releasedBtn) {
      while (releasedBtn.firstChild) releasedBtn.removeChild(releasedBtn.firstChild);
      releasedBtn.textContent = '';
      releasedBtn.style.backgroundColor = releasedColors[idx] !== undefined ? releasedColors[idx] : '#454545';
    }
  });
  // Fret buttons
  const fretOrder = ['orange', 'blue', 'yellow', 'red', 'green'];
  fretOrder.forEach((fret, i) => {
    const pressedBtn = document.getElementById(`${fret}-fret-pressed`);
    if (pressedBtn) {
      pressedBtn.textContent = '';
      pressedBtn.style.backgroundColor = ledColors[i+2] !== undefined ? ledColors[i+2] : '#FFFFFF';
    }
    const releasedBtn = document.getElementById(`${fret}-fret-released`);
    if (releasedBtn) {
      releasedBtn.textContent = '';
      releasedBtn.style.backgroundColor = releasedColors[i+2] !== undefined ? releasedColors[i+2] : '#454545';
    }
  });
  // Remove any text from strum buttons after config assignment
  ['up', 'down'].forEach(strum => {
    const activeBtn = document.getElementById(`strum-${strum}-active`);
    if (activeBtn) {
      while (activeBtn.firstChild) activeBtn.removeChild(activeBtn.firstChild);
      activeBtn.textContent = '';
    }
    const releasedBtn = document.getElementById(`strum-${strum}-released`);
    if (releasedBtn) {
      while (releasedBtn.firstChild) releasedBtn.removeChild(releasedBtn.firstChild);
      releasedBtn.textContent = '';
    }
  });
  // Fret toggle button state
  const toggleBtn = document.querySelector('.fret-toggle-button.selected');
  if (toggleBtn) {
    toggleBtn.style.border = '2px solid #ffcc00';
  }
  // Store config for debugging
  window.originalConfig = config;
  console.log('[deviceUI][DEBUG] window.originalConfig assigned in applyConfig:', window.originalConfig);
  
  // Enable apply button after config reload
  const applyBtn = document.getElementById('apply-config-btn');
  if (applyBtn) applyBtn.disabled = false;
  
  // Always preview LEDs after config reload
  if (typeof previewAllLeds === 'function') previewAllLeds();
}

function populatePresetDropdown(presets, isUserPresets = false) {
  const saveBtn = document.getElementById('save-custom-btn');
  const id = isUserPresets ? 'user-preset-select' : 'preset-select';
  const select = document.getElementById(id);
  // Attach save logic for user presets (must be after select is defined)
  if (isUserPresets && saveBtn && select) {
    saveBtn.onclick = async function() {
      const slot = select.value;
      if (!slot) {
        alert('Please select a user preset slot.');
        return;
      }
      // Collect current colors from UI
      const collectCurrentColors = () => {
        const colorMap = {};
        document.querySelectorAll('.fret-button, .strum-button').forEach(btn => {
          if (btn.id) colorMap[btn.id] = btn.style.backgroundColor;
        });
        return colorMap;
      };
      const data = collectCurrentColors();
      // Ensure payload is a single line (no embedded newlines)
      let payload = JSON.stringify({ [slot]: data });
      payload = payload.replace(/\n|\r/g, '');
      // Output the save data to the console for inspection
      console.log('[deviceUI] Save User DATA:', { slot, data, payload });
      try {
        console.log('[deviceUI] Save User clicked. window.connectedPort:', window.connectedPort, 'Type:', typeof window.connectedPort);
        if (window.connectedPort) {
          // Add delays between writes for device reliability
          const delay = ms => new Promise(res => setTimeout(res, ms));
          window.connectedPort.write("IMPORTUSER\n");
          console.log('[deviceUI] Wrote IMPORTUSER');
          await delay(50);
          window.connectedPort.write(payload + "\n");
          console.log('[deviceUI] Wrote payload:', payload);
          await delay(50);
          window.connectedPort.write("END\n");
          console.log('[deviceUI] Wrote END');
          if (typeof window.showToast === 'function') window.showToast(`Saved to ${slot}`, 'success');
          saveBtn.style.display = 'none';
          // Update in-memory user presets and UI
          if (typeof window.loadedUserPresets === 'object' && window.loadedUserPresets !== null) {
            window.loadedUserPresets[slot] = data;
            if (typeof window.populatePresetDropdown === 'function') {
              window.populatePresetDropdown(window.loadedUserPresets, true);
              // Reselect the just-saved slot to trigger UI update
              const userSelect = document.getElementById('user-preset-select');
              if (userSelect) {
                userSelect.value = slot;
                if (typeof userSelect.onchange === 'function') userSelect.onchange();
              }
            }
          }
        } else {
          alert('No device connected.');
        }
      } catch (err) {
        alert('Failed to save user preset: ' + err.message);
      }
    };
  }
// Utility to enable/disable preset dropdowns and save button based on device connection
function setPresetDropdownsEnabled(enabled) {
  const presetSelect = document.getElementById('preset-select');
  const userPresetSelect = document.getElementById('user-preset-select');
  const saveBtn = document.getElementById('save-custom-btn');
  if (presetSelect) presetSelect.disabled = !enabled;
  if (userPresetSelect) userPresetSelect.disabled = !enabled;
  if (saveBtn) saveBtn.disabled = !enabled;
}

// Listen for device connection/disconnection events to update UI
if (window.multiDeviceManager && typeof window.multiDeviceManager.on === 'function') {
  window.multiDeviceManager.on('activeDeviceChanged', (device) => {
    const enabled = !!(device && device.port && device.port.isOpen);
    setPresetDropdownsEnabled(enabled);
    if (!enabled) {
      // Optionally reset dropdowns to default
      const presetSelect = document.getElementById('preset-select');
      const userPresetSelect = document.getElementById('user-preset-select');
      if (presetSelect) presetSelect.selectedIndex = 0;
      if (userPresetSelect) userPresetSelect.selectedIndex = 0;
    }
  });
}

  // ...existing code...
  // ...existing code...
  if (!select) return;
  // Clear existing options
  select.innerHTML = '';
  // Always use correct data source
  let presetsData;
  if (isUserPresets) {
    // Only include keys that match exactly 'User N' (N = number)
    presetsData = {};
    if (presets && typeof presets === 'object') {
      for (const key in presets) {
        if (
          presets.hasOwnProperty(key) &&
          typeof presets[key] === 'object' &&
          /^User \d+$/i.test(key)
        ) {
          presetsData[key] = presets[key];
        }
      }
    }
    // Defensive: log the actual keys and values
    console.log('[deviceUI][PATCH] Raw user_presets.json object:', presets);
    console.log('[deviceUI][PATCH] Filtered user presetsData for dropdown:', presetsData);
    console.log('[deviceUI][PATCH] User preset keys:', Object.keys(presetsData));
    // If no keys, warn
    if (Object.keys(presetsData).length === 0) {
      console.warn('[deviceUI][PATCH] No user presets found in user_presets.json!');
    }
    window.userPresetsData = presetsData; // <-- always update global for user presets
  } else {
    // presets.json structure: { _metadata, presets: { ... } }
    presetsData = {};
    if (presets && typeof presets === 'object' && presets.presets && typeof presets.presets === 'object') {
      for (const key in presets.presets) {
        if (presets.presets.hasOwnProperty(key) && typeof presets.presets[key] === 'object') {
          presetsData[key] = presets.presets[key];
        }
      }
    }
    console.log('[deviceUI][PATCH] Raw presets.json object:', presets);
    console.log('[deviceUI][PATCH] Extracted presetsData for dropdown:', presetsData);
    window.presetsData = presetsData; // <-- always update global for factory presets
  }
  // Add a default option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = isUserPresets ? 'Select User Preset' : 'Select Preset';
  select.appendChild(defaultOption);
  // Add each preset and log each option injected
  let keys = Object.keys(presetsData);
  if (isUserPresets) {
    // Sort keys as User 1, User 2, ..., User 5 (numerically)
    keys = keys
      .filter(k => k !== '_metadata')
      .sort((a, b) => {
        const aNum = parseInt((a.match(/\d+/) || [0])[0], 10);
        const bNum = parseInt((b.match(/\d+/) || [0])[0], 10);
        return aNum - bNum;
      });
    // Defensive: log sorted keys
    console.log('[deviceUI][PATCH] Sorted user preset keys for dropdown:', keys);
  }
  for (const key of keys) {
    if (isUserPresets && key === '_metadata') continue;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    select.appendChild(option);
    console.log(`[deviceUI][PATCH] Injecting option into dropdown: value='${key}', text='${key}'`);
  }
  // Log final dropdown options
  const options = Array.from(select.options).map(opt => opt.value);
  console.log('[deviceUI][PATCH] Final dropdown options:', options);
  // Add event listener to update button colors when a preset is selected
  select.onchange = function() {
    const selectedKey = select.value;
    console.log('[deviceUI] Dropdown changed, selectedKey:', selectedKey);
    // Debug: print current window.originalConfig and window.presetsData
    console.debug('[deviceUI][DEBUG] window.originalConfig at dropdown change:', window.originalConfig);
    console.debug('[deviceUI][DEBUG] window.presetsData at dropdown change:', window.presetsData);
    if (!selectedKey) {
      if (saveBtn) saveBtn.style.display = 'none';
      return;
    }
    let presetData = null;
    // Defensive: ensure global preset data is always an object
    if (isUserPresets) {
      if (typeof window.userPresetsData === 'string') {
        try {
          window.userPresetsData = JSON.parse(window.userPresetsData);
        } catch (e) {
          console.error('[deviceUI][DEFENSIVE] Failed to parse window.userPresetsData:', e, window.userPresetsData);
          return;
        }
      }
      if (window.userPresetsData && typeof window.userPresetsData === 'object') {
        console.debug('[deviceUI][DEFENSIVE] userPresetsData keys:', Object.keys(window.userPresetsData));
        presetData = window.userPresetsData[selectedKey];
        if (typeof presetData !== 'object' || presetData === null) {
          console.warn('[deviceUI] User preset data for', selectedKey, 'is not an object:', presetData);
          presetData = null;
        }
      }
    } else {
      if (typeof window.presetsData === 'string') {
        try {
          window.presetsData = JSON.parse(window.presetsData);
        } catch (e) {
          console.error('[deviceUI][DEFENSIVE] Failed to parse window.presetsData:', e, window.presetsData);
          return;
        }
      }
      if (window.presetsData && typeof window.presetsData === 'object') {
        console.debug('[deviceUI][DEFENSIVE] presetsData keys:', Object.keys(window.presetsData));
        presetData = window.presetsData[selectedKey];
      }
    }
    console.debug('[deviceUI][DEBUG] presetData for selectedKey:', selectedKey, presetData);
    if (presetData && typeof presetData === 'object') {
      // Only update color arrays in window.originalConfig, never overwrite the full object
      if (window.originalConfig && typeof window.originalConfig === 'object') {
        const ledOrder = [
          'strum-up-active', 'strum-down-active',
          'orange-fret-pressed', 'blue-fret-pressed', 'yellow-fret-pressed', 'red-fret-pressed', 'green-fret-pressed'
        ];
        const releasedOrder = [
          'strum-up-released', 'strum-down-released',
          'orange-fret-released', 'blue-fret-released', 'yellow-fret-released', 'red-fret-released', 'green-fret-released'
        ];
        const led_color = ledOrder.map(k => presetData[k] || '#FFFFFF');
        const released_color = releasedOrder.map(k => presetData[k] || '#454545');
        window.originalConfig.led_color = led_color;
        window.originalConfig.released_color = released_color;
        console.log('[deviceUI][DEBUG] Updated window.originalConfig color arrays from preset:', { led_color, released_color });
        if (typeof window.applyConfig === 'function') {
          window.applyConfig(window.originalConfig);
        }
        // Show the Apply to config button and mark config as dirty
        const applyBtn = document.getElementById('apply-config-btn');
        if (applyBtn) applyBtn.style.display = 'inline-block';
        if (typeof window.setConfigDirty === 'function') window.setConfigDirty(true);
      } else {
        // Fallback: update button backgrounds for all states (pressed and released)
        Object.keys(presetData).forEach(key => {
          const btn = document.getElementById(key);
          if (btn) btn.style.backgroundColor = presetData[key];
        });
      }
      // Preview only released colors (optional, keep as is)
      if (window.multiDeviceManager && typeof window.multiDeviceManager.previewReleasedColorsForPreset === 'function') {
        console.debug('[deviceUI][DEBUG] Calling previewReleasedColorsForPreset with:', presetData);
        window.multiDeviceManager.previewReleasedColorsForPreset(presetData);
      }
      // Update save button label
      if (isUserPresets && saveBtn) {
        saveBtn.textContent = `Save User ${selectedKey.replace(/[^0-9]/g, '') || selectedKey}`;
      }
    } else {
      console.warn('[deviceUI] No valid presetData found for selectedKey:', selectedKey);
      if (saveBtn) saveBtn.style.display = 'none';
    }
  };

  // --- PATCH: Do not auto-select or preview any preset on load ---
  // Leave dropdowns on default option and do not trigger preview.
  // --- END PATCH ---

  // Listen for color changes to show save button (for user presets only)
  if (isUserPresets && saveBtn) {
    // Use event delegation to catch color changes on any input inside the preset area
    const presetContainer = select.parentNode;
    if (presetContainer) {
      // Helper to find parent button with '-released' or '-pressed' in id
      const findButtonId = (el, suffix) => {
        while (el && el !== presetContainer) {
          if (el.classList && (el.classList.contains('fret-button') || el.classList.contains('strum-button')) && el.id && el.id.endsWith(suffix)) {
            return el.id;
          }
          el = el.parentElement;
        }
        return null;
      };
      const triggerReleasedLedPreview = () => {
        if (select.value && typeof window.multiDeviceManager?.previewReleasedColorsForPreset === 'function') {
          // Collect all current button colors (pressed and released)
          const colorMap = {};
          document.querySelectorAll('.fret-button, .strum-button').forEach(btn => {
            if (btn.id) colorMap[btn.id] = btn.style.backgroundColor;
          });
          console.log('[deviceUI][DEBUG] PREVIEWLED (released): previewReleasedColorsForPreset called with:', colorMap);
          window.multiDeviceManager.previewReleasedColorsForPreset(colorMap);
        }
      };
      // Use only the global triggerPressedLedPreview
// Expose globally for app.js to call directly (always, not just in event handler)
window.triggerPressedLedPreview = function(btnId) {
  if (btnId && typeof window.multiDeviceManager?.previewLed === 'function') {
    const color = document.getElementById(btnId)?.style.backgroundColor;
    if (!btnId || !color) return; // Suppress non-critical previewLed errors
    window.multiDeviceManager.previewLed(btnId, color);
  }
};
      const colorChangeHandler = (e) => {
        if (e.target && (e.target.matches('input[type="color"]') || e.target.classList.contains('color-btn') || e.target.classList.contains('user-color-picker'))) {
          const releasedId = findButtonId(e.target, '-released');
          const pressedId = findButtonId(e.target, '-pressed');
          console.log('[deviceUI][DEBUG] Color event:', {
            eventType: e.type,
            target: e.target,
            selectValue: select.value,
            releasedId,
            pressedId
          });
          if (select.value) saveBtn.style.display = 'inline-block';
          if (releasedId) triggerReleasedLedPreview();
          if (pressedId) window.triggerPressedLedPreview(pressedId);
        }
      };
      presetContainer.addEventListener('change', colorChangeHandler);
      presetContainer.addEventListener('input', colorChangeHandler);
      presetContainer.addEventListener('pointerup', colorChangeHandler);
      // Add a global fallback for color changes (for color pickers outside presetContainer)
      if (!window.__deviceUI_globalColorHandler) {
         window.__deviceUI_globalColorHandler = function(e) {
           if (e.target && (e.target.matches('input[type="color"]') || e.target.classList.contains('color-btn') || e.target.classList.contains('user-color-picker'))) {
             // Try to find the closest preset select (user or factory)
             let parent = e.target.parentElement;
             let foundSelect = null;
             while (parent && !foundSelect) {
               foundSelect = parent.querySelector && (parent.querySelector('#user-preset-select') || parent.querySelector('#preset-select'));
               parent = parent.parentElement;
             }
             // Fallback to global if not found
             const activeSelect = foundSelect || document.getElementById('user-preset-select') || document.getElementById('preset-select');
             const releasedId = e.target.id && e.target.id.endsWith('-released') ? e.target.id : null;
             const pressedId = e.target.id && e.target.id.endsWith('-pressed') ? e.target.id : null;
             console.log('[deviceUI][DEBUG][GLOBAL] Color event:', {
               eventType: e.type,
               target: e.target,
               selectValue: activeSelect && activeSelect.value,
               releasedId,
               pressedId
             });
             if (activeSelect && activeSelect.value) saveBtn.style.display = 'inline-block';
             if (releasedId) triggerReleasedLedPreview();
             if (pressedId) window.triggerPressedLedPreview(pressedId);
           }
         };
         document.addEventListener('change', window.__deviceUI_globalColorHandler, true);
         document.addEventListener('input', window.__deviceUI_globalColorHandler, true);
         document.addEventListener('pointerup', window.__deviceUI_globalColorHandler, true);
      }
    }
  }
}

window.applyConfig = applyConfig;
window.populatePresetDropdown = populatePresetDropdown;

window.addEventListener('deviceFilesLoaded', function(e) {
  const { device, config, presets, userPresets } = e.detail || {};
  // --- PATCH: Log the actual userPresets value received ---
  console.log('[deviceFilesLoaded event][PATCH] Received userPresets:', userPresets);
  console.log('[deviceFilesLoaded event] Received:', { device, config, presets, userPresets });
  let parsedConfig = config;
  let parsedPresets = presets;
  let parsedUserPresets = userPresets;
  try {
    if (typeof config === 'string') parsedConfig = JSON.parse(config);
  } catch (err) {
    console.warn('[deviceUI.js] Failed to parse config JSON:', err, config);
  }
  try {
    if (typeof presets === 'string') parsedPresets = JSON.parse(presets);
  } catch (err) {
    console.warn('[deviceUI.js] Failed to parse presets JSON:', err, presets);
  }
  try {
    if (typeof userPresets === 'string') parsedUserPresets = JSON.parse(userPresets);
  } catch (err) {
    console.warn('[deviceUI.js] Failed to parse userPresets JSON:', err, userPresets);
  }
  if (parsedConfig) {
    if (typeof window.applyConfig === 'function') {
      console.log('[deviceFilesLoaded event] Calling window.applyConfig');
      window.applyConfig(parsedConfig);
    } else {
      window.originalConfig = parsedConfig;
      console.log('[deviceFilesLoaded event] No applyConfig function, assigned to window.originalConfig:', window.originalConfig);
    }
    // Always log after assignment for debugging
    console.log('[deviceUI][DEBUG] window.originalConfig after deviceFilesLoaded:', window.originalConfig);
  }
  // Always pass the full parsed object to dropdown logic
  if (parsedPresets && typeof parsedPresets === 'object') {
    window.loadedPresets = parsedPresets;
    if (typeof window.populatePresetDropdown === 'function') {
      console.log('[deviceFilesLoaded event] Calling window.populatePresetDropdown for presets');
      window.populatePresetDropdown(parsedPresets, false);
    }
  }
  // --- Robust assignment and logging for user presets ---
  if (typeof userPresets !== 'undefined') {
    let parseError = null;
    if (typeof userPresets === 'string') {
      try {
        parsedUserPresets = JSON.parse(userPresets);
      } catch (err) {
        parseError = err;
        console.error('[deviceUI.js][ERROR] Failed to parse userPresets string:', err, userPresets);
        parsedUserPresets = null;
      }
    }
    if (parsedUserPresets && typeof parsedUserPresets === 'object' && !Array.isArray(parsedUserPresets)) {
      window.loadedUserPresets = parsedUserPresets;
      console.log('[deviceUI.js] window.loadedUserPresets assigned:', window.loadedUserPresets);
      if (typeof window.populatePresetDropdown === 'function') {
        window.populatePresetDropdown(window.loadedUserPresets, true);
      }
    } else {
      window.loadedUserPresets = {};
      if (parseError) {
        console.warn('[deviceUI.js] No valid user presets due to parse error:', parseError);
      } else {
        console.warn('[deviceUI.js] No valid user presets to populate dropdown:', parsedUserPresets);
      }
      if (typeof window.populatePresetDropdown === 'function') {
        window.populatePresetDropdown({}, true);
      }
      // Also clear the dropdown for safety
      const select = document.getElementById('user-preset-select');
      if (select) select.innerHTML = '';
    }
  }
  if (typeof window.showToast === 'function') {
    window.showToast('Device files loaded', 'success');
  }
});

module.exports = {
  applyConfig,
  populatePresetDropdown
};
