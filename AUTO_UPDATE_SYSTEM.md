# BGG Configurator Auto-Update System

## Overview

The BGG Configurator now includes a robust auto-update system designed specifically for portable executable distribution. The system automatically checks for updates, downloads them in the background, and provides a seamless update experience for users.

## Architecture

### Components

1. **PortableAutoUpdater** (`autoUpdater.js`)
   - Core update logic and GitHub API integration
   - Version comparison and update detection
   - Download management

2. **AutoUpdaterUI** (`autoUpdaterUI.js`) 
   - User interface for update notifications
   - Progress tracking and error handling
   - Installation prompts and user interaction

3. **Main Process Handlers** (`main.js`)
   - IPC handlers for secure file operations
   - Download management and file system operations
   - Update installation via batch script

4. **Preload Script** (`preload.js`)
   - Secure IPC bridge between renderer and main processes
   - Context isolation and API exposure

## Features

### Automatic Update Checking
- Checks for updates on startup (after 30 seconds)
- Periodic checks every 4 hours
- Manual update checks via config menu
- Uses GitHub Releases API for update detection

### Smart Version Comparison
- Semantic versioning support (e.g., 3.9.15)
- Handles version prefixes (removes 'v' if present)
- Accurate comparison across major/minor/patch versions

### Secure Download System
- Downloads via HTTPS using native Node.js modules
- Progress tracking with real-time updates
- Automatic retry on network errors
- Secure file validation

### Seamless Installation
- Automatic backup of current executable
- Batch script handles process replacement
- Automatic app restart after update
- Cleanup of temporary files

### User Experience
- Non-intrusive notifications
- Release notes display with markdown formatting
- Progress indicators during download
- Error handling with user-friendly messages
- Manual update checking available

## Implementation Details

### Update Detection Process

1. **GitHub API Query**
   ```javascript
   GET https://api.github.com/repos/wattsy74/bgg-windows-app/releases/latest
   ```

2. **Asset Discovery**
   - Searches for portable executable in release assets
   - Filters by filename containing 'portable' and ending with '.exe'
   - Extracts download URL, file size, and metadata

3. **Version Comparison**
   - Parses version strings into numeric components
   - Compares major.minor.patch incrementally
   - Returns true if latest > current

### Download Process

1. **Secure Download**
   - Creates `updates` directory if not exists
   - Uses native HTTPS module for secure downloads
   - Streams file directly to disk to handle large files
   - Tracks progress and reports to UI

2. **Progress Tracking**
   ```javascript
   const progress = Math.round((downloadedSize / totalSize) * 100);
   event.sender.send('download-progress', progress);
   ```

### Installation Process

1. **Batch Script Generation**
   - Creates temporary batch script for update process
   - Handles process waiting and file operations
   - Ensures clean replacement of executable

2. **Installation Steps**
   ```batch
   # Wait for main process to exit
   # Backup current executable
   # Move new executable into place
   # Start updated application
   # Clean up backup and batch script
   ```

## Configuration

### Release Management

For updates to work properly, GitHub releases must:

1. **Include Portable Executable**
   - Asset must contain 'portable' in filename
   - Must end with '.exe' extension
   - Should follow naming pattern: `BumbleGum-Guitars-Configurator-v{version}-portable.exe`

2. **Proper Versioning**
   - Release tags should follow semantic versioning
   - Example: `v3.9.16` or `3.9.16`
   - Version in `package.json` must match release tag

3. **Release Notes**
   - Markdown formatting supported
   - Automatic conversion of common markdown elements
   - Displayed to users before download

### Build Process Integration

The auto-updater integrates with the existing Electron Forge build process:

```javascript
// forge.config.js - Portable maker configuration
{
  name: '@rabbitholesyndrome/electron-forge-maker-portable',
  config: {
    icon: './bg-bee-icon.ico',
    portable: {
      artifactName: 'BumbleGum-Guitars-Configurator-v${version}-portable.exe',
      requestExecutionLevel: 'user'
    }
  }
}
```

## Security Considerations

### Context Isolation
- Enabled context isolation in main window
- Disabled node integration for security
- All IPC communication goes through secure preload script

### File Operations
- Downloads go to dedicated `updates` directory
- File validation before installation
- Secure batch script generation
- Automatic cleanup of temporary files

### Network Security
- HTTPS-only downloads
- GitHub API authentication not required (public repos)
- No credentials stored or transmitted

## User Interface

### Update Notification Modal
- Shows new version information
- Displays formatted release notes
- File size and publication date
- Download and dismiss options

### Progress Modal
- Real-time download progress bar
- Status messages and completion notification
- Install button appears when download complete
- Non-dismissible during download

### Error Handling
- Toast notifications for errors
- Detailed error logging to console
- Graceful fallback for network issues
- User-friendly error messages

## API Reference

### AutoUpdater Methods

```javascript
// Initialize auto-updater
await window.autoUpdater.initialize();

// Check for updates manually
window.autoUpdater.checkForUpdates();

// Download available update
await window.autoUpdater.downloadUpdate(updateInfo);

// Install downloaded update
await window.autoUpdater.installUpdate(downloadPath);

// Set event callbacks
window.autoUpdater.on('updateAvailable', callback);
window.autoUpdater.on('downloadProgress', callback);
window.autoUpdater.on('updateDownloaded', callback);
window.autoUpdater.on('error', callback);
```

### AutoUpdaterUI Methods

```javascript
// Manual update check trigger
window.autoUpdaterUI.checkForUpdates();

// Show custom notification
window.autoUpdaterUI.showNotification(title, message, type);
```

## Deployment Checklist

1. **Build Configuration**
   - [ ] Portable executable maker configured
   - [ ] Version in package.json updated
   - [ ] Icon and branding configured

2. **Release Preparation**
   - [ ] Create GitHub release with semantic version tag
   - [ ] Include portable executable as release asset
   - [ ] Write comprehensive release notes
   - [ ] Test download URL accessibility

3. **Testing**
   - [ ] Test manual update check
   - [ ] Verify download progress tracking
   - [ ] Test installation process
   - [ ] Verify app restart after update

4. **Monitoring**
   - [ ] Monitor GitHub API rate limits
   - [ ] Check download statistics
   - [ ] Monitor user feedback and error reports

## Troubleshooting

### Common Issues

1. **Update Check Fails**
   - Check internet connectivity
   - Verify GitHub repository access
   - Check API rate limiting

2. **Download Fails**
   - Check available disk space
   - Verify HTTPS connectivity
   - Check file permissions in updates directory

3. **Installation Fails**
   - Check file permissions
   - Verify app is not running as administrator
   - Check antivirus software interference

### Debug Information

Enable detailed logging by checking the browser console:
- Update check results
- Download progress and errors
- Installation process status
- IPC communication logs

## Future Enhancements

### Planned Features
- [ ] Delta updates for smaller downloads
- [ ] Rollback functionality
- [ ] Update scheduling options
- [ ] Offline update support
- [ ] Multi-language support for UI

### Performance Optimizations
- [ ] Implement download resumption
- [ ] Add download compression
- [ ] Cache update information
- [ ] Optimize batch script performance

---

*This auto-update system provides a professional, secure, and user-friendly way to keep the BGG Configurator application current with the latest features and bug fixes.*
