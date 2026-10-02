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

    for (const c of checks) {
      await t.test(`${c.theme ? `${c.theme}: ` : ""}${c.name}`, (st) => {
        if (c.skipped) return st.skip("not used by this preset");
        assert.ok(c.ok, c.message);
      });
    }
  });
}
