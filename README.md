# 🖥️ BumbleGum Guitars Configurator v3.9.22

A standalone desktop application for configuring and testing the BGG USB HID controller with automatic update capabilities.

## 🎯 Key Features

- 🔧 Read and write `config.json` over USB
- 🎨 Live LED color preview with color picker and hex input
- 🎮 Button state testing and real-time feedback
- 📁 Preset management (import/export, apply live)
- 🛠️ Advanced config mode for pin mapping and calibration
- 🌊 Tilt Wave Effect control with dynamic button text
- 🎭 Custom styled modal dialogs with consistent UI
- 🔄 Whammy bar calibration with live preview
- 🎯 Hat mode switching (D-pad/Joystick)
- 🏷️ Device renaming functionality
- 🔍 Comprehensive diagnostics mode
- ⚙️ Factory reset capability
- 🆕 **Automatic App Updates** - Stay current automatically
- 🆕 **Automatic Firmware Updates** - Seamless firmware management
- 🆕 **Multi-Device Support** - Manage multiple BGG controllers
- 🆕 **Serial Operation LED Indicators** - Visual feedback during operations

## 📦 Tech Stack

- **Framework**: Electron with JavaScript
- **USB Communication**: Serial (CDC) over USB using SerialPort library  
- **UI Framework**: Custom HTML/CSS with Iro.js color picker
- **File Management**: JSON-based config and presets
- **Auto-Updates**: GitHub API integration with background downloads
- **Firmware Management**: Submodule-based version control and automated deployment

## 🚀 Major Updates in v3.x Series

### 🔄 Complete Auto-Update System (v3.9.x)
- ✅ **Automatic App Updates**: Background checks, seamless downloads, and one-click installation
- ✅ **Automatic Firmware Updates**: Detects outdated firmware and guides users through updates
- ✅ **Smart Update Detection**: Compares local and remote versions with intelligent caching
- ✅ **Progress Tracking**: Real-time download progress with cancellation support
- ✅ **Safety Features**: Backup creation, rollback capability, and update validation
- ✅ **GitHub Integration**: Direct integration with GitHub releases for both app and firmware
- ✅ **Background Processing**: Non-blocking updates that don't interrupt workflow

### 📡 Serial Operation LED Indicators (v3.9.x)
- ✅ **Visual Feedback**: Green LED flashes during serial reads, red during writes
- ✅ **Firmware Integration**: Built into the device firmware for immediate response
- ✅ **Operation Status**: Clear indication of communication state during config operations
- ✅ **Enhanced UX**: Users can see exactly when device communication is happening

### 🏗️ Automated Release System (v3.9.x)
- ✅ **Single-Command Releases**: Automated version bumping, building, and publishing
- ✅ **Git Integration**: Automatic tagging, commits, and push to repository
- ✅ **GitHub Releases**: Automatic creation of releases with compiled executables
- ✅ **Version Management**: Semantic versioning with patch/minor/major bump support
- ✅ **Build Automation**: Integrated with Electron Forge for consistent builds

### 🛠️ Enhanced Multi-Device Management (v3.x)
- ✅ **Robust Device Detection**: Improved USB device enumeration and tracking
- ✅ **Smart Dropdown Behavior**: Persistent device selector with intelligent refresh
- ✅ **Device State Management**: Track connection status across multiple devices
- ✅ **Enhanced Device UI**: Better visual feedback and device identification

### 📁 Firmware Submodule Architecture (v3.x)
- ✅ **Separate Firmware Repository**: Clean separation of app and firmware codebases
- ✅ **Version Synchronization**: Automated firmware version tracking and updates
- ✅ **Streamlined Development**: Independent firmware updates without app rebuilds
- ✅ **Automated Deployment**: PowerShell scripts for automated firmware publishing

## 🆕 What's New in v2.4 (Previous Release)

### Multi-Device Management & UI Fixes
- ✅ Robust multi-device selector with improved dropdown behavior
- ✅ Device dropdown stays open after connect/disconnect/set active/identify actions
- ✅ Improved device selector UI and styles for better workflow
- ✅ Code and documentation cleanup

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

## 📋 System Requirements

- **OS**: Windows 10/11 (64-bit)
- **Storage**: ~50MB for app, additional space for firmware updates
- **USB**: Available USB port for BGG controller connection
- **Internet**: Required for automatic updates (optional for offline use)

## 🔧 Installation & Updates

### First Time Installation
1. Download the latest release from [GitHub Releases](https://github.com/wattsy74/BumbleGum-Guitars-Configurator/releases)
2. Run the portable executable - no installation required
3. Connect your BGG controller via USB
4. The app will automatically check for updates on startup

### Automatic Updates
- **App Updates**: Automatically checked on startup and every 24 hours
- **Firmware Updates**: Detected when connecting devices with outdated firmware
- **Manual Check**: Use "Check for Updates" in the app menu anytime
- **Background Downloads**: Updates download in the background without interrupting use

## 📚 Documentation

- **[Auto-Update System](./AUTO_UPDATE_SYSTEM.md)** - Complete auto-update documentation
- **[Automated Releases](./AUTOMATED_RELEASES.md)** - Release system documentation  
- **[Development Roadmap](./ROADMAP.md)** - Development status and future plans
- **[Bug Reports & Features](./Bug_and_Features.md)** - Known issues and feature requests

## 🧠 Development Status

**All major roadmap items completed!** The BGG Configurator now includes:
- ✅ Complete auto-update system for both app and firmware
- ✅ Automated release pipeline with GitHub integration
- ✅ Enhanced multi-device management
- ✅ Serial operation visual feedback
- ✅ Robust firmware management with safety features

The application is feature-complete and in active maintenance mode with regular updates.
