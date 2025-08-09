1. Missing Start & Select buttons on configurator page - Done
2. Add Guide button to configurator page with a tooltip to say not present on all devices - Done
3. Add a uploading presets please wait message - Done
4. Investigate turning off Auto-Reload in CP with the view to allow FW patching - Done ✅
   - Standardized all file writing operations to use rebootAndReload() - Done
   - Fixed duplicate event listener in whammy calibration causing double reboot - Done
   - Auto-reload disabled successfully via supervisor.runtime.autoreload = False - Done
   - Implemented staged firmware update system via /updates/ folder - Done
5. Create a self checking update system - In Progress
   - Boot-time firmware update processor implemented in boot.py - Done
   - Firmware updater class with staging system implemented - Done
   - MKDIR command added to serial handler for directory creation - Done

BUGS
1. Switch to DPAD / JOSYTICK button is not changing its label based on the config - Resolved
2. Turn ON/OFF Tiltwave is not changing the button label based on the config - Resolved
3. Device ID and Device Firmware are not always populating in the diagnostics page - Seems stable marked as Resolved

AESTHETICS
1. Diagnostics Input Status need a better more balanced look
