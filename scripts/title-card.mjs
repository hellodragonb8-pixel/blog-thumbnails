// Title cards (PROTOCOL.md, "Title cards"): the thumbnails for a post without
// an image. The post's short title, read from its markdown file, is set in the
// title font and centred on each theme's background. Settings are in
// CONFIG.titleCard (make-thumbnails.mjs).

import sharp from "sharp";

// ---------------------------------------------------------------------------
// The title
// ---------------------------------------------------------------------------

// The post's short title: the TOCTitle field in the front matter of its
// markdown file (the block between the first two --- lines), the same title
// the blog archive lists. PageTitle is the long one at the top of the post.
// Null when there's no TOCTitle.
export function readTitle(markdown) {
  const front = markdown.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  for (const line of front[1].split(/\r?\n/)) {
    const m = line.match(/^TOCTitle\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[1].trim();
    if (/^"(.*)"$/.test(value)) value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    else if (/^'(.*)'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    return value.replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// Splits the title into lines no wider than maxWidth: as few lines as
// possible, and of those, the most even split (the longest line as short as
// it can be), so a long title doesn't leave one word alone on its last line.
// measure(text) gives a line's width. Returns null when one word alone is too
// wide.
export async function wrapTitle(title, measure, maxWidth) {
  const words = title.split(" ");
  const n = words.length;
  const cache = new Map();
  const width = async (i, j) => {
    const key = `${i},${j}`;
    if (!cache.has(key)) cache.set(key, await measure(words.slice(i, j).join(" ")));
    return cache.get(key);
  };

  // longest[j]: the shortest possible longest line for words[0..j) in k lines,
  // and from[j] where its last line starts.
  let longest = [0, ...Array(n).fill(Infinity)];
  const from = [];
  for (let k = 1; k <= n; k++) {
    const next = Array(n + 1).fill(Infinity);
    const start = Array(n + 1).fill(-1);
    for (let i = 0; i < n; i++) {
      if (longest[i] === Infinity) continue;
      for (let j = i + 1; j <= n; j++) {
        const w = await width(i, j);
        if (w > maxWidth) break;
        const worst = Math.max(longest[i], w);
        if (worst < next[j]) { next[j] = worst; start[j] = i; }
      }
    }
    from.push(start);
    longest = next;
    if (longest[n] < Infinity) {
      const lines = [];
      for (let j = n, line = k - 1; line >= 0; line--) {
        const i = from[line][j];
        lines.unshift(words.slice(i, j).join(" "));
        j = i;
      }
      return lines;
    }
    if (longest.every((w) => w === Infinity)) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const escapeXml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The SVG text attributes for the title font, at the export scale.
function fontAttributes(settings, scale, family = settings.font.map((f) => `'${f}'`).join(", ")) {
  return `font-family="${family}" font-weight="${settings.weight}" font-size="${settings.size * scale}" ` +
    `letter-spacing="${settings.size * settings.letterSpacing * scale}"`;
}

async function renderGrey(svg) {
  const { data, info } = await sharp(Buffer.from(svg)).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Width of one line of text in the title font at the export scale, measured
// on its pixels.
async function lineWidth(text, settings, scale) {
  const size = settings.size * scale;
  const W = Math.ceil(text.length * size) + size, H = size * 2;
  const { data } = await renderGrey(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<text x="${size / 2}" y="${size * 1.4}" ${fontAttributes(settings, scale)}>${escapeXml(text)}</text></svg>`,
  );
  let left = W, right = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x]) { left = Math.min(left, x); right = Math.max(right, x); }
    }
  }
  return right < 0 ? 0 : right - left + 1;
}

// Whether the title font is installed. A font that isn't installed is quietly
// replaced by the system's default, so this draws a sample in the title font
// and in a font that can't exist: the same pixels mean it was replaced.
export async function titleFontInstalled(settings) {
  const sample = (family) => renderGrey(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80">` +
    `<text x="10" y="60" ${fontAttributes(settings, 1, family)}>Hamburgefonstiv 0123</text></svg>`,
  );
  const [wanted, missing] = await Promise.all([sample(settings.font.map((f) => `'${f}'`).join(", ")), sample("'No Such Font 7f3a'")]);
  return !wanted.data.equals(missing.data);
}

// The title card for both themes. config: CONFIG from make-thumbnails.mjs.
// Returns { pixels: { light, dark } as raw RGB, lines }, or throws when the
// title can't be set (the font isn't installed, or one word is too wide).
export async function renderTitleCard(title, config) {
  const settings = config.titleCard;
  const { frame, inset, scale } = config;
  const W = frame.width * scale, H = frame.height * scale;

  if (!(await titleFontInstalled(settings))) {
    throw Object.assign(new Error(`The title font (${settings.font[0]} Semibold) isn't installed on this computer`),
      { advice: "Install it (on Windows, for all users), then run the command again." });
  }
  const lines = await wrapTitle(title, (text) => lineWidth(text, settings, scale), (frame.width - 2 * inset) * scale);
  if (!lines) {
    throw Object.assign(new Error(`A word in the title "${title}" is too wide for the thumbnail`),
      { advice: "Ask the author for a shorter TOCTitle, or ask the design team." });
  }

  // Lines are centred as a block, each line settings.lineHeight tall with its
  // baseline settings.baseline from its top, like a Figma text box with
  // centred text.
  const lineHeight = settings.lineHeight * scale;
  const top = (H - lines.length * lineHeight) / 2;
  const pixels = {};
  for (const [themeName, colors] of Object.entries(settings.colors)) {
    const text = lines.map((line, i) =>
      `<text x="${W / 2}" y="${top + i * lineHeight + settings.baseline * scale}" text-anchor="middle" fill="${colors.text}" ` +
      `${fontAttributes(settings, scale)}>${escapeXml(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="${W}" height="${H}" fill="${colors.background}"/>${text}</svg>`;
    pixels[themeName] = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
  }
  return { pixels, lines };
}
