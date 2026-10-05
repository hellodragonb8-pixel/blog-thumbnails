# Blog thumbnails

Turns an image (a diagram, a graph or a code screenshot) into two grayscale thumbnails: one for the light theme and one for the dark theme.

A post without an image gets a title card instead: its short title (`TOCTitle`).  Its rules are in [PROTOCOL.md](PROTOCOL.md#title-cards).

## Quick start

Needs [Node.js](https://nodejs.org) 20.9 or later. Title cards also need the SF Pro font installed (on Windows, for all users).

```sh
npm install
```

Put each image in `inbox/diagram`, `inbox/graph` or `inbox/code`, and the `.md` file of each post without an image in `inbox/text`, then run:

```sh
npm run thumbs
```



