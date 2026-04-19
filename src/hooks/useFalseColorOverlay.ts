import { useEffect, type RefObject } from "react";

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

/** Maps luminance to a color ramp (real image processing — not thermal hardware). */
function lumaFalseColor(r: number, g: number, b: number): [number, number, number] {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const t = Math.max(0, Math.min(1, Y / 255));
  const hue = (1 - t) * 260;
  return hsvToRgb(hue, 0.82, 0.92);
}

/**
 * Draws a false-color view from the live video (helps visibility; not a real thermal camera).
 */
export function useFalseColorOverlay(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    const fps = 12;
    const frameMs = 1000 / fps;

    const draw = (t: number) => {
      if (t - last < frameMs) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = t;
      if (v.readyState < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 480;
      c.width = w;
      c.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const [R, G, B] = lumaFalseColor(d[i]!, d[i + 1]!, d[i + 2]!);
        d[i] = R;
        d[i + 1] = G;
        d[i + 2] = B;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [enabled, videoRef, canvasRef]);
}
