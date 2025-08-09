# BGG Firmware Updates Repository

This repository hosts firmware updates for BumbleGum Guitars devices.

## Repository Structure

```
/
├── version_manifest.json     # Version information and file checksums
├── boot.py                   # Boot configuration
├── code.py                   # Main application code  
├── serial_handler.py         # Serial communication handler
├── utils.py                  # Utility functions
├── hardware.py               # Hardware abstraction
├── gamepad.py                # Gamepad functionality
├── config.json               # Default configuration
├── presets.json              # Default presets
└── README.md                 # This file
```

## How It Works

1. **Version Checking**: The BGG Windows App periodically checks this repository for new firmware versions
2. **Automatic Detection**: Compares local device firmware version with the version in `version_manifest.json`
3. **Secure Downloads**: Files are downloaded via GitHub API with integrity verification
4. **Staged Updates**: Files are staged in a safe `/updates/` folder before deployment
5. **Atomic Installation**: Boot-time migration ensures safe firmware updates without device crashes

## Creating a Release

To release a new firmware version:

1. Update all firmware files in this repository
2. Update the version number in `version_manifest.json`
3. Update checksums and file sizes in the manifest
4. Commit and push to the `main` branch
5. BGG devices will automatically detect the update within 24 hours

## Manual Update Check

Users can also manually check for updates using the "Check for Updates" button in the BGG Windows App.

## Version History

- **v3.0**: Initial staged firmware update system
- **v3.1**: Automatic update detection and deployment
- **v3.2**: (Future) Enhanced update features

## Security

- All files are verified using SHA-256 checksums
- Updates are downloaded over HTTPS
- Staged deployment prevents corruption during updates
- Atomic file operations ensure device stability
