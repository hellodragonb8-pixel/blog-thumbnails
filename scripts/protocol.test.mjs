// Protocol test: runs every sample image through make-thumbnails.mjs and
// checks both thumbnails against PROTOCOL.md. Run with `npm test`.
//
// The checks themselves are in checks.mjs, shared with the inbox command
// (`npm run thumbs`), which runs them on every image it makes:
//   size         the output is 716 x 396
//   background   everything outside the image is exactly the theme background
//   margins      at least 32px on every side, touching 32px on one axis, centred
//   not tiny     a tall image fills at least 60% of the width (else: crop it)
//   colour only  the same input grey always gives the same output colour, and
//                greys further from the background never get less contrast:
//                proof that only colours were changed, nothing redrawn
//   on palette   every output colour lies on the preset's colour ramp
//   visible      for presets with minVisible (graphs): nothing visible in the
//                original fades below that contrast
//   readable     the strongest marks reach the preset's minimum contrast
//   saved file   the saved file, read back, is exactly what was checked (so
//                the background stays locked to the theme colour)
//
// Two more checks look for meaning the greys lost, and make an image NEEDS A
// LOOK rather than breaking the protocol:
//   colours merge   graphs: two different colours came out as one grey
//   text on a box   text that was readable on a box faded against it
// EXPECTED_FLAGS lists the samples each one should flag; every other sample
// must pass them. So the test fails if they miss a known case or start
// flagging good images.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONFIG, DEFAULT_OPTIONS, makeThumbnails } from "./make-thumbnails.mjs";
import { rampProblems } from "./tone.mjs";

// The sample set: every image in these folders, run the way the inbox runs
// them (automatic crop on). To add a sample, drop it in the right folder.
const SAMPLE_FOLDERS = { "assets/diagrams": "diagram", "assets/graphs": "graph", "assets/code": "code" };
const IMAGE = /\.(png|jpe?g|webp|gif|avif|tiff?|svg)$/i;

const cases = [];
const missing = [];
for (const [folder, type] of Object.entries(SAMPLE_FOLDERS)) {
  let names;
  try { names = await readdir(folder); } catch { missing.push(folder); continue; }
  for (const name of names.sort()) {
    if (IMAGE.test(name)) cases.push({ file: path.posix.join(folder, name), type });
  }
}
// Sample images aren't kept in the repository. Without them only the preset
// checks run; add images to these folders to test the whole protocol.
if (missing.length) {
  test(`sample images (add some to ${missing.join(", ")})`, (t) => t.skip(`no sample folder: ${missing.join(", ")}`));
}

// Samples the two lost-meaning checks should flag (in at least one theme),
// as judged by eye. Everything else must pass them.
const LOST_MEANING = ["colours merge", "text on a box"];
const EXPECTED_FLAGS = {
  "assets/graphs/create-file-chart.webp": ["colours merge"],  // bars coloured by vendor, all one grey
  "assets/graphs/prompt-signature.webp": ["colours merge", "text on a box"], // segments and legend merge; labels on bars fade
  "assets/graphs/vsdraw-2 1.png": ["colours merge"],          // Production and Staging lines, told apart only by the legend
  "assets/graphs/graph-4.png": ["colours merge"],             // blue markers and red line (they also differ in shape)
  "assets/graphs/line-chart-original.png": ["colours merge"], // false alarm: each line is labelled directly
  "assets/graphs/vscbench-plot.webp": ["colours merge"],      // false alarm: each point is labelled
};

const out = await mkdtemp(path.join(os.tmpdir(), "thumbs-protocol-"));
test.after(() => rm(out, { recursive: true, force: true }));

// The presets themselves: every ramp gets steadily stronger, with no flat stretch.
test("presets: each ramp colour has more contrast than the one before", async (t) => {
  for (const [type, preset] of Object.entries(CONFIG.presets)) {
    for (const [themeName, theme] of Object.entries(preset)) {
      await t.test(`${type} ${themeName}`, () => {
        const problems = rampProblems(theme);
        assert.equal(problems.length, 0, problems.join("; "));
      });
    }
  }
});

for (const { file, type } of cases) {
  test(`${file} [${type}]`, async (t) => {
    const opts = { ...DEFAULT_OPTIONS, type, out, review: "off", quiet: true, crop: "auto" };
    const { checks } = await makeThumbnails(file, opts);

    for (const c of checks.filter((c) => !LOST_MEANING.includes(c.name))) {
      await t.test(`${c.theme ? `${c.theme}: ` : ""}${c.name}`, (st) => {
        if (c.skipped) return st.skip("not used by this preset");
        assert.ok(c.ok, c.message);
      });
    }
    for (const name of LOST_MEANING) {
      const expected = (EXPECTED_FLAGS[file] ?? []).includes(name);
      const flagged = checks.filter((c) => c.name === name && !c.ok);
      await t.test(`${name}: ${expected ? "flagged" : "not flagged"}`, () => {
        if (expected) assert.ok(flagged.length > 0, `expected "${name}" to flag this image`);
        else assert.equal(flagged.length, 0, flagged.map((c) => `${c.theme}: ${c.message}`).join("; "));
      });
    }
  });
}

// The text check catches the failure that tintCap fixed: with no limit, the
// labels on Fig4_Custom_Graph's yellow node and be_3_image005's boxes fade.
for (const file of ["assets/diagrams/Fig4_Custom_Graph.png", "assets/diagrams/be_3_image005.png"]) {
  if (cases.some((c) => c.file === file)) {
    test(`${file} without tintCap: text on a box flags it`, async () => {
      const cap = CONFIG.tintCap;
      CONFIG.tintCap = Infinity;
      try {
        const { checks } = await makeThumbnails(file, { ...DEFAULT_OPTIONS, type: "diagram", out, review: "off", quiet: true, crop: "auto" });
        assert.ok(checks.some((c) => c.name === "text on a box" && !c.ok), "expected the faded labels to be flagged");
      } finally {
        CONFIG.tintCap = cap;
      }
    });
  }
}
