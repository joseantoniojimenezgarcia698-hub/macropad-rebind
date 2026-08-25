# Keypad Bench

A cross-platform configurator for CH57x mini keypads and macropads — the ones
sold on AliExpress and elsewhere, which ship with a 32-bit Windows-only
application and nothing else.

This is a single HTML file. It uses WebHID, so it configures the keypad from
Linux, Windows, macOS or Android with nothing installed and no driver.

**Supported:** vendor `0x1189`, products `8830`–`8833`, `8840`, `8842`, `8850`.
All 17 models the firmware recognises, from 2 keys up to 15 keys and 3 knobs.
The layout is read from the device; you can also pick it by hand.

## What it does

- Remap every key and knob (counter-clockwise, press, clockwise), across three layers
- Keyboard combos and multi-step macros, media keys, mouse actions
- **Type a string and get the macro** — capitals and symbols get their Shift automatically
- Backlight mode and colour, per layer
- **Read the existing configuration off the keypad**, and write untouched
  bindings back byte for byte
- **See exactly what will change before you write it**
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
   keyboard bindings you can either click the capture box and **press the
   shortcut you want**, or type a string into **Or type the text you want** and
   have it converted for you.
4. Set the backlight per layer. **Apply lighting now** sends just that, without
   a full write.
5. **Write to keypad.** It reads the device first and shows a diff — what is on
   each key now, and what it will become — before anything is sent.

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
records captured from real hardware. 159 assertions, no dependencies.

## If the keypad looks broken

If only some keys light up or respond, it has been told it is a different model.
Press **Repair device identity** in the Reset panel. Key bindings are unaffected;
[docs/PROTOCOL.md](docs/PROTOCOL.md) explains the cause.

## Command line

`linux/probe.py` reads the keypad's configuration and prints it, with no
dependencies beyond Python 3. Useful for checking what is on the device without
opening a browser.

    python3 linux/probe.py

## Protocol

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the wire format, the record layout,
the hardware geometry, and the things that are known to be dangerous.

The two most useful things in there if you are working on this hardware: the
**read-back command** (`0xFA`), and the **`0xFC` hazard** — an undocumented
command that makes a working keypad look broken, with a recovery that is not
obvious.

## Credits

Write-side byte layout cross-checked against
[kriomant/ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool)
(MIT, © 2023 Mikhail Trishchenkov), whose unit tests carry vectors verified
against real USB captures — this project's tests assert against them. If you
would rather have a command-line tool with a YAML config, use that one.

## Licence

MIT — see [LICENSE](LICENSE).
