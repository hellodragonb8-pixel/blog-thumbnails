// Colour mapping, used by make-thumbnails.mjs and checks.mjs.
//
// Every pixel arrives as a "contrast amount" d from 0 to 255: how far its grey
// is from the image background's grey.
//   0   = the image background
//   255 = as far from the background as possible (black on a white image,
//         white on a dark screenshot)
// The same d always gives the same colour within a theme. This is the only
// thing that changes a pixel's colour.

export function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// The neutral grey (0-255) with the same luminance as an RGB colour: how
// bright it looks. Weighted in linear light and converted back, so a saturated
// colour keeps its brightness: blue #0078d3 is grey 118, not the 101 that
// weighting the stored values gives. A neutral grey stays exactly the same.
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
export function greyLevel(r, g, b) {
  const y = 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
  return Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055));
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

// Code uses three colours instead of seven: the background and two text
// colours. Code has no fills or icons to shade, only text in a few syntax
// colours, so the paler ones (comments, numbers, strings) blend towards "dim"
// and the main text towards "text". Still an even blend between stops, so
// anti-aliased edges stay smooth.
//   0-0.1  background  the image background, panel borders, highlight bars
//   0.35   dim         comments, numbers, the paler syntax colours
//   0.6+   text        the main code text (CONFIG.textLevel puts its typical
//                      level, edges included, at 0.48, so the cores reach this)
export const CODE_STOPS = [
  ["background", 0],
  ["background", 0.1],
  ["dim", 0.35],
  ["text", 0.6],
];

// The stops a theme uses: three for a theme with a "dim" colour (code),
// otherwise the seven of PALETTE_STOPS.
export function stopsFor(theme) {
  return "dim" in theme ? CODE_STOPS : PALETTE_STOPS;
}

// Colour for contrast amount d (0..1) in one theme.
export function themeColor(theme, d) {
  const stops = stopsFor(theme).map(([key, at]) => ({ at, rgb: hexToRgb(theme[key]) }));
  if (d <= 0) return stops[0].rgb;
  let i = 1;
  while (i < stops.length - 1 && d > stops[i].at) i++;
  const a = stops[i - 1], b = stops[i];
  const t = clamp01((d - a.at) / (b.at - a.at));
  return a.rgb.map((c, ch) => Math.round(c + (b.rgb[ch] - c) * t));
}

// Box fill (diagrams): the image's main fill, the most common grey between
// the page and the "strong" stop, as a contrast amount (0-1). Null when no
// one fill makes up settings.minShare of the image's content. Looks at a
// window of a few levels, so a JPEG's noisy fill still counts as one.
export function boxFill(histogram, settings) {
  if (!settings) return null;
  let content = 0;
  for (let d = CONTENT_LEVEL; d < 256; d++) content += histogram[d];
  const darkest = Math.round(settings.darkest * 255);
  let best = 0, at = -1;
  for (let d = CONTENT_LEVEL; d <= darkest; d++) {
    let area = 0;
    for (let k = Math.max(CONTENT_LEVEL, d - 2); k <= Math.min(255, d + 2); k++) area += histogram[k];
    if (area > best) { best = area; at = d; }
  }
  return at < 0 || best < content * settings.minShare ? null : at / 255;
}

// The image's tone curve: contrast amount in, contrast amount out (0-1). With
// a box fill darker than target, it bends so the fill moves to target: an even
// squeeze below the fill, an even stretch from the fill up to the "text" stop,
// and no change from there up, so text and lines keep their colour. Marks
// lighter than the fill (connectors, outlines) are squeezed with it, so the
// fill moves at most to minScale of where it was: they keep at least that
// much of their strength. It always rises and has no steps, so every rule of
// step 5 still holds.
export function toneCurve(fill, target, minScale = 0) {
  const knee = PALETTE_STOPS.find(([key]) => key === "text")[1];
  if (fill === null || fill <= target || fill >= knee) return (d) => d;
  const to = Math.max(target, fill * minScale);
  return (d) => (d <= fill ? (d * to) / fill : d >= knee ? d : to + ((d - fill) * (knee - to)) / (knee - fill));
}

// Text level (code): the typical contrast amount (0-1) of the image's text,
// the median of its marks at least 40% as strong as its strongest (so faint
// highlight bars and soft edges don't count). Null when there's no content.
export function textLevel(histogram) {
  const strongest = strongestLevel(histogram);
  if (strongest === null) return null;
  const from = Math.max(CONTENT_LEVEL, Math.round(strongest * 0.4));
  let marks = 0;
  for (let d = from; d < 256; d++) marks += histogram[d];
  let seen = 0;
  for (let d = from; d < 256; d++) {
    seen += histogram[d];
    if (seen >= marks / 2) return d / 255;
  }
  return null;
}

// Lookup table: d (0..255) -> RGB, through the image's tone curve and with
// its legibility boost applied.
export function buildLut(theme, boost = 1, curve = (d) => d) {
  const lut = new Uint8Array(256 * 3);
  for (let d = 0; d < 256; d++) {
    lut.set(themeColor(theme, Math.min(1, curve(d / 255) * boost)), d * 3);
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
export function legibility(theme, strongest, curve = (d) => d) {
  const bgRgb = hexToRgb(theme.background);
  const floor = effectiveFloor(theme);
  const ratioAt = (boost) => contrastRatio(themeColor(theme, Math.min(1, curve(strongest / 255) * boost)), bgRgb);
  if (strongest === null) return { boost: 1, before: null, after: null, floor };

  const before = ratioAt(1);
  if (before >= floor) return { boost: 1, before, after: before, floor };

  // Somewhere between the image as is and its strongest marks at full ink.
  let lo = 1, hi = 1 / curve(strongest / 255);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= floor) hi = mid;
    else lo = mid;
  }
  return { boost: hi, before, after: ratioAt(hi), floor };
}
