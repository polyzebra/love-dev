"use client";

import { useEffect, useState } from "react";

export type RGB = [number, number, number];

const cache = new Map<string, RGB | null>();

/**
 * Samples the dominant colour of an image by averaging a 12×12
 * downsample, then lifts saturation so the tone works as ambient light.
 * Returns null (caller falls back) on CORS failure or until loaded.
 */
export function useDominantColor(url: string | null | undefined): RGB | null {
  const [color, setColor] = useState<RGB | null>(url ? (cache.get(url) ?? null) : null);

  useEffect(() => {
    if (!url) {
      setColor(null);
      return;
    }
    if (cache.has(url)) {
      setColor(cache.get(url)!);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    img.onload = () => {
      try {
        const size = 12;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let i = 0; i < data.length; i += 4) {
          // skip near-black/near-white pixels — they wash the tone out
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (lum < 24 || lum > 235) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
        if (n === 0) return;
        const avg: RGB = [r / n, g / n, b / n];
        const lifted = liftForAmbient(avg);
        cache.set(url, lifted);
        if (!cancelled) setColor(lifted);
      } catch {
        cache.set(url, null); // tainted canvas (CORS) — fall back silently
        if (!cancelled) setColor(null);
      }
    };
    img.onerror = () => {
      cache.set(url, null);
      if (!cancelled) setColor(null);
    };
    return () => {
      cancelled = true;
    };
  }, [url]);

  return color;
}

/** Push the tone toward a saturated mid-lightness so it glows on black. */
function liftForAmbient([r, g, b]: RGB): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.max(0.45, Math.min(0.85, s * 1.4)), Math.max(0.38, Math.min(0.52, l)));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
