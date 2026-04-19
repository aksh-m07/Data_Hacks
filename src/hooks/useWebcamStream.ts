import { useEffect, useRef, useState } from "react";

export type FacingMode = "user" | "environment";

/** One browser camera stream for the whole Helper view (no duplicate getUserMedia). */
export function useWebcamStream(facing: FacingMode) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    setReady(false);
    setError(null);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setReady(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open camera");
      }
    })();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setReady(false);
    };
  }, [facing]);

  return { videoRef, error, ready };
}
