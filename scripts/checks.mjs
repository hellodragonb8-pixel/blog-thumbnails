// The protocol checks (PROTOCOL.md, "The test"), run on one image's two
// thumbnails. Used by `npm test` (protocol.test.mjs) and by the inbox command
// (`npm run thumbs` with no arguments), so every thumbnail that's made gets
// the same checks.
//
// checkThumbnails() returns a list of results:
//   { name, theme, ok, skipped, message }
// where message explains a failure in plain words.

import { contrastRatio, hexToRgb, inkContrast, themeColor, VISIBLE_LEVEL } from "./tone.mjs";

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
// RGB, checked just before it's saved (saving as WebP is a separate, standard
// step that shifts colours slightly).
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
  }

  return results;
}
