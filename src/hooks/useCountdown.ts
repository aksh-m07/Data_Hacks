import { useEffect, useState } from "react";

/** Seconds remaining until `targetMs` (updates every second). */
export function useCountdown(targetMs: number): number {
  const [remainingSec, setRemainingSec] = useState(() =>
    Math.max(0, Math.floor((targetMs - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = () => {
      setRemainingSec(Math.max(0, Math.floor((targetMs - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  return remainingSec;
}
