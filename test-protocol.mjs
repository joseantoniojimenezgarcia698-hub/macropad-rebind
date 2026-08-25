/**
 * Protocol tests for index.html.
 *
 * Extracts the message-building code straight out of index.html — so the
 * test always checks the file that actually ships — and asserts it against
 * the byte vectors published as unit tests in ch57x-keyboard-tool's
 * src/keyboard/k884x.rs, which were themselves verified against USB captures.
 *
 * Run:  node webapp/test-protocol.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const js = /<script>([\s\S]*)<\/script>/.exec(html)[1];
const core = js.slice(
  js.indexOf("const REPORT_ID"),
  js.indexOf("/* ==================================================================\n   Device I/O"),
);

const mod = await import(
  "data:text/javascript;base64," +
  Buffer.from(core + "\nexport {bindingReports, ledReports, keySlot, knobSlot, decodeRecord, touch, KEY_ORDER, SLOT_OF_POS, POS_OF_SLOT, emptyReports, variantReport, DEVICE_VARIANTS};\n").toString("base64")
);
const { bindingReports, ledReports, keySlot, knobSlot, decodeRecord, touch, KEY_ORDER, SLOT_OF_POS, POS_OF_SLOT, emptyReports, variantReport, DEVICE_VARIANTS } = mod;

let pass = 0, fail = 0;
const hx = a => Array.from(a, b => b.toString(16).padStart(2, "0")).join(" ");

/** ch57x vectors carry the leading 0x03 report id; a WebHID payload omits it. */
function check(name, got, wantWithReportId) {
  const want = wantWithReportId.slice(1);
  const head = Array.from(got.subarray(0, want.length));
  const bodyOk = head.length === want.length && head.every((b, i) => b === want[i]);
  const padOk = got.length === 64 && got.subarray(want.length).every(b => b === 0);
  if (bodyOk && padOk) { pass++; console.log("  ok    " + name); return; }
  fail++;
  console.log("  FAIL  " + name);
  console.log("        want " + hx(want));
  console.log("        got  " + hx(head) + (padOk ? "" : "   [tail not zero-padded]"));
}

function eq(name, got, want) {
  if (got === want) { pass++; console.log(`  ok    ${name} -> ${got}`); }
  else { fail++; console.log(`  FAIL  ${name} -> ${got}, want ${want}`); }
}

const SEP = [0x03, 0xaa, 0xaa];
const COMMIT = [0x03, 0xfd, 0xfe, 0xff];

console.log("\nkey bindings");
let r = bindingReports(keySlot(0), { type: "key", delay: 0, steps: [{ mods: 0x01, code: 0x04 }] });
check("ctrl-a on key 1", r[0], [0x03,0xfe,0x01,0x01,0x01,0,0,0,0,0,0x01,0x01,0x04]);
check("  separator",     r[1], SEP);
check("  commit",        r[2], COMMIT);
check("  separator",     r[3], SEP);
eq("  report count", r.length, 4);

r = bindingReports(keySlot(0), { type: "key", delay: 0, steps: [{ mods: 0x01, code: 0 }] });
check("modifier-only sends count 0", r[0], [0x03,0xfe,0x01,0x01,0x01,0,0,0,0,0,0x00,0x01,0x00]);

r = bindingReports(keySlot(0), { type: "key", delay: 1000, steps: [{ mods: 0x01, code: 0x04 }] });
check("delay 1000ms", r[1], [0x03,0xfe,0x01,0x01,0x05,0xe8,0x03]);
eq("  report count with delay", r.length, 5);

r = bindingReports(keySlot(0), { type: "key", delay: 5999, steps: [{ mods: 0, code: 0x04 }] });
check("delay 5999ms", r[1], [0x03,0xfe,0x01,0x01,0x05,0x6f,0x17]);

console.log("\nmedia");
r = bindingReports(keySlot(1), { type: "media", media: 0xe9 });
check("volume up on key 2", r[0], [0x03,0xfe,0x02,0x01,0x02,0,0,0,0,0,0x00,0xe9,0x00]);

console.log("\nmouse");
r = bindingReports(keySlot(2), { type: "mouse", action: "click", buttons: 1, mod: 0 });
check("left click",  r[0], [0x03,0xfe,0x03,0x01,0x03,0,0,0,0,0,0x01,0x00,0x01]);
r = bindingReports(keySlot(3), { type: "mouse", action: "move", dx: 10, dy: -5, mod: 0 });
check("move 10,-5",  r[0], [0x03,0xfe,0x04,0x01,0x03,0,0,0,0,0,0x05,0x00,0x00,0x0a,0xfb]);
r = bindingReports(keySlot(4), { type: "mouse", action: "wheel", wheel: 3, mod: 0 });
check("wheel +3",    r[0], [0x03,0xfe,0x05,0x01,0x03,0,0,0,0,0,0x03,0x00,0,0,0,0x03]);
r = bindingReports(keySlot(5), { type: "mouse", action: "drag", buttons: 1, dx: 5, dy: 10, mod: 0 });
check("drag left",   r[0], [0x03,0xfe,0x06,0x01,0x03,0,0,0,0,0,0x05,0x00,0x01,0x05,0x0a]);

console.log("\nslot ids");
for (let i = 0; i < 12; i++) eq(`key ${i + 1}`, keySlot(i), i + 1);
for (const [k, a, want] of [[0,0,16],[0,1,17],[0,2,18],[1,0,19],[1,1,20],[1,2,21]])
  eq(`knob ${k + 1} action ${a}`, knobSlot(k, a), want);

console.log("\nbacklight");
check("cyan steady, layer 1", ledReports(0, { mode: "backlight", color: 5 })[0],
      [0x03,0xfe,0xb0,0x01,0x08,0,0,0,0,0,0x01,0x00,0x51]);
check("  commit", ledReports(0, { mode: "backlight", color: 5 })[1], COMMIT);
check("purple press, layer 3", ledReports(2, { mode: "press", color: 7 })[0],
      [0x03,0xfe,0xb0,0x03,0x08,0,0,0,0,0,0x01,0x00,0x74]);

const code = (mode, color) => ledReports(0, { mode, color })[0][11];
for (const [mode, color, want] of [
  ["off",0,0x00], ["backlight",0,0x05], ["backlight",1,0x11], ["backlight",6,0x61],
  ["shock",1,0x12], ["shock2",4,0x43], ["press",7,0x74],
]) eq(`code ${mode}/${color}`, code(mode, color), want);


/* ------------------------------------------------------------------
   Decoding, against records actually read off a 1189:8842 keypad.
   Captured 0xFA replies, report id stripped (WebHID payload form).
   ------------------------------------------------------------------ */
const R = h => { const a = new Uint8Array(64); h.split(/\s+/).forEach((b,i) => a[i] = parseInt(b,16)); return a; };

console.log("\ndecoding real device records");

let d = decodeRecord(R("fa 01 01 02 00 00 00 00 00 01 b6 00"));
eq("key1 L1 is media", d.type, "media");
eq("  code = Previous", d.media, 0xb6);

d = decodeRecord(R("fa 03 01 01 00 00 00 00 00 01 00 21"));
eq("key3 L1 is keyboard", d.type, "key");
eq("  one step", d.steps.length, 1);
eq("  no modifiers", d.steps[0].mods, 0);
eq("  code 0x21 = '4'", d.steps[0].code, 0x21);

d = decodeRecord(R("fa 14 01 01 00 00 00 00 00 01 08 0f"));
eq("knob2 press is keyboard", d.type, "key");
eq("  Super modifier", d.steps[0].mods, 0x08);
eq("  code 0x0f = L", d.steps[0].code, 0x0f);

d = decodeRecord(R("fa 0a 01 01 00 00 00 00 00 07 00 12 00 15 00 07 00 08 00 15 00 2c 01 19"));
eq("key10 L1 is a 7-step macro", d.steps.length, 7);
eq("  last step is Ctrl+V", d.steps[6].mods, 0x01);
eq("  ... code 0x19 = V", d.steps[6].code, 0x19);

// A record whose only pair is (0,0) is an empty slot, not a binding.
eq("empty slot decodes to null", decodeRecord(R("fa 02 02 01 00 00 00 00 00 01 00 00")), null);
eq("never-programmed decodes to null", decodeRecord(R("fa 05 02 00 00 00 00 00 00 00 00 00")), null);

// Leading padding pair must not become a phantom step.
d = decodeRecord(R("fa 01 02 01 00 00 00 00 00 02 00 00 0a 16"));
eq("padding pair dropped", d.steps.length, 1);
eq("  Shift+Super", d.steps[0].mods, 0x0a);
eq("  code 0x16 = S", d.steps[0].code, 0x16);

// This device reports 0x04 for a wheel binding; ch57x writes 0x03.
d = decodeRecord(R("fa 13 02 03 00 00 00 00 00 04 00 00 00 00 01"));
eq("knob2 ccw is mouse", d.type, "mouse");
eq("  action wheel (0x04 accepted)", d.action, "wheel");
eq("  delta +1", d.wheel, 1);
d = decodeRecord(R("fa 15 02 03 00 00 00 00 00 04 00 00 00 00 ff"));
eq("  0xff decodes to -1", d.wheel, -1);

console.log("\nverbatim round-trip");
const captured = "fa 13 02 03 00 00 00 00 00 04 00 00 00 00 01";
d = decodeRecord(R(captured));
let rt = bindingReports(0x13, d)[0];
// byte 0 becomes 0xFE; every other byte must survive untouched.
const src = Array.from(R(captured));
eq("byte0 rewritten to 0xFE", rt[0], 0xfe);
let same = true;
for (let i = 1; i < 64; i++) if (rt[i] !== src[i]) same = false;
if (same) { pass++; console.log("  ok    bytes 1..63 identical to what the device gave us"); }
else { fail++; console.log("  FAIL  round-trip altered the record"); }

// Once edited, the verbatim copy is dropped and our encoder takes over.
touch(d);
rt = bindingReports(0x13, d)[0];
eq("after edit, re-encoded with action 0x03", rt[9], 0x03);
eq("  delta preserved", rt[14], 0x01);


console.log("\nphysical grid mapping");
// Slot ids run UP each column from the bottom-left, so reading order is:
eq("grid order", KEY_ORDER.join(","), "4,8,12,3,7,11,2,6,10,1,5,9");
eq("  all 12 slots present once", new Set(KEY_ORDER).size, 12);
// The owner's media keys are on the bottom row and read back as 1, 5, 9.
eq("bottom row is slots 1,5,9",  KEY_ORDER.slice(9).join(","), "1,5,9");
eq("top row is slots 4,8,12",    KEY_ORDER.slice(0,3).join(","), "4,8,12");
eq("second row is slots 3,7,11", KEY_ORDER.slice(3,6).join(","), "3,7,11");
eq("third row is slots 2,6,10",  KEY_ORDER.slice(6,9).join(","), "2,6,10");


console.log("\nposition <-> slot");
// What the user sees as key 1..12 (reading order) vs the wire's slot id.
for (const [pos, slot] of [[1,4],[2,8],[3,12],[4,3],[5,7],[6,11],[7,2],[8,6],[9,10],[10,1],[11,5],[12,9]])
  eq(`key ${pos} -> slot`, SLOT_OF_POS(pos), slot);
eq("round trip pos->slot->pos", [...Array(12)].every((_, i) => POS_OF_SLOT.get(SLOT_OF_POS(i + 1)) === i + 1), true);
// The owner's WELCOME macro is stored on slot 2 and is physically the 7th key.
eq("slot 2 shows as key", POS_OF_SLOT.get(2), 7);
// Media keys read back as slots 1/5/9 and must land on the bottom row, 10/11/12.
eq("slot 1 (Prev) shows as key",  POS_OF_SLOT.get(1), 10);
eq("slot 5 (Play) shows as key",  POS_OF_SLOT.get(5), 11);
eq("slot 9 (Next) shows as key",  POS_OF_SLOT.get(9), 12);


console.log("\nblanking");
// The device itself stores an unbound key as type 1, count 1, pair (0,0) —
// this is exactly the shape read back from empty slots on real hardware.
let er = emptyReports(7, 0);
check("empty binding, slot 7 layer 1", er[0], [0x03,0xfe,0x07,0x01,0x01,0,0,0,0,0,0x01,0x00,0x00]);
check("  separator", er[1], SEP);
check("  commit",    er[2], COMMIT);
eq("  report count", er.length, 4);
eq("  decodes back to unbound", decodeRecord(R("fa 07 01 01 00 00 00 00 00 01 00 00")), null);
er = emptyReports(21, 2);
check("empty binding, slot 21 layer 3", er[0], [0x03,0xfe,0x15,0x03,0x01,0,0,0,0,0,0x01,0x00,0x00]);

console.log("\ndevice variant (0xFC)");
// 0xFC is NOT a lighting command: low byte is the key count, high byte the
// knob count. Sending the wrong pair makes the firmware drive the wrong
// number of keys. Confirmed on hardware, and confirmed recoverable.
eq("15 variants known", DEVICE_VARIANTS.length, 15);
check("this keypad: 12 keys, 2 knobs", variantReport(12, 2), [0x03,0xfc,0xfc,0x0c,0x02]);
check("3 keys, 1 knob",                variantReport(3, 1),  [0x03,0xfc,0xfc,0x03,0x01]);
check("15 keys, 3 knobs",              variantReport(15, 3), [0x03,0xfc,0xfc,0x0f,0x03]);
eq("12+2 is a known variant", DEVICE_VARIANTS.some(([k, n]) => k === 12 && n === 2), true);
eq("no variant byte collides with a command",
   DEVICE_VARIANTS.every(([k]) => k !== 0xfe && k !== 0xef && k !== 0xfd), true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
