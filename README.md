# Blog thumbnails

Turns a blog post's image into two grayscale thumbnails, one for the light theme and one for the dark theme: `<name>-light.webp` and `<name>-dark.webp` (716 × 396, lossless WebP). A post without an image gets a text-only thumbnail with its title instead.

## Set up (once)

Install [Node.js](https://nodejs.org) 20.9 or later, then run `npm install` in this folder.

## Use it in a build

```js
import { makeThumbnails, DEFAULT_OPTIONS } from "./scripts/make-thumbnails.mjs";

// file: the post's image, or the post's .md file for a post without an image
// alt:  the image's alt text from the post (optional, helps tell charts from diagrams)
// type: "code", "diagram" or "graph"/"chart" to skip the detection (optional)
const { entry, checks } = await makeThumbnails(file, { ...DEFAULT_OPTIONS, out: "path/to/output", alt, type });
// entry.files.light and entry.files.dark: the two files written to `out`
// entry.type: "code", "diagram", "graph" or "text"; entry.decidedBy: "type", "alt text" or "detected"
// checks with ok: false are worth a warning in the build log; the files are still made
```

Or from the command line: `npm run thumbs -- <image or post .md> [more...] --out <folder> [--alt "<alt text>"] [--type chart]`.

## Text-only thumbnails

The post's `TOCTitle` (the short title at the top of its `.md` file), as written:

| | |
|---|---|
| Font | The site's font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`, the first one installed. Semibold, 30px, line height 34px, letter spacing −1% |
| Layout | Centred, at most 294px wide and 3 lines, in the 358 × 198 frame |
| Light theme | Text `#1b2022` on `#f4f5f6` |
| Dark theme | Text `#989fa4` on `#0b0c0d` |

A title longer than 3 lines needs to be truncated.
