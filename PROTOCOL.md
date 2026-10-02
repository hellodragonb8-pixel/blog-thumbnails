# Thumbnail protocol

The fixed rules `scripts/make-thumbnails.mjs` follows to turn a blog image into two homepage thumbnails, one for the light theme and one for the dark theme. `npm test` checks every sample image against them.

## What the script does

Every image goes through the same steps, in this order. Nothing else changes the image.

1. **Load the image as it looks.** For an animated image, the first frame. Transparent areas count as white. SVGs are rendered with their CSS variables and `color-mix()` replaced by plain colours, so they look as they do in a browser.
2. **Find the background.** The background is the image's most common grey. If that grey is darker than middle grey, the image is a dark image, such as an editor screenshot.
3. **Remove a frame.** A closed box drawn around all the content (a border around a chart, for example) is painted over with the background colour. Boxes inside the content are kept.
4. **Lay it out.**
   - Trim the image's own empty margins.
   - Scale the whole image to fit inside 294 × 134 (the 358 × 198 frame minus a 32px margin on every side), without cropping.
   - Centre it on the frame. It's exported at 2x: 716 × 396.

   So there's always at least 32px of space on every side, and exactly 32px on whichever axis the image fills.
5. **Change the colours, and only the colours.** Each pixel:
   - is desaturated to a grey. For diagrams, colourful pixels count as further from the background than a neutral grey of the same brightness, like Photoshop's Black & White adjustment. The amount is `CONFIG.tint`: 1 for diagrams, 0 for code and graphs. Without it, a pale blue card on a grey page has the page's grey and vanishes;
   - gets a contrast amount: how far its grey is from the background grey, from 0 (the background itself) to 1 (as far away as the image allows);
   - is given the colour for that amount from its category's ramp, for the theme.

   Every preset in `CONFIG.presets` (diagram, code and graph) is a ramp of seven hex colours per theme, placed at fixed contrast amounts:

   | Colour | At | Typically catches |
   |---|---|---|
   | background | 0 | the image background, which becomes the thumbnail background exactly |
   | faint | 0.04 | outlines, the palest fills, soft edges |
   | subtle | 0.098 (25/255) | the lightest marks drawn to be seen |
   | medium | 0.2 | pale boxes and panels, gridlines |
   | strong | 0.35 | darker boxes and fills |
   | text | 0.5 | grey text, connectors, lines |
   | ink | 0.75 and above | black text and solid marks |

   Greys between two stops get an even blend of the two colours. So the curve is smooth: the same grey always gets the same colour, a grey further from the background never gets less contrast, and there are no steps that would distort shading, soft edges or icons. After the first colour that differs from the background, each colour must have more contrast than the one before; equal colours would make a flat stretch where shading disappears.
6. **Bring faint images up to the minimum contrast.** The strongest marks are the strongest 1% of content pixels, where content means at least 10/255 away from the background. If they come out below the preset's `minContrast`, that image's contrast amounts are scaled up until they reach it. They never go past the ink colour. This still only changes colours: step 5's rules hold for the result.
7. **Save** `<name>-light` and `<name>-dark` (WebP by default).

## What the script doesn't do

It doesn't redraw, detect or repaint shapes, boxes, text or icons. The only step that moves pixels is the layout in step 4, and the only step that paints over pixels is the frame removal in step 3.

These options go beyond the protocol and are off unless you ask for them:

| Option | What it does |
|---|---|
| `--crop auto` | Crops an image so tall that it would fill less than 60% of the width, keeping the top. If Microsoft Foundry is set up, Claude then checks the crop (see README). |
| `--crop "left,top,width,height"` | Uses only that part of the image. |
| `--accent on` | Keeps blue in the original as the accent colour. |
| `--frames keep` | Skips step 3. |
| `--source light` / `--source dark` | Overrides step 2's dark-image detection. |

## The test

`npm test` runs every sample image in `assets/diagrams`, `assets/graphs` and `assets/code` the way the inbox does (automatic crop on). The same checks run on every image the inbox makes (`scripts/checks.mjs`), so READY means it passed all of them. For both themes of each image:

| Check | Passes when |
|---|---|
| Size | The output is 716 × 396. |
| Background | Everything outside the image is exactly the theme background. |
| Margins | At least 32px on every side, 32px on one axis, centred. |
| Not tiny | A tall image fills at least 60% of the width. If not, run it with `--crop auto` or a manual `--crop`. |
| Colour only | The same input grey always has the same output colour, and greys further from the background never have less contrast. This fails if anything blurs, smears or redraws the image. |
| Smooth | Two greys one level apart never get colours more than 12 levels apart. This fails if the colour curve has a step, which turns soft edges and icons into flat blocks. |
| On palette | Every output colour lies on the preset's ramp, between background and ink. |
| Visible | For presets with `minVisible` (graphs): every mark drawn to be seen (at least 25/255 from the background) keeps at least that contrast. It only checks; set the "subtle" colour to reach it. Presets without `minVisible` skip it. |
| Readable | The strongest marks reach the preset's `minContrast`, or the ink colour's own contrast if that's lower. |

It also checks every preset: after the first colour that differs from the background, each ramp colour must have more contrast than the one before.

To add a sample, drop the image in the matching folder.

## Known limits

These come from mapping greys to colours, and no setting can remove them:

- **Different colours with the same brightness become the same grey.** Green and grey boxes can merge, and so can coloured lines. For diagrams, the tint weight makes coloured boxes darker than neutral ones of the same brightness, but two colours that are equally colourful still merge.
- **A thin line and a pale fill of the same grey get the same colour.** The protocol only sees colours, not shapes. Each category's ramp decides how strong faint greys get: stronger for graphs, where they're lines and data, and softer for diagrams and code, where they're fills and highlights.
- **The lower the ink's contrast, the less room the ramp has.** A light Graph ink of 2.11:1 can't also give faint lines 1.75:1 without squeezing every grey in between into nearly one colour, so the light Graph `minVisible` is 1.3.
- **Light text on a darker box** (white text on a blue box, white labels on dark bars) stays lighter than its box. It can end up low in contrast, for example the pill labels in `evaluations`. The readability check measures the strongest marks against the background, so it doesn't catch this. Check these by eye, or use the HTML templates for bar charts.
- **Elements lighter than the page** (white cards on a light grey page) come out slightly darker than the page, so they stay visible.
- **A dark panel inside a light image** (a code block in a diagram) is mapped by the page's background, so its text is inverted.
