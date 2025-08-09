# Deployment Instructions

## Initial Repository Setup

1. **Create GitHub Repository**
   ```bash
   # Create new repository at: https://github.com/wattsy74/bgg-firmware-updates
   # Make it PUBLIC so BGG devices can access it
   ```

2. **Clone and Setup**
   ```bash
   git clone https://github.com/wattsy74/bgg-firmware-updates.git
   cd bgg-firmware-updates
   ```

3. **Copy Files**
   ```bash
   # Copy all files from this bgg-firmware-updates folder to the repository
   cp ../bgg-firmware-updates/* ./
   ```

4. **Initial Commit**
   ```bash
   git add .
   git commit -m "Initial firmware v3.1 release with automatic update system"
   git push origin main
   ```

## Releasing New Firmware Versions

1. **Update Firmware Files**
   ```bash
   # Make changes to your firmware files in the main project
   nano firmware/code.py
   nano firmware/serial_handler.py
   ```

2. **Generate New Manifest**
   ```bash
   # From your main BGG-Windows-App directory
   python generate_manifest.py 3.2 firmware
   ```

3. **Prepare Repository Update**
   ```bash
   # Run this setup script again
   python setup_repository.py
   ```

4. **Deploy to GitHub**
   ```bash
   cd bgg-firmware-updates
   git add .
   git commit -m "Firmware v3.2: Describe your changes here"
   git push origin main
   ```

5. **Automatic Distribution**
   - BGG devices worldwide will detect the update within 24 hours
   - Users get notification popup with update option
   - Updates deploy safely using staged update system

## Testing

Before deploying to production:

1. Test with a development device using the "Check for Updates" button
2. Verify all files download correctly
3. Ensure update process completes successfully
4. Confirm device functionality after update

## Repository URL

Your firmware repository will be accessible at:
**https://github.com/wattsy74/bgg-firmware-updates**

BGG devices use GitHub API to check for updates:
**https://api.github.com/repos/wattsy74/bgg-firmware-updates/contents/version_manifest.json**
