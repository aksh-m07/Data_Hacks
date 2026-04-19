import { useEffect, useRef, useState, type RefObject } from "react";
import type { PersonRoi } from "./usePersonDetection";

function estimateBpm(samples: number[], sampleRate: number): number | null {
  if (samples.length < 120) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const x = samples.map((s) => s - mean);
  let bestLag = 0;
  let best = -1;
  const minLag = Math.floor(sampleRate * 0.45);
  const maxLag = Math.floor(sampleRate * 1.2);
  for (let lag = minLag; lag < maxLag && lag < x.length / 2; lag++) {
    let c = 0;
    for (let i = lag; i < x.length; i++) c += x[i]! * x[i - lag]!;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;
  const bpm = (60 * sampleRate) / bestLag;
  if (bpm < 45 || bpm > 180) return null;
  return Math.round(bpm);
}

function clampRoi(
  roi: PersonRoi,
  cw: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(roi.x, cw - 8));
  const y = Math.max(0, Math.min(roi.y, ch - 8));
  const w = Math.max(8, Math.min(roi.w, cw - x));
  const h = Math.max(8, Math.min(roi.h, ch - y));
  return { x, y, w, h };
}

/**
 * Remote photoplethysmography from webcam green channel (non-medical estimate).
 * When `roiRef` is set (from person detection), samples the face region; otherwise center crop.
 */
export function useRppg(
  videoRef: RefObject<HTMLVideoElement | null>,
  roiRef?: RefObject<PersonRoi | null>,
) {
  const [bpm, setBpm] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("NO SIGNAL");
  const samples = useRef<number[]>([]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rate = 30;
    const iv = window.setInterval(() => {
      if (v.readyState < 2) return;
      canvas.width = v.videoWidth || 320;
      canvas.height = v.videoHeight || 240;
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.drawImage(v, 0, 0, cw, ch);

      let sx = Math.floor(cw / 2 - 32);
      let sy = Math.floor(ch / 2 - 32);
      let w = 64;
      let h = 64;
      const roi = roiRef?.current;
      if (roi) {
        const c = clampRoi(roi, cw, ch);
        sx = Math.floor(c.x);
        sy = Math.floor(c.y);
        w = Math.floor(c.w);
        h = Math.floor(c.h);
      }
      let d: ImageData;
      try {
        d = ctx.getImageData(sx, sy, w, h);
      } catch {
        return;
      }
      let rsum = 0;
      const n = d.width * d.height;
      for (let i = 0; i < d.data.length; i += 4) rsum += d.data[i]!;
      const rmean = rsum / n;
      samples.current.push(rmean);
      if (samples.current.length > 330) samples.current.shift();
      const b = estimateBpm(samples.current, rate);
      if (b) {
        setBpm(b);
        if (b < 60) setStatus("LOW");
        else if (b > 100) setStatus("ELEVATED");
        else setStatus("NORMAL");
      }
    }, 1000 / rate);
    return () => clearInterval(iv);
  }, [videoRef, roiRef]);

  return { bpm, status };
}
