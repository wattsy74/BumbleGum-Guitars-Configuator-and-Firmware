# Firmware-Side Serial Operation LED Indicators

## Overview
The BGG firmware now includes automatic visual feedback for serial read/write operations using the device's strum LEDs. This provides users with real-time indication of when the device is communicating with the app, implemented entirely in firmware for maximum reliability and accuracy.

## LED Assignments
- **Both Strum LEDs (Index 0 & 1)**: Show solid color during operations
  - **Green (0, 255, 0)**: Indicates READ operations from device
  - **Red (255, 0, 0)**: Indicates WRITE operations to device

## Visual Behavior
- **Solid Color Display**: LEDs show solid green or red during operations (no blinking)
- **Duration**: Indicators remain active for the exact duration of the file operation
- **State Preservation**: Original LED colors are saved and automatically restored after operations
- **Automatic Management**: Firmware handles all timing and restoration without app intervention

## Triggered Operations

### Read Operations (Green Strum LEDs)
- Loading device configuration files (config.json, presets.json, user_presets.json)
- Reading any file via READFILE command
- Factory configuration reads
- Boot.py troubleshooting reads
- Any firmware file read operation

### Write Operations (Red Strum LEDs)
- Saving configuration changes via WRITEFILE command
- Writing preset data (high-speed streaming mode)
- Factory config restoration
- User preset merging (IMPORTUSER operations)
- Boot.py modifications
- Any firmware file write operation

## Technical Implementation

### Firmware Functions
```python
def start_serial_indicator(leds, operation_type):
    """Start LED indicator - saves current states and sets indicator color"""
    
def stop_serial_indicator(leds):
    """Stop LED indicator - restores original LED states"""
```

### Integration Points
- **READFILE command**: Green indicator for entire read duration
- **WRITEFILE command**: Red indicator for entire write process
- **All write modes**: write_stream, write, merge_user
- **Error handling**: Indicators stop even if operations fail
- **State safety**: Original LED states always restored

### Benefits Over App-Side Implementation
✅ **Perfect Timing** - Indicators run for exact operation duration  
✅ **No Conflicts** - Cannot interfere with app-side LED operations  
✅ **State Preservation** - Firmware saves/restores exact LED colors  
✅ **Reliability** - Works even if app-side code has issues  
✅ **Performance** - No app-to-device communication overhead  
✅ **Both Strum LEDs** - More visible indication than single LED  

## User Experience
- **Clear Feedback**: Both strum LEDs provide obvious visual indication
- **Duration Accuracy**: Indicators show exactly when operations are happening
- **No Interruption**: Normal LED functionality completely preserved
- **Professional Feel**: Smooth, automatic operation without user intervention

## Error Handling
- Indicators automatically stop if operations fail or timeout
- LED state restoration is guaranteed in all code paths (try/finally blocks)
- Compatible with all existing firmware features and LED operations
- No impact on device functionality if LED commands fail

## File Coverage
All serial file operations now include automatic LED indicators:
- **serial_handler.py** - Enhanced with LED indicator functions and integration
- **READFILE operations** - Green strum LEDs during reads
- **WRITEFILE operations** - Red strum LEDs during writes (all modes)
- **Error recovery** - Automatic LED restoration on failures
