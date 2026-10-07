# Blog thumbnails

Turns a blog post's **first image** into two grayscale thumbnails, one for the light theme and one for the dark theme: `<post name>-light.webp` and `<post name>-dark.webp` (716 × 396, lossless WebP). 

## Set up (once)

Install [Node.js](https://nodejs.org) 20.9 or later, then run `npm install` in this folder.


## Text-only thumbnails

The post's `TOCTitle` (the short title at the top of its `.md` file), as written:

| | |
|---|---|
| Font | The site's font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif`, the first one installed. Semibold, 30px, line height 34px, letter spacing −1% |
| Layout | Centred, at most 294px wide and 3 lines, in the 358 × 198 frame |
| Light theme | Text `#1b2022` on `#f4f5f6` |
| Dark theme | Text `#989fa4` on `#0b0c0d` |

A title longer than 3 lines is truncated: it's cut at a word so it fits in 3 lines, and the last line ends with "…".
