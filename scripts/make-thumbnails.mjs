// Turns a blog image into two homepage thumbnails, one per theme:
//   <name>-light.webp and <name>-dark.webp
//
// It follows the fixed protocol in PROTOCOL.md, which `npm test` checks:
//   1. Load the image as it looks (first frame, transparency on white,
//      SVG colours resolved).
//   2. Background: the image's most common colour.
//   3. Remove a frame drawn around the content.
//   4. Layout: trim empty margins, fit the whole image inside the 32px
//      margins, centre it on the 716 x 396 canvas.
//   5. Colour: desaturate, then map each grey (by its distance from the
//      background grey) along the category preset's ramp of colours (seven,
//      or three for code), the same way for every pixel.
//   6. Tone: each image gets its own smooth tone curve. Diagrams: a main box
//      fill darker than the standard is brought to it. Code: text further
//      from its background than the standard is scaled down to it, as far as
//      text on boxes stays readable. All: if the strongest marks come out
//      below the preset's minimum contrast, stretch the greys until they do.
// The colour curve is always smooth, like Levels: no steps, so icons, shading
// and soft edges keep their shape.
// Nothing else changes the image. Options that go beyond the protocol
// (automatic crop, accent colour) are off unless asked for.
//
// Posts without an image get a title card instead (--type text): their short
// title, read from the post's markdown file, set in type (title-card.mjs,
// PROTOCOL.md "Text-only thumbnails").
//
// Every run also updates, in the output folder:
//   preview.html  all thumbnails in the folder, in both themes
//   tuner.html    the preset settings as live controls, per category
//
// Usage:
//   npm run thumbs
//     makes thumbnails for every image in inbox/diagram, inbox/graph and
//     inbox/code, and a title card for every post (.md) in inbox/text, into
//     out/ (see HOW-TO-THUMBNAILS.md)
//   npm run thumbs -- --type graph assets/chart.png [more images...] [options]
//     one or more images, with options
//
// Options:
//   --type diagram|code|graph|text  which preset to use (required); text
//                              makes a title card from a post's .md file
//   --crop off|auto|"l,t,w,h"  off (default): never crop.
//                              auto: crop content that would end up small (see
//                              autoCropBelow), keeping the top of a tall image.
//                              "l,t,w,h": use only this part of the image: left,
//                              top, width, height (like Photoshop's X, Y, W, H),
//                              in pixels or % of the original. Height can be
//                              "auto": fill the thumbnail at that width, cut at
//                              a gap between rows. Example: "0,0,100%,auto"
//   --out <dir>                output folder (default: assets/thumbs)
//   --source auto|light|dark   is the image's background light or dark?
//                              (default: auto, from the image's most common colour)
//   --fit contain|cover        contain = whole image visible (default)
//                              cover   = fill the frame, cropping the edges
//   --frames remove|keep       remove frames around the content (default: remove)
//   --accent on|off            keep blue as the accent colour (default: off)
//
// Thumbnails are always saved as lossless WebP, for the web.

import sharp from "sharp";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { boxFill, buildLut, greyLevel, hexToRgb, legibility, strongestLevel, textLevel, toneCurve } from "./tone.mjs";
import { loadInput } from "./svg.mjs";
import { pathToFileURL } from "node:url";
import { checkSavedFile, checkThumbnails, checkTitleCard, inkMargins, lostText } from "./checks.mjs";
import { readTitle, renderTitleCard } from "./title-card.mjs";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const CONFIG = {
  frame: { width: 358, height: 198 }, // Figma frame, in Figma px
  inset: 32,                          // minimum margin on every side, in Figma px
  scale: 2,                           // export at 2x for sharp screens -> 716 x 396

  // One preset per image category, each with a light and a dark theme. Each
  // theme is a ramp of seven colours (code has three, see below): each grey in
  // the image, by how far it is from the image's background, gets a blend of
  // the two nearest colours (positions in tone.mjs, PALETTE_STOPS):
  //   background  the image background becomes this (the thumbnail background)
  //   faint       outlines, the palest fills, soft edges
  //   subtle      the lightest marks drawn to be seen
  //   medium      pale boxes and panels, gridlines
  //   strong      darker boxes and fills
  //   text        grey text, connectors, lines
  //   ink         black text and solid marks
  //   minContrast legibility floor: lowest contrast ratio allowed between the
  //               strongest marks and the background (WCAG ratio, 1-21).
  //               Capped at the ink's own contrast.
  //   minVisible  optional, checked only (graphs): marks drawn to be seen
  //               should come out at least this contrast ratio, otherwise the
  //               image is flagged NEEDS A LOOK. Set it by choosing a
  //               "subtle" colour with that contrast.
  // After the first colour that differs from the background, each colour must
  // have more contrast than the one before (npm test checks this).
  // Tune these live in <out>/tuner.html, then paste the copied preset here.
  presets: {
    diagram: {
      light: { background: "#f4f5f6", faint: "#eff1f3", subtle: "#e9edf0", medium: "#d8dee4", strong: "#b7c6d0", text: "#81898f", ink: "#737a7f", minContrast: 3 },
      dark:  { background: "#0b0c0d", faint: "#111314", subtle: "#17191b", medium: "#202326", strong: "#353b40", text: "#797f84", ink: "#8a9095", minContrast: 3 },
    },
    // Code: three colours (tone.mjs, CODE_STOPS): background, dim for the
    // paler syntax colours (comments, numbers, strings), text for the rest.
    code: {
      light: { background: "#f4f5f6", dim: "#9ba9b4", text: "#8595a3", minContrast: 2 },
      dark:  { background: "#0b0c0d", dim: "#61696f", text: "#859098", minContrast: 3.1 },
    },
    graph: {
      light: { background: "#f4f5f6", faint: "#e5e7ea", subtle: "#d5d9dd", medium: "#d1d5da", strong: "#bfc5ca", text: "#abb3b9", ink: "#a4acb3", minContrast: 2.1, minVisible: 1.3 },
      dark:  { background: "#0b0c0d", faint: "#25292b", subtle: "#3f4549", medium: "#454b4f", strong: "#5f676c", text: "#7c858a", ink: "#879096", minContrast: 2.9, minVisible: 2 },
    },
  },

  // Tint weight per category, used when desaturating: how much a pixel's
  // colourfulness (0-255) counts as distance from the background, on top of
  // its brightness. 0 = plain desaturation. Keeps pale tinted boxes (a pale
  // blue card on a grey page) from turning into the page grey.
  tint: { diagram: 1, code: 0, graph: 0 }, // see PROTOCOL.md, step 5
  // Most the tint can add (grey levels). Without a limit, a strongly coloured
  // pale box (a yellow #f5cc84 node) counts as nearly as dark as the black
  // text on it, and the text disappears.
  tintCap: 40,

  // Box fill (PROTOCOL.md, step 6): in these categories, an image whose main
  // fill (boxes, panels) is darker than `target` gets a tone curve that brings
  // that fill to `target`, so boxes look the same from diagram to diagram.
  // Contrast amounts (0-1): 0.14 is evaluation_flow's box fill. A fill counts
  // when it is at least `minShare` of the content and no darker than `darkest`.
  // It moves at most to `minScale` of where it was, so lines lighter than the
  // boxes (connectors) keep at least that much of their strength.
  boxFill: { types: ["diagram"], target: 0.14, darkest: 0.35, minShare: 0.2, minScale: 0.6 },

  // Text level (PROTOCOL.md, step 6): in these categories, an image whose
  // typical text sits further from its background than `target` has all its
  // greys scaled down so the text lands on `target`. Light text on a dark
  // editor is far from its background, and without this it comes out much
  // brighter than code from a light screenshot. Contrast amount (0-1): 0.48 is
  // Screenshot 2026-10-02 095526's text.
  textLevel: { types: ["code"], target: 0.48 },

  // Title cards (PROTOCOL.md, "Text-only thumbnails"): for a post without an image, its
  // short title (TOCTitle) on the theme background. Sizes in Figma px.
  titleCard: {
    font: ["SF Pro Display", "SF Pro"], // installed system font: the first one found
    weight: 600,          // Semibold
    size: 30,
    lineHeight: 34,
    letterSpacing: -0.01, // share of the size: -1%
    baseline: 28,         // from the top of each line to its baseline, as in the Figma frames
    maxLines: 3,          // all that fit inside the margins: 3 x 34 <= 198 - 2 x 32
    colors: {             // same backgrounds as the presets
      light: { background: "#f4f5f6", text: "#1b2022" },
      dark:  { background: "#0b0c0d", text: "#989fa4" },
    },
  },

  // How different from the background a pixel must be (grey levels, 0-255) to
  // count as content when trimming the image's own margins. Raise it for noisy JPEGs.
  trimThreshold: 10,

  // Automatic crop: if the whole image, fitted inside the margins, would fill
  // less than this share of the width, it's too tall and is cropped to keep
  // the top (lists and long charts). Wide images aren't cropped: a row of boxes
  // or an equation only makes sense whole. 0 turns it off for that direction.
  autoCropBelow: { tall: 0.6, wide: 0 },

  accent: {
    color: "#4082ee",
    hueFrom: 190,       // which hues count as "blue", in degrees (0-360)
    hueTo: 240,
    minSaturation: 0.3, // greyer than this stays grey
    boost: 2,           // how quickly faint blue reaches full accent strength
  },

  // Figma exports to compare against in the tuner: <referenceDir>/<name>-light.png
  // and -dark.png, where <name> is the image name without "-original".
  referenceDir: "assets/figma",
};

// ---------------------------------------------------------------------------

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (from, to, v) => {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// 0..1: how strongly this pixel reads as "blue" in the original.
function accentWeight(r, g, b) {
  const { hueFrom, hueTo, minSaturation } = CONFIG.accent;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0 || max === min) return 0;

  const saturation = (max - min) / max;
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;

  const inHue = smoothstep(hueFrom - 10, hueFrom, hue) * (1 - smoothstep(hueTo, hueTo + 10, hue));
  const inSat = smoothstep(minSaturation - 0.1, minSaturation + 0.1, saturation);
  return inHue * inSat;
}

// A pixel's grey: the neutral grey with the same luminance (tone.mjs, greyLevel).
const greyOf = (data, o) => greyLevel(data[o], data[o + 1], data[o + 2]);

// Most common grey level (the image background) and one pixel of that colour.
function background(data, { width, height, channels }) {
  const histogram = new Uint32Array(256);
  for (let o = 0; o < width * height * channels; o += channels) histogram[greyOf(data, o)]++;
  const level = histogram.indexOf(Math.max(...histogram));
  for (let o = 0; ; o += channels) {
    if (greyOf(data, o) === level) return { level, rgb: [data[o], data[o + 1], data[o + 2]] };
  }
}

// Smallest rectangle holding every content pixel, or null if there are none.
// With an area, only content inside that rectangle counts.
function contentBox(mask, width, height, area = { left: 0, top: 0, right: width - 1, bottom: height - 1 }) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = area.top; y <= area.bottom; y++) {
    for (let x = area.left; x <= area.right; x++) {
      if (!mask[y * width + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

// A frame is a group of connected pixels that
//   - is large (at least a fifth of the image in both directions),
//   - is hollow: nearly all its pixels lie along the edges of its own box,
//   - is closed: each of its four sides is mostly drawn.
function isFrame(pixels, count, box, width, band) {
  const w = box.right - box.left + 1;
  const h = box.bottom - box.top + 1;
  const top = new Uint8Array(w), bottom = new Uint8Array(w);
  const left = new Uint8Array(h), right = new Uint8Array(h);
  let onEdge = 0;

  for (let i = 0; i < count; i++) {
    const x = pixels[i] % width;
    const y = (pixels[i] - x) / width;
    const dx = x - box.left, dy = y - box.top;
    let edge = false;
    if (dy < band) { top[dx] = 1; edge = true; }
    if (box.bottom - y < band) { bottom[dx] = 1; edge = true; }
    if (dx < band) { left[dy] = 1; edge = true; }
    if (box.right - x < band) { right[dy] = 1; edge = true; }
    if (edge) onEdge++;
  }

  const covered = (side) => side.reduce((a, b) => a + b, 0) / side.length;
  return onEdge / count > 0.9 && [top, bottom, left, right].every((side) => covered(side) > 0.8);
}

// Paints frames over with the background colour and clears them from the mask.
// Only outer frames are removed: those lining up with at least three sides of
// the content. Boxes further in (cards in a diagram, a chart's plot area) stay.
function removeFrames(data, info, mask, bg) {
  const { width, height, channels } = info;
  const n = width * height;
  const band = Math.max(4, Math.round(Math.min(width, height) * 0.01));
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const pixels = new Int32Array(n);
  const frames = [];

  // Find connected groups of content pixels (8-connected) and keep the frames.
  for (let start = 0; start < n; start++) {
    if (!mask[start] || visited[start]) continue;
    let sp = 0, count = 0;
    const box = { left: width, top: height, right: -1, bottom: -1 };
    stack[sp++] = start;
    visited[start] = 1;
    while (sp) {
      const p = stack[--sp];
      pixels[count++] = p;
      const x = p % width, y = (p - x) / width;
      if (x < box.left) box.left = x;
      if (x > box.right) box.right = x;
      if (y < box.top) box.top = y;
      if (y > box.bottom) box.bottom = y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const q = ny * width + nx;
          if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; }
        }
      }
    }
    const big = box.right - box.left + 1 >= width * 0.2 && box.bottom - box.top + 1 >= height * 0.2;
    if (big && isFrame(pixels, count, box, width, band)) frames.push({ box, pixels: pixels.slice(0, count) });
  }
  if (frames.length === 0) return 0;

  const content = contentBox(mask, width, height);
  const tolerance = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  const outer = frames.filter(({ box }) =>
    near(box.left, content.left) + near(box.top, content.top) +
    near(box.right, content.right) + near(box.bottom, content.bottom) >= 3);

  const inFrame = new Uint8Array(n);
  for (const f of outer) for (const p of f.pixels) inFrame[p] = 1;

  // Paint a little beyond each frame pixel to catch its faint anti-aliased edge,
  // without touching any other content.
  for (const f of outer) {
    for (const p of f.pixels) {
      const x = p % width, y = (p - x) / width;
      for (let ny = Math.max(0, y - 2); ny <= Math.min(height - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(width - 1, x + 2); nx++) {
          const q = ny * width + nx;
          if (mask[q] && !inFrame[q]) continue;
          const o = q * channels;
          data[o] = bg.rgb[0];
          data[o + 1] = bg.rgb[1];
          data[o + 2] = bg.rgb[2];
        }
      }
    }
  }
  for (const f of outer) for (const p of f.pixels) mask[p] = 0;
  return outer.length;
}

// Content pixels: those that differ from the background by more than trimThreshold.
function contentMask(data, { width, height, channels }, bgLevel) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.abs(greyOf(data, i * channels) - bgLevel) > CONFIG.trimThreshold ? 1 : 0;
  }
  return mask;
}

// Turns --crop "left,top,width,height" into a pixel rectangle of the original.
// Each value is pixels or a percentage of the image; height can be "auto":
// the height that fills the thumbnail at the chosen width, ending in a gap
// between rows of content so the cut doesn't slice through a bar or label.
function cropRegion(spec, { width, height }, mask) {
  const parts = spec.split(",").map((s) => s.trim());
  if (parts.length !== 4) throw new Error(`--crop needs 4 values (left,top,width,height), got "${spec}"`);
  const value = (s, size) => {
    const n = parseFloat(s);
    if (!Number.isFinite(n)) throw new Error(`--crop: "${s}" isn't a number, percentage or "auto"`);
    return Math.round(s.endsWith("%") ? (n / 100) * size : n);
  };

  const left = Math.min(width - 1, Math.max(0, value(parts[0], width)));
  const top = Math.min(height - 1, Math.max(0, value(parts[1], height)));
  const w = Math.min(width - left, Math.max(1, value(parts[2], width)));
  if (parts[3] !== "auto") {
    return { left, top, width: w, height: Math.min(height - top, Math.max(1, value(parts[3], height))) };
  }

  // Auto height: fit the content inside the chosen columns to the thumbnail shape.
  const box = contentBox(mask, width, height, { left, top, right: left + w - 1, bottom: height - 1 });
  if (!box) return { left, top, width: w, height: height - top };
  const { bottom } = fitToShape(mask, width, box, "tall");
  return { left, top, width: w, height: bottom - top + 1 };
}

// Width / height of the space inside the margins (294 x 134 -> about 2.2).
function innerShape() {
  const { frame, inset } = CONFIG;
  return (frame.width - 2 * inset) / (frame.height - 2 * inset);
}

// Shortens a content box to the thumbnail's shape. "tall" keeps the top at
// full width, "wide" keeps the left at full height. The cut moves back to the
// nearest empty row or column, if there is one in the last 40%, so it doesn't
// slice through a bar, a label or a line of text.
function fitToShape(mask, width, box, direction) {
  const shape = innerShape();
  const isEmpty = (from, to, at, alongRows) => {
    for (let i = from; i <= to; i++) {
      if (mask[alongRows ? at * width + i : i * width + at]) return false;
    }
    return true;
  };

  if (direction === "tall") {
    const wanted = Math.round((box.right - box.left + 1) / shape);
    let bottom = Math.min(box.bottom, box.top + wanted - 1);
    for (let y = bottom; bottom < box.bottom && y > box.top + wanted * 0.6; y--) {
      if (isEmpty(box.left, box.right, y, true)) { bottom = y; break; }
    }
    return { ...box, bottom };
  }

  const wanted = Math.round((box.bottom - box.top + 1) * shape);
  let right = Math.min(box.right, box.left + wanted - 1);
  for (let x = right; right < box.right && x > box.left + wanted * 0.6; x--) {
    if (isEmpty(box.top, box.bottom, x, false)) { right = x; break; }
  }
  return { ...box, right };
}

// Automatic crop for content that would end up small: if, fitted whole, it
// would fill less than autoCropBelow of the space inside the margins in one
// direction, keep the top (too tall) or the left (too wide). Returns the
// direction and how much it would have filled, or null when no crop is needed.
function autoCropDirection(box) {
  const aspect = (box.right - box.left + 1) / (box.bottom - box.top + 1);
  const shape = innerShape();
  const direction = aspect < shape ? "tall" : "wide";
  const fill = direction === "tall" ? aspect / shape : shape / aspect;
  if (fill >= CONFIG.autoCropBelow[direction]) return null;
  return { direction, fill };
}

// Crops (if asked), removes frames, trims the image's own margins and fits
// what's left into the frame.
export async function prepare(input, opts) {
  const { frame, inset, scale } = CONFIG;
  const boxWidth = (frame.width - 2 * inset) * scale;
  const boxHeight = (frame.height - 2 * inset) * scale;

  const { source, density } = await loadInput(input);

  let { data: flat, info } = await sharp(source, { density })
    .rotate()                                // respect camera orientation
    .flatten({ background: "#ffffff" })      // transparent areas count as white
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  let crop = null;
  if (opts.crop !== "auto" && opts.crop !== "off") {
    // Pixel values are pixels of the image as loaded. SVGs are rendered at 4x,
    // so for an SVG use percentages.
    crop = cropRegion(opts.crop, info, contentMask(flat, info, background(flat, info).level));
    ({ data: flat, info } = await sharp(flat, { raw: info })
      .extract(crop)
      .raw()
      .toBuffer({ resolveWithObject: true }));
  }

  const bg = background(flat, info);
  const mask = contentMask(flat, info, bg.level);

  const framesRemoved = opts.frames === "keep" ? 0 : removeFrames(flat, info, mask, bg);

  let pipeline = sharp(flat, { raw: info });
  let box = contentBox(mask, info.width, info.height);

  let autoCrop = null;
  if (opts.crop === "auto" && box) {
    autoCrop = autoCropDirection(box);
    if (autoCrop) box = contentBox(mask, info.width, info.height, fitToShape(mask, info.width, box, autoCrop.direction));
  }

  if (box) {
    pipeline = pipeline.extract({
      left: box.left,
      top: box.top,
      width: box.right - box.left + 1,
      height: box.bottom - box.top + 1,
    });
  }

  const { data, info: fitted } = await pipeline
    .resize(boxWidth, boxHeight, { fit: opts.fit === "cover" ? "cover" : "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Desaturate. With a tint weight for this category, colourful pixels count
  // as further from the background than a neutral grey of the same brightness
  // (like Photoshop's Black & White adjustment), so tinted boxes don't vanish.
  const tint = CONFIG.tint[opts.type] ?? 0;
  const away = bg.level < 128 ? 1 : -1; // further from a light background = darker
  const grey = new Uint8Array(fitted.width * fitted.height);
  for (let i = 0; i < grey.length; i++) {
    const o = i * fitted.channels;
    const chroma = Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
    grey[i] = Math.min(255, Math.max(0, Math.round(greyOf(data, o) + away * tint * Math.min(chroma, CONFIG.tintCap))));
  }
  return {
    rgb: data,
    channels: fitted.channels,
    grey,
    width: fitted.width,
    height: fitted.height,
    bgLevel: bg.level,
    framesRemoved,
    crop,
    autoCrop,
  };
}

// The colour step (PROTOCOL.md, steps 5 and 6): every pixel's grey becomes a
// contrast amount, which the preset maps to a colour, the same way for every
// pixel. Returns the themed canvases and report lines.
async function colorize(prepared, preset, layout, base, opts) {
  const { rgb, channels, grey, width, height, bgLevel } = prepared;
  const { canvasWidth, canvasHeight, left, top } = layout;
  const sourceIsDark = opts.source === "auto" ? bgLevel < 128 : opts.source === "dark";

  // Contrast amount per pixel on the full canvas (0 = background, 255 = as far
  // from the background as the image allows), measured from the image's own
  // background so that it becomes the theme background exactly. The tuner
  // recolours this map with the same code as below.
  const amount = Buffer.alloc(canvasWidth * canvasHeight, 0);
  const accent = new Float32Array(canvasWidth * canvasHeight);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Distance from the background grey, in either direction, so marks
      // lighter than the background (a white card on a grey page) stay visible.
      const d = Math.abs(grey[i] - bgLevel) / ((sourceIsDark ? 255 - bgLevel : bgLevel) || 1);
      const c = (y + top) * canvasWidth + x + left;
      amount[c] = Math.round(clamp01(d) * 255);
      histogram[amount[c]]++;
      if (opts.accent === "on") {
        const o = i * channels;
        accent[c] = accentWeight(rgb[o], rgb[o + 1], rgb[o + 2]);
      }
    }
  }

  await sharp(amount, { raw: { width: canvasWidth, height: canvasHeight, channels: 1 } })
    .png()
    .toFile(path.join(opts.workDir ?? opts.out, "tuning", `${base}.png`));

  const strongest = strongestLevel(histogram);
  const fill = CONFIG.boxFill.types.includes(opts.type) ? boxFill(histogram, CONFIG.boxFill) : null;
  const fillCurve = toneCurve(fill, CONFIG.boxFill.target, CONFIG.boxFill.minScale);

  // Text level: scale the greys down so the typical text lands on the target,
  // but only as far as text on boxes stays readable in every theme (the "text
  // on a box" check): a light title bar with small dark text on it would
  // otherwise fade into its text.
  const text = CONFIG.textLevel.types.includes(opts.type) ? textLevel(histogram) : null;
  const wanted = text !== null && text > CONFIG.textLevel.target + 0.01 ? CONFIG.textLevel.target / text : 1;
  const readableAt = (s) => Object.values(preset).every((theme) => {
    const c = (d) => fillCurve(d) * s;
    const lut = buildLut(theme, legibility(theme, strongest, c).boost, c);
    const out = (i) => { const a = amount[(Math.floor(i / width) + top) * canvasWidth + (i % width) + left] * 3; return [lut[a], lut[a + 1], lut[a + 2]]; };
    return !lostText(prepared, out);
  });
  let scale = wanted;
  while (scale < 1 && !readableAt(scale)) scale = Math.min(1, scale + 0.05);
  const curve = (d) => fillCurve(d) * scale;

  const accentRgb = hexToRgb(CONFIG.accent.color);
  const images = {};
  const report = [`source: ${sourceIsDark ? "dark" : "light"} (background grey ${bgLevel})`];
  if (fill !== null && fill > CONFIG.boxFill.target) report.push(`box fill ${fill.toFixed(2)}, brought to ${Math.max(CONFIG.boxFill.target, fill * CONFIG.boxFill.minScale).toFixed(2)}`);
  if (wanted < 1) {
    report.push(scale === wanted
      ? `text level ${text.toFixed(2)}, scaled x${scale.toFixed(2)} to ${CONFIG.textLevel.target}`
      : `text level ${text.toFixed(2)}, scaled x${scale.toFixed(2)} (not all the way to ${CONFIG.textLevel.target}: text on a box would fade)`);
  }

  for (const [themeName, theme] of Object.entries(preset)) {
    const legible = legibility(theme, strongest, curve);
    const lut = buildLut(theme, legible.boost, curve);
    const bgRgb = hexToRgb(theme.background);

    const out = Buffer.alloc(canvasWidth * canvasHeight * 3);
    for (let c = 0; c < amount.length; c++) {
      let color = lut.subarray(amount[c] * 3, amount[c] * 3 + 3);
      if (accent[c] > 0) {
        // Accent strength follows the contrast amount, so pale blue fills
        // become a soft tint and solid blue becomes the accent.
        const strength = clamp01((amount[c] / 255) * CONFIG.accent.boost);
        const tinted = bgRgb.map((v, ch) => mix(v, accentRgb[ch], strength));
        color = Array.from(color, (v, ch) => mix(v, tinted[ch], accent[c]));
      }
      out[c * 3] = Math.round(color[0]);
      out[c * 3 + 1] = Math.round(color[1]);
      out[c * 3 + 2] = Math.round(color[2]);
    }
    images[themeName] = out;

    const ratio = (r) => `${r.toFixed(2)}:1`;
    const capped = legible.floor < theme.minContrast
      ? ` (floor ${theme.minContrast}:1 capped to the ink's ${ratio(legible.floor)})`
      : "";
    if (legible.before === null) report.push(`${themeName}: no content found`);
    else if (legible.boost === 1) report.push(`${themeName}: strongest marks ${ratio(legible.before)}${capped}`);
    else report.push(`${themeName}: strongest marks ${ratio(legible.before)}, boosted x${legible.boost.toFixed(2)} to ${ratio(legible.after)}${capped}`);
  }
  return { images, report, textScale: scale };
}

export async function makeThumbnails(input, opts) {
  if (opts.type === "text") return makeTitleCard(input, opts);
  const preset = CONFIG.presets[opts.type];
  const prepared = await prepare(input, opts);
  const { width, height, framesRemoved, crop, autoCrop } = prepared;

  const { frame, scale } = CONFIG;
  const canvasWidth = frame.width * scale;
  const canvasHeight = frame.height * scale;
  const layout = {
    canvasWidth,
    canvasHeight,
    left: Math.round((canvasWidth - width) / 2),
    top: Math.round((canvasHeight - height) / 2),
  };
  const { left, top } = layout;

  const base = path.basename(input, path.extname(input));
  await mkdir(path.join(opts.workDir ?? opts.out, "tuning"), { recursive: true });
  const { images, report, textScale } = await colorize(prepared, preset, layout, base, opts);
  const checks = checkThumbnails({ config: CONFIG, type: opts.type, prepared, pixels: images });
  const log = opts.quiet ? () => {} : console.log;

  const { files, saved } = await saveThemes(images, base, opts);
  checks.push(...saved);

  // Margins in Figma px: top, right, bottom, left.
  const margins = [top, canvasWidth - width - left, canvasHeight - height - top, left].map((m) => m / scale);

  log(
    `${input}  [${opts.type}]\n` +
    (crop ? `  crop: left ${crop.left}, top ${crop.top}, width ${crop.width}, height ${crop.height} (px of the original)\n` : "") +
    (autoCrop
      ? `  auto crop: too ${autoCrop.direction} (whole, it would fill only ${Math.round(autoCrop.fill * 100)}% of the ` +
        `${autoCrop.direction === "tall" ? "width" : "height"}), kept the ${autoCrop.direction === "tall" ? "top" : "left"}\n`
      : "") +
    `  frames removed: ${framesRemoved}, margins (top right bottom left): ${margins.join(" ")}\n` +
    report.map((r) => `  ${r}`).join("\n") + "\n" +
    Object.values(files).map((f) => `  -> ${path.join(opts.out, f)}`).join("\n") + "\n" +
    describeChecks(checks).map((line) => `  ${line}`).join("\n"),
  );

  const entry = { name: base, type: opts.type, source: path.relative(opts.out, input).replaceAll("\\", "/"), files, margins, textScale };
  return { entry, checks };
}

// Saves both themes as lossless WebP, so each file has exactly the colours
// that were checked: the theme background stays locked and compression adds
// no off-palette colours.
async function saveThemes(images, base, opts) {
  const { frame, scale } = CONFIG;
  const files = {};
  const saved = [];
  for (const [themeName, pixels] of Object.entries(images)) {
    const fileName = `${base}-${themeName}.webp`;
    const file = path.join(opts.out, fileName);
    await sharp(pixels, { raw: { width: frame.width * scale, height: frame.height * scale, channels: 3 } })
      .webp({ lossless: true })
      .toFile(file);
    files[themeName] = fileName;
    saved.push(await checkSavedFile(file, pixels, themeName));
  }
  return { files, saved };
}

// A title card (PROTOCOL.md, "Text-only thumbnails"): the post's short title, read
// from its markdown file, set in the title font on each theme's background.
async function makeTitleCard(input, opts) {
  const title = readTitle(await readFile(input, "utf8"));
  if (!title) {
    throw Object.assign(new Error("There's no TOCTitle in the post's front matter"),
      { advice: "Check that it's the post's .md file and that it has a TOCTitle line." });
  }
  const { pixels, lines } = await renderTitleCard(title, CONFIG);
  const checks = checkTitleCard({ config: CONFIG, pixels, lines });
  const base = path.basename(input, path.extname(input));
  await mkdir(opts.out, { recursive: true });
  const { files, saved } = await saveThemes(pixels, base, opts);
  checks.push(...saved);

  // Margins in Figma px: top, right, bottom, left.
  const { frame, scale } = CONFIG;
  const m = inkMargins(pixels.light, frame.width * scale, frame.height * scale, hexToRgb(CONFIG.titleCard.colors.light.background));
  const margins = m ? [m.top, m.right, m.bottom, m.left].map((px) => px / scale) : [];
  const log = opts.quiet ? () => {} : console.log;
  log(
    `${input}  [text]\n` +
    `  title: ${lines.join(" / ")}\n` +
    `  margins (top right bottom left): ${margins.join(" ")}\n` +
    Object.values(files).map((f) => `  -> ${path.join(opts.out, f)}`).join("\n") + "\n" +
    describeChecks(checks).map((line) => `  ${line}`).join("\n"),
  );

  const entry = { name: base, type: "text", title, lines, source: path.relative(opts.out, input).replaceAll("\\", "/"), files, margins };
  return { entry, checks };
}

// What to tell the person running the script when a check fails.
const ADVICE = {
  readable: "Look at it in preview.html. If text is hard to read, ask the design team.",
  visible: "Look at it in preview.html. If lines are missing, ask the design team.",
  "not tiny": "It's very tall, so it ends up small. Run it with --crop auto, or ask the design team.",
  "colours merge": "Look at it in preview.html. If every line or bar is labelled directly, it's fine. If the chart needs a legend or colour to tell them apart, ask the author for a version where they differ in lightness, or ask the design team.",
  fits: "Ask the author for a shorter TOCTitle, or ask the design team.",
  "text on a box": "Look at that area in preview.html. If the text is hard to read, ask the author for dark text on light boxes (or the other way round), or ask the design team.",
};

// Plain-language result lines for an image's checks (empty when all passed).
// Advice is given once per check, after its last failing theme.
function describeChecks(checks) {
  const failed = checks.filter((c) => !c.ok);
  return failed.map((c, k) => {
    const last = !failed.slice(k + 1).some((d) => d.name === c.name);
    return `${c.theme ? `${c.theme} theme: ` : ""}${c.message}.` +
      (last ? ` ${ADVICE[c.name] ?? "This shouldn't happen: send the image and this message to the design team."}` : "");
  });
}

// ---------------------------------------------------------------------------
// Preview page
// ---------------------------------------------------------------------------

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function writePreview(outDir, entries) {
  const { frame, inset } = CONFIG;
  const rows = entries.map((e) => `
    <section class="row">
      <h2>${escapeHtml(e.name)}</h2>
      <p class="meta">${escapeHtml(e.type ?? "")} · margins (top, right, bottom, left): ${e.margins.join(", ")} px</p>
      <div class="cols">
        <figure class="col col--source">
          ${e.title
            ? `<div class="source source--title">${escapeHtml(e.title)}</div>`
            : `<div class="source"><img src="${escapeHtml(e.source)}" alt=""></div>`}
          <figcaption>${e.title ? "TOCTitle" : "Original"}</figcaption>
        </figure>
        <figure class="col col--light">
          <div class="thumb"><img src="${escapeHtml(e.files.light)}" alt=""><span class="guide"></span></div>
          <figcaption>Light</figcaption>
        </figure>
        <figure class="col col--dark">
          <div class="thumb"><img src="${escapeHtml(e.files.dark)}" alt=""><span class="guide"></span></div>
          <figcaption>Dark</figcaption>
        </figure>
      </div>
    </section>`).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thumbnail preview</title>
<style>
  :root {
    --page: #ffffff;
    --text: #1b2022;
    --muted: #5f6468;
    --rule: #e3e6e8;
    --light-page: #ffffff;
    --dark-page: #000000;
    --guide: #4082ee;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 16px 64px;
    background: var(--page);
    color: var(--text);
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 1200px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
  h1 { margin: 0; font-size: 1.5rem; font-weight: 600; }
  label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
  .intro { margin: 0 0 24px; color: var(--muted); }
  .row { padding: 24px 0; border-top: 1px solid var(--rule); }
  h2 { margin: 0; font-size: 1rem; font-weight: 600; }
  .meta { margin: 2px 0 16px; color: var(--muted); font-size: 0.875rem; font-variant-numeric: tabular-nums; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; }
  figure { margin: 0; padding: 16px; border-radius: 8px; }
  .col--source { background: #f7f7f8; }
  .col--light { background: var(--light-page); outline: 1px solid var(--rule); outline-offset: -1px; }
  .col--dark { background: var(--dark-page); color: #9a9ea2; }
  figcaption { margin-top: 8px; font-size: 0.8125rem; color: var(--muted); }
  .col--dark figcaption { color: #9a9ea2; }
  .source { aspect-ratio: ${frame.width} / ${frame.height}; display: grid; place-items: center; }
  .source img { max-width: 100%; max-height: 100%; }
  .source--title { padding: 16px; text-align: center; font-size: 1.125rem; font-weight: 600; }
  .thumb { position: relative; aspect-ratio: ${frame.width} / ${frame.height}; border-radius: 4px; overflow: hidden; }
  .thumb img { display: block; width: 100%; height: 100%; }
  .guide {
    display: none;
    position: absolute;
    inset: ${(inset / frame.height) * 100}% ${(inset / frame.width) * 100}%;
    outline: 1px dashed var(--guide);
    pointer-events: none;
  }
  body.show-guides .guide { display: block; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Thumbnail preview</h1>
    <label><input type="checkbox" id="guides"> Show ${inset}px margin guides</label>
  </header>
  <p class="intro">Generated by scripts/make-thumbnails.mjs. Rerun the script and refresh to see changes.</p>
  ${rows}
</main>
<script>
  const box = document.getElementById("guides");
  const apply = () => document.body.classList.toggle("show-guides", box.checked);
  try { box.checked = localStorage.getItem("thumb-guides") === "1"; } catch {}
  apply();
  box.addEventListener("change", () => {
    apply();
    try { localStorage.setItem("thumb-guides", box.checked ? "1" : "0"); } catch {}
  });
</script>
</body>
</html>
`;
  await writeFile(path.join(outDir, "preview.html"), html);
}

// The tuner: tuner-template.html with tone.mjs, the presets and every image's
// contrast map built in. The maps are embedded as data URLs because a page
// opened from disk isn't allowed to read pixels from image files.
async function writeTuner(outDir, entries) {
  const exists = (file) => access(file).then(() => true, () => false);
  const images = [];
  const dataUrl = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
  for (const e of entries) {
    const mapFile = path.join(outDir, "tuning", `${e.name}.png`);
    if (!CONFIG.presets[e.type] || !(await exists(mapFile))) continue;

    const reference = {};
    for (const theme of ["light", "dark"]) {
      const file = path.join(CONFIG.referenceDir, `${e.name.replace(/-original$/, "")}-${theme}.png`);
      reference[theme] = (await exists(file)) ? path.relative(outDir, file).replaceAll("\\", "/") : null;
    }
    images.push({ name: e.name, type: e.type, textScale: e.textScale ?? 1, map: await dataUrl(mapFile), reference });
  }

  const data = { frame: CONFIG.frame, inset: CONFIG.inset, scale: CONFIG.scale, presets: CONFIG.presets, boxFill: CONFIG.boxFill, images };
  const tone = (await readFile(new URL("./tone.mjs", import.meta.url), "utf8")).replace(/^export /gm, "");
  const template = await readFile(new URL("./tuner-template.html", import.meta.url), "utf8");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  await writeFile(
    path.join(outDir, "tuner.html"),
    template.replace("/*TONE*/", () => tone).replace("/*DATA*/null", () => json),
  );
}

// Remembers every thumbnail made into this folder, so the preview shows them all.
async function updateManifest(outDir, made) {
  const file = path.join(outDir, "manifest.json");
  let entries = [];
  try { entries = JSON.parse(await readFile(file, "utf8")); } catch {}
  for (const entry of made) {
    entries = entries.filter((e) => e.name !== entry.name);
    entries.push(entry);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(file, JSON.stringify(entries, null, 2) + "\n");
  return entries;
}

// ---------------------------------------------------------------------------

// The protocol's defaults (PROTOCOL.md). Options that go beyond it, such as
// the automatic crop, are off unless asked for.
export const DEFAULT_OPTIONS = {
  type: null, crop: "off", out: "assets/thumbs", source: "auto", fit: "contain", frames: "remove",
  accent: "off",
};

function parseArgs(argv) {
  const opts = { ...DEFAULT_OPTIONS, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) opts[arg.slice(2)] = argv[++i];
    else opts.inputs.push(arg);
  }
  return opts;
}

// The inbox: `npm run thumbs` with no arguments makes thumbnails for every
// image in inbox/<category>/ and writes them to a fresh out/ folder, with
// tall images cropped automatically and every image checked. Working files
// (the tuner, its maps, the list of images made) go to out/_work/.
const INBOX = "inbox";
const OUT = "out";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tif", ".tiff", ".svg"]);
// Image categories, plus text: title cards, made from a post's .md file.
const TYPES = [...Object.keys(CONFIG.presets), "text"];
const accepts = (type, name) => (type === "text" ? /\.md$/i.test(name) : IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));

async function runInbox() {
  for (const type of TYPES) await mkdir(path.join(INBOX, type), { recursive: true });

  const jobs = [];
  for (const type of TYPES) {
    for (const name of (await readdir(path.join(INBOX, type))).sort()) {
      if (accepts(type, name)) jobs.push({ type, file: path.join(INBOX, type, name) });
    }
  }
  if (jobs.length === 0) {
    console.log(`The inbox is empty. Put images in ${Object.keys(CONFIG.presets).map((t) => `${INBOX}/${t}`).join(", ")}, or a post's .md file in ${INBOX}/text, then run npm run thumbs again.`);
    return;
  }

  // Start from an empty out/ folder, so it always matches what's in the inbox.
  await rm(OUT, { recursive: true, force: true });
  const workDir = path.join(OUT, "_work");
  await mkdir(workDir, { recursive: true });
  const made = [];
  const names = new Map();
  let ready = 0;
  for (const { type, file } of jobs) {
    const name = path.basename(file, path.extname(file));
    if (names.has(name)) {
      console.log(`FAILED       ${file}\n             Another image is also called "${name}" (${names.get(name)}). Rename one of them.`);
      continue;
    }
    names.set(name, file);
    try {
      const { entry, checks } = await makeThumbnails(file, { ...DEFAULT_OPTIONS, type, out: OUT, workDir, crop: "auto", quiet: true });
      made.push(entry);
      const outputs = Object.values(entry.files).map((f) => path.join(OUT, f)).join(", ");
      const problems = describeChecks(checks);
      if (problems.length === 0) {
        ready++;
        console.log(`READY        ${file}  ->  ${outputs}`);
      } else {
        console.log(`NEEDS A LOOK ${file}  ->  ${outputs}`);
        for (const line of problems) console.log(`             ${line}`);
      }
    } catch (error) {
      const advice = error.advice ?? (type === "text"
        ? "Check that it's the post's .md file; if it is, send it to the design team."
        : "Check that it's an image file; if it is, send it to the design team.");
      console.log(`FAILED       ${file}\n             ${error.message}. ${advice}`);
    }
  }

  const entries = await updateManifest(workDir, made);
  await writePreview(OUT, entries);
  await writeTuner(workDir, entries);
  console.log(`\n${ready} of ${jobs.length} ready. See them all in ${path.join(OUT, "preview.html")}.`);
}

async function main() {
  if (process.argv.length <= 2) return runInbox();

  const opts = parseArgs(process.argv.slice(2));
  if (opts.inputs.length === 0 || !TYPES.includes(opts.type)) {
    console.error(
      `Usage: npm run thumbs -- --type ${TYPES.join("|")} <image or post .md> [more...] [--crop off|auto|"l,t,w,h"] [--out dir] ` +
      "[--source auto|light|dark] [--fit contain|cover] [--frames remove|keep] [--accent on|off]",
    );
    if (opts.inputs.length > 0) console.error(opts.type ? `Unknown type "${opts.type}".` : "--type is required.");
    process.exit(1);
  }
  await mkdir(opts.out, { recursive: true });
  const made = [];
  for (const input of opts.inputs) made.push((await makeThumbnails(input, opts)).entry);
  const entries = await updateManifest(opts.out, made);
  await writePreview(opts.out, entries);
  await writeTuner(opts.out, entries);
  console.log(`Preview: ${path.join(opts.out, "preview.html")}`);
  console.log(`Tuner:   ${path.join(opts.out, "tuner.html")}`);
}

// Run as a command; when imported (by the protocol test), just export.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
