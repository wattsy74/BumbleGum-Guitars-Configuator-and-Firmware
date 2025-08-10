# BGG Configurator Automated Release System

## Overview

This automated release system streamlines the entire process of creating and publishing new versions of the BGG Configurator, similar to the firmware update system. With a single command, you can bump versions, build the application, create git tags, and publish GitHub releases.

## 🚀 Quick Start

### Simple Release Commands

```bash
# Patch release (3.9.16 → 3.9.17)
npm run release:patch

# Minor release (3.9.16 → 3.10.0)  
npm run release:minor

# Major release (3.9.16 → 4.0.0)
npm run release:major

# Test the process without making changes
npm run release:dry-run
```

### Alternative Methods

```bash
# Using batch file
quick-release.bat patch

# Using PowerShell directly
.\release.ps1 -VersionType patch

# With custom release notes
.\release.ps1 -VersionType patch -ReleaseNotes "Custom release description"
```

## 📁 Release System Files

| File | Purpose |
|------|---------|
| `release.ps1` | Main automation script |
| `quick-release.bat` | Simple batch wrapper |
| `release-config.json` | Configuration settings |
| `test-updater.ps1` | Auto-updater testing utilities |

## 🔄 Automated Process

The release system performs these steps automatically:

### 1. **Validation**
- ✅ Checks git repository status
- ✅ Validates prerequisites (npm, git, etc.)
- ✅ Warns about uncommitted changes
- ✅ Confirms version bump type

### 2. **Version Management**
- 🔢 Reads current version from package.json
- ➕ Calculates new version (patch/minor/major)
- 📝 Updates package.json with new version
- ✅ Validates version format

### 3. **Build Process**
- 🏗️ Runs `npm run make` to build application
- 📦 Creates portable executable
- ✅ Verifies build artifacts
- 📍 Locates portable .exe file

### 4. **Git Operations**
- 💾 Commits version changes
- 🏷️ Creates git tag (e.g., `v3.9.17`)
- ⬆️ Pushes changes and tags to GitHub
- ✅ Verifies git operations

### 5. **GitHub Release**
- 🌐 Creates GitHub release using GitHub CLI
- 📄 Generates release notes automatically
- 📎 Uploads portable executable as asset
- 🔗 Provides release URL

## 📋 Prerequisites

### Required Tools
- **Node.js & npm**: For building the application
- **Git**: For version control and tagging
- **GitHub CLI (gh)**: For automated release creation
  - Install from: https://cli.github.com/
  - Login with: `gh auth login`

### Optional Tools
- **PowerShell**: For running scripts (Windows built-in)
- **Windows Terminal**: For better script output

## ⚙️ Configuration

### Release Configuration (`release-config.json`)

```json
{
  "release": {
    "repository": "wattsy74/BumbleGum-Guitars-Configuator-and-Firmware",
    "defaultBranch": "v3.0",
    "artifactPattern": "BumbleGum-Guitars-Configurator-v{version}-portable.exe"
  },
  "automation": {
    "autoCommit": true,
    "autoTag": true,
    "autoPush": true,
    "autoRelease": true,
    "requireConfirmation": true
  }
}
```

### Environment Setup

1. **Install GitHub CLI**:
   ```bash
   winget install GitHub.cli
   # or download from https://cli.github.com/
   ```

2. **Authenticate with GitHub**:
   ```bash
   gh auth login
   ```

3. **Set PowerShell Execution Policy** (if needed):
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

## 🧪 Testing the Auto-Updater

### Test Commands

```bash
# Test the auto-updater API
npm run test:updater

# Test update checking process
.\test-updater.ps1 -TestUpdateCheck

# Create a test release
.\test-updater.ps1 -CreateTestRelease -TestVersion "3.9.17"
```

### Testing Workflow

1. **Test API Connection**:
   ```bash
   npm run test:updater
   ```

2. **Create Test Release**:
   ```bash
   .\test-updater.ps1 -CreateTestRelease
   ```

3. **Test Update Detection**:
   - Run the current app
   - Click "Check for App Updates" in config menu
   - Verify update notification appears

4. **Test Download & Install**:
   - Download the test update
   - Verify progress tracking
   - Test installation process

## 📖 Usage Examples

### Standard Patch Release
```bash
# Most common: bug fixes and small improvements
npm run release:patch
```

### Feature Release
```bash
# New features or significant improvements
npm run release:minor
```

### Major Version Release
```bash
# Breaking changes or major overhaul
npm run release:major
```

### Custom Release with Notes
```powershell
.\release.ps1 -VersionType patch -ReleaseNotes @"
## Bug Fixes
- Fixed LED indicator timing issue
- Improved serial communication stability
- Updated firmware compatibility

## Improvements  
- Enhanced auto-updater reliability
- Better error messages
- Performance optimizations
"@
```

### Dry Run Testing
```bash
# Test the process without making any changes
npm run release:dry-run
```

## 🔧 Advanced Usage

### Manual Release Steps

If you prefer manual control or the automation fails:

1. **Update Version**:
   ```bash
   # Edit package.json manually
   # Change "version": "3.9.16" to "3.9.17"
   ```

2. **Build Application**:
   ```bash
   npm run make
   ```

3. **Git Operations**:
   ```bash
   git add package.json
   git commit -m "Release v3.9.17"
   git tag v3.9.17
   git push
   git push origin v3.9.17
   ```

4. **Create GitHub Release**:
   ```bash
   gh release create v3.9.17 \
     --title "BGG Configurator v3.9.17" \
     --notes "Release notes here" \
     "out\make\BumbleGum-Guitars-Configurator-v3.9.17-portable.exe"
   ```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| `gh: command not found` | Install GitHub CLI from https://cli.github.com/ |
| `git push failed` | Check authentication: `git remote -v` |
| `Build failed` | Run `npm install` and check dependencies |
| `Release creation failed` | Check GitHub CLI auth: `gh auth status` |
| `PowerShell execution blocked` | Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |

### Version Strategy

- **Patch (x.y.Z)**: Bug fixes, small improvements, firmware updates
- **Minor (x.Y.0)**: New features, UI improvements, significant enhancements  
- **Major (X.0.0)**: Breaking changes, major redesigns, architecture changes

## 🎯 Integration with Auto-Updater

The release system works seamlessly with the built-in auto-updater:

1. **Automated Detection**: Users get notified automatically when new releases are available
2. **Seamless Updates**: One-click download and installation
3. **Version Tracking**: Proper semantic versioning ensures correct update detection
4. **Asset Management**: Portable executables are automatically detected and downloaded

## 📊 Release Checklist

Before running a release:

- [ ] All changes committed and tested
- [ ] Firmware updates included (if applicable)  
- [ ] Documentation updated
- [ ] GitHub CLI authenticated
- [ ] Internet connection available
- [ ] No critical issues in current version

After release:

- [ ] Verify GitHub release created successfully
- [ ] Test auto-updater detection with older version
- [ ] Update documentation if needed
- [ ] Announce release to users
- [ ] Monitor for user feedback

## 🔄 Continuous Integration

For future enhancements, consider:

- **GitHub Actions**: Automate releases on tag push
- **Automated Testing**: Run tests before release creation
- **Multi-Platform**: Build for multiple operating systems
- **Code Signing**: Sign executables for security
- **Release Notes**: Auto-generate from commit messages

---

**The automated release system provides a professional, reliable way to publish new versions of the BGG Configurator with minimal manual effort and maximum consistency.**
