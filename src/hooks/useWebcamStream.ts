import { useEffect, useRef, useState } from "react";

export type FacingMode = "user" | "environment";

export type WebcamStreamOptions = {
  /** Include mic in the same getUserMedia call (avoids a second prompt / failures while the camera is open). */
  withAudio?: boolean;
};

/** One browser camera stream for the whole Helper view (no duplicate getUserMedia). */
export function useWebcamStream(facing: FacingMode, options: WebcamStreamOptions = {}) {
  const { withAudio = false } = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    setReady(false);
    setError(null);
    setMediaStream(null);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: withAudio
            ? {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : false,
        });
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
          setReady(true);
        }
        setMediaStream(stream);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open camera");
      }
    })();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setReady(false);
      setMediaStream(null);
    };
  }, [facing, withAudio]);

  return { videoRef, error, ready, mediaStream };
}
