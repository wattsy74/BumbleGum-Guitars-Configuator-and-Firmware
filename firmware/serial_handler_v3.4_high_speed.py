# serial_handler.py - High-Speed Streaming Version
__version__ = "3.4"

def get_version():
    return __version__
# Serial command handler for BGG Firmware
import json
import time
import microcontroller 
import os
from utils import hex_to_rgb, load_config
from hardware import setup_leds, setup_buttons, setup_whammy, resolve_pin

# Helper: ensure parent directory exists before writing
# Only works for single-level subdirs (e.g. /updates/file.txt)
def ensure_parent_dir_exists(filepath):
    dirpath = "/".join(filepath.split("/")[:-1])
    if dirpath and dirpath != "":
        try:
            os.mkdir(dirpath)
        except OSError as e:
            # Directory may already exist, ignore EEXIST
            if not ("exist" in str(e).lower() or getattr(e, 'errno', None) == 17):
                raise

def handle_serial(serial, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors, buffer, mode, filename, file_lines, gp, update_leds, poll_inputs, joystick_x=None, joystick_y=None, max_bytes=8, start_tilt_wave=None):
    try:
        # Pre-emptive memory cleanup for large file operations
        if mode == "write" and len(file_lines) > 8:  # ULTRA-early cleanup threshold (8 lines = ~400 bytes)
            import gc
            gc.collect()
            
        for _ in range(max_bytes):
            if not serial.in_waiting:
                return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
            
            try:
                byte = serial.read(1)
                if not byte:
                    return buffer, mode, filename, file_lines, config, raw_config, leds, buttons, whammy, current_state, user_presets, preset_colors
                    
                char = byte.decode("utf-8")
            except Exception as byte_error:
                print(f"❌ Error reading/decoding byte: {byte_error}")
                # Skip this byte and continue
                continue

            if char == "\n":
                line = buffer.rstrip("\r\n")
                buffer = ""
                print(f"📩 Received line: {line}")
                # DEBUG: Send acknowledgment for ANY line received
                serial.write(f"DEBUG: Line received: {line[:50]}{'...' if len(line) > 50 else ''}\n".encode("utf-8"))

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

                # 🕹️ Handle READJOYSTICK command
                elif mode is None and line == "READJOYSTICK":
                    if joystick_x and joystick_y:
                        x_val = joystick_x.value
                        y_val = joystick_y.value
                        serial.write(f"JOYSTICK:X:{x_val}:Y:{y_val}\n".encode("utf-8"))
                    else:
                        serial.write(b"JOYSTICK:X:-1:Y:-1\n")

                # 📝 Handle WRITEFILE commands with HIGH-SPEED streaming mode
                elif mode is None and line.startswith("WRITEFILE:"):
                    filename = "/" + line.split(":", 1)[1]
                    file_lines = []
                    
                    # Optimized detection - use high-speed streaming for most Python files
                    fname_lower = filename.lower()
                    use_high_speed_streaming = (
                        "serial_handler.py" in fname_lower or
                        "code.py" in fname_lower or
                        "gamepad.py" in fname_lower or
                        "hardware.py" in fname_lower or
                        "utils.py" in fname_lower or
                        "demo_routine.py" in fname_lower or
                        "demo_state.py" in fname_lower or
                        "pin_detect.py" in fname_lower or
                        "boot.py" in fname_lower or
                        # Any .py file likely to be >2KB gets streaming
                        (fname_lower.endswith(".py") and len(fname_lower) > 8)
                    )
                    
                    if use_high_speed_streaming:
                        mode = "write_stream"
                        print(f"📝 Starting HIGH-SPEED streaming write to {filename}")
                        # Open file handle immediately for high-speed streaming
                        try:
                            ensure_parent_dir_exists(filename)
                            stream_file = open(filename, "w")
                            file_lines = [stream_file]  # Store file handle in first position
                            serial.write(f"DEBUG: HIGH-SPEED streaming activated for {filename}\n".encode("utf-8"))
                        except Exception as stream_error:
                            serial.write(f"ERROR: Failed to open stream for {filename}: {stream_error}\n".encode("utf-8"))
                            mode = "write"  # Fallback to regular mode
                            file_lines = []
                    else:
                        mode = "write"
                        print(f"📝 Starting regular write to {filename}")
                    
                    # DEBUG: Send immediate acknowledgment
                    serial.write(f"DEBUG: WRITEFILE command received for {filename}\n".encode("utf-8"))
                    print(f"🔍 DEBUG: WRITEFILE command processed, mode set to {mode}")

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

                # ✏️ HIGH-SPEED streaming write mode - optimized for maximum throughput
                elif mode == "write_stream":
                    if line == "END":
                        try:
                            # Flush and close the stream file
                            if file_lines and hasattr(file_lines[0], 'close'):
                                file_lines[0].flush()  # Final flush
                                file_lines[0].close()
                                serial.write(f"✅ File {filename} written (high-speed streaming)\n".encode("utf-8"))
                                print(f"✅ High-speed streaming write completed for {filename}")
                            else:
                                serial.write(f"ERROR: No valid stream handle for {filename}\n".encode("utf-8"))
                        except Exception as e:
                            serial.write(f"ERROR: Failed to close stream for {filename}: {e}\n".encode("utf-8"))
                            print(f"❌ Stream close error: {e}")
                        finally:
                            mode = None
                            file_lines = []
                            import gc
                            gc.collect()
                    else:
                        # HIGH-SPEED write: minimal overhead, batched operations
                        try:
                            if file_lines and hasattr(file_lines[0], 'write'):
                                # Fast write with newline
                                file_lines[0].write(line + "\n")
                                
                                # Track lines using file_lines list length (starting from index 1)
                                if len(file_lines) == 1:  # First line after file handle
                                    file_lines.append(1)  # Line counter at index 1
                                else:
                                    file_lines[1] += 1  # Increment line counter
                                
                                line_count = file_lines[1]
                                
                                # Optimized flush frequency - every 128 lines (~6KB) for speed
                                if line_count % 128 == 0:
                                    file_lines[0].flush()
                                
                                # Very infrequent GC - only every 40KB to maximize speed
                                if line_count % 800 == 0:  # ~40KB
                                    import gc
                                    gc.collect()
                            else:
                                serial.write(f"ERROR: Invalid stream handle for {filename}\n".encode("utf-8"))
                                mode = None
                                file_lines = []
                        except Exception as stream_write_error:
                            print(f"❌ Error writing line to stream: {stream_write_error}")
                            serial.write(f"ERROR: Stream write error: {stream_write_error}\n".encode("utf-8"))
                            mode = None
                            file_lines = []

                # ✏️ Write mode logic (original memory-accumulating mode for small files)
                elif mode == "write":
                    if line == "END":
                        try:
                            # Aggressive pre-write memory cleanup
                            import gc
                            line_count = len(file_lines)
                            if line_count > 20:  # Earlier threshold
                                gc.collect()
                                print(f"🧠 Pre-write cleanup for {filename}: {line_count} lines")
                            
                            # Memory-efficient file writing
                            if filename.endswith(".json"):
                                # Small JSON files - use full parsing and validation
                                raw = "\n".join(file_lines)
                                parsed = json.loads(raw)
                                
                                # Validation for user_presets.json
                                if filename == "/user_presets.json":
                                    if (
                                        isinstance(parsed, dict) and
                                        all(
                                            isinstance(v, dict) and (
                                                (isinstance(k, str) and (k.lower().startswith("user ") or "preset" in k.lower()))
                                            )
                                            for k, v in parsed.items()
                                        )
                                    ):
                                        ensure_parent_dir_exists(filename)
                                        with open(filename, "w") as f:
                                            f.write(json.dumps(parsed, indent=2) + "\n")
                                        serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                        print("✅ File written successfully (user_presets.json, validated)")
                                        user_presets = parsed
                                        preset_colors = user_presets.get("NewUserPreset1", {})
                                    else:
                                        serial.write(f"ERROR: Invalid user_presets.json structure, write rejected\n".encode("utf-8"))
                                        print("❌ Invalid user_presets.json structure, write rejected")
                                elif filename == "/config.json":
                                    ensure_parent_dir_exists(filename)
                                    with open(filename, "w") as f:
                                        f.write(json.dumps(parsed, indent=2) + "\n")
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
                                    # Write re-serialized JSON for other small JSON files with proper formatting
                                    ensure_parent_dir_exists(filename)
                                    with open(filename, "w") as f:
                                        f.write(json.dumps(parsed, indent=2) + "\n")
                                    serial.write(f"✅ File {filename} written\n".encode("utf-8"))
                                    print("✅ File written successfully")
                                    
                            else:
                                # Small non-JSON files - write efficiently
                                ensure_parent_dir_exists(filename)
                                with open(filename, "w") as f:
                                    for i, line in enumerate(file_lines):
                                        f.write(line)
                                        if i < len(file_lines) - 1:
                                            f.write("\n")
                                    f.write("\n")  # Ensure file ends with newline
                                print(f"✅ File {filename} written successfully ({line_count} lines)")
                                    
                            serial.write(f"✅ File {filename} written\n".encode("utf-8"))

                        except Exception as e:
                            serial.write(f"ERROR: Failed to write {filename}: {e}\n".encode("utf-8"))
                            print("❌", e)
                        finally:
                            # Always cleanup mode and file_lines, even on error
                            mode = None
                            file_lines = []
                            # Final cleanup
                            import gc
                            gc.collect()
                    else:
                        try:
                            file_lines.append(line)
                            # Light memory protection for small files
                            line_count = len(file_lines)
                            if line_count > 30 and line_count % 20 == 0:  # Cleanup every 20 lines after 30
                                import gc
                                gc.collect()
                                print(f"🧠 Memory cleanup: {line_count} lines for {filename}")
                        except Exception as append_error:
                            print(f"❌ Error appending line to file_lines: {append_error}")
                            serial.write(f"ERROR: Memory error during file processing: {append_error}\n".encode("utf-8"))
                            mode = None
                            file_lines = []

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
                                ensure_parent_dir_exists(filename)
                                with open(filename, "w") as f:
                                    f.write(json.dumps(merged, indent=2) + "\n")
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
                        try:
                            file_lines.append(line)
                            # Memory protection for merge mode too
                            if len(file_lines) > 25:  # User presets are typically smaller
                                import gc
                                gc.collect()
                                print(f"🧠 Memory cleanup in merge mode: {len(file_lines)} lines")
                        except Exception as merge_append_error:
                            print(f"❌ Error appending line in merge mode: {merge_append_error}")
                            serial.write(f"ERROR: Memory error during merge: {merge_append_error}\n".encode("utf-8"))
                            mode = None
                            file_lines = []

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

                # 📁 Handle MKDIR command
                elif mode is None and line.startswith("MKDIR:"):
                    print(f"🔍 MKDIR handler entered with line: {line}")
                    try:
                        import os
                        folder_path = line[6:].strip()  # Remove "MKDIR:" prefix
                        print(f"📁 Creating directory: {folder_path}")
                        # CircuitPython uses os.mkdir(), not os.makedirs()
                        try:
                            os.mkdir(folder_path)
                            print(f"✅ Created new directory: {folder_path}")
                        except OSError as mkdir_error:
                            # Directory might already exist, which is fine
                            # Check for various "file exists" error patterns across different systems
                            error_str = str(mkdir_error).lower()
                            if (
                                "eexist" in error_str or 
                                "file exists" in error_str or 
                                "exists" in error_str or
                                "cannot create" in error_str or
                                mkdir_error.errno == 17  # EEXIST errno
                            ):
                                print(f"📁 Directory already exists: {folder_path}")
                            else:
                                # Re-raise for other OS errors
                                raise mkdir_error
                        serial.write(f"MKDIR:SUCCESS:{folder_path}\n".encode("utf-8"))
                        print(f"✅ Directory ready: {folder_path}")
                    except Exception as e:
                        serial.write(f"MKDIR:ERROR:{e}\n".encode("utf-8"))
                        print(f"❌ Failed to create directory: {e}")

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

                # 📖 Handle READVERSION command
                elif mode is None and line == "READVERSION":
                    print("📖 READVERSION handler entered")
                    try:
                        serial.write(f"VERSION:{__version__}\nEND\n".encode("utf-8"))
                        print(f"✅ Version sent: {__version__}")
                    except Exception as e:
                        serial.write(f"ERROR: {e}\nEND\n".encode("utf-8"))
                        print(f"❌ Error sending version: {e}")

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
