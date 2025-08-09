# boot.py v3.3+ with Smart Config Merge
__version__ = "3.4"

def get_version():
    return __version__

import microcontroller
import board
import digitalio
import storage
import usb_cdc
import usb_hid
import usb_midi
import supervisor
import json

def file_exists(path):
    """Check if a file exists in CircuitPython"""
    try:
        with open(path, "r") as f:
            pass
        return True
    except OSError:
        return False

def smart_merge_config(source_path, target_path):
    """Smart merge that preserves user settings while adding new keys from updates"""
    try:
        # Load existing config
        existing_config = {}
        if file_exists(target_path):
            with open(target_path, "r") as f:
                existing_config = json.load(f)
        
        # Load new config
        with open(source_path, "r") as f:
            new_config = json.load(f)
        
        # Create merged config - start with new config structure
        merged_config = new_config.copy()
        
        # Preserve user-modified values from existing config
        preserve_keys = [
            "led_color", "released_color", "led_brightness", 
            "whammy_min", "whammy_max", "whammy_reverse",
            "tilt_wave_enabled", "hat_mode"
        ]
        
        for key in preserve_keys:
            if key in existing_config:
                merged_config[key] = existing_config[key]
        
        # Update metadata if present
        if "_metadata" in merged_config:
            merged_config["_metadata"]["lastUpdated"] = "2025-08-05"
            if "_metadata" in existing_config and "userModified" in existing_config["_metadata"]:
                merged_config["_metadata"]["userModified"] = existing_config["_metadata"]["userModified"]
        
        # Create backup of existing config before overwriting
        if file_exists(target_path):
            backup_path = target_path.replace(".json", "_backup.json")
            with open(backup_path, "w") as f:
                json.dump(existing_config, f, indent=2)
        
        # Write merged config with proper JSON formatting
        with open(target_path, "w") as f:
            json.dump(merged_config, f, indent=2)
        
        # Log merge results
        added_keys = set(new_config.keys()) - set(existing_config.keys())
        if added_keys:
            print(f"[BOOT] Smart merge added new keys: {', '.join(added_keys)}")
        
        preserved_keys = [k for k in preserve_keys if k in existing_config]
        if preserved_keys:
            print(f"[BOOT] Smart merge preserved user settings: {', '.join(preserved_keys)}")
        
        return True
        
    except Exception as e:
        print(f"[BOOT] Smart merge failed: {e}")
        return False

# Check for config updates during boot
def check_config_updates():
    """Check if config files need smart merging during boot"""
    try:
        config_updates = [
            ("/config_new.json", "/config.json"),
            ("/presets_new.json", "/presets.json"),
            ("/user_presets_new.json", "/user_presets.json")
        ]
        
        for source, target in config_updates:
            if file_exists(source):
                print(f"[BOOT] Found update file: {source}")
                if smart_merge_config(source, target):
                    print(f"[BOOT] Successfully merged {source} → {target}")
                    try:
                        # Remove update file after successful merge
                        import os
                        os.remove(source)
                    except:
                        # If os.remove fails, try alternative method
                        try:
                            with open(source, "w") as f:
                                f.write("")  # Clear file contents as fallback
                        except:
                            pass
                else:
                    print(f"[BOOT] Failed to merge {source}")
        
    except Exception as e:
        print(f"[BOOT] Config update check failed: {e}")

# Run config update check early in boot process
check_config_updates()

# Use last 2 bytes of UID for unique PID
uid_bytes = microcontroller.cpu.uid
unique_pid = int.from_bytes(uid_bytes[-2:], "big")

# Custom HID Gamepad Descriptor (Report ID 5)
GAMEPAD_REPORT_DESCRIPTOR = bytes((
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x05,        # Usage (Gamepad)
    0xA1, 0x01,        # Collection (Application)
    0x85, 0x05,        #   Report ID (5)

    # Buttons (11)
    0x05, 0x09,        #   Usage Page (Button)
    0x19, 0x01,        #   Usage Minimum (Button 1)
    0x29, 0x0B,        #   Usage Maximum (Button 11)
    0x15, 0x00,
    0x25, 0x01,
    0x95, 0x0B,
    0x75, 0x01,
    0x81, 0x02,

    # 5 bits of padding to make 16 bits (2 bytes)
    0x95, 0x05,
    0x75, 0x01,
    0x81, 0x01,

    # Hat Switch
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x39,        # Usage (Hat Switch)
    0x15, 0x01,        # Logical Minimum (1)
    0x25, 0x08,        # Logical Maximum (8)
    0x35, 0x00,        # Physical Minimum (0)
    0x46, 0x3B, 0x01,  # Physical Maximum (315)
    0x65, 0x14,        # Unit (English Rotation: degrees)
    0x75, 0x04,        # Report Size (4)
    0x95, 0x01,        # Report Count (1)
    0x81, 0x02,        # Input (Data, Variable, Absolute)

    # 4 bits of padding
    0x75, 0x04,
    0x95, 0x01,
    0x81, 0x01,

    # Z axis for whammy
    0x09, 0x32,        # Usage (Z)
    0x15, 0x00,        # Logical Minimum (0)
    0x25, 0xFF,        # Logical Maximum (255)
    0x75, 0x08,        # Report Size (8)
    0x95, 0x01,        # Report Count (1)
    0x81, 0x02,        # Input (Data, Variable, Absolute)

    0xC0
))

supervisor.set_usb_identification(
    manufacturer="BumbleGum",
    product="CH-Guitar",
    vid=0x6997,
    pid=unique_pid
)

usb_hid.set_interface_name("BumbleGum Guitars - Guitar Controller")

# Enable custom HID gamepad
gamepad = usb_hid.Device(
    report_descriptor=GAMEPAD_REPORT_DESCRIPTOR,
    usage_page=0x01,
    usage=0x05,
    report_ids=(5,),
    in_report_lengths=(4,),  # 4 bytes: 2 for buttons, 1 for hat, 1 for Z
    out_report_lengths=(0,)
)
usb_hid.enable((gamepad,))

# Disable MIDI
usb_midi.disable()

# Enable USB CDC (console + data)
usb_cdc.enable(console=True, data=True)

# Hold GREEN_FRET (GP10) to enable USB drive
button = digitalio.DigitalInOut(board.GP10)
button.switch_to_input(pull=digitalio.Pull.UP)

if button.value:
    storage.disable_usb_drive()
