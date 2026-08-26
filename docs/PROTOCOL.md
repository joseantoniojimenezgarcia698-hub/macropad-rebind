# CH57x keypad protocol

Wire protocol for CH57x-based mini keypads (vendor `0x1189`). Confirmed
against a `1189:8842` with 12 keys and 2 knobs.

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
`(modifier, keycode)` pairs, but the firmware keeps only 18.

**Overshooting is not rejected — it corrupts.** Measured on a `1189:8842` by
writing sequences of 16, 18, 19, 20, 22 and 27 steps and reading each back:

| Steps written | Count byte read back | Pairs actually stored |
|---:|---:|---:|
| 16 | 16 | 16 |
| 18 | 18 | 18 |
| 19 | 19 | **18** |
| 20 | 20 | **18** |
| 22 | 22 | **18** |
| 27 | 27 | **18** |

The device stores the count byte verbatim while dropping every pair past the
18th, leaving a record that claims a length it does not have. A writer must
clamp to 18 itself; the firmware will not do it for you.

## Hardware geometry

Slot ids run **up each column from the bottom-left** — the corner furthest from
the knobs, where the key matrix begins:

    slot  4   slot  8   slot 12     <- top row, nearest the knobs
    slot  3   slot  7   slot 11
    slot  2   slot  6   slot 10
    slot  1   slot  5   slot  9     <- bottom row

So `slot = column * 4 + (4 - row)`, with row counted from the top. Reading order
left-to-right, top-to-bottom is therefore `4,8,12 / 3,7,11 / 2,6,10 / 1,5,9`.

Knob 1 (slots 16–18) is the **left** knob. Verified on hardware — it is not
something you can infer from a config where both knobs are bound to volume.

## Lighting

The entire lighting interface is one byte: `(colour << 4) | mode` at offset 11 of
the LED record.

    03 FE B0 <layer+1> 08 00 00 00 00 00 01 00 <code>
    03 FD FE FF

Modes: 0 off, 1 steady backlight, 2 shock, 3 shock2, 4 light-up-on-press,
5 steady white. Colours 1–7: red, orange, yellow, green, cyan, blue, purple.
White is mode 5 with colour 0. The LEDs are genuinely RGB.

That byte **selects** a firmware effect; it cannot describe one. There is no way
to author a new mode without replacing the firmware.

**Per-key or per-row colour is not possible.** The hardware can address keys
individually — the press effects prove it, and a wrong variant setting lights
only the first N keys — but the protocol never exposes it. Tested and rejected on
hardware:

| Hypothesis | Result |
|---|---|
| Byte 9 is a count, as it is for key macros — send 12 `(00, colour)` pairs | firmware reads the first pair, ignores the rest |
| Per-key LED slots at `0xB1`, `0xB2`, … beside the global `0xB0` | ignored, no change |
| Mode values 6–15 (the field is 4 bits, only 0–5 used) | nothing, all ten |

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
