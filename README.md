# Blog thumbnails

Plain HTML/CSS thumbnails that reproduce the Figma blog thumbnails (homepage-redesign, node 890-1097) in light and dark mode.

- `thumbnails.css`: the component. Colours are tokens at the top of the file.
- `index.html`: demo grid with one card per type, plus the image fallback.
- `compare.html`: each Figma export next to the CSS version, with the remaining differences.

The Figma thumbnails were redrawn, not filtered: labels move, fonts change, frames disappear. So each thumbnail is built from the post's content, not from a screenshot. Everything is laid out on the Figma frame (358 × 198) and scales with the card like an image.

## Adding a post card

Copy this shell and put one of the thumbnails below inside it:

```html
<li class="post-card">
  <a class="post-card__link" href="/blog/my-post">
    <!-- thumbnail goes here -->
    <h3 class="post-card__title">My post title</h3>
  </a>
  <p class="post-card__meta">September 29, 2026</p>
</li>
```

Content-built thumbnails get `aria-hidden="true"`, because the card title already describes the link.

### Title only (no image)

```html
<div class="thumb" data-type="title" aria-hidden="true">
  <div class="thumb__body"><p class="thumb__title">My post title</p></div>
</div>
```

### Code snippet

Paste the lines as text, one `<li>` per line. Escape `<` as `&lt;` and `&` as `&amp;`.

```html
<div class="thumb" data-type="code" aria-hidden="true">
  <div class="thumb__body">
    <p class="thumb__title">My post title</p>
    <ol class="thumb__code" style="--first-line: 6">  <!-- number of the first line -->
      <li></li>
      <li data-mark>const a = 1;</li>                  <!-- adds the ↳| marker -->
      <li data-ghost>const suggestion = 2;</li>        <!-- unnumbered suggestion line -->
    </ol>
  </div>
</div>
```

### Bar chart

One `<li>` per bar. `--v` is the bar length from 0 to 1. Add `data-highlight` to the bar the post compares against. You can use one chart or two.

```html
<div class="thumb" data-type="chart" aria-hidden="true">
  <div class="thumb__charts">
    <figure class="thumb__chart">
      <ol class="thumb__bars">
        <li style="--v: .84"><span>Model A</span><span>-3%</span></li>
        <li style="--v: .87" data-highlight><span>Our model</span></li>
      </ol>
      <figcaption class="thumb__axis"><span>0%</span><span>Code survival rate</span><span>100%</span></figcaption>
    </figure>
  </div>
</div>
```

### Diagram

Paste the post's SVG inline, not as `<img>`, so the CSS can re-colour it:

```html
<div class="thumb" data-type="diagram" aria-hidden="true">
  <svg viewBox="…">…</svg>
</div>
```

This works automatically for diagrams built on the same template as the sample diagram in `index.html`. That means they define the `--diagram-*` variables and use the classes `surface`, `card`, `client-card`, `host-shell`, `connector`, `section-label`, `component-label`, `protocol-label` and `endpoint-icon`. The diagram keeps its own layout. For any other diagram, use the image fallback.

An inline SVG's `<style>` applies to the whole page. Don't reuse those class names elsewhere on the page.

### Pre-rendered image

For an author's image (PNG, JPG, WebP or SVG), make a light and a dark thumbnail with sharp.

**Uploading posts:** put the image in `inbox/diagram`, `inbox/graph` or `inbox/code` and run `npm run thumbs`. Both thumbnails for every image in the inbox go to `out/`, each image is checked against the protocol, and the command prints READY, NEEDS A LOOK or FAILED for each one. Step-by-step instructions for whoever uploads the posts are in [HOW-TO-THUMBNAILS.md](HOW-TO-THUMBNAILS.md).

**One image with options** (for the design team):

```sh
npm install
npm run thumbs -- --type graph path/to/post-image.png
```

`--type` picks the category preset: `diagram`, `code` or `graph`. (Title-only posts use the HTML title template, not an image.)

This writes `post-image-light.webp` and `post-image-dark.webp` (716 × 396) to `assets/thumbs/`. The script follows a fixed protocol, described in [PROTOCOL.md](PROTOCOL.md):

- it removes a frame drawn around the content, trims empty margins and fits the whole image inside a 32px margin;
- it desaturates the image and maps each grey to the category preset's colours, the same way for every pixel, so shapes are never changed;
- it brings faint images up to the preset's minimum contrast.

`npm test` checks every sample image against the protocol. Run it after changing a preset or the script, and add new sample images to its list (see PROTOCOL.md).

It also updates `assets/thumbs/preview.html`, which shows every thumbnail in that folder in both themes, with optional margin guides.

### Tall images

A very tall image (a long list or chart) ends up tiny when it's fitted whole, and the test flags it. Run it with `--crop auto` to keep its top at full width; the cut lands in a gap between rows. The threshold is `autoCropBelow.tall` in the script (0.6: crop if the whole image would fill less than 60% of the width). Wide images aren't cropped.

After an automatic crop, the script can ask Claude (vision, `claude-opus-5` through Microsoft Foundry) to check it: it sees the original with the kept part outlined and the finished thumbnail, and answers pass or fail. On a fail, Claude suggests a better crop and the script redoes that image with it; the output shows the verdict, the reason and the crop used. Each check costs a few cents.

Set up Foundry once per terminal session (PowerShell):

```powershell
$env:ANTHROPIC_FOUNDRY_RESOURCE = "your-resource-name"   # from https://<name>.services.ai.azure.com
$env:ANTHROPIC_FOUNDRY_API_KEY = "your-key"
```

Without these, the check is skipped and the automatic crop is kept. `--review off` turns it off for a run. The deployment names (`claude-opus-5`, with `claude-opus-4-8` as the fallback if it declines) are at the top of `scripts/review-crop.mjs`.

To choose the part yourself, use `--crop "left,top,width,height"` (like Photoshop's X, Y, W, H), in pixels or percentages of the original. A height of `auto` fills the thumbnail at that width: `--crop "30%,0,70%,auto"` keeps the right 70% from the top. Keep the quotes, and for SVGs use percentages.

### Presets

The presets and the margin are settings at the top of `scripts/make-thumbnails.mjs`. To tune a preset, open `assets/thumbs/tuner.html`: pick a category and its settings apply live to every image in it, next to the Figma exports, and it gives you the preset to paste back into the script. The `tuning/` folder, `manifest.json` and the two HTML pages are working files and don't need to be deployed. Options: `--accent on` keeps blue as the accent colour, `--frames keep` leaves frames in, `--source dark` forces a dark image (such as an editor screenshot) to be flipped if it isn't detected.

The files already include the margin, so they fill the thumbnail with no extra inset:

```html
<div class="thumb" data-type="rendered" aria-hidden="true">
  <img class="thumb__img--light" src="assets/thumbs/post-image-light.webp" alt="" loading="lazy">
  <img class="thumb__img--dark" src="assets/thumbs/post-image-dark.webp" alt="" loading="lazy">
</div>
```

### Image fallback (last resort)

Only for images none of the templates can rebuild. A colour filter can't move or resize the text in an image, and it can't make dark bars light while keeping their white text dark. Use the bar chart template for bar charts. It works well for line charts and other line art.

```html
<div class="thumb" data-type="image" data-fit="contain" data-source="light" style="--focus: 50% 30%">
  <img src="post-image.png" alt="Describe the image" loading="lazy">
</div>
```

This re-colours the image into two tones from the thumbnail palette, flipping them for dark mode:

| Part of the image | Light | Dark |
|---|---|---|
| Background | `#f4f5f6` | `#0b0c0d` |
| Everything drawn on it: lines, markers, text, axes | `#a9afb3` | `#62686c` |

There's no accent colour, because brightness alone can't tell which part of an image deserves it.

Every fallback image sits inside the same margin on all four sides (`--thumb-image-inset`, 20px on the 358px Figma frame). Coloured series (for example three coloured lines) all become the same grey, so markers and labels have to tell them apart.

- `data-source="dark"`: set this for dark images such as editor screenshots, so they are inverted before mapping.
- `data-fit="contain"`: shows the whole image inside the margin. Leave it out to fill the margin box.
- `--focus`: the focal point for the crop, as `object-position` values. Only used without `contain`.

**One-time setup per page:** the colour map is an SVG filter. Paste the contents of `thumb-filters.html` once, right after `<body>`. The two tones are variables at the top of `thumbnails.css` (`--thumb-map-*`).

## Guidance for post authors: charts

The thumbnail can only restyle a chart if it gets the chart's parts, not a picture of it. Images (PNG, JPG, WebP) are flat pixels. A colour filter can lighten or darken them, but it can't make white text on black bars into dark text on light bars, or move text.

When a post has a chart, ask the author for one of these, in order of preference:

1. **An SVG export of the chart.** In Excel or PowerPoint: right-click the chart → **Save as Picture** → **SVG**. In Python: `plt.savefig("chart.svg")`. With an SVG, CSS can style the bars and text directly, so the thumbnail matches the design automatically.
2. **The numbers behind the chart**, so the bar chart template can be filled in: each bar's label, value, change, and which bar to highlight.
3. **Only a picture**: use the image fallback. It works well for line charts and line art. Bar charts with white text on dark bars can't be fixed this way; use option 2 instead.

Example: the chart in the MAI-Code-1-Flash post (July 29, 2026) is only published as WebP and PNG, so its thumbnail uses the bar chart template with values read from the image.

## Fonts

The Figma design uses **SF Pro** and **Geist Mono**. Load Geist Mono in the page `<head>`, before `thumbnails.css`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300..600&display=swap">
```

SF Pro can't be served from a website (Apple's licence), so Apple devices use it and everything else falls back to the system UI font.

## Theme

Thumbnails follow the OS setting. `data-theme="light"` or `data-theme="dark"` on `<html>`, or on any element around the thumbnails, overrides it.

## Browser support

The CSS uses container query units, `light-dark()` and `min-width: max-content`. All current evergreen browsers support these (Chrome/Edge 123+, Safari 17.5+, Firefox 120+).
