/**
 * Estimates breathing rate from periodic pixel motion in an upper-chest ROI.
 * Works by tracking mean luminance of the chest region across frames;
 * periodic fluctuations (~12–20 breaths/min = 0.2–0.33 Hz) indicate breathing.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PersonRoi } from "./usePersonDetection";

const SAMPLE_RATE_HZ = 10;
const WINDOW_SECS = 15;
const WINDOW_SIZE = SAMPLE_RATE_HZ * WINDOW_SECS;

function autocorrBreathBpm(samples: number[]): number | null {
  if (samples.length < WINDOW_SIZE * 0.6) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const x = samples.map((s) => s - mean);
  // Breathing: 0.15–0.5 Hz → lag at sample_rate/freq
  const minLag = Math.floor(SAMPLE_RATE_HZ / 0.5); // 20 frames for 0.5Hz
  const maxLag = Math.floor(SAMPLE_RATE_HZ / 0.15); // 66 frames for 0.15Hz
  let bestLag = 0;
  let bestCorr = -1;
  for (let lag = minLag; lag <= Math.min(maxLag, x.length / 2); lag++) {
    let c = 0;
    for (let i = lag; i < x.length; i++) c += x[i]! * x[i - lag]!;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || bestCorr <= 0) return null;
  const bpm = (60 * SAMPLE_RATE_HZ) / bestLag;
  if (bpm < 8 || bpm > 40) return null;
  return Math.round(bpm);
}

export type BreathingResult = {
  bpm: number | null;
  active: boolean;
};

export function useBreathing(
  videoRef: RefObject<HTMLVideoElement | null>,
  personRoiRef?: RefObject<PersonRoi | null>,
): BreathingResult {
  const [bpm, setBpm] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const samples = useRef<number[]>([]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    setActive(true);
    const iv = window.setInterval(() => {
      if (v.readyState < 2) return;
      const cw = v.videoWidth || 320;
      const ch = v.videoHeight || 240;
      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(v, 0, 0, cw, ch);

      // Use upper-third of bounding box (chest) or centre strip
      const roi = personRoiRef?.current;
      let sx: number, sy: number, sw: number, sh: number;
      if (roi) {
        // Chest = mid-third of the bounding box
        sx = Math.max(0, Math.round(roi.x + roi.w * 0.2));
        sy = Math.max(0, Math.round(roi.y + roi.h * 0.3));
        sw = Math.min(Math.round(roi.w * 0.6), cw - sx);
        sh = Math.min(Math.round(roi.h * 0.25), ch - sy);
      } else {
        sx = Math.round(cw * 0.3);
        sy = Math.round(ch * 0.3);
        sw = Math.round(cw * 0.4);
        sh = Math.round(ch * 0.2);
      }

      sw = Math.max(4, sw);
      sh = Math.max(4, sh);

      let d: ImageData;
      try {
        d = ctx.getImageData(sx, sy, sw, sh);
      } catch {
        return;
      }
      let lsum = 0;
      const n = d.width * d.height;
      for (let i = 0; i < d.data.length; i += 4) {
        lsum += 0.299 * d.data[i]! + 0.587 * d.data[i + 1]! + 0.114 * d.data[i + 2]!;
      }
      samples.current.push(lsum / n);
      if (samples.current.length > WINDOW_SIZE) samples.current.shift();

      if (samples.current.length >= Math.round(WINDOW_SIZE * 0.4)) {
        const result = autocorrBreathBpm(samples.current);
        setBpm(result);
      }
    }, 1000 / SAMPLE_RATE_HZ);

    return () => {
      clearInterval(iv);
      setActive(false);
      samples.current = [];
    };
  }, [videoRef, personRoiRef]);

  return { bpm, active };
}
