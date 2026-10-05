// The protocol checks (PROTOCOL.md, "The test"), run on one image's two
// thumbnails. Used by `npm test` (protocol.test.mjs) and by the inbox command
// (`npm run thumbs` with no arguments), so every thumbnail that's made gets
// the same checks.
//
// checkThumbnails() returns a list of results:
//   { name, theme, ok, skipped, message }
// where message explains a failure in plain words.

import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { contrastRatio, greyLevel, hexToRgb, inkContrast, themeColor, VISIBLE_LEVEL } from "./tone.mjs";

// Thresholds for the two checks that look for lost meaning rather than
// protocol breaks ("colours merge", "text on a box"). Either one failing makes
// an image NEEDS A LOOK.
export const LIMITS = {
  mergeTypes: ["graph"], // where colour tells things apart (data series, legends); in diagrams and code the words do
  mergeFloor: 1.12,      // two colours closer than this ratio in the thumbnail look like one grey
  textFloor: 1.5,        // text or lines on a box under this ratio against the box are hard to read
  minMarks: 8,           // faded pixels (at 2x) on one box before it counts: a few letters' worth
  minShare: 0.5,         // ...and at least this share of the readable marks on that box (one dim line among clear text isn't a loss)
};

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// Largest colour change (0-255, any channel) allowed between two greys one
// level apart. Smooth curves change by a few levels at most.
const MAX_STEP = 12;

// Every colour on a theme's ramp, for the on-palette check.
function rampColours(theme) {
  const colours = [];
  for (let n = 0; n <= 2048; n++) colours.push(themeColor(theme, n / 2048));
  return colours;
}
const nearest = (colour, ramp) => Math.min(...ramp.map((r) => Math.max(...r.map((c, i) => Math.abs(c - colour[i])))));

// config: CONFIG from make-thumbnails.mjs. prepared: what prepare() returned
// for this image. pixels: { light, dark }, each the finished thumbnail as raw
// RGB, checked just before it's saved. checkSavedFile() then confirms the
// saved file holds exactly these pixels.
export function checkThumbnails({ config, type, prepared, pixels }) {
  const { frame, inset, scale } = config;
  const W = frame.width * scale, H = frame.height * scale, M = inset * scale;
  const results = [];
  const check = (name, theme, fn) => {
    try {
      const outcome = fn();
      if (outcome === "skip") results.push({ name, theme, ok: true, skipped: true, message: "" });
      else results.push({ name, theme, ok: true, skipped: false, message: "" });
    } catch (error) {
      results.push({ name, theme, ok: false, skipped: false, message: error.message });
    }
  };
  const fail = (message) => { throw new Error(message); };

  const left = Math.round((W - prepared.width) / 2), top = Math.round((H - prepared.height) / 2);
  const right = W - prepared.width - left, bottom = H - prepared.height - top;
  const inContent = (x, y) => x >= left && x < left + prepared.width && y >= top && y < top + prepared.height;

  // Contrast amount (0-255) of an input grey, as PROTOCOL.md defines it.
  const level = prepared.bgLevel, dark = level < 128;
  const amountOf = (grey) => Math.round(Math.min(1, Math.abs(grey - level) / ((dark ? 255 - level : level) || 1)) * 255);

  check("margins", null, () => {
    for (const [side, m] of Object.entries({ left, right, top, bottom })) {
      if (m < M) fail(`the ${side} margin is ${m / scale}px, under ${inset}px`);
    }
    const touches = (left <= M + 1 && right <= M + 1) || (top <= M + 1 && bottom <= M + 1);
    if (!touches) fail(`the image doesn't reach the ${inset}px margin on either side`);
    if (Math.abs(left - right) > 1 || Math.abs(top - bottom) > 1) fail("the image isn't centred");
  });

  check("not tiny", null, () => {
    const share = prepared.width / (W - 2 * M);
    if (share < config.autoCropBelow.tall) {
      fail(`the image is so tall it fills only ${Math.round(share * 100)}% of the width; run it with --crop auto or a manual --crop`);
    }
  });

  for (const [themeName, theme] of Object.entries(config.presets[type])) {
    const data = pixels[themeName];
    const px = (x, y) => { const o = (y * W + x) * 3; return [data[o], data[o + 1], data[o + 2]]; };
    const bg = hexToRgb(theme.background);

    check("size", themeName, () => {
      if (data.length !== W * H * 3) fail(`the image isn't ${W} x ${H}`);
    });

    check("background", themeName, () => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!inContent(x, y) && !same(px(x, y), bg)) fail(`pixel ${x},${y} outside the image isn't the background ${theme.background}`);
        }
      }
    });

    // Pair every content pixel with its input grey.
    const byGrey = new Map();
    for (let y = 0; y < prepared.height; y++) {
      for (let x = 0; x < prepared.width; x++) {
        const grey = prepared.grey[y * prepared.width + x];
        const colour = px(x + left, y + top);
        const seen = byGrey.get(grey);
        if (!seen) byGrey.set(grey, colour);
        else if (!same(seen, colour)) byGrey.set(grey, null); // the same grey gave two colours
      }
    }

    check("colour only", themeName, () => {
      const split = [...byGrey].filter(([, c]) => c === null).map(([g]) => g);
      if (split.length) fail(`greys ${split.slice(0, 5).join(", ")} came out as more than one colour, so something other than the colours changed`);
      const byDistance = [...byGrey].sort((a, b) => Math.abs(a[0] - level) - Math.abs(b[0] - level));
      let best = 1;
      for (const [grey, colour] of byDistance) {
        const ratio = contrastRatio(colour, bg);
        if (ratio < best - 0.02) fail(`grey ${grey} has less contrast (${ratio.toFixed(2)}:1) than greys closer to the background`);
        best = Math.max(best, ratio);
      }
    });

    check("smooth", themeName, () => {
      // Neighbouring greys must get neighbouring colours: a big jump means the
      // colour curve has a step, which turns soft edges and shading into flat
      // blocks (an icon looks filled in, text looks hollow).
      const greys = [...byGrey.keys()].sort((a, b) => a - b);
      for (let i = 1; i < greys.length; i++) {
        if (greys[i] !== greys[i - 1] + 1) continue;
        const a = byGrey.get(greys[i - 1]), b = byGrey.get(greys[i]);
        if (!a || !b) continue;
        const jump = Math.max(...a.map((v, c) => Math.abs(v - b[c])));
        if (jump > MAX_STEP) fail(`grey ${greys[i - 1]} -> ${greys[i]} jumps ${jump} levels in colour; the colour curve has a step, which distorts icons and soft edges`);
      }
    });

    check("on palette", themeName, () => {
      const ramp = rampColours(theme);
      for (const colour of new Set([...byGrey.values()].map((c) => c.join(",")))) {
        if (nearest(colour.split(",").map(Number), ramp) > 2) fail(`colour rgb(${colour}) isn't one of the preset's colours`);
      }
    });

    check("visible", themeName, () => {
      if (!theme.minVisible) return "skip";
      const floor = Math.min(theme.minVisible, inkContrast(theme));
      let lost = 0, weakest = Infinity;
      for (let y = 0; y < prepared.height; y++) {
        for (let x = 0; x < prepared.width; x++) {
          if (amountOf(prepared.grey[y * prepared.width + x]) < VISIBLE_LEVEL) continue;
          const ratio = contrastRatio(px(x + left, y + top), bg);
          if (ratio < floor - 0.01) { lost++; weakest = Math.min(weakest, ratio); }
        }
      }
      if (lost) fail(`${lost} pixels of visible marks faded to ${weakest.toFixed(2)}:1 or less against the background`);
    });

    check("readable", themeName, () => {
      const ratios = [];
      for (let y = 0; y < prepared.height; y++) {
        for (let x = 0; x < prepared.width; x++) {
          if (amountOf(prepared.grey[y * prepared.width + x]) >= 9.5) ratios.push(contrastRatio(px(x + left, y + top), bg));
        }
      }
      if (!ratios.length) fail("the image has no visible content");
      ratios.sort((a, b) => b - a);
      const strongest = ratios[Math.floor(ratios.length * 0.01)];
      const floor = Math.min(theme.minContrast, inkContrast(theme));
      if (strongest < floor - 0.02) fail(`the strongest text and lines are ${strongest.toFixed(2)}:1, under ${floor.toFixed(2)}:1`);
    });

    check("colours merge", themeName, () => {
      if (!LIMITS.mergeTypes.includes(type)) return "skip";
      const out = (i) => px(i % prepared.width + left, Math.floor(i / prepared.width) + top);
      const pairs = mergedColours(prepared, out);
      if (pairs.length) {
        const [a, b, ratio] = pairs[0];
        fail(`${a} and ${b} in the original come out ${ratio.toFixed(2)}:1 apart, so they look like the same grey`);
      }
    });

    check("text on a box", themeName, () => {
      const out = (i) => px(i % prepared.width + left, Math.floor(i / prepared.width) + top);
      const lost = lostText(prepared, out);
      if (lost) fail(`text or lines on a box (around ${lost.where}) dropped from about ${lost.before.toFixed(1)}:1 against the box to ${lost.after.toFixed(2)}:1 (${lost.faded} of ${lost.readable} pixels)`);
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Colours merge: two clearly different colours in the original, each covering
// a real area (a data series, a set of bars, a legend swatch), that come out
// as nearly the same colour. Grey from brightness can't tell apart colours of
// the same brightness, so this is flagged rather than fixed.
// ---------------------------------------------------------------------------

const HUE_BINS = 36;            // 10 degrees each
const MIN_CHROMA = 50;          // colourful enough to be a deliberate colour (0-255)
const MIN_AREA = 300;           // pixels (at 2x) for a colour to count: a short line or a legend swatch
const MIN_HUE_APART = 45;       // degrees: clearly different colours, not two shades of one

const HUE_NAMES = [[15, "red"], [45, "orange"], [70, "yellow"], [160, "green"], [195, "teal"], [255, "blue"], [290, "purple"], [335, "pink"], [360, "red"]];
const hueName = (h) => HUE_NAMES.find(([upTo]) => h < upTo)[1];

function hueOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c === 0) return 0;
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return (h * 60 + 360) % 360;
}

// Pairs of merged colours, worst first: [name, name, thumbnail ratio].
export function mergedColours(prepared, out) {
  const { rgb, channels, width, height } = prepared;
  const n = width * height;
  const bins = Array.from({ length: HUE_BINS }, () => []);
  for (let i = 0; i < n; i++) {
    const o = i * channels, r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < MIN_CHROMA) continue;
    bins[Math.floor(hueOf(r, g, b) / (360 / HUE_BINS)) % HUE_BINS].push(i);
  }
  // Colours: runs of neighbouring hue bins (wrapping round), so shades of one
  // colour and their anti-aliased edges stay together.
  const busy = bins.map((b) => b.length >= MIN_AREA / 10);
  const start = busy.indexOf(false);
  if (start === -1) return []; // colour all round the wheel: a gradient, not separate colours
  const colours = [];
  let run = null;
  for (let k = 1; k <= HUE_BINS; k++) {
    const bin = (start + k) % HUE_BINS;
    if (busy[bin]) (run ??= []).push(bin);
    else if (run) { colours.push(run); run = null; }
  }
  const groups = colours
    .map((run) => {
      const members = run.flatMap((bin) => bins[bin]);
      const peak = run.reduce((best, bin) => (bins[bin].length > bins[best].length ? bin : best), run[0]);
      return { members, hue: (peak + 0.5) * (360 / HUE_BINS) };
    })
    .filter((c) => c.members.length >= MIN_AREA);

  // Each colour's typical thumbnail colour: the median by brightness.
  for (const c of groups) {
    const shades = c.members.map((i) => out(i)).sort((a, b) => greyLevel(...a) - greyLevel(...b));
    c.out = shades[shades.length >> 1];
  }
  const pairs = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const apart = Math.abs(groups[a].hue - groups[b].hue);
      if (Math.min(apart, 360 - apart) < MIN_HUE_APART) continue;
      const ratio = contrastRatio(groups[a].out, groups[b].out);
      if (ratio < LIMITS.mergeFloor) pairs.push([hueName(groups[a].hue), hueName(groups[b].hue), ratio]);
    }
  }
  return pairs.sort((x, y) => x[2] - y[2]);
}

// ---------------------------------------------------------------------------
// Text on a box: marks drawn on a filled shape (a label on a bar, text in a
// coloured box) that were clearly readable against that shape in the original
// and barely differ from it in the thumbnail. The readable check measures
// against the page background, so it can't see these.
// ---------------------------------------------------------------------------

const RADIUS = 6;          // pixels (at 2x): a mark needs its box within this distance on all four sides
const MIN_FILL = 300;      // pixels (at 2x) of one flat colour for it to count as a box
const FILL_MATCH = 14;     // colour difference (0-255, any channel) still counted as the same fill
const TEXT_BEFORE = 2.5;   // marks at least this far from their box in the original (at thumbnail size) were meant to be read

// The box with the most faded marks, or null: { faded, readable, before, after, where }.
export function lostText(prepared, out) {
  const { rgb, channels, width, height, bgLevel } = prepared;
  const n = width * height;
  const level = new Uint8Array(n);
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * channels, r = rgb[o], g = rgb[o + 1], b = rgb[o + 2];
    level[i] = greyLevel(r, g, b);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Fills: flat colours covering a real area, other than the page. A colour
  // close to a bigger fill is the same fill (a colour on the edge of two
  // bands), so it joins that one.
  const fills = [];
  const near = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c]))) <= FILL_MATCH;
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (count < MIN_FILL) break;
    const colour = [((key >> 8) & 15) * 16 + 8, ((key >> 4) & 15) * 16 + 8, (key & 15) * 16 + 8];
    if (Math.abs(greyLevel(...colour) - bgLevel) <= 6 && Math.max(...colour) - Math.min(...colour) < 16) continue; // the page
    if (fills.some((f) => near(f.colour, colour))) continue;
    fills.push({ colour, marks: [], sample: -1 });
  }
  if (!fills.length) return null;

  // Which fill each pixel belongs to, if any (nearest within FILL_MATCH).
  const fillOf = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    let best = -1, bestDiff = FILL_MATCH + 1;
    for (let k = 0; k < fills.length; k++) {
      const c = fills[k].colour;
      const diff = Math.max(Math.abs(rgb[o] - c[0]), Math.abs(rgb[o + 1] - c[1]), Math.abs(rgb[o + 2] - c[2]));
      if (diff < bestDiff) { best = k; bestDiff = diff; }
    }
    fillOf[i] = best;
    if (best >= 0 && fills[best].sample < 0) fills[best].sample = i;
  }

  // A mark on a box: not the fill itself, with the same fill within RADIUS on
  // all four sides (across and down), so it sits inside the box rather than
  // on its edge.
  const sideFill = (x, y, dx, dy) => {
    for (let s = 1; s <= RADIUS; s++) {
      const xx = x + dx * s, yy = y + dy * s;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return -1;
      const f = fillOf[yy * width + xx];
      if (f >= 0) return f;
    }
    return -1;
  };
  const grey = (v) => [v, v, v];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (fillOf[i] >= 0) continue;
      const f = sideFill(x, y, -1, 0);
      if (f < 0 || sideFill(x, y, 1, 0) !== f || sideFill(x, y, 0, -1) !== f || sideFill(x, y, 0, 1) !== f) continue;
      const before = contrastRatio(grey(level[i]), grey(level[fills[f].sample]));
      if (before >= 1.5) fills[f].marks.push({ i, before });
    }
  }

  // A box fails when enough of the marks that were readable on it in the
  // original end up under the floor against it. Text is small and
  // anti-aliased at thumbnail size, so only its stronger pixels count as
  // readable. Marks on one box can fade while others on it stay clear (a white
  // heading over pale blue bullets), so they're counted one by one.
  let worst = null;
  for (const { marks, sample } of fills) {
    const boxOut = out(sample);
    const readable = marks.filter((m) => m.before >= TEXT_BEFORE);
    const faded = readable.filter((m) => contrastRatio(out(m.i), boxOut) < LIMITS.textFloor);
    if (faded.length < LIMITS.minMarks || faded.length < readable.length * LIMITS.minShare) continue;
    if (worst && faded.length <= worst.faded) continue;
    faded.sort((p, q) => p.before - q.before);
    const mid = faded[faded.length >> 1];
    const cx = faded.reduce((t, m) => t + (m.i % width), 0) / faded.length / width;
    const cy = faded.reduce((t, m) => t + Math.floor(m.i / width), 0) / faded.length / height;
    const where = `${cy < 0.33 ? "top" : cy < 0.67 ? "middle" : "bottom"} ${cx < 0.33 ? "left" : cx < 0.67 ? "centre" : "right"}`.replace("middle centre", "centre");
    worst = { faded: faded.length, readable: readable.length, before: mid.before, after: contrastRatio(out(mid.i), boxOut), where };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Title cards (PROTOCOL.md, "Title cards"): a post without an image gets its
// title set in type. These checks replace the colour checks above, since no
// image was recoloured.
// ---------------------------------------------------------------------------

// Space around the text, in px: everything that isn't exactly the background.
// Null when there's no text.
export function inkMargins(data, W, H, bg) {
  let left = W, right = -1, top = H, bottom = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (data[o] === bg[0] && data[o + 1] === bg[1] && data[o + 2] === bg[2]) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, right: W - 1 - right, top, bottom: H - 1 - bottom };
}

// config: CONFIG from make-thumbnails.mjs. pixels: { light, dark } as raw RGB.
// lines: the title's lines, as set.
export function checkTitleCard({ config, pixels, lines }) {
  const { frame, inset, scale, titleCard } = config;
  const W = frame.width * scale, H = frame.height * scale, M = inset * scale;
  const results = [];
  const check = (name, theme, fn) => {
    try {
      fn();
      results.push({ name, theme, ok: true, skipped: false, message: "" });
    } catch (error) {
      results.push({ name, theme, ok: false, skipped: false, message: error.message });
    }
  };
  const fail = (message) => { throw new Error(message); };

  check("fits", null, () => {
    if (lines.length > titleCard.maxLines) fail(`the title takes ${lines.length} lines, and only ${titleCard.maxLines} fit inside the margins`);
  });

  for (const [themeName, colors] of Object.entries(titleCard.colors)) {
    const data = pixels[themeName];
    const bg = hexToRgb(colors.background), ink = hexToRgb(colors.text);

    check("size", themeName, () => {
      if (data.length !== W * H * 3) fail(`the image isn't ${W} x ${H}`);
    });

    // Everything outside the text is exactly the background, so this is also
    // the background check.
    check("margins", themeName, () => {
      const m = inkMargins(data, W, H, bg);
      if (!m) fail("the title is missing");
      for (const [side, px] of Object.entries(m)) {
        if (px < M) fail(`the text is ${px / scale}px from the ${side} edge, under ${inset}px`);
      }
      if (Math.abs(m.left - m.right) > 2 * scale) fail(`the text isn't centred: ${m.left / scale}px on the left, ${m.right / scale}px on the right`);
    });

    // Only the text colour, the background, and blends of the two at the
    // letters' soft edges.
    check("on palette", themeName, () => {
      const d = ink.map((v, i) => v - bg[i]);
      const dd = d.reduce((t, v) => t + v * v, 0);
      for (let o = 0; o < data.length; o += 3) {
        const c = [data[o], data[o + 1], data[o + 2]];
        const t = Math.min(1, Math.max(0, c.reduce((s, v, i) => s + (v - bg[i]) * d[i], 0) / dd));
        if (c.some((v, i) => Math.abs(v - (bg[i] + t * d[i])) > 2)) fail(`colour rgb(${c.join(",")}) isn't the text colour, the background or a blend of the two`);
      }
    });
  }
  return results;
}

// The saved file, read back, is pixel for pixel what passed the checks above:
// saving changed no colour, so the background is still exactly the theme's.
export async function checkSavedFile(file, pixels, theme) {
  const name = "saved file";
  // Read into memory first: sharp holding the file open locks it on Windows.
  const { data } = await sharp(await readFile(file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (data.length !== pixels.length) return { name, theme, ok: false, skipped: false, message: "the saved file isn't the same size as the thumbnail" };
  let changed = 0;
  for (let i = 0; i < data.length; i++) if (data[i] !== pixels[i]) changed++;
  return changed
    ? { name, theme, ok: false, skipped: false, message: `saving changed ${changed} colour values, so the file isn't exactly what was checked` }
    : { name, theme, ok: true, skipped: false, message: "" };
}
