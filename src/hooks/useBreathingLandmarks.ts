/**
 * MoveNet (chest/torso) + MediaPipe Face Mesh (nostril band, lips) for breathing ROIs.
 * Feeds pixel rects into useBreathing — same “green dot” idea as pose overlays, in software.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Keypoint } from "@tensorflow-models/pose-detection";
import type { BreathingGeometry } from "./useBreathing";

const LANDMARK_TICK_MS = 90;

/** Nose / alar region — stable subset of MediaPipe 468 mesh indices */
const NOSE_MESH_IDX = [
  1, 2, 4, 5, 6, 19, 20, 44, 94, 97, 98, 168, 195, 197, 275, 278, 327, 344, 440,
];

function clampRect(
  r: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(r.x, cw - 8));
  const y = Math.max(0, Math.min(r.y, ch - 8));
  const w = Math.max(8, Math.min(r.w, cw - x));
  const h = Math.max(8, Math.min(r.h, ch - y));
  return { x, y, w, h };
}

function bboxFromKeypoints(
  kps: Keypoint[],
  indices: number[],
  cw: number,
  ch: number,
  padFrac: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const i of indices) {
    const p = kps[i];
    if (!p || p.x == null || p.y == null) continue;
    n++;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (n < 4 || !Number.isFinite(minX)) return null;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const pad = Math.max(4, Math.max(bw, bh) * padFrac);
  return clampRect(
    {
      x: Math.floor(minX - pad),
      y: Math.floor(minY - pad),
      w: Math.ceil(bw + 2 * pad),
      h: Math.ceil(bh + 2 * pad),
    },
    cw,
    ch,
  );
}

function chestFromPose(kps: Keypoint[], cw: number, ch: number): { x: number; y: number; w: number; h: number } | null {
  const byName = (n: string) => kps.find((k) => k.name === n);
  const ls = byName("left_shoulder");
  const rs = byName("right_shoulder");
  const lh = byName("left_hip");
  const rh = byName("right_hip");
  if (!ls || !rs) return null;
  const minS = 0.22;
  if ((ls.score ?? 1) < minS && (rs.score ?? 1) < minS) return null;

  const shoulderMidY = (ls.y + rs.y) / 2;
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  let hipMidY = shoulderMidY + shoulderW * 1.15;
  if (lh && rh && (lh.score ?? 0) > 0.2 && (rh.score ?? 0) > 0.2) {
    hipMidY = (lh.y + rh.y) / 2;
  }
  const torsoH = Math.max(24, hipMidY - shoulderMidY);
  const cx = (ls.x + rs.x) / 2;
  const cy = shoulderMidY + torsoH * 0.2;
  const w = Math.max(shoulderW * 1.08, 48);
  const h = Math.max(torsoH * 0.4, 40);
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, cw, ch);
}

export type BreathingLandmarksStatus = "loading" | "ready" | "error";

export function useBreathingLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  ready: boolean,
): { landmarksRef: RefObject<BreathingGeometry | null>; status: BreathingLandmarksStatus } {
  const landmarksRef = useRef<BreathingGeometry | null>(null);
  const [status, setStatus] = useState<BreathingLandmarksStatus>("loading");
  const poseRef = useRef<import("@tensorflow-models/pose-detection").PoseDetector | null>(null);
  const faceRef = useRef<import("@tensorflow-models/face-landmarks-detection").FaceLandmarksDetector | null>(null);
  const lipIdxRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
        const poseDetection = await import("@tensorflow-models/pose-detection");
        const faceLM = await import("@tensorflow-models/face-landmarks-detection");
        lipIdxRef.current =
          faceLM.util.getKeypointIndexByContour(faceLM.SupportedModels.MediaPipeFaceMesh).lips ?? [];

        const poseDet = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
          enableSmoothing: true,
        });
        const faceDet = await faceLM.createDetector(faceLM.SupportedModels.MediaPipeFaceMesh, {
          runtime: "tfjs",
          maxFaces: 1,
          refineLandmarks: false,
        });
        if (cancelled) {
          poseDet.dispose();
          faceDet.dispose();
          return;
        }
        poseRef.current = poseDet;
        faceRef.current = faceDet;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      poseRef.current?.dispose();
      faceRef.current?.dispose();
      poseRef.current = null;
      faceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !ready) return;
    const v = videoRef.current;
    if (!v) return;

    let busy = false;
    const tick = async () => {
      if (busy || v.readyState < 2) return;
      const pd = poseRef.current;
      const fd = faceRef.current;
      if (!pd || !fd) return;
      busy = true;
      try {
        const cw = v.videoWidth || 320;
        const ch = v.videoHeight || 240;
        const [poses, faces] = await Promise.all([
          pd.estimatePoses(v, { flipHorizontal: false, maxPoses: 1 }),
          fd.estimateFaces(v, { flipHorizontal: false, staticImageMode: false }),
        ]);

        let chest: BreathingGeometry["chest"] = null;
        if (poses.length > 0 && (poses[0]!.score ?? 0) >= 0.22) {
          chest = chestFromPose(poses[0]!.keypoints, cw, ch);
        }

        let nose: BreathingGeometry["nose"] = null;
        let mouth: BreathingGeometry["mouth"] = null;
        if (faces.length > 0) {
          const kps = faces[0]!.keypoints;
          nose = bboxFromKeypoints(kps, NOSE_MESH_IDX, cw, ch, 0.12);
          const lipIdx = lipIdxRef.current;
          if (lipIdx.length > 0) {
            mouth = bboxFromKeypoints(kps, lipIdx, cw, ch, 0.08);
          }
        }

        let poseKeypoints: BreathingGeometry["poseKeypoints"] = null;
        if (poses.length > 0 && (poses[0]!.score ?? 0) >= 0.15) {
          poseKeypoints = poses[0]!.keypoints.map((k) => ({
            x: k.x,
            y: k.y,
            name: k.name,
            score: k.score,
          }));
        }

        landmarksRef.current = { chest, nose, mouth, poseKeypoints };
      } catch {
        /* dropped frame */
      } finally {
        busy = false;
      }
    };

    const iv = window.setInterval(() => void tick(), LANDMARK_TICK_MS);
    void tick();
    return () => {
      clearInterval(iv);
      landmarksRef.current = null;
    };
  }, [status, ready, videoRef]);

  return { landmarksRef, status };
}
