import { useEffect, useRef, type RefObject } from "react";
import type { DetectedObject } from "@tensorflow-models/coco-ssd";

function estimateDistanceM(bboxH: number, videoH: number): number {
  const ratio = bboxH / Math.max(1, videoH);
  if (ratio > 0.8) return 0.5;
  if (ratio > 0.5) return 1.0;
  if (ratio > 0.25) return 2.0;
  if (ratio > 0.1) return 4.0;
  return 8.0;
}

/** Draws green-dot tracking marker (centroid + confidence ring) for each detected person. */
export function usePersonOverlayCanvas(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  persons: DetectedObject[],
  active: boolean,
) {
  const personsRef = useRef(persons);
  personsRef.current = persons;

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

      const people = personsRef.current.filter((p) => p.class === "person");

      if (people.length === 0) {
        // Show scanning indicator
        ctx.font = "bold 13px system-ui, sans-serif";
        ctx.fillStyle = "rgba(74, 222, 128, 0.6)";
        ctx.fillText("SCANNING…", c.width / 2 - 36, c.height / 2);
      }

      people.forEach((p, idx) => {
        const [x, y, w, h] = p.bbox;
        const cx = (x + w / 2) * sx;
        const cy = (y + h * 0.3) * sy; // upper-body / chest centroid
        const confidence = p.score;
        const highConf = confidence >= 0.6;
        const distM = estimateDistanceM(h, vh);

        // Green dot
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(74, 222, 128, 0.95)";
        ctx.fill();

        // Confidence ring — solid if high confidence, dashed if low
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(74, 222, 128, 0.85)";
        ctx.lineWidth = 2.5;
        if (!highConf) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label below dot
        const label = `${idx + 1} PERSON · ${distM.toFixed(1)}m`;
        ctx.font = "bold 12px system-ui, sans-serif";
        const tw = ctx.measureText(label).width;
        const lx = cx - tw / 2;
        const ly = cy + 40;
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(lx - 4, ly - 14, tw + 8, 18);
        ctx.fillStyle = "#d1fae5";
        ctx.fillText(label, lx, ly);

        // Confidence score above dot
        const confLabel = `${(confidence * 100).toFixed(0)}%`;
        ctx.font = "10px system-ui, sans-serif";
        const cw2 = ctx.measureText(confLabel).width;
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(cx - cw2 / 2 - 3, cy - 38, cw2 + 6, 14);
        ctx.fillStyle = "#a7f3d0";
        ctx.fillText(confLabel, cx - cw2 / 2, cy - 27);
      });

      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [active, videoRef, canvasRef]);
}
