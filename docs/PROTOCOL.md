# CH57x keypad protocol

Wire protocol for the mini keypads that identify as vendor `0x1189`. Confirmed
against a `1189:8842` with 12 keys and 2 knobs.

> **A note on "CH57x".** That name is the convention this ecosystem settled on,
> inherited from the first tool to crack the protocol — it is not a verified
> statement about the silicon. Some of these pads are reported to use a WCH
> CH552G instead, and the microcontroller cannot be identified from software: USB
> descriptors don't carry it, and the vendor application never names it. The only
> software route would be entering the bootloader, which reports a WCH-specific
> USB ID — and that is the one command this project refuses to send.
>
> One piece of evidence does point at CH57x for at least some models: variants of
> this family are sold with Bluetooth, and that needs a radio — which CH552 has no
> trace of, while CH573/CH579 do. Not conclusive, since a cheap pad could pair a
> CH552 with a separate BLE module, but it is the only positive signal available
> without opening a case.
>
> It makes no practical difference either way. The protocol is a property of the
> **firmware**, not the chip, and compatibility is determined by the USB
> vendor/product ID plus the HID interface layout described below. A CH552G
> running this firmware speaks this protocol; a CH57x running something else does
> not. Note also that the wireless variants are still programmed over USB — the
> configuration channel is the wired interface regardless, which retail listings
> confirm: *"if need to use bluetooth function, please first setup when wired."*
>
> The Bluetooth models carry a rechargeable battery and a charge indicator, and
> disable the backlight entirely in wireless mode to save power. A single MCU with
> an integrated radio explains that more economically than a separate BLE module
> alongside a CH552, which nudges those units further toward CH57x.

## Transport

The device presents two HID interfaces:

| Interface | Top-level usage | Reports | Purpose |
|---|---|---|---|
| 0 | vendor page `0xFF00`, usage `0x01` | ID 3 — 64 B in, 64 B out | configuration |
| 1 | keyboard, mouse, consumer control | IDs 1, 2, 4, 5 | the actual typing |

Interface 1 is why the keypad works with no software: it is a plain HID keyboard.
Interface 0 is a private side channel used to rewrite what interface 1 sends.

Because interface 0's top-level collection is a vendor usage rather than a
keyboard, it sits outside the usage classes browsers refuse to expose — which is
what makes a WebHID implementation possible at all.

Every exchange is a 64-byte payload on report ID `0x03`. Note that hidraw
includes the report ID as byte 0 of a read while WebHID does not, so **offsets
shift by one between the two APIs**. All offsets below are WebHID payload
offsets, where byte 0 is the command.

## Commands

| Byte 0 | Meaning |
|---|---|
| `0xFA` | read stored records |
| `0xFB` | identify layout |
| `0xFC` | **set hardware variant** — see the hazard section |
| `0xFD` | commit, sent as `FD FE FF` |
| `0xFE` | write a record |
| `0xAA` | separator, sent as `AA AA` |
| `0xEF` | enter firmware update — never send this |

`0xEF` puts the CH57x into its bootloader. There is no published firmware image
for this board, so there is no way back. Nothing in this project emits it.

## Record layout

Writes and reads share one layout. Only byte 0 differs — `0xFE` going out,
`0xFA` coming back — which is what makes lossless round-tripping practical.

    [0]      0xFE / 0xFA
    [1]      slot id
    [2]      layer, 1-based
    [3]      type: 1 keyboard, 2 media, 3 mouse, 5 delay, 8 LED record
    [4..8]   0
    [9]      step count, or mouse action, or LED flag
    [10..]   payload

### Slots

    1..15     keys
    16..24    knob actions, three per knob: ccw, press, cw
    0xB0      the LED / global record

A model with fewer keys simply leaves the higher key slots unused; a 12-key unit
never touches slots 13–15.

### Payloads

**Keyboard** — `[9]` is the step count, then `(modifiers, keycode)` pairs from
`[10]`, up to 18. Modifiers are the standard HID bitmask (`0x01` LeftCtrl through
`0x80` RightGui); keycodes are standard HID usage IDs. A single modifier-only
step is written with count `0` so it can combine with a following key.

**Media** — `[9]` is 0, then the 16-bit consumer usage little-endian at `[10]`.

**Mouse** — `[9]` is the action: `0x01` click, `0x03` wheel, `0x05` move or drag.
`[10]` is a modifier, `[11]` buttons, `[12]`/`[13]` dx/dy, `[14]` wheel delta.
Note that this device *reports* `0x04` for a wheel binding on read while
accepting `0x03` on write.

**Delay** — a separate record of type 5 with the delay in ms little-endian at
`[4]`. Maximum 6000.

**Empty** — a key that does nothing is stored as type 1, count 1, pair `(0, 0)`.

### Programming sequence

Per slot: the record, then optionally a delay record, then `AA AA`, `FD FE FF`,
`AA AA`.

## Reading

`0xFB` — send `FB FB FB`. The reply carries the key count and knob count.

`0xFA` — send `FA <keys> <knobs> <layer>`. The device streams one record per
slot. **Layer 3 returns its records out of order**, so key on the slot byte in
the reply rather than on arrival order.

`0xFA` does not report backlight state or inter-step delays.

## A newer hardware generation exists

Vendor software dated mid-2025 carries UI elements this protocol has no room for:
keys `K16`–`K27`, a `_BK` variant of each (per-key backlight), swipe gestures, a
free colour picker, and a delay field per macro step rather than one per binding.

None of it applies to the hardware documented here, and this project does not
attempt it. It is recorded only so that anyone finding those strings knows they
belong to later devices, not to a gap in this implementation.

## Limits

There is **no shared macro pool**. Every control on every layer owns an
independent fixed-size record, so unlike QMK/VIA there is no total budget to
exhaust — every key can hold a maximum-length macro at once.

| | |
|---|---|
| Layers | 3 |
| Controls | keys + 3 per knob (e.g. 18 on a 12+2) |
| Bindings | controls × 3 layers (54 on a 12+2) |
| Steps per keyboard binding | **18** |
| Inter-step delay | 0–6000 ms |

The record has 40 payload bytes after its 10-byte header, which is room for 20
`(modifier, keycode)` pairs, but the firmware keeps only 18. Retail listings for
these keypads state the same figure — *"could enter max 18 characters one key"* —
so the limit is deliberate, not an artefact of how the record is packed.

**Overshooting is silently truncated.** Measured on a `1189:8842` by writing
sequences of 16, 18, 19, 20, 22 and 27 steps and reading each back:

| Steps written | Count byte read back | Pairs actually stored |
|---:|---:|---:|
| 16 | 16 | 16 |
| 18 | 18 | 18 |
| 19 | 19 | **18** |
| 20 | 20 | **18** |
| 22 | 22 | **18** |
| 27 | 27 | **18** |

The device stores the count byte verbatim while dropping every pair past the
18th, so the record claims a length it does not hold.

On replay this turns out to be harmless: a 20-step macro written as `a`..`t`
types `abcdefghijklmnopqr` — 18 characters, nothing after. The firmware walks the
stored pairs and ignores its own count byte. So the practical answer is that a
too-long macro comes out truncated, not garbled.

A writer should still clamp to 18, so the stored record stays consistent with
itself and any tool reading the configuration back sees the truth.

## Hardware geometry

Slot ids run **up each column from the bottom-left** — the corner furthest from
the knobs, where the key matrix begins:

    slot  4   slot  8   slot 12     <- top row, nearest the knobs
    slot  3   slot  7   slot 11
    slot  2   slot  6   slot 10
    slot  1   slot  5   slot  9     <- bottom row

So `slot = column * 4 + (4 - row)`, with row counted from the top. Reading order
left-to-right, top-to-bottom is therefore `4,8,12 / 3,7,11 / 2,6,10 / 1,5,9`.

The vendor's own printed manual corroborates this. Its software draws the pad
**rotated 90° clockwise** — knobs on the right, so a 3-wide by 4-tall grid appears
as 4-wide by 3-tall — and numbers those cells 1..12 in reading order. Apply that
rotation to the formula above and the two numberings are identical, cell for cell.
The vendor's key numbers *are* the slot ids.

**Layers are switched on the hardware,** not over the wire: a button on the left
edge of the case cycles them, the indicator LEDs beside the knobs show which is
live, and they flash once on each press. There is no command to change the active
layer.

Knob 1 (slots 16–18) is the **left** knob. Verified on hardware — it is not
something you can infer from a config where both knobs are bound to volume.

## Lighting

The entire lighting interface is one byte: `(colour << 4) | mode` at offset 11 of
the LED record.

    03 FE B0 <layer+1> 08 00 00 00 00 00 01 00 <code>
    03 FD FE FF

Colours 1–7 are red, orange, yellow, green, cyan, blue, purple. The LEDs are
genuinely RGB. All six modes observed on hardware:

| Mode | At rest | On keypress |
|---:|---|---|
| 0 | all off | nothing |
| 1 | all keys lit, configured colour | nothing |
| 2 | all off | wave lights every key in turn, monochrome |
| 3 | all off | the same wave, reversed |
| 4 | all off | the pressed key alone lights, configured colour |
| 5 | all keys lit white | nothing |

Mode 5 is equivalent to colour 0 with mode 1 — two encodings for steady white.

That byte **selects** a firmware effect; it cannot describe one. There is no way
to author a new mode without replacing the firmware.

The colour nibble only decodes **1–7**. Values 0 and 8–15 all render white, so
white is available with any mode — not only via mode 5. Confirmed on hardware in
press mode: colour 0 with mode 4 leaves the pad dark and lights the pressed key
white. Mode values 6–15 do nothing at all.

Note that mode 4 lighting only the pressed key proves the firmware addresses LEDs
individually. The capability is there; the protocol simply never exposes it.

Modes 2 and 3 are the same keypress-triggered wave in opposite directions, and
both are **monochrome**: the wave takes the single configured colour.

### Per-key colour: not found

The hardware can address keys individually — the press effects prove it, and a
wrong variant setting lights only the first N keys — but no way to reach that from
the host has been found. Seven mechanisms were tried on a `1189:8842` and all
were ruled out:

| Hypothesis | Result |
|---|---|
| Byte 9 is a count, as for key macros — 12 `(00, colour)` pairs | first pair's colour applied to every key |
| Byte 10 is a key index — 12 `(key, colour)` pairs | first pair's colour applied to every key; index ignored |
| Per-key LED slots at `0xB1`–`0xB4` beside the global `0xB0` | no effect |
| Mode values 6–15 | no effect |
| Colour values 0 and 8–15 | all render white |
| RGB triplets in the 38 spare record bytes (12 keys × 3 fits) | no effect |
| The shock/shock2 animations being multi-hue | monochrome, both directions |

### Why a pad can still show several colours at once

The firmware drives LEDs individually — mode 4 lights exactly one key, and the
wave modes light keys one at a time. So per-key state exists inside the firmware;
it is only the *host* that has no way to address it.

That has a visible consequence. A colour change arriving **while a wave is still
running** leaves the keys it has already passed holding the old colour and the
rest taking the new one, so the pad shows two colours simultaneously.
Reproduced deliberately: set mode 2, press keys continuously, and flip the colour
every 250 ms — a wave was observed changing from red to green partway along its
own sequence.

This is what a one-off multi-colour sighting during development turned out to be,
and it is worth knowing because it looks exactly like per-key colour working. It
is not: the pad is showing the seam between two global settings, not twelve
independent ones. A single key appearing yellow fits the same mechanism — one RGB
LED with both its red and green channels driven — though that specific case was
not reproduced on demand.

Practical upshot for a writer: don't send lighting changes in quick succession.
Set the colour once and let the effect run.

## Hazard: 0xFC is not a lighting command

`0xFC` declares which hardware variant the keypad is:

    03 FC FC <key count> <knob count>

The firmware recognises fifteen combinations and nothing else: `(0,0) (2,0)
(3,1) (4,0) (4,1) (5,0) (6,0) (6,1) (6,2) (9,2) (9,3) (11,3) (12,2) (12,3)
(15,3)`.

Send the wrong pair and the firmware drives only that many keys. A 12-key pad
told `(3, 1)` lights three keys and ignores the other nine. It looks exactly like
broken hardware.

Key bindings survive — only the declared geometry changes. Recovery for a 12+2
unit is the correct variant, then a fresh LED record, then a commit:

    03 fc fc 0c 02
    03 fe b0 01 08 00 00 00 00 00 01 00 11
    03 fd fe ff

`0xFC` must not be sent alone. Pause ~200 ms, rewrite the LED record, commit,
then re-read the device. Sending it bare leaves the lighting half-configured.

## Grid shapes by model

Only 12 keys / 2 knobs has been checked against a real unit. The rest are the
documented shapes for those models, and the app lets you correct the grid if
your hardware disagrees.

| Keys | Knobs | Grid |
|---|---|---|
| 2 | 0 | 2×1 |
| 3 | 1 | 3×1 |
| 4 | 0 or 1 or 3 | 4×1 |
| 5 | 0 | 5×1 |
| 6 | 0, 1 or 2 | 3×2 |
| 9 | 2 or 3 | 3×3 |
| 11 | 3 | 4×3 |
| 12 | 2 | 3×4 |
| 12 | 3 | 4×3 |
| 15 | 3 | 5×3 |

## Credits

Write-side byte layout cross-checked against
[kriomant/ch57x-keyboard-tool](https://github.com/kriomant/ch57x-keyboard-tool)
(MIT, © 2023 Mikhail Trishchenkov), whose unit tests carry vectors verified
against USB captures. This project's tests assert against those vectors.
