# serial_handler.py
__version__ = "2.2"

def get_version():
    return __version__
# Serial command handler for BGG Firmware
import json
import microcontroller 
from utils import hex_to_rgb, load_config
from hardware import setup_leds, setup_buttons, setup_whammy, resolve_pin

def handle_serial(serial, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors, buffer, mode, filename, file_lines, gp, update_leds, poll_inputs, joystick_x=None, joystick_y=None, max_bytes=8):
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
                # 🧾 Handle READFILE commands
                if mode is None and line.startswith("READFILE:"):
                    filename = "/" + line.split(":", 1)[1]
                    try:
                        with open(filename, "r") as f:
                            lines = f.readlines()
                        if lines:
                            for l in lines:
                                serial.write(l.encode("utf-8"))
                        serial.write(b"END\n")
                    except Exception as e:
                        serial.write(f"ERROR: {e}\nEND\n".encode("utf-8"))
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
                    import code  # Import the main module to access tilt wave functions
                    code.start_tilt_wave()
                    serial.write(b"TILTWAVE:STARTED\n")

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
                                with open(filename, "w") as f:
                                    f.write(raw + "\n")
                                serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                print("✅ File written successfully")

                                if filename == "/user_presets.json":
                                    user_presets = parsed
                                    preset_colors = user_presets.get("NewUserPreset1", {})
                                elif filename == "/config.json":
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
                            existing.update(new_data)
                            with open(filename, "w") as f:
                                f.write(json.dumps(existing) + "\n")
                            user_presets = existing
                            preset_colors = user_presets.get("NewUserPreset1", {})
                            serial.write(f"✅ Merged into {filename}\n".encode("utf-8"))
                            print("✅ Merge complete")
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
