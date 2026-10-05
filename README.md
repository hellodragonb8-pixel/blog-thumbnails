# Blog thumbnails

Turns an image (a diagram, a graph or a code screenshot) into two grayscale thumbnails: one for the light theme and one for the dark theme. A post without an image gets a text-only thumbnail with its title.

## Set up (once)

Install [Node.js](https://nodejs.org) 20.9 or later, then run `npm install` in this folder. For text-only thumbnails, also install the **SF Pro** font (on Windows, for all users).

## Make thumbnails

1. Put each file in its folder in `inbox`, named after its post:

   | Folder | What goes in it |
   |---|---|
   | `inbox/diagram` | Boxes, arrows, flows, architecture drawings |
   | `inbox/graph` | Charts with data |
   | `inbox/code` | Screenshots of code or an editor |
   | `inbox/text` | For a post without an image: the post's `.md` file |

2. Run `npm run thumbs`. Each file gets **READY**, **NEEDS A LOOK** (check it in `out/preview.html`; the next line says what to look for) or **FAILED** (fix what it says and run again).
3. Upload `<name>-light.webp` and `<name>-dark.webp` from `out`.
4. Empty the inbox: every run remakes everything in it.

## Text-only thumbnails

The post's `TOCTitle` (the short title at the top of its `.md` file), as written:

| | |
|---|---|
| Font | SF Pro Display Semibold, 30px, line height 34px, letter spacing −1% |
| Layout | Centred, at most 294px wide and 3 lines, in the 358 × 198 frame |
| Light theme | Text `#1b2022` on `#f4f5f6` |
| Dark theme | Text `#989fa4` on `#0b0c0d` |

A title longer than 3 lines comes out NEEDS A LOOK: ask the author for a shorter `TOCTitle`.
