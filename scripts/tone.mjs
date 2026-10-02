// Colour mapping shared by make-thumbnails.mjs and the tuner page.
// The tuner inlines this file with the "export" keywords removed, so keep it to
// plain top-level functions with no imports.
//
// Every pixel arrives as a "contrast amount" d from 0 to 255: how far its grey
// is from the image background's grey.
//   0   = the image background
//   255 = as far from the background as possible (black on a white image,
//         white on a dark screenshot)
// The same d always gives the same colour within a theme. This is the only
// thing that changes a pixel's colour (see PROTOCOL.md).

export function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// WCAG contrast ratio between two RGB colours, from 1 to 21.
export function contrastRatio(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.map((c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Content: pixels at least this far (0-255) from the background. Fainter
// pixels count as background (anti-aliasing fringes, compression noise).
export const CONTENT_LEVEL = 10;

// Marks the author drew to be seen: at least this far (0-255) from the
// background, about 1.2:1 in the original. This is where the ramp's "subtle"
// stop sits, and presets with minVisible are checked to keep these marks at
// that contrast (checks.mjs).
export const VISIBLE_LEVEL = 25;

// The colour ramp every preset uses: a theme's seven colours, placed by
// contrast amount d (0-1, how far a grey is from the image background):
//   0      background  the image background
//   0.04   faint       outlines, the palest fills, soft edges
//   0.098  subtle      the lightest marks drawn to be seen (VISIBLE_LEVEL)
//   0.2    medium      pale boxes and panels, gridlines
//   0.35   strong      darker boxes and fills
//   0.5    text        grey text, connectors, lines
//   0.75+  ink         black text and solid marks
// Greys in between get an even blend of the two neighbouring colours, so the
// curve is smooth: no steps, so shading, soft edges and icons keep their shape.
export const PALETTE_STOPS = [
  ["background", 0],
  ["faint", 0.04],
  ["subtle", VISIBLE_LEVEL / 255],
  ["medium", 0.2],
  ["strong", 0.35],
  ["text", 0.5],
  ["ink", 0.75],
];

// Colour for contrast amount d (0..1) in one theme.
export function themeColor(theme, d) {
  const stops = PALETTE_STOPS.map(([key, at]) => ({ at, rgb: hexToRgb(theme[key]) }));
  if (d <= 0) return stops[0].rgb;
  let i = 1;
  while (i < stops.length - 1 && d > stops[i].at) i++;
  const a = stops[i - 1], b = stops[i];
  const t = clamp01((d - a.at) / (b.at - a.at));
  return a.rgb.map((c, ch) => Math.round(c + (b.rgb[ch] - c) * t));
}

// Problems with a theme's ramp, as messages (empty when it's fine). After the
// first stop that differs from the background, each stop must have more
// contrast than the one before: two equal stops make a flat stretch, where
// everything in between gets one colour and shading flattens out.
export function rampProblems(theme) {
  const bg = hexToRgb(theme.background);
  const problems = [];
  let previous = null;
  for (const [key] of PALETTE_STOPS.slice(1)) {
    if (!/^#[0-9a-f]{6}$/i.test(theme[key] ?? "")) { problems.push(`${key} isn't a hex colour`); continue; }
    const ratio = contrastRatio(hexToRgb(theme[key]), bg);
    if (previous && previous.ratio > 1.01 && ratio < previous.ratio + 0.02) {
      problems.push(`${key} (${ratio.toFixed(2)}:1) needs more contrast than ${previous.key} (${previous.ratio.toFixed(2)}:1)`);
    }
    previous = { key, ratio };
  }
  return problems;
}

// Lookup table: d (0..255) -> RGB, with the image's legibility boost applied.
export function buildLut(theme, boost = 1) {
  const lut = new Uint8Array(256 * 3);
  for (let d = 0; d < 256; d++) {
    lut.set(themeColor(theme, Math.min(1, (d / 255) * boost)), d * 3);
  }
  return lut;
}

// The image's strongest marks: the d level that the strongest 1% of its
// content pixels reach. Text, axes and outlines usually set this. Null when
// the image has no content.
export function strongestLevel(histogram) {
  const minLevel = CONTENT_LEVEL; // fainter than this is background noise, not content
  let content = 0;
  for (let d = minLevel; d < 256; d++) content += histogram[d];
  if (content === 0) return null;
  let seen = 0;
  for (let d = 255; d >= minLevel; d--) {
    seen += histogram[d];
    if (seen >= content * 0.01) return d;
  }
  return minLevel;
}

// Contrast ratio of the ink (the strongest possible mark) against the background.
export function inkContrast(theme) {
  return contrastRatio(themeColor(theme, 1), hexToRgb(theme.background));
}

// The floor actually used: theme.minContrast, but never more than the ink
// reaches, since no mark can be stronger than the ink.
export function effectiveFloor(theme) {
  return Math.min(theme.minContrast, inkContrast(theme));
}

// Legibility floor: if the strongest marks come out below the floor against
// the background, boost this image's contrast just enough to reach it.
export function legibility(theme, strongest) {
  const bgRgb = hexToRgb(theme.background);
  const floor = effectiveFloor(theme);
  const ratioAt = (boost) => contrastRatio(themeColor(theme, Math.min(1, (strongest / 255) * boost)), bgRgb);
  if (strongest === null) return { boost: 1, before: null, after: null, floor };

  const before = ratioAt(1);
  if (before >= floor) return { boost: 1, before, after: before, floor };

  // Somewhere between the image as is and its strongest marks at full ink.
  let lo = 1, hi = 255 / strongest;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= floor) hi = mid;
    else lo = mid;
  }
  return { boost: hi, before, after: ratioAt(hi), floor };
}
