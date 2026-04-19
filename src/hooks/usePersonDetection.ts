import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DetectedObject, ObjectDetection } from "@tensorflow-models/coco-ssd";

export type PersonRoi = { x: number; y: number; w: number; h: number };

/**
 * Runs COCO-SSD in the browser on the live video (real person detection).
 * Updates `roiRef` with a face-ish crop from the highest-confidence box for rPPG.
 */
export function usePersonDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  ready: boolean,
) {
  const [persons, setPersons] = useState<DetectedObject[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const modelRef = useRef<ObjectDetection | null>(null);
  const roiRef = useRef<PersonRoi | null>(null);
  /** Latest count from the detection loop — safe when modal/pause makes React state stale. */
  const personCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
        const coco = await import("@tensorflow-models/coco-ssd");
        const m = await coco.load();
        if (!cancelled) {
          modelRef.current = m;
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !ready) return;
    const v = videoRef.current;
    const model = modelRef.current;
    if (!v || !model) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled || v.readyState < 2) return;
      try {
        const preds = await model.detect(v);
        const people = preds.filter((p) => p.class === "person");
        personCountRef.current = people.length;
        setPersons(people);
        if (people.length > 0) {
          const best = people.reduce((a, b) => (a.score >= b.score ? a : b));
          const [x, y, w, h] = best.bbox;
          const fh = Math.max(24, h * 0.4);
          const fy = y + h * 0.06;
          const fx = x + w * 0.18;
          const fw = w * 0.64;
          roiRef.current = { x: fx, y: fy, w: fw, h: fh };
        } else {
          roiRef.current = null;
        }
      } catch {
        /* dropped frame */
      }
    };

    const iv = window.setInterval(() => void tick(), 480);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(iv);
      roiRef.current = null;
    };
  }, [status, ready, videoRef]);

  /** One fresh detect at call time (e.g. distress send) — avoids stale state if the modal affected the stream. */
  const getPersonCountNow = useCallback(async (): Promise<number> => {
    const v = videoRef.current;
    const model = modelRef.current;
    if (status !== "ready" || !v || v.readyState < 2 || !model) {
      return personCountRef.current;
    }
    try {
      const preds = await model.detect(v);
      const n = preds.filter((p) => p.class === "person").length;
      personCountRef.current = n;
      return n;
    } catch {
      return personCountRef.current;
    }
  }, [status, videoRef]);

  return {
    persons,
    personCount: persons.length,
    personCountRef,
    getPersonCountNow,
    status,
    roiRef,
  };
}
