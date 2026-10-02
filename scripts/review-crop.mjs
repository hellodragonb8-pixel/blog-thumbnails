// Optional AI check of automatic crops, using Claude's vision.
//
// After make-thumbnails.mjs crops an image automatically, this sends Claude
// the original (with a 10% grid and the kept part outlined in red) and the
// finished thumbnail, and asks whether the crop keeps the part that matters.
// Claude answers pass or fail; on fail it suggests a better crop, as
// percentages of the original, which the script then uses instead.
//
// Claude is reached through Microsoft Foundry. Set two environment variables:
//   ANTHROPIC_FOUNDRY_RESOURCE  your Foundry resource name (the <resource> in
//                               https://<resource>.services.ai.azure.com)
//   ANTHROPIC_FOUNDRY_API_KEY   a key for that resource
// Without them the check is skipped.

import { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import sharp from "sharp";

// Foundry deployment names. By default a deployment is named after its model;
// change these if your team named them differently.
const MODEL = "claude-opus-5";
// If MODEL declines to answer (a safety refusal), this deployment answers instead.
const FALLBACK_MODEL = "claude-opus-4-8";

const MAX_SIDE = 1568; // larger images are downscaled by the API anyway

// Thrown when Foundry isn't set up, so the caller can say what's missing.
export class SetupError extends Error {}

function foundryClient() {
  const missing = ["ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_FOUNDRY_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length) throw new SetupError(`set ${missing.join(" and ")}`);
  return new AnthropicFoundry({
    middleware: [betaRefusalFallbackMiddleware([{ model: FALLBACK_MODEL }])],
  });
}

const Review = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string(),
  // Only on fail: the better crop, in percentages of the original image.
  crop: z
    .object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});

// The original as PNG with a 10% grid and the kept region outlined in red.
export async function annotatedOriginal(input, density, region, size) {
  const image = await sharp(input, { density })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = image.info;
  const sx = w / size.width, sy = h / size.height;

  const fontSize = Math.max(12, Math.round(Math.max(w, h) / 70));
  const lines = [];
  for (let p = 10; p < 100; p += 10) {
    const x = (p / 100) * w, y = (p / 100) * h;
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${h}" />`,
      `<line x1="0" y1="${y}" x2="${w}" y2="${y}" />`,
      `<text x="${x + 3}" y="${fontSize}" stroke="none">${p}%</text>`,
      `<text x="3" y="${y - 3}" stroke="none">${p}%</text>`,
    );
  }
  const box = {
    x: region.left * sx,
    y: region.top * sy,
    w: (region.right - region.left + 1) * sx,
    h: (region.bottom - region.top + 1) * sy,
  };
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <g stroke="#00a0ff" stroke-opacity="0.45" stroke-dasharray="4 4" fill="#0070c0" font-family="sans-serif" font-weight="bold" font-size="${fontSize}">${lines.join("")}</g>
    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="#ff0000" stroke-width="3" />
  </svg>`;

  return sharp(image.data).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
}

const pct = (v) => Math.round(v * 1000) / 10;

// Returns { verdict, reason, crop } where crop (fail only) is in % of the original.
export async function reviewCrop({ input, density, region, size, thumbnailFile, direction, shape }) {
  const original = await annotatedOriginal(input, density, region, size);
  const thumbnail = await sharp(thumbnailFile).png().toBuffer();
  const kept = {
    left: pct(region.left / size.width),
    top: pct(region.top / size.height),
    width: pct((region.right - region.left + 1) / size.width),
    height: pct((region.bottom - region.top + 1) / size.height),
  };

  const prompt = `You are checking a crop for a blog thumbnail.

The homepage shows each blog post's image as a small, wide thumbnail (the content area is about ${shape.toFixed(1)}:1, width to height). This image is much ${direction}er than that, so showing it whole would make it tiny. The script cropped it automatically, keeping the ${direction === "tall" ? "top" : "left"} part.

Image 1: the full original. The grid lines are at every 10% of its width and height. The red box is the part that was kept: left ${kept.left}%, top ${kept.top}%, width ${kept.width}%, height ${kept.height}%. The original is ${size.width} x ${size.height} px.
Image 2: the finished thumbnail (colours are restyled on purpose; judge only what is included).

Pass if the kept part shows what a reader would most want to see from this image at a glance - its main takeaway, such as the title, the headline result, or the key bars or lines - and doesn't cut through text or important marks in an awkward way.

Fail if a clearly more important part was left out, or the cut is awkward. Then give a better crop as percentages of the original: left, top, width, height. Make its shape close to ${shape.toFixed(1)}:1 in pixels (convert using the original's pixel size), keep it inside the image, and prefer the edges of the content over cutting through it. On pass, set crop to null.

Keep the reason to one sentence.`;

  const client = foundryClient();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: betaZodOutputFormat(Review) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: original.toString("base64") } },
          { type: "image", source: { type: "base64", media_type: "image/png", data: thumbnail.toString("base64") } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to review this image");
  const review = response.parsed_output;
  if (!review) throw new Error(`no usable answer (stop reason: ${response.stop_reason})`);

  // Keep a suggested crop inside the image.
  if (review.crop) {
    const c = review.crop;
    const left = Math.min(95, Math.max(0, c.left));
    const top = Math.min(95, Math.max(0, c.top));
    review.crop = {
      left,
      top,
      width: Math.min(100 - left, Math.max(5, c.width)),
      height: Math.min(100 - top, Math.max(5, c.height)),
    };
  }
  return review;
}
