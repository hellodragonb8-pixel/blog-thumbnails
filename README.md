# Blog thumbnails

Turns a blog post's image (a diagram, a graph or a code screenshot) into the two grayscale homepage thumbnails: one for the light theme and one for the dark theme, 716 × 396 (358 × 198 at 2x). It only changes colours: shapes, text and icons are never redrawn.

A post without an image gets a title card instead: its short title (`TOCTitle`) in SF Pro Semibold on the same backgrounds, made from the post's `.md` file. Its rules are in [PROTOCOL.md](PROTOCOL.md#title-cards).

- **Making thumbnails for a post:** [HOW-TO-THUMBNAILS.md](HOW-TO-THUMBNAILS.md), step by step, for whoever uploads the posts.
- **The rules the script follows and the checks that prove it:** [PROTOCOL.md](PROTOCOL.md).

## Quick start

Needs [Node.js](https://nodejs.org) 20.9 or later. Title cards also need the SF Pro font installed (on Windows, for all users).

```sh
npm install
```

Put each image in `inbox/diagram`, `inbox/graph` or `inbox/code`, and the `.md` file of each post without an image in `inbox/text`, then run:

```sh
npm run thumbs
```

Both thumbnails for every image go to `out/` as `<name>-light.webp` and `<name>-dark.webp`. For each image the command prints READY, NEEDS A LOOK (with what to check) or FAILED, and `out/preview.html` shows every image next to its thumbnails.

## One image with options

For the design team:

```sh
npm run thumbs -- --type graph path/to/post-image.png
```

`--type` picks the category: `diagram`, `graph` or `code`, or `text` for a title card from a post's `.md` file. Output goes to `assets/thumbs/` unless you pass `--out <folder>`.

| Option | What it does |
|---|---|
| `--crop auto` | Crops a very tall image, keeping its top (the inbox always does this). |
| `--crop "left,top,width,height"` | Uses only that part of the image, in pixels or percentages, like Photoshop's X, Y, W, H. A height of `auto` fills the thumbnail at that width: `--crop "30%,0,70%,auto"`. Use percentages for SVGs. |
| `--source light` / `--source dark` | Overrides the light/dark detection of the original. |
| `--frames keep` | Keeps a frame drawn around the content. |
| `--accent on` | Keeps blue as the accent colour. |

## How it works

In short (the full rules are in [PROTOCOL.md](PROTOCOL.md)):

1. Find the background, remove a frame around the content, trim empty margins and fit the whole image inside a 32px margin.
2. Turn each pixel into a grey by how bright it looks, then into a colour by how far that grey is from the background, along the category's ramp of colours: seven for diagrams and graphs, three for code (background, dim and text). The same grey always gets the same colour.
3. Even out each image's tones: diagram box fills come out at one standard shade, code text at one standard brightness, and faint images are brought up to a minimum contrast.
4. Save both files lossless, so the theme backgrounds are exactly `#f4f5f6` and `#0b0c0d`.

Every thumbnail is then checked. Breaking a rule is a failure. Two checks look for meaning the greys lost (two colours in a graph that became one grey, text that faded on a box) and mark the image NEEDS A LOOK.

## Showing them on a page

The site uses its own markup. If you need a reference, `thumbnails.css` shows the two files in the 358 × 198 frame and displays the one that matches the reader's theme:

```html
<div class="thumb" aria-hidden="true">
  <img class="thumb__img--light" src="post-image-light.webp" alt="" loading="lazy">
  <img class="thumb__img--dark" src="post-image-dark.webp" alt="" loading="lazy">
</div>
```

It follows the OS setting; `data-theme="light"` or `data-theme="dark"` on `<html>`, or on any element around the thumbnails, overrides it.

## Tuning and testing

The settings are in `CONFIG` at the top of `scripts/make-thumbnails.mjs`: the colour ramp for each category and theme (`presets`), the margin, the standards for box fills and code text, and the title card's font, sizes and colours (`titleCard`). To try ramp colours, open `out/_work/tuner.html` after an inbox run, or `assets/thumbs/tuner.html` after a single-image run. It recolours every image live and its **Copy** button gives the preset to paste back into `CONFIG.presets`.

`npm test` runs every sample image through the script and all the checks. Run it after any change. The samples live in `assets/diagrams`, `assets/graphs`, `assets/code` and `assets/text` (posts' `.md` files), which aren't in the repository; without them only the preset and title checks run. To add a sample, drop it in the matching folder.

## Tips for post authors

The script works with any image, but these make the grayscale versions clearer:

- **Tell things apart by lightness, not just colour.** Two series in the same brightness (a typical blue and red) become the same grey. Check by viewing the chart in grayscale: in Chrome or Edge DevTools, Rendering → Emulate vision deficiencies → Achromatopsia.
- **Dark text on light boxes,** or labels outside shapes, rather than text on strongly coloured or dark boxes and bars.
- **Landscape images,** around 2:1 or wider. A tall image is cropped to its top.
- **A plain background,** with no window frame around the chart.

## Files

| File | What it is |
|---|---|
| `scripts/make-thumbnails.mjs` | The script: settings, layout, colouring, the inbox command, the preview and tuner pages. |
| `scripts/tone.mjs` | The colour mapping, shared with the tuner. |
| `scripts/checks.mjs` | The checks run on every thumbnail. |
| `scripts/protocol.test.mjs` | `npm test`. |
| `scripts/title-card.mjs` | Title cards: reads the `TOCTitle`, splits it into lines, sets it in type. |
| `scripts/svg.mjs` | Loads SVGs with their CSS variables resolved. |
| `scripts/tuner-template.html` | The tuner page. |
| `thumbnails.css` | Reference CSS for showing the thumbnails on a page. |
| `inbox/`, `out/`, `assets/` | Images and posts in, thumbnails out, sample and reference images. Not in the repository. |
