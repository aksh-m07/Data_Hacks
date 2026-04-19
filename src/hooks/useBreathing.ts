/**
 * Breathing estimate from webcam motion (non-medical).
 * Uses two signals and fuses them:
 * 1) upper-torso/chest motion
 * 2) lower-face motion proxy (nose/mouth area inside person box)
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PersonRoi } from "./usePersonDetection";

const SAMPLE_RATE_HZ = 12;
const WINDOW_SECS = 22;
const WINDOW_SIZE = SAMPLE_RATE_HZ * WINDOW_SECS;
const MIN_BPM = 8;
const MAX_BPM = 30;
const TREND_MAX = 90;

/** Display smoothing — not medical tuning; reduces UI jitter from noisy motion. */
const EMA_ALPHA = 0.2;
const MAX_BPM_STEP = 5;
const DISPLAY_MEDIAN_LEN = 5;
const FUSE_AGREE_MAX_SPREAD = 5;

type Estimate = { bpm: number | null; confidence: number };
type Rect = { x: number; y: number; w: number; h: number };

/** Single joint for canvas overlay (MoveNet — video pixel space). */
export type PoseKeypointLite = { x: number; y: number; name?: string; score?: number };

/** MoveNet chest + face-mesh nose/mouth ROIs from useBreathingLandmarks; optional. */
export type BreathingGeometry = {
  chest: Rect | null;
  nose: Rect | null;
  mouth: Rect | null;
  /** Populated when pose is found — used to draw skeleton on the webcam overlay. */
  poseKeypoints?: PoseKeypointLite[] | null;
};

function movingAverage(values: number[], size: number): number[] {
  if (values.length === 0 || size <= 1) return values.slice();
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i]!;
    if (i >= size) acc -= values[i - size]!;
    out.push(acc / Math.min(i + 1, size));
  }
  return out;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let varAcc = 0;
  for (const v of values) varAcc += (v - mean) * (v - mean);
  return Math.sqrt(varAcc / (values.length - 1));
}

function preprocessMotion(samples: number[]): number[] {
  const smooth = movingAverage(samples, 5);
  const slow = movingAverage(smooth, 22);
  const band = smooth.map((v, i) => v - slow[i]!);
  const s = stdDev(band);
  if (s < 1e-4) return [];
  return band.map((v) => v / s);
}

function estimateBreathBpmFromMotion(samples: number[]): Estimate {
  if (samples.length < WINDOW_SIZE * 0.55) return { bpm: null, confidence: 0 };
  const x = preprocessMotion(samples);
  if (x.length < WINDOW_SIZE * 0.55) return { bpm: null, confidence: 0 };

  const minLag = Math.floor((60 * SAMPLE_RATE_HZ) / MAX_BPM);
  const maxLag = Math.floor((60 * SAMPLE_RATE_HZ) / MIN_BPM);
  let bestLag = 0;
  let bestCorr = -1;
  let secondCorr = -1;

  for (let lag = minLag; lag <= Math.min(maxLag, Math.floor(x.length / 2)); lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = lag; i < x.length; i++) {
      const a = x[i]!;
      const b = x[i - lag]!;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const corr = num / Math.sqrt(denA * denB + 1e-9);
    if (corr > bestCorr) {
      secondCorr = bestCorr;
      bestCorr = corr;
      bestLag = lag;
    } else if (corr > secondCorr) {
      secondCorr = corr;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.19) return { bpm: null, confidence: Math.max(0, bestCorr) };
  const bpm = (60 * SAMPLE_RATE_HZ) / bestLag;
  if (bpm < MIN_BPM || bpm > MAX_BPM) return { bpm: null, confidence: 0 };
  const sep = Math.max(0, bestCorr - Math.max(0, secondCorr));
  const confidence = Math.max(0, Math.min(1, 0.65 * bestCorr + 0.35 * sep));
  if (confidence < 0.24) return { bpm: null, confidence };
  return { bpm, confidence };
}

function clampRect(r: Rect, cw: number, ch: number): Rect {
  const x = Math.max(0, Math.min(r.x, cw - 8));
  const y = Math.max(0, Math.min(r.y, ch - 8));
  const w = Math.max(8, Math.min(r.w, cw - x));
  const h = Math.max(8, Math.min(r.h, ch - y));
  return { x, y, w, h };
}

function getTorsoRect(roi: PersonRoi | null | undefined, cw: number, ch: number): Rect {
  if (roi) {
    return clampRect(
      {
        x: Math.round(roi.x + roi.w * 0.2),
        y: Math.round(roi.y + roi.h * 0.38),
        w: Math.round(roi.w * 0.6),
        h: Math.round(roi.h * 0.34),
      },
      cw,
      ch,
    );
  }
  return clampRect(
    {
      x: Math.round(cw * 0.28),
      y: Math.round(ch * 0.38),
      w: Math.round(cw * 0.44),
      h: Math.round(ch * 0.3),
    },
    cw,
    ch,
  );
}

function getLowerFaceRect(roi: PersonRoi | null | undefined, cw: number, ch: number): Rect {
  if (roi) {
    return clampRect(
      {
        x: Math.round(roi.x + roi.w * 0.32),
        y: Math.round(roi.y + roi.h * 0.12),
        w: Math.round(roi.w * 0.36),
        h: Math.round(roi.h * 0.14),
      },
      cw,
      ch,
    );
  }
  return clampRect(
    {
      x: Math.round(cw * 0.4),
      y: Math.round(ch * 0.2),
      w: Math.round(cw * 0.2),
      h: Math.round(ch * 0.12),
    },
    cw,
    ch,
  );
}

/** Upper vs lower split of legacy lower-face box — nostril vs mouth fallbacks. */
function splitNoseMouthFallback(roi: PersonRoi | null | undefined, cw: number, ch: number): {
  nose: Rect;
  mouth: Rect;
} {
  const r = getLowerFaceRect(roi, cw, ch);
  const mid = Math.max(8, Math.floor(r.h * 0.45));
  return {
    nose: clampRect({ x: r.x, y: r.y, w: r.w, h: mid }, cw, ch),
    mouth: clampRect({ x: r.x, y: r.y + mid, w: r.w, h: r.h - mid }, cw, ch),
  };
}

function sampleRoiMotion(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  previousPatchRef: { current: number[] | null },
): number | null {
  let d: ImageData;
  try {
    d = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  } catch {
    return null;
  }

  const step = 3;
  const patch: number[] = [];
  let motion = 0;
  let n = 0;
  for (let y = 0; y < d.height; y += step) {
    for (let x = 0; x < d.width; x += step) {
      const i = (y * d.width + x) * 4;
      const lum = 0.299 * d.data[i]! + 0.587 * d.data[i + 1]! + 0.114 * d.data[i + 2]!;
      patch.push(lum);
      const prev = previousPatchRef.current;
      if (prev && prev.length === patch.length) {
        motion += Math.abs(lum - prev[patch.length - 1]!);
        n++;
      }
    }
  }
  previousPatchRef.current = patch;
  if (n === 0) return null;
  return motion / n;
}

/** Fuse chest + nostril + mouth motion estimates; chest weighted slightly higher. */
function fuseEstimatesTriple(chest: Estimate, nose: Estimate, mouth: Estimate): Estimate {
  const parts: { e: Estimate; w: number }[] = [
    { e: chest, w: 1 },
    { e: nose, w: 0.88 },
    { e: mouth, w: 0.88 },
  ];
  const ok = parts.filter((p) => p.e.bpm != null);
  if (ok.length === 0) {
    return {
      bpm: null,
      confidence: Math.max(chest.confidence, nose.confidence, mouth.confidence),
    };
  }
  if (ok.length === 1) return ok[0]!.e;
  const bpms = ok.map((p) => p.e.bpm!);
  const spread = Math.max(...bpms) - Math.min(...bpms);
  if (spread <= FUSE_AGREE_MAX_SPREAD) {
    let sum = 0;
    let wsum = 0;
    for (const p of ok) {
      const w = p.w * Math.max(0.06, p.e.confidence);
      sum += p.e.bpm! * w;
      wsum += w;
    }
    return {
      bpm: sum / wsum,
      confidence: ok.reduce((m, p) => Math.max(m, p.e.confidence), 0),
    };
  }
  const best = ok.reduce((a, b) => (a.e.confidence >= b.e.confidence ? a : b));
  if (chest.bpm != null && chest.confidence >= 0.24) return chest;
  return best.e;
}

export type BreathingResult = {
  bpm: number | null;
  active: boolean;
  trend: number[];
  confidence: number;
};

export function useBreathing(
  videoRef: RefObject<HTMLVideoElement | null>,
  personRoiRef?: RefObject<PersonRoi | null>,
  landmarksRef?: RefObject<BreathingGeometry | null>,
): BreathingResult {
  const [bpm, setBpm] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const [trend, setTrend] = useState<number[]>([]);
  const [confidence, setConfidence] = useState(0);

  const chestSamples = useRef<number[]>([]);
  const noseSamples = useRef<number[]>([]);
  const mouthSamples = useRef<number[]>([]);
  const previousChestPatch = useRef<number[] | null>(null);
  const previousNosePatch = useRef<number[] | null>(null);
  const previousMouthPatch = useRef<number[] | null>(null);
  const emaBpm = useRef<number | null>(null);
  const misses = useRef(0);
  const displayBpmWindow = useRef<number[]>([]);

  useEffect(() => {
    const smoothDisplayBpm = (value: number): number => {
      const w = displayBpmWindow.current;
      w.push(value);
      if (w.length > DISPLAY_MEDIAN_LEN) w.shift();
      const sorted = [...w].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };

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

      const roi = personRoiRef?.current;
      const geom = landmarksRef?.current;
      const torsoRect = geom?.chest ?? getTorsoRect(roi, cw, ch);
      const fb = splitNoseMouthFallback(roi, cw, ch);
      const noseRect = geom?.nose ?? fb.nose;
      const mouthRect = geom?.mouth ?? fb.mouth;

      const torsoMotion = sampleRoiMotion(ctx, torsoRect, previousChestPatch);
      if (torsoMotion != null) {
        chestSamples.current.push(torsoMotion);
        if (chestSamples.current.length > WINDOW_SIZE) chestSamples.current.shift();
      }

      const noseMotion = sampleRoiMotion(ctx, noseRect, previousNosePatch);
      if (noseMotion != null) {
        noseSamples.current.push(noseMotion);
        if (noseSamples.current.length > WINDOW_SIZE) noseSamples.current.shift();
      }

      const mouthMotion = sampleRoiMotion(ctx, mouthRect, previousMouthPatch);
      if (mouthMotion != null) {
        mouthSamples.current.push(mouthMotion);
        if (mouthSamples.current.length > WINDOW_SIZE) mouthSamples.current.shift();
      }

      if (
        chestSamples.current.length >= Math.round(WINDOW_SIZE * 0.55) ||
        noseSamples.current.length >= Math.round(WINDOW_SIZE * 0.55) ||
        mouthSamples.current.length >= Math.round(WINDOW_SIZE * 0.55)
      ) {
        const chestEst = estimateBreathBpmFromMotion(chestSamples.current);
        const noseEst = estimateBreathBpmFromMotion(noseSamples.current);
        const mouthEst = estimateBreathBpmFromMotion(mouthSamples.current);
        const fused = fuseEstimatesTriple(chestEst, noseEst, mouthEst);
        setConfidence(fused.confidence);

        if (fused.bpm != null) {
          misses.current = 0;
          const prev = emaBpm.current;
          let incoming = fused.bpm;
          if (prev != null) {
            const d = incoming - prev;
            if (Math.abs(d) > MAX_BPM_STEP) incoming = prev + Math.sign(d) * MAX_BPM_STEP;
          }
          const next =
            prev == null ? incoming : EMA_ALPHA * incoming + (1 - EMA_ALPHA) * prev;
          emaBpm.current = next;
          const rounded = smoothDisplayBpm(Math.round(next));
          setBpm(rounded);
          setTrend((prevTrend) => {
            const nextTrend = [...prevTrend, rounded];
            if (nextTrend.length > TREND_MAX) nextTrend.shift();
            return nextTrend;
          });
        } else {
          misses.current += 1;
          setTrend((prevTrend) => {
            const hold = emaBpm.current == null ? 0 : Math.round(Math.max(0, emaBpm.current * 0.97));
            const nextTrend = [...prevTrend, hold];
            if (nextTrend.length > TREND_MAX) nextTrend.shift();
            return nextTrend;
          });
          if (misses.current > SAMPLE_RATE_HZ * 2) {
            emaBpm.current = null;
            setBpm(null);
          }
        }
      }
    }, 1000 / SAMPLE_RATE_HZ);

    return () => {
      clearInterval(iv);
      setActive(false);
      chestSamples.current = [];
      noseSamples.current = [];
      mouthSamples.current = [];
      previousChestPatch.current = null;
      previousNosePatch.current = null;
      previousMouthPatch.current = null;
      emaBpm.current = null;
      misses.current = 0;
      displayBpmWindow.current = [];
    };
  }, [videoRef, personRoiRef, landmarksRef]);

  return { bpm, active, trend, confidence };
}
