# 🖥️ BGG Windows App v2.3

A standalone desktop application for configuring and testing the BGG USB HID controller.

## 🎯 Features

- 🔧 Read and write `config.json` over USB
- 🎨 Live LED color preview with color picker and hex input
- 🎮 Button state testing and real-time feedback
- 📁 Preset management (import/export, apply live)
- 🛠️ Advanced config mode for pin mapping and calibration
- 🌊 **NEW**: Tilt Wave Effect control with dynamic button text
- 🎭 **NEW**: Custom styled modal dialogs with consistent UI
- 🔄 Whammy bar calibration with live preview
- 🎯 Hat mode switching (D-pad/Joystick)
- 🏷️ Device renaming functionality
- 🔍 Comprehensive diagnostics mode
- ⚙️ Factory reset capability

## 📦 Tech Stack

- **Language**: Electron with JavaScript
- **USB Communication**: Serial (CDC) over USB using SerialPort library
- **UI Framework**: Custom HTML/CSS with Iro.js color picker
- **File Access**: JSON-based config and presets

## 🆕 What's New in v2.3

### UI/UX Improvements
- ✅ Custom styled confirmation and alert dialogs
- ✅ Consistent yellow button styling throughout app
- ✅ Dynamic button text for tilt wave toggle (Turn On/Off Tiltwave)
- ✅ Improved modal design with rounded corners and proper spacing

### Tilt Wave Effect
- ✅ Enhanced 7-LED cascading animation
- ✅ 19-color gradient wave effect (blue to white)
- ✅ 3 complete sweeps with perfect color restoration
- ✅ Real-time enable/disable control
- ✅ Integration with device configuration system

### Performance & Reliability
- ✅ Priority-based main loop (1000Hz)
- ✅ Optimized gamepad polling (100Hz)
- ✅ Throttled LED updates for smooth performance
- ✅ Improved serial communication handling

### Firmware Distribution
- ✅ Optimized UF2 creation with picotool
- ✅ 4MB complete firmware package (vs 32MB with --all)
- ✅ Single-file deployment with CircuitPython runtime included

## 🧠 Development Status

All major roadmap items completed! See [ROADMAP.md](./ROADMAP.md) for original development plan.
