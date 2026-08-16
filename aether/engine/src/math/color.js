/**
 * Colors.
 *
 * Runtime representation is `{ r, g, b, a }` with each channel in 0..1.
 * Scene files may write `"#rrggbb"`, `"#rrggbbaa"`, `[r, g, b]`, `[r, g, b, a]`
 * or a named color; `fromAny` accepts all of them so authors (human or agent)
 * never have to remember which one a given field wants.
 *
 * @typedef {{ r: number, g: number, b: number, a: number }} Color
 */

export function color(r = 1, g = 1, b = 1, a = 1) {
  return { r, g, b, a };
}

export function clone(c) {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

export function copy(out, c) {
  out.r = c.r;
  out.g = c.g;
  out.b = c.b;
  out.a = c.a;
  return out;
}

export function set(out, r, g, b, a = 1) {
  out.r = r;
  out.g = g;
  out.b = b;
  out.a = a;
  return out;
}

/** Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, with or without the `#`. */
export function fromHex(hex, out = color()) {
  let s = String(hex).trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3 || s.length === 4) {
    s = s.split('').map((ch) => ch + ch).join('');
  }
  // Check the characters, not just the length: `parseInt` happily returns NaN
  // for "#xyz", which would otherwise produce a color with NaN channels and a
  // sprite that silently fails to draw.
  if ((s.length !== 6 && s.length !== 8) || !/^[0-9a-fA-F]+$/.test(s)) {
    throw new Error(`Invalid hex color: "${hex}" (expected #rgb, #rgba, #rrggbb or #rrggbbaa)`);
  }
  out.r = parseInt(s.slice(0, 2), 16) / 255;
  out.g = parseInt(s.slice(2, 4), 16) / 255;
  out.b = parseInt(s.slice(4, 6), 16) / 255;
  out.a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return out;
}

export function toHex(c, includeAlpha = false) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const base = `#${to255(c.r)}${to255(c.g)}${to255(c.b)}`;
  return includeAlpha ? base + to255(c.a) : base;
}

/** The `rgba()` string Canvas2D wants. */
export function toCSS(c) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${c.a})`;
}

/** Pack into a single 0xRRGGBBAA integer, for renderer vertex attributes. */
export function toUint32(c) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return ((to255(c.r) << 24) | (to255(c.g) << 16) | (to255(c.b) << 8) | to255(c.a)) >>> 0;
}

/**
 * @param {number} h hue in degrees, 0..360
 * @param {number} s saturation 0..1
 * @param {number} l lightness 0..1
 */
export function fromHSL(h, s, l, a = 1, out = color()) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return set(out, r + m, g + m, b + m, a);
}

export function toHSL(c) {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l, a: c.a };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === c.r) h = 60 * (((c.g - c.b) / d) % 6);
  else if (max === c.g) h = 60 * ((c.b - c.r) / d + 2);
  else h = 60 * ((c.r - c.g) / d + 4);
  return { h: ((h % 360) + 360) % 360, s, l, a: c.a };
}

export function lerp(a, b, t, out = color()) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  out.a = a.a + (b.a - a.a) * t;
  return out;
}

/** Component-wise multiply — how sprite tints are applied. */
export function multiply(a, b, out = color()) {
  out.r = a.r * b.r;
  out.g = a.g * b.g;
  out.b = a.b * b.b;
  out.a = a.a * b.a;
  return out;
}

export function withAlpha(c, a, out = color()) {
  out.r = c.r;
  out.g = c.g;
  out.b = c.b;
  out.a = a;
  return out;
}

export function equals(a, b, epsilon = 1e-6) {
  return (
    Math.abs(a.r - b.r) <= epsilon &&
    Math.abs(a.g - b.g) <= epsilon &&
    Math.abs(a.b - b.b) <= epsilon &&
    Math.abs(a.a - b.a) <= epsilon
  );
}

export const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 1, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  orange: [1, 0.5, 0, 1],
  purple: [0.5, 0, 0.5, 1],
  gray: [0.5, 0.5, 0.5, 1],
  grey: [0.5, 0.5, 0.5, 1],
  darkGray: [0.25, 0.25, 0.25, 1],
  lightGray: [0.75, 0.75, 0.75, 1],
};

/** The permissive parser used by the scene loader. */
export function fromAny(value, out = color()) {
  if (value == null) return set(out, 1, 1, 1, 1);
  if (typeof value === 'string') {
    const named = NAMED[value];
    if (named) return set(out, named[0], named[1], named[2], named[3]);
    return fromHex(value, out);
  }
  if (Array.isArray(value)) {
    return set(out, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1);
  }
  return set(out, value.r ?? 0, value.g ?? 0, value.b ?? 0, value.a ?? 1);
}

export const WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
export const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
export const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
