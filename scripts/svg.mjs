// Loading images for sharp, with a fix for SVGs.
//
// The SVG renderer behind sharp (librsvg) doesn't support CSS custom
// properties (var(--x)) or color-mix(). Diagrams exported from websites often
// use both, and then render mostly black. For SVGs, this replaces them with
// plain colours before rendering.

import { readFile } from "node:fs/promises";
import path from "node:path";

export function resolveSvgCss(svg) {
  const vars = {};
  for (const m of svg.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) vars[m[1]] = m[2].trim();
  let out = svg;
  for (let pass = 0; pass < 5; pass++) {
    out = out.replace(/var\((--[\w-]+)\)/g, (all, name) => vars[name] ?? all);
  }
  return out.replace(
    /color-mix\(in srgb,\s*(#[0-9a-fA-F]{6})\s+(\d+(?:\.\d+)?)%,\s*transparent\)/g,
    (all, c, p) => {
      const n = parseInt(c.slice(1), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number(p) / 100})`;
    },
  );
}

// What to pass to sharp(source, { density }) for an input file. SVGs are
// rendered at 4x (density 288) so they stay crisp after resizing.
export async function loadInput(file) {
  if (path.extname(file).toLowerCase() !== ".svg") return { source: file, density: undefined };
  return { source: Buffer.from(resolveSvgCss(await readFile(file, "utf8"))), density: 288 };
}
