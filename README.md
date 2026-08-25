# Keypad Bench

A cross-platform configurator for CH57x mini keypads — the ones sold on
AliExpress and elsewhere with 12 keys and two knobs, which ship with a 32-bit
Windows-only Qt application and nothing else.

This is a single HTML file. It uses WebHID, so it configures the keypad from
Linux, Windows, macOS or Android with nothing installed and no driver.

**Supported:** vendor `0x1189`, products `8830`–`8833`, `8840`, `8842`, `8850`.
Developed and verified against a `1189:8842` with 12 keys and 2 knobs.

## What it does

- Remap all 12 keys and both knobs (counter-clockwise, press, clockwise)
- Three layers
- Keyboard combos and multi-step macros, media keys, mouse actions
- Backlight mode and colour, per layer
- **Read the existing configuration off the keypad** — the vendor's own
  ecosystem can't do this
- Export and import profiles as JSON

Bindings live in the keypad's flash. Nothing runs in the background: the page
programs the device and exits. Once configured, the keypad works on any machine
with no software at all.

## Run it

WebHID needs a secure context, so serve it over localhost:

    python3 -m http.server 8000
    # open http://localhost:8000/

Opening `index.html` as a `file://` URL usually works too, but localhost is the
reliable path. Any static host works — the page has no backend.

**Chromium browsers only.** Firefox and Safari have not implemented WebHID. The
page must also be the top-level document; `navigator.hid` defaults to `self` in
Permissions Policy, so it will not work inside a cross-origin iframe.

## Linux permissions

`/dev/hidraw*` is root-only by default, and Chrome opens hidraw exactly like a
native application does. Install the udev rule once:

    sudo cp linux/60-ch57x-keypad.rules /etc/udev/rules.d/
    sudo udevadm control --reload-rules
    # then unplug and replug the keypad

Check it took — this needs no sudo and should print your username:

    getfacl -p /dev/hidraw2 | grep $USER

The rule uses `TAG+="uaccess"`, which grants the device to whoever is logged in
at the local seat. That is narrower than joining the `input` group, which would
let you read every input device on the machine.

**The filename must sort below 70.** systemd's `70-uaccess.rules` is what acts
on the `uaccess` tag; a rule that adds the tag later is silently ignored.

## Using it

1. **Connect keypad.** The browser picker is filtered to vendor `0x1189` on
   usage page `0xFF00`, so only the configuration interface is offered. The
   keyboard interface is invisible to WebHID by design.
2. **Read from keypad** pulls the live configuration into the editor.
3. Pick a key or knob action, choose Keyboard / Media / Mouse, and bind it. For
   keyboard bindings, click the capture box and **press the shortcut you want** —
   it is read off your real keyboard and converted to HID usage codes.
4. Set the backlight per layer. **Apply lighting now** sends just that, without
   a full write.
5. **Write to keypad.**

Bindings persist in `localStorage`, which is a convenience and not a backup. Use
**Export** for anything you care about.

> **Exported profiles contain whatever your macros type.** If you have a key that
> types a password, it is in that JSON in plain text. `.gitignore` excludes the
> usual filenames, but do check before committing.

A binding read off the device keeps its original 64 bytes and is written back
byte for byte unless you edit it, so fields this tool does not fully decode
survive a round trip untouched.

## Tests

    node test-protocol.mjs

Extracts the message builder out of `index.html` — so the test always checks the
file that actually ships — and asserts it against two independent sources: the
byte vectors published in `ch57x-keyboard-tool`'s `src/keyboard/k884x.rs`, and
records captured from real hardware. 102 assertions, no dependencies.

## Command line

`linux/probe.py` reads the keypad's configuration and prints it, with no
dependencies beyond Python 3. Useful for checking what is on the device without
opening a browser.

    python3 linux/probe.py

## Protocol

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the wire format, the record layout,
the hardware geometry, and the things that are known to be dangerous.

If you are working on this keypad family, the two most valuable things in that
document are the **read-back command** (`0xFA`, which the vendor app uses and no
open-source tool implemented) and the **`0xFC` hazard** — an undocumented command
that makes a working keypad look broken, with a recovery that is not obvious.

## Credits

The write-side byte layout was cross-checked against
[kriomant/ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool)
(MIT, © 2023 Mikhail Trishchenkov), whose unit tests carry vectors verified
against real USB captures. This project's tests assert against those vectors
directly. If you want a command-line tool with a YAML config, use that one — it
is excellent, and it supports keyboards this page has never seen.

The read side, the hardware geometry, the device-variant command and the LED
findings were recovered independently by reverse-engineering the vendor's
`MINI_KEYBOARD.exe` — which shipped with its build directory and unstripped
object files still attached — and confirmed against hardware.

No vendor code or binaries are included in this repository.

## Licence

MIT — see [LICENSE](LICENSE).
