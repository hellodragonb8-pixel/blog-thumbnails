# Making homepage thumbnails for a blog post

Each blog post on the homepage needs two thumbnails: one for the light theme and one for the dark theme. A script makes both, from the post's image, or for a post without an image, from its title. You put the image (or the post's file) in a folder and run one command.

## Once: set up

1. Open a terminal in this project folder.
   - **Windows:** open the folder in File Explorer, right-click an empty area and choose **Open in Terminal**.
   - **Mac:** open Terminal, type `cd ` (with a space) and drag the folder into the window, then press Return.
2. Run:

   ```
   npm install
   ```

   This takes a minute. You only need to do it once.
3. For posts without an image, the computer also needs the **SF Pro** font installed. On Windows, install it for all users (right-click the font file, **Install for all users**). Ask the design team for it.

## For each post

### 1. Put the image in the right folder

The author tells you which kind of image it is. Put the file in the matching folder inside `inbox`. For a post without an image, put the post's `.md` file in `inbox/text`:

| Folder | Kind of image | Examples |
|---|---|---|
| `inbox/diagram` | Boxes, arrows, flows, architecture drawings | "Agent = Model + Harness", a process flow |
| `inbox/graph` | Charts with data | bar charts, line charts, scatter plots |
| `inbox/code` | Screenshots of code or an editor | a code snippet from VS Code |
| `inbox/text` | A post without an image: its `.md` file, the one with the `TOCTitle` line at the top | `agent-host-architecture.md` |

For a post without an image, the thumbnail shows the post's `TOCTitle`, the short title the blog archive lists. If it's too long for the thumbnail (more than 3 lines), the result is `NEEDS A LOOK`: ask the author for a shorter `TOCTitle`.

- **File names:** the file name becomes the thumbnail's name, so name the image after the post, for example `copilot-inline-suggestions.png`. A post's `.md` file already has the post's name.
- **Formats:** PNG, JPG, WebP, GIF, AVIF, TIFF and SVG all work. For animated images, the first frame is used.
- **Several images at once:** you can put images for several posts in the inbox; they're all made in one go.

### 2. Run the command

```
npm run thumbs
```

You get one line per image:

| Result | What it means | What to do |
|---|---|---|
| `READY` | Both thumbnails were made and passed every check. | Go to step 3. |
| `NEEDS A LOOK` | Both thumbnails were made, but a check found something, explained on the next line. Usually some text or lines may be hard to read, or two colours in a chart came out as the same grey. | Open `out/preview.html` and look at that image. The next line says what to look for. If it's hard to read, ask the design team. |
| `FAILED` | No thumbnails were made. The next line says why, for example a file that isn't an image, or two images with the same name. | Fix what it says and run the command again. |

### 3. Check them and upload

1. Open `out/preview.html` in a browser. It shows every image next to its two thumbnails.
2. Upload the two files for each image from the `out` folder: `<name>-light.webp` and `<name>-dark.webp`.
3. Add them to the post's card on the homepage the usual way. The website shows the right one for the reader's theme.

### 4. Empty the inbox

When the thumbnails are uploaded, delete the images from the `inbox` folders. Every run makes thumbnails for everything in the inbox, and starts the `out` folder fresh.

## If something goes wrong

| Problem | Fix |
|---|---|
| `npm` isn't recognised | Node.js isn't installed, or the terminal was opened before it was. Install Node.js, then open a new terminal. |
| `Cannot find package 'sharp'` | Run `npm install` in this folder. |
| "The inbox is empty" | The images aren't in `inbox/diagram`, `inbox/graph` or `inbox/code`, or the posts' `.md` files aren't in `inbox/text`. Check the folder names. |
| "The title font (SF Pro Display Semibold) isn't installed" | Install SF Pro (on Windows, for all users), then run the command again. |
| The thumbnail looks wrong | Ask the design team, and send them the image and the line the command printed for it. |

You don't need to change anything else in this folder. The colours, sizes and margins are set by the design team.
