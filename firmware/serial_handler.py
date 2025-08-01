# serial_handler.py
__version__ = "3.0"

def get_version():
    return __version__
# Serial command handler for BGG Firmware
import json
import time
import microcontroller 
from utils import hex_to_rgb, load_config
from hardware import setup_leds, setup_buttons, setup_whammy, resolve_pin

def handle_serial(serial, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors, buffer, mode, filename, file_lines, gp, update_leds, poll_inputs, joystick_x=None, joystick_y=None, max_bytes=8, start_tilt_wave=None):
    try:
        for _ in range(max_bytes):
            if not serial.in_waiting:
                return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
            byte = serial.read(1)
            if not byte:
                return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
            char = byte.decode("utf-8")

            if char == "\n":
                line = buffer.rstrip("\r\n")
                buffer = ""
                print(f"📩 Received line: {line}")

                # 🎬 Handle DEMO command - run LED demo routine (non-blocking)
                if mode is None and line == "DEMO":
                    try:
                        from demo_routine import run_demo_generator
                        import demo_state
                        demo_state.demo_gen = run_demo_generator(leds, config, preset_colors, start_tilt_wave)
                        serial.write(b"DEMO:STARTED\n")
                    except ImportError as e:
                        serial.write(b"ERROR: DEMO modules not found\n")
                        print(f"❌ DEMO import error: {e}")
                    except Exception as e:
                        serial.write(f"ERROR: DEMO failed: {e}\n".encode("utf-8"))
                        print(f"❌ DEMO error: {e}")
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors

                # --- Pin Detect Commands ---
                if mode is None and line.startswith("DETECTPIN:"):
                    from pin_detect import deinit_all_buttons, detect_pin
                    button_name = line.split(":", 1)[1].strip()
                    deinit_all_buttons(buttons)
                    serial.write(f"PINDETECT:START:{button_name}\n".encode("utf-8"))
                    detected_pin = detect_pin(button_name, duration=10)
                    if detected_pin:
                        serial.write(f"PINDETECT:DETECTED:{button_name}:{detected_pin}\n".encode("utf-8"))
                    else:
                        serial.write(f"PINDETECT:NONE:{button_name}\n".encode("utf-8"))
                    # Reinitialize button pins after detection to avoid crash
                    buttons = setup_buttons(config, raw_config)
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors

                if mode is None and line.startswith("SAVEPIN:"):
                    from pin_detect import save_detected_pin
                    try:
                        _, button_name, pin_name = line.split(":")
                        save_detected_pin("/config.json", button_name, pin_name)
                        serial.write(f"PINDETECT:SAVED:{button_name}:{pin_name}\n".encode("utf-8"))
                    except Exception as e:
                        serial.write(f"PINDETECT:ERROR:{e}\n".encode("utf-8"))
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors

                if mode is None and line == "CANCELPINDETECT":
                    from pin_detect import cancel_pin_detect
                    cancel_pin_detect()
                    serial.write(b"PINDETECT:CANCELLED\n")
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors

                # 🔦 Preview LED command — always handled
                if line.startswith("PREVIEWLED:"):
                    try:
                        _, led_name, hex_color = line.split(":")
                        name_map = {
                            "green-fret": "GREEN_FRET_led",
                            "green-fret-pressed": "GREEN_FRET_led",
                            "green-fret-released": "GREEN_FRET_led",
                            "red-fret": "RED_FRET_led",
                            "red-fret-pressed": "RED_FRET_led",
                            "red-fret-released": "RED_FRET_led",
                            "yellow-fret": "YELLOW_FRET_led",
                            "yellow-fret-pressed": "YELLOW_FRET_led",
                            "yellow-fret-released": "YELLOW_FRET_led",
                            "blue-fret": "BLUE_FRET_led",
                            "blue-fret-pressed": "BLUE_FRET_led",
                            "blue-fret-released": "BLUE_FRET_led",
                            "orange-fret": "ORANGE_FRET_led",
                            "orange-fret-pressed": "ORANGE_FRET_led",
                            "orange-fret-released": "ORANGE_FRET_led",
                            "strum-up": "STRUM_UP_led",
                            "strum-up-active": "STRUM_UP_led",
                            "strum-up-released": "STRUM_UP_led",
                            "strum-down": "STRUM_DOWN_led",
                            "strum-down-active": "STRUM_DOWN_led",
                            "strum-down-released": "STRUM_DOWN_led"
                        }
                        led_key = name_map.get(led_name.lower())
                        i = config.get(led_key)
                        if i is not None and leds:
                            rgb = hex_to_rgb(hex_color)
                            leds[i] = rgb
                            leds.show()
                            print("🔍 PREVIEWLED applied")
                            print(f"➡️ led_name: {led_name}, hex_color: {hex_color}")
                            print(f"➡️ led_key: {led_key}, index: {i}, rgb: {rgb}")
                        else:
                            print(f"⚠️ LED not found for key: {led_key}")
                    except Exception as e:
                        print("⚠️ PREVIEWLED failed:", e)
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
                # 🧾 Handle READFILE commands
                if mode is None and line.startswith("READFILE:"):
                    filename = "/" + line.split(":", 1)[1]
                    try:
                        # Send START_<FILENAME> marker
                        fname = filename.split("/")[-1]
                        serial.write(f"START_{fname}\n".encode("utf-8"))
                        with open(filename, "r") as f:
                            lines = f.readlines()
                        sent_content = False
                        if lines:
                            for l in lines:
                                # Defensive: skip blank lines and FIRMWARE_READY:OK lines
                                l_stripped = l.strip()
                                if not l_stripped or l_stripped == "FIRMWARE_READY:OK":
                                    continue
                                serial.write(l.encode("utf-8"))
                                sent_content = True
                        # Always send END_<FILENAME> marker, even if file is empty or all lines skipped
                        serial.write(f"END_{fname}\n".encode("utf-8"))
                    except Exception as e:
                        # On error, still send END_<FILENAME> for protocol consistency
                        fname = filename.split("/")[-1]
                        serial.write(f"ERROR: {e}\nEND_{fname}\n".encode("utf-8"))
                # 🎸 Handle READWHAMMY command
                elif mode is None and line == "READWHAMMY":
                    if whammy:
                        serial.write(f"WHAMMY:{whammy.value}\n".encode("utf-8"))
                    else:
                        serial.write(b"WHAMMY:-1\n")

                # �️ Handle READJOYSTICK command
                elif mode is None and line == "READJOYSTICK":
                    if joystick_x and joystick_y:
                        x_val = joystick_x.value
                        y_val = joystick_y.value
                        serial.write(f"JOYSTICK:X:{x_val}:Y:{y_val}\n".encode("utf-8"))
                    else:
                        serial.write(b"JOYSTICK:X:-1:Y:-1\n")

                # �📝 Handle WRITEFILE commands
                elif mode is None and line.startswith("WRITEFILE:"):
                    filename = "/" + line.split(":", 1)[1]
                    file_lines = []
                    mode = "write"
                    print(f"📝 Starting write to {filename}")

                # 🔄 Handle user preset import
                elif mode is None and line == "IMPORTUSER":
                    filename = "/user_presets.json"
                    file_lines = []
                    mode = "merge_user"
                    print("🔄 Starting IMPORTUSER merge")

                # --- Handle READPIN:<key> for button status ---
                elif mode is None and line.startswith("READPIN:"):
                    key = line.split(":", 1)[1].strip()
                    print(f"[DEBUG] READPIN handler for key: {key}")
                    pin_obj = buttons.get(key)
                    if pin_obj:
                        val = int(not pin_obj["obj"].value)
                        print(f"[DEBUG] Pin value for {key}: {val}")
                        serial.write(f"PIN:{key}:{val}\n".encode("utf-8"))
                    else:
                        print(f"[DEBUG] Pin not found for {key}")
                        serial.write(f"PIN:{key}:ERR\n".encode("utf-8"))

                # 🌊 Handle TILTWAVE command - trigger blue wave effect
                elif mode is None and line == "TILTWAVE":
                    print("🌊 Triggering tilt wave effect")
                    try:
                        if leds is not None:
                            print("🌊 Starting exact tilt wave animation")
                            
                            # Store current LED colors before starting wave
                            stored_colors = [(0, 0, 0)] * len(leds)
                            for i in range(len(leds)):
                                stored_colors[i] = tuple(leds[i])
                            
                            # Enhanced wave colors - exact same as main firmware
                            WAVE_COLORS = [
                                (0, 0, 255),      # Deep blue
                                (0, 100, 255),    # Bright blue
                                (0, 150, 255),    # Electric blue  
                                (50, 200, 255),   # Cyan-blue
                                (100, 220, 255),  # Light electric blue
                                (150, 240, 255),  # Bright cyan
                                (200, 250, 255),  # Nearly white-blue
                                (255, 255, 255),  # Pure white (peak)
                                (200, 250, 255),  # Bright cyan (fade back)
                                (150, 240, 255),  # Light electric blue
                                (100, 220, 255),  # Electric blue
                                (50, 200, 255),   # Cyan-blue
                                (0, 150, 255),    # Electric blue
                                (0, 100, 255),    # Bright blue
                                (0, 50, 255),     # Deep blue
                                (0, 25, 128),     # Darker blue
                                (0, 12, 64),      # Very dark blue
                                (0, 0, 32),       # Almost off
                                (0, 0, 0)         # Off
                            ]
                            
                            # Animation parameters - exact same as firmware
                            tilt_wave_max_steps = 120  # 2.4 seconds
                            led_count = len(leds)
                            wave_cycles = 3  # Number of complete sweeps
                            total_sweep_steps = tilt_wave_max_steps // wave_cycles
                            tilt_wave_led_counter = 0
                            
                            # Perform the exact tilt wave animation algorithm
                            for tilt_wave_step in range(tilt_wave_max_steps):
                                # Only update LEDs every 2nd cycle (50Hz from 100Hz)
                                tilt_wave_led_counter += 1
                                if tilt_wave_led_counter < 2:
                                    time.sleep(0.01)  # 100Hz base rate
                                    continue
                                tilt_wave_led_counter = 0
                                
                                # Calculate wave position - exact algorithm from firmware
                                current_cycle_step = tilt_wave_step % total_sweep_steps
                                wave_position = (current_cycle_step * 12) // total_sweep_steps  # 0-11 range
                                
                                for led_index in range(led_count):
                                    # Calculate distance from wave center
                                    distance = abs(led_index * 2 - wave_position)  # Scale LED positions
                                    
                                    # Multiple wave effects - exact algorithm:
                                    if distance == 0:
                                        # Direct hit - brightest color
                                        color_idx = 7  # Pure white peak
                                    elif distance == 1:
                                        # Adjacent - very bright
                                        color_idx = 5 + (current_cycle_step % 3)  # Cycle through bright colors
                                    elif distance == 2:
                                        # Near - bright blue
                                        color_idx = 3 + (current_cycle_step % 2)
                                    elif distance <= 4:
                                        # Trailing effect - medium blue
                                        color_idx = max(0, 4 - distance)
                                    else:
                                        # Far from wave - dim or off
                                        color_idx = 0
                                    
                                    # Add sparkle effects on secondary cycles
                                    cycle_num = tilt_wave_step // total_sweep_steps
                                    if cycle_num > 0 and (led_index + tilt_wave_step) % 7 == 0:
                                        color_idx = min(len(WAVE_COLORS) - 1, color_idx + 3)  # Extra brightness
                                    
                                    # Clamp color index
                                    color_idx = min(len(WAVE_COLORS) - 1, max(0, color_idx))
                                    leds[led_index] = WAVE_COLORS[color_idx]
                                
                                leds.show()
                                time.sleep(0.01)  # 100Hz base timing
                            
                            # Restore original colors
                            for i in range(len(leds)):
                                leds[i] = stored_colors[i]
                            leds.show()
                            
                            serial.write(b"TILTWAVE:STARTED\n")
                            print("✅ Exact tilt wave animation completed")
                        else:
                            serial.write(b"ERROR: No LEDs available\n")
                    except Exception as e:
                        serial.write(f"ERROR: TILTWAVE failed: {e}\n".encode("utf-8"))
                        print(f"❌ TILTWAVE error: {e}")

                # 💡 Handle SETLED:<index>:<r>:<g>:<b> command - set specific LED color
                elif mode is None and line.startswith("SETLED:"):
                    try:
                        parts = line.split(":")
                        if len(parts) == 5:  # SETLED:index:r:g:b
                            led_index = int(parts[1])
                            r = int(parts[2])
                            g = int(parts[3])
                            b = int(parts[4])
                            
                            if leds and 0 <= led_index < len(leds) and 0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255:
                                leds[led_index] = (r, g, b)
                                leds.show()
                                serial.write(f"SETLED:{led_index}:OK\n".encode("utf-8"))
                                print(f"💡 LED {led_index} set to ({r},{g},{b})")
                            else:
                                serial.write(f"SETLED:{led_index}:ERR\n".encode("utf-8"))
                        else:
                            serial.write(f"ERROR: Invalid SETLED format\n".encode("utf-8"))
                    except Exception as e:
                        serial.write(f"ERROR: SETLED command failed: {e}\n".encode("utf-8"))

                # 💡 Handle LEDRESTORE command - restore normal LED operation
                elif mode is None and line == "LEDRESTORE":
                    try:
                        print("💡 Restoring normal LED operation")
                        # Force update of LED states based on current button presses
                        import code
                        code.update_button_states(config, leds, buttons, current_state, user_presets, preset_colors)
                        serial.write(b"LEDRESTORE:OK\n")
                        print("✅ LED restoration complete")
                    except Exception as e:
                        serial.write(f"ERROR: LED restore failed: {e}\n".encode("utf-8"))
                        print(f"❌ LED restore error: {e}")

                # 🌊 Handle TILTWAVE_ENABLE:<true/false> command
                elif mode is None and line.startswith("TILTWAVE_ENABLE:"):
                    try:
                        enabled_str = line.split(":", 1)[1].strip().lower()
                        enabled = enabled_str in ("true", "1", "yes", "on")
                        config["tilt_wave_enabled"] = enabled
                        import code
                        code.tilt_wave_enabled = enabled
                        serial.write(f"TILTWAVE_ENABLE:{enabled}\n".encode("utf-8"))
                        print(f"🌊 Tilt wave {'enabled' if enabled else 'disabled'}")
                    except Exception as e:
                        serial.write(f"ERROR: Invalid TILTWAVE_ENABLE command: {e}\n".encode("utf-8"))

                # ✏️ Write mode logic
                elif mode == "write":
                    if line == "END":
                        try:
                            raw = "\n".join(file_lines)
                            if filename.endswith(".json"):
                                parsed = json.loads(raw)
                                # Validation for user_presets.json
                                if filename == "/user_presets.json":
                                    # Only allow if it's a dict of objects with keys that look like user preset names
                                    if (
                                        isinstance(parsed, dict) and
                                        all(
                                            isinstance(v, dict) and (
                                                (isinstance(k, str) and (k.lower().startswith("user ") or "preset" in k.lower()))
                                            )
                                            for k, v in parsed.items()
                                        )
                                    ):
                                        with open(filename, "w") as f:
                                            f.write(json.dumps(parsed) + "\n")
                                        serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                        print("✅ File written successfully (user_presets.json, validated)")
                                        user_presets = parsed
                                        preset_colors = user_presets.get("NewUserPreset1", {})
                                    else:
                                        serial.write(f"ERROR: Invalid user_presets.json structure, write rejected\n".encode("utf-8"))
                                        print("❌ Invalid user_presets.json structure, write rejected")
                                elif filename == "/config.json":
                                    with open(filename, "w") as f:
                                        f.write(raw + "\n")
                                    serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                    print("✅ File written successfully")
                                    if leds:
                                        leds.deinit()
                                    for p in buttons.values():
                                        try:
                                            p["obj"].deinit()
                                        except:
                                            pass
                                    if whammy:
                                        try:
                                            whammy.deinit()
                                        except:
                                            pass
                                    import microcontroller
                                    microcontroller.reset()
                                else:
                                    # Write raw text for other JSON files
                                    with open(filename, "w") as f:
                                        f.write(raw + "\n")
                                    serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                    print("✅ File written successfully")
                            else:
                                # Write raw text for non-JSON files
                                with open(filename, "w") as f:
                                    f.write(raw + "\n")

                        except Exception as e:
                            serial.write(f"ERROR: Failed to write {filename}: {e}\n".encode("utf-8"))
                            print("❌", e)
                        mode = None
                        file_lines = []
                    else:
                        file_lines.append(line)

                # 🔧 User preset merge logic
                elif mode == "merge_user":
                    if line == "END":
                        try:
                            new_data = json.loads("\n".join(file_lines))
                            try:
                                with open(filename, "r") as f:
                                    existing = json.load(f)
                            except:
                                existing = {}
                            # Validation for user_presets.json merge
                            merged = existing.copy()
                            merged.update(new_data)
                            if (
                                filename == "/user_presets.json" and
                                isinstance(merged, dict) and
                                all(
                                    isinstance(v, dict) and (
                                        (isinstance(k, str) and (k.lower().startswith("user ") or "preset" in k.lower()))
                                    )
                                    for k, v in merged.items()
                                )
                            ):
                                with open(filename, "w") as f:
                                    f.write(json.dumps(merged) + "\n")
                                user_presets = merged
                                preset_colors = user_presets.get("NewUserPreset1", {})
                                serial.write(f"✅ Merged into {filename}\n".encode("utf-8"))
                                print("✅ Merge complete (user_presets.json, validated)")
                            else:
                                serial.write(f"ERROR: Invalid user_presets.json structure, merge rejected\n".encode("utf-8"))
                                print("❌ Invalid user_presets.json structure, merge rejected")
                        except Exception as e:
                            serial.write(f"ERROR: {e}\n".encode("utf-8"))
                            print("❌ Merge failed:", e)
                        mode = None
                        file_lines = []
                    else:
                        file_lines.append(line)

                # 🔁 Handle REBOOTBOOTSEL command
                elif mode is None and line == "REBOOTBOOTSEL":
                    try:
                        import microcontroller
                        serial.write(b" Rebooting to BOOTSEL mode...\n")
                        microcontroller.on_next_reset(microcontroller.RunMode.UF2)
                        microcontroller.reset()
                    except Exception as e:
                        serial.write(f"ERROR: Failed to reboot to BOOTSEL: {e}\n".encode("utf-8"))
                        print("❌ BOOTSEL reboot failed:", e)
                # ⏪ Handle REBOOT command
                elif mode is None and line == "REBOOT":
                    try:
                        import microcontroller
                        serial.write(b"Rebooting...\n")
                        microcontroller.reset()
                    except Exception as e:
                        serial.write(f"ERROR: Failed to reboot: {e}\n".encode("utf-8"))
                        print("❌ Simple reboot failed:", e)

                # Read cpu.uid and pass back
                elif mode is None and line == "READUID":
                    print("🔍 READUID handler entered")
                    try:
                        import microcontroller
                        uid_hex = "".join("{:02X}".format(b) for b in microcontroller.cpu.uid)
                        print(f"🔑 UID: {uid_hex}")
                        serial.write((uid_hex + "\nEND\n").encode("utf-8"))
                        print("✅ UID sent over serial")
                    except Exception as e:
                        serial.write(f"ERROR: {e}\nEND\n".encode("utf-8"))
                        print(f"❌ Error sending UID: {e}")

                # ✅ Firmware ready status command
                elif mode is None and (line == "FIRMWARE_READY?" or line == "READY?"):
                    try:
                        serial.write(b"FIRMWARE_READY:OK\n")
                        print("✅ FIRMWARE_READY:OK sent over serial")
                    except Exception as e:
                        serial.write(f"ERROR: {e}\n".encode("utf-8"))
                        print(f"❌ Error sending FIRMWARE_READY: {e}")

                # 📛 Handle READDEVICENAME command
                elif mode is None and line == "READDEVICENAME":
                    try:
                        # Read /boot.py as text and extract the product string
                        with open("/boot.py", "r") as f:
                            boot_lines = f.readlines()
                        product_str = None
                        for l in boot_lines:
                            l = l.strip()
                            if l.startswith("supervisor.set_usb_identification"):
                                # Find the first quoted argument after the open paren
                                parts = l.split(",")
                                if len(parts) >= 2:
                                    # The product string is usually the second argument
                                    prod_part = parts[1].strip()
                                    # Remove any surrounding quotes
                                    if prod_part.startswith('"') and prod_part.endswith('"'):
                                        product_str = prod_part[1:-1]
                                    elif prod_part.startswith("'") and prod_part.endswith("'"):
                                        product_str = prod_part[1:-1]
                                    else:
                                        product_str = prod_part
                                    break
                        prefix = "BumbleGum Guitars - "
                        if product_str and prefix in product_str:
                            device_name = product_str.split(prefix, 1)[1].strip()
                        elif product_str:
                            device_name = product_str.strip()
                        else:
                            device_name = "Unknown"
                        serial.write((device_name + "\nEND\n").encode("utf-8"))
                        print(f"✅ Device name sent: {device_name}")
                    except Exception as e:
                        serial.write(f"ERROR: {e}\nEND\n".encode("utf-8"))
                        print(f"❌ Error sending device name: {e}")

                # ❓ Fallback error for unknown command
                elif mode is None:
                    if line.startswith("READPIN:"):
                        key = line.split(":", 1)[1].strip()
                        pin_obj = buttons.get(key)
                        if pin_obj:
                            val = int(not pin_obj["obj"].value)
                            serial.write(f"PIN:{key}:{val}\n".encode("utf-8"))
                        else:
                            serial.write(f"PIN:{key}:ERR\n".encode("utf-8"))
                    else:
                        serial.write(b"ERROR: Unknown command\n")
            else:
                buffer += char
    except Exception as e:
        print("❌ Serial handler crashed:", e)
        serial.write(f"ERROR: Serial crash: {e}\n".encode("utf-8"))
        buffer = ""
        mode = None
        file_lines = []
    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
