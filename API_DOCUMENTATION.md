# BGG Guitar Controller API Documentation v2.3

## Table of Contents
- [Serial Communication Protocol](#serial-communication-protocol)
- [Configuration API](#configuration-api)
- [LED Control API](#led-control-api)
- [Tilt Wave Effect API](#tilt-wave-effect-api)
- [Firmware Commands](#firmware-commands)
- [JavaScript Interface](#javascript-interface)
- [File System API](#file-system-api)

---

## Serial Communication Protocol

### Connection Settings
- **Baud Rate**: Auto-detected (typically 115200)
- **Data Format**: 8N1 (8 data bits, no parity, 1 stop bit)
- **Timeout**: 1ms for firmware, auto for Windows app
- **Protocol**: USB CDC (Communication Device Class)

### Command Structure
All commands are text-based, terminated with `\n` (newline).

```
COMMAND[:PARAMETER]\n
```

---

## Configuration API

### Read Configuration
```
READFILE:config.json
```
**Response**: JSON configuration data

### Write Configuration
```
WRITEFILE:config.json
{JSON_DATA}
END
```

### Factory Reset
```
READFILE:factory_config.json
```
Reads factory defaults, then automatically writes to config.json

### Configuration Schema
```json
{
  "UP": "GP2",
  "DOWN": "GP3",
  "LEFT": "GP4",
  "RIGHT": "GP5",
  "GREEN_FRET": "GP10",
  "GREEN_FRET_led": 6,
  "RED_FRET": "GP11",
  "RED_FRET_led": 5,
  "YELLOW_FRET": "GP12",
  "YELLOW_FRET_led": 4,
  "BLUE_FRET": "GP13",
  "BLUE_FRET_led": 3,
  "ORANGE_FRET": "GP14",
  "ORANGE_FRET_led": 2,
  "STRUM_UP": "GP7",
  "STRUM_UP_led": 0,
  "STRUM_DOWN": "GP8",
  "STRUM_DOWN_led": 1,
  "TILT": "GP9",
  "SELECT": "GP0",
  "START": "GP1",
  "GUIDE": "GP6",
  "WHAMMY": "GP27",
  "neopixel_pin": "GP23",
  "joystick_x_pin": "GP28",
  "joystick_y_pin": "GP29",
  "hat_mode": "dpad|joystick",
  "led_brightness": 1.0,
  "whammy_min": 500,
  "whammy_max": 65000,
  "whammy_reverse": false,
  "tilt_wave_enabled": true,
  "led_color": ["#FFFFFF", "#FFFFFF", "#B33E00", "#0000FF", "#FFFF00", "#FF0000", "#00FF00"],
  "released_color": ["#454545", "#454545", "#521C00", "#000091", "#696B00", "#8c0009", "#003D00"]
}
```

---

## LED Control API

### LED Mapping
| Index | Control | Description |
|-------|---------|-------------|
| 0 | STRUM_UP | Upper strum LED |
| 1 | STRUM_DOWN | Lower strum LED |
| 2 | ORANGE_FRET | Orange fret button LED |
| 3 | BLUE_FRET | Blue fret button LED |
| 4 | YELLOW_FRET | Yellow fret button LED |
| 5 | RED_FRET | Red fret button LED |
| 6 | GREEN_FRET | Green fret button LED |

### Manual LED Control
```
SETLED:INDEX:R:G:B
```
**Example**: `SETLED:0:255:0:0` (Set strum up LED to red)

### LED Brightness Control
```
BRIGHTNESS:0.0-1.0
```
**Example**: `BRIGHTNESS:0.5` (Set to 50% brightness)

---

## Tilt Wave Effect API

### Enable/Disable Tilt Wave
```
TILTWAVE_ENABLE:1    # Enable
TILTWAVE_ENABLE:0    # Disable
```

### Trigger Tilt Wave Manually
```
TILTWAVE
```

### Tilt Wave Configuration
The tilt wave effect can be configured through the main configuration:
- `tilt_wave_enabled`: Boolean to enable/disable the effect
- Effect automatically triggers when tilt sensor is activated
- Duration: 2.4 seconds (120 steps at 50Hz)
- Animation: 3 complete sweeps with cascading blue-to-white effect

### Tilt Wave Color Palette
19-color gradient used for the wave effect:
```python
WAVE_COLORS = [
    (0, 0, 255),      # Deep blue
    (0, 100, 255),    # Bright blue
    (0, 150, 255),    # Electric blue  
    (50, 200, 255),   # Cyan-blue
    (100, 220, 255),  # Light electric blue
    (150, 240, 255),  # Bright cyan
    (200, 250, 255),  # Nearly white-blue
    (255, 255, 255),  # Pure white (peak)
    # ... fade back sequence
]
```

---

## Firmware Commands

### System Commands
```
REBOOT              # Restart the firmware
VERSION             # Get firmware version info
PING                # Connection test
```

### Calibration Commands
```
CALIBRATE:WHAMMY    # Start whammy calibration
CALIBRATE:JOYSTICK  # Start joystick calibration
```

### Hat Mode Toggle
```
HATMODE:dpad        # Set hat to D-pad mode
HATMODE:joystick    # Set hat to joystick mode
```

### Gamepad Button Mapping
| Button | HID Code | Description |
|--------|----------|-------------|
| GREEN_FRET | 1 | Green fret button |
| RED_FRET | 2 | Red fret button |
| YELLOW_FRET | 3 | Yellow fret button |
| BLUE_FRET | 4 | Blue fret button |
| ORANGE_FRET | 5 | Orange fret button |
| STRUM_UP | 6 | Upper strum |
| STRUM_DOWN | 7 | Lower strum |
| SELECT | 8 | Select button |
| START | 9 | Start button |
| TILT | 10 | Tilt sensor |

---

## JavaScript Interface

### Device Connection
```javascript
// Auto-detect and connect to BGG controller
const device = await window.electronAPI.getConnectedDevice();

// Write command to device
connectedPort.write("COMMAND\n");

// Listen for responses
connectedPort.on('data', (data) => {
  // Handle response
});
```

### Configuration Management
```javascript
// Read current config
connectedPort.write("READFILE:config.json\n");

// Write new config
const config = { /* config object */ };
connectedPort.write("WRITEFILE:config.json\n");
connectedPort.write(JSON.stringify(config) + "\n");
connectedPort.write("END\n");
```

### Event Handlers
```javascript
// Toggle tilt wave effect
document.getElementById('toggle-tilt-wave-btn')?.addEventListener('click', () => {
  closeConfigMenu();
  if (!connectedPort || !originalConfig) {
    updateStatus("Device not connected or config missing", false);
    return;
  }

  const current = originalConfig.tilt_wave_enabled || false;
  const next = !current;
  originalConfig.tilt_wave_enabled = next;

  connectedPort.write("WRITEFILE:config.json\n");
  connectedPort.write(JSON.stringify(originalConfig) + "\n");
  connectedPort.write("END\n");
  
  setTimeout(() => {
    connectedPort.write(`TILTWAVE_ENABLE:${next ? '1' : '0'}\n`);
  }, 200);
});
```

---

## File System API

### Supported Files
- `config.json` - Main configuration
- `factory_config.json` - Factory defaults (read-only)
- `presets.json` - Color presets
- `user_presets.json` - User-defined presets

### File Operations
```
READFILE:filename.json      # Read file contents
WRITEFILE:filename.json     # Write file (followed by data and END)
LISTFILES                   # List all files
DELETEFILE:filename.json    # Delete file (if permitted)
```

### File Write Protocol
```
WRITEFILE:config.json
{
  "setting": "value",
  "another_setting": true
}
END
```

---

## Error Handling

### Common Error Responses
- `ERROR: File not found` - Requested file doesn't exist
- `ERROR: Invalid JSON` - Malformed JSON data
- `ERROR: Command not recognized` - Unknown command
- `ERROR: Permission denied` - Cannot modify file
- `ERROR: Device busy` - Device is processing another command

### Status Codes
- `✅` - Success/Connected
- `❌` - Error/Failed
- `⚠️` - Warning/Partial success
- `🔄` - Processing/Loading

---

## Performance Characteristics

### Timing Specifications
- **Main Loop**: 1000Hz (1ms cycle time)
- **Gamepad Polling**: 100Hz (priority #1)
- **Whammy Processing**: 100Hz (priority #2)
- **LED Updates**: Variable, throttled (priority #3)
- **Serial Communication**: Variable (priority #4)
- **Tilt Wave Animation**: 50Hz when active

### Memory Usage
- **RAM**: ~32KB typical usage
- **Flash**: ~256KB firmware size
- **LED Buffer**: 7 × 3 bytes (RGB)
- **Serial Buffer**: 1KB circular buffer

### Latency Specifications
- **Button Response**: <10ms (1-cycle delay)
- **Whammy Response**: <10ms
- **LED Update**: <20ms (when not throttled)
- **Serial Response**: <100ms typical
- **Tilt Wave Trigger**: <20ms

---

## Version History

### v2.3 (Current)
- Enhanced tilt wave effect with 7-LED cascading animation
- Performance optimization with priority-based main loop
- 19-color gradient wave effect
- Perfect color restoration after animation
- Windows app integration for tilt wave control

### v2.2
- Basic tilt wave effect implementation
- Serial command additions
- Configuration system improvements

### v2.1
- Core functionality
- LED control system
- Basic configuration support

---

## Development Notes

### Adding New Commands
1. Add command parsing in `serial_handler.py`
2. Implement command logic
3. Update documentation
4. Test thoroughly for performance impact

### Performance Guidelines
- Gamepad polling must remain highest priority
- LED updates should be throttled when possible
- Avoid floating-point math in critical paths
- Use pre-calculated values for animations

### Testing Checklist

#### STARTUP
- [ ] Is the device detected?
- [ ] Has the config loaded?
- [ ] Have the presets loaded?
- [ ] Have the user presets loaded?
- [ ] Is the device name shown?
- [ ] Is the serial quiet?

#### USER INTERACTION
- [ ] Does pressing the Released / Pressed toggle update the on screen colours and the LED's?
- [ ] Can you change a single button colour using the picker and hex input?
- [ ] Can you change multiple button colours using the picker and hex input?
- [ ] Can you choose a preset from the dropdown?
- [ ] Can you pick a user preset and change a colour?
- [ ] Does the user preset load back in the correct colours?
- [ ] Does the Unsaved changes dialog appear if you try to close the app without clicking the Apply button?
- [ ] Can you click Apply?
- [ ] Does the device reboot after clicking apply?
- [ ] Have the changes been saved?

#### MENU ITEMS
- [ ] Can you upload new presets?
- [ ] Can you download the presets?

#### BUTTON CONFIG
- [ ] Is pin detection working?
- [ ] Is pin status working?
- [ ] Is pin validation working?
- [ ] Is LED validation working?
- [ ] Does Cancel and Apply work as expected?
- [ ] When you exit the Button Config Modal does all serial polling stop?

#### WHAMMY CALIBRATION
- [ ] Does the Min slider work and update the Min field?
- [ ] Does the Max slider work and update the Max field?
- [ ] Can you enter numbers in the Min and Max fields and does it update the sliders?
- [ ] Is the Live readout working?
- [ ] Does the Auto Calibration work?
- [ ] When you've closed the modal does all serial polling stop?

#### HAT MODE CONTROLS
- [ ] Does the Switch to DPAD/Joystick option work?

#### TILT WAVE EFFECT
- [ ] Does the Turn On/Off Tiltwave option work?
- [ ] Does the toggle button text change correctly (Turn On/Off Tiltwave)?
- [ ] Does enabling tilt wave save config and reboot device?
- [ ] Does tilt wave trigger properly when tilting the guitar?
- [ ] Does the wave animation complete all 3 sweeps?
- [ ] Do LEDs restore to original colors after wave completes?

#### RENAME DEVICE
- [ ] Can you enter a name in the dialog and click apply?
- [ ] Does the name change in the Main window footer?
- [ ] Does the registry update?
- [ ] Does the correct name show in 'Setup USB Game Controllers App'?

#### RESET CONFIG
- [ ] Does the config reset to defaults?

#### DIAGNOSTICS
- [ ] Does the modal open with the None radio button selected and is polling disabled?
- [ ] When selecting Buttons does the box highlight green and become active?
- [ ] When you press buttons on the device are the statuses updated?
- [ ] When you click on Whammy radio button, does the buffer clearing message appear?
- [ ] Is the Whammy box green?
- [ ] Does the Whammy live read out follow the device?
- [ ] Are the Min and Max texts as set in the config?
- [ ] When you click on Joystick / DPAD does it highlight green?
- [ ] Does it show the buffer clearing message?
- [ ] Do the readings match the device input?
- [ ] When you click on LED Test, do they cycle through the expected colours?
- [ ] When you select None does all polling stop?
- [ ] When you close the Modal does all polling stop?

#### SERIAL COMMUNICATION
- [ ] All buttons respond correctly
- [ ] Whammy bar works smoothly
- [ ] LEDs show correct colors
- [ ] No input lag during LED animations
- [ ] Serial commands respond correctly
- [ ] Configuration saves and loads properly

---

*BGG Guitar Controller API Documentation v2.3*  
*Last Updated: July 24, 2025*
