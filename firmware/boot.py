import microcontroller
import board
import digitalio
import storage
import usb_cdc
import usb_hid
import usb_midi
import supervisor

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

    # Padding (5 bits)
    0x95, 0x05,
    0x75, 0x01,
    0x81, 0x03,

    # Hat switch (4 bits)
    0x05, 0x01,
    0x09, 0x39,
    0x15, 0x00,
    0x25, 0x07,
    0x35, 0x00,
    0x46, 0x3B, 0x01,
    0x65, 0x14,
    0x75, 0x04,
    0x95, 0x01,
    0x81, 0x42,

    # Padding (4 bits)
    0x75, 0x04,
    0x95, 0x01,
    0x81, 0x03,

    # Z axis (whammy)
    0x09, 0x32,
    0x15, 0x00,
    0x26, 0xFF, 0x00,
    0x75, 0x08,
    0x95, 0x01,
    0x81, 0x02,

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
