// configUtils.js
// Utility functions for config merging, validation, and safe updates

/**
 * Merge color arrays from a preset into a full config object, preserving all other fields.
 * @param {object} config - The full config object to update (mutated in place).
 * @param {object} preset - The preset object containing color data.
 * @param {object} [options] - Optional mapping info.
 */
function applyPresetToConfig(config, preset, options = {}) {
  if (!config || typeof config !== 'object') return;
  if (!preset || typeof preset !== 'object') return;
  // Default: expects preset keys to match button ids
  if (!Array.isArray(config.led_color)) config.led_color = Array(7).fill('#ffffff');
  if (!Array.isArray(config.released_color)) config.released_color = Array(7).fill('#ffffff');

  // Default mapping for BGG: led_color and released_color arrays
  // led_color: [strum-up-active, strum-down-active, orange-fret-pressed, blue-fret-pressed, yellow-fret-pressed, red-fret-pressed, green-fret-pressed]
  // released_color: [strum-up-released, strum-down-released, orange-fret-released, blue-fret-released, yellow-fret-released, red-fret-released, green-fret-released]
  const ledPressedKeys = [
    'strum-up-active',
    'strum-down-active',
    'orange-fret-pressed',
    'blue-fret-pressed',
    'yellow-fret-pressed',
    'red-fret-pressed',
    'green-fret-pressed'
  ];
  const ledReleasedKeys = [
    'strum-up-released',
    'strum-down-released',
    'orange-fret-released',
    'blue-fret-released',
    'yellow-fret-released',
    'red-fret-released',
    'green-fret-released'
  ];
  for (let i = 0; i < 7; i++) {
    if (preset[ledPressedKeys[i]]) config.led_color[i] = preset[ledPressedKeys[i]];
    if (preset[ledReleasedKeys[i]]) config.released_color[i] = preset[ledReleasedKeys[i]];
  }
  // Optionally use a mapping if provided (for advanced/legacy use)
  if (options.ledMap && options.pressedKeys && options.releasedKeys) {
    options.ledMap.forEach((ledIndex, i) => {
      const pressedKey = options.pressedKeys[i];
      const releasedKey = options.releasedKeys[i];
      if (pressedKey && preset[pressedKey]) config.led_color[ledIndex] = preset[pressedKey];
      if (releasedKey && preset[releasedKey]) config.released_color[ledIndex] = preset[releasedKey];
    });
  }
  // Strum buttons (if present in options)
  if (options.strumPressed) {
    options.strumPressed.forEach((id, i) => {
      if (id && preset[id]) config.led_color[i] = preset[id];
    });
  }
  if (options.strumReleased) {
    options.strumReleased.forEach((id, i) => {
      if (id && preset[id]) config.released_color[i] = preset[id];
    });
  }
}

/**
 * Validate that a config object contains all required fields.
 * @param {object} config - The config object to validate.
 * @param {string[]} requiredFields - List of required field names.
 * @returns {string|null} - Returns the first missing field, or null if all present.
 */
function validateConfigFields(config, requiredFields) {
  for (const key of requiredFields) {
    if (!(key in config)) return key;
  }
  return null;
}

module.exports = {
  applyPresetToConfig,
  validateConfigFields
};
