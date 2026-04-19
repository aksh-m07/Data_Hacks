import { useEffect, useRef, type RefObject } from "react";
import type { DetectedObject } from "@tensorflow-models/coco-ssd";
import type { BreathingGeometry } from "./useBreathing";

function estimateDistanceM(bboxH: number, videoH: number): number {
  const ratio = bboxH / Math.max(1, videoH);
  if (ratio > 0.8) return 0.5;
  if (ratio > 0.5) return 1.0;
  if (ratio > 0.25) return 2.0;
  if (ratio > 0.1) return 4.0;
  return 8.0;
}

/** MoveNet Lightning (COCO 17) skeleton edges — indices into keypoints array */
const MOVENET_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [5, 6],
  [5, 7],
  [5, 11],
  [6, 8],
  [6, 12],
  [7, 9],
  [8, 10],
  [11, 12],
  [11, 13],
  [12, 14],
  [13, 15],
  [14, 16],
];

const KP_SCORE_MIN = 0.12;

function drawPoseAndBreathingRois(
  ctx: CanvasRenderingContext2D,
  geo: BreathingGeometry,
  sx: number,
  sy: number,
) {
  const kps = geo.poseKeypoints;
  if (kps && kps.length >= 5) {
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(74, 222, 128, 0.92)";
    for (const [a, b] of MOVENET_EDGES) {
      const pa = kps[a];
      const pb = kps[b];
      if (!pa || !pb) continue;
      if ((pa.score ?? 1) < KP_SCORE_MIN || (pb.score ?? 1) < KP_SCORE_MIN) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * sx, pa.y * sy);
      ctx.lineTo(pb.x * sx, pb.y * sy);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(74, 222, 128, 0.98)";
    for (const p of kps) {
      if ((p.score ?? 1) < KP_SCORE_MIN) continue;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 4.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  const strokeRoi = (
    r: { x: number; y: number; w: number; h: number },
    label: string,
    dash: number[],
  ) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = "rgba(52, 211, 153, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy);
    ctx.setLineDash([]);
    ctx.font = "bold 11px system-ui, sans-serif";
    const tx = r.x * sx + 4;
    const ty = r.y * sy - 4;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(tx - 2, ty - 12, ctx.measureText(label).width + 6, 14);
    ctx.fillStyle = "#d1fae5";
    ctx.fillText(label, tx, ty - 2);
  };

  if (geo.chest) strokeRoi(geo.chest, "Chest (breathing)", [6, 4]);
  if (geo.nose) strokeRoi(geo.nose, "Nose / nostrils", [4, 3]);
  if (geo.mouth) strokeRoi(geo.mouth, "Mouth / lips", [2, 3]);

  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  const banner = "MoveNet + face mesh — tracking regions";
  const bw = ctx.measureText(banner).width;
  ctx.fillRect(8, 8, bw + 12, 20);
  ctx.fillStyle = "#a7f3d0";
  ctx.fillText(banner, 14, 22);
}

function drawLegacyCocoOverlay(
  ctx: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  people: DetectedObject[],
  vh: number,
  sx: number,
  sy: number,
) {
  if (people.length === 0) {
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(74, 222, 128, 0.6)";
    ctx.fillText("SCANNING…", c.width / 2 - 36, c.height / 2);
    return;
  }

  people.forEach((p, idx) => {
    const [x, y, w, h] = p.bbox;
    const chestCx = (x + w / 2) * sx;
    const chestCy = (y + h * 0.44) * sy;
    const faceCx = (x + w / 2) * sx;
    const faceCy = (y + h * 0.18) * sy;
    const confidence = p.score;
    const highConf = confidence >= 0.6;
    const distM = estimateDistanceM(h, vh);

    ctx.beginPath();
    ctx.arc(chestCx, chestCy, 9, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(74, 222, 128, 0.95)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(chestCx, chestCy, 20, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(74, 222, 128, 0.85)";
    ctx.lineWidth = 2.2;
    if (!highConf) ctx.setLineDash([6, 4]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(faceCx, faceCy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(74, 222, 128, 0.88)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(faceCx - 7, faceCy - 2, 2, 0, 2 * Math.PI);
    ctx.arc(faceCx + 7, faceCy - 2, 2, 0, 2 * Math.PI);
    ctx.arc(faceCx, faceCy + 6, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(74, 222, 128, 0.78)";
    ctx.fill();

    const label = `${idx + 1} PERSON · ${distM.toFixed(1)}m`;
    ctx.font = "bold 12px system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    const lx = chestCx - tw / 2;
    const ly = chestCy + 36;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(lx - 4, ly - 14, tw + 8, 18);
    ctx.fillStyle = "#d1fae5";
    ctx.fillText(label, lx, ly);

    const confLabel = `${(confidence * 100).toFixed(0)}%`;
    ctx.font = "10px system-ui, sans-serif";
    const cw2 = ctx.measureText(confLabel).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(chestCx - cw2 / 2 - 3, chestCy - 34, cw2 + 6, 14);
    ctx.fillStyle = "#a7f3d0";
    ctx.fillText(confLabel, chestCx - cw2 / 2, chestCy - 23);
  });

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(74, 222, 128, 0.75)";
  ctx.fillText("Heuristic markers (load pose model…)", 8, c.height - 10);
}

/**
 * Green tracking overlay: when `landmarksRef` + `poseReady` yield MoveNet joints, draws
 * skeleton + chest/nose/mouth ROIs; otherwise falls back to COCO-SSD heuristic dots.
 */
export function usePersonOverlayCanvas(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  persons: DetectedObject[],
  active: boolean,
  landmarksRef?: RefObject<BreathingGeometry | null>,
  poseReady?: boolean,
) {
  const personsRef = useRef(persons);
  personsRef.current = persons;
  const landmarksRefOuter = landmarksRef;
  const poseReadyRef = useRef(poseReady);
  poseReadyRef.current = poseReady ?? false;

  useEffect(() => {
    if (!active) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const loop = () => {
      const rect = v.getBoundingClientRect();
      c.width = Math.max(1, rect.width);
      c.height = Math.max(1, rect.height);
      const vw = v.videoWidth || 640;
      const vh = v.videoHeight || 480;
      const sx = c.width / vw;
      const sy = c.height / vh;
      ctx.clearRect(0, 0, c.width, c.height);

      const geo = landmarksRefOuter?.current;
      const usePose =
        poseReadyRef.current &&
        geo &&
        geo.poseKeypoints &&
        geo.poseKeypoints.length >= 5;

      if (usePose) {
        drawPoseAndBreathingRois(ctx, geo, sx, sy);
      } else {
        const people = personsRef.current.filter((p) => p.class === "person");
        drawLegacyCocoOverlay(ctx, c, people, vh, sx, sy);
      }

      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active, videoRef, canvasRef, landmarksRef]);
}
