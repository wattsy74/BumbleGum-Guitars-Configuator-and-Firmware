# utils.py
__version__ = "3.0"

def get_version():
    return __version__
# Utility functions for BGG Firmware
import board

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def load_config(raw, resolve_pin):
    conf = {}
    for key, value in raw.items():
        if isinstance(value, str) and value.startswith("GP"):
            conf[key] = resolve_pin(value)
        elif isinstance(value, list) and all(isinstance(v, str) and v.startswith("#") for v in value):
            conf[key] = [hex_to_rgb(v) for v in value]
        elif isinstance(value, str) and value.startswith("#"):
            conf[key] = hex_to_rgb(value)
        else:
            conf[key] = value
    return conf
