import { useEffect, useRef, useState } from "react";

type Props = {
  onAlarm?: () => void;
};

/**
 * Listens for energy near ~3.1kHz (many smoke alarms) and calls onAlarm.
 * Requires microphone permission.
 */
export function SmokeAlarmListener({ onAlarm }: Props) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const lastTrig = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const sr = ctx.sampleRate;
        const target = 3100;
        const bin = Math.min(
          data.length - 1,
          Math.round((target * analyser.fftSize) / sr),
        );

        const loop = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          const v = data[bin] / 255;
          setLevel(v);
          const strong = data[bin] > 200 && data[bin] > data[bin - 1] + 30;
          if (strong && Date.now() - lastTrig.current > 8000) {
            lastTrig.current = Date.now();
            onAlarm?.();
          }
          requestAnimationFrame(loop);
        };
        setActive(true);
        loop();
      } catch {
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      void ctxRef.current?.close();
    };
  }, [onAlarm]);

  return (
    <div className="smoke-indicator" title="Smoke alarm listener (mic)">
      <span className={active ? "pulse" : ""} />
      <span className="smoke-label">Alarm listen</span>
      {active ? <span className="smoke-level" style={{ opacity: 0.4 + level * 0.6 }} /> : null}
    </div>
  );
}
