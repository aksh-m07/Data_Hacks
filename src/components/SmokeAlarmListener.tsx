import { useEffect, useRef, useState } from "react";

type Props = {
  /** Same MediaStream as the Survivor webcam (must include an audio track). */
  mediaStream: MediaStream | null;
  onAlarm?: () => void;
  /** True while smoke tone was just detected — header bar pulses red. */
  alarmActive?: boolean;
};

/** Core band where many US photoelectric smoke alarms peak (~3.1 kHz). */
const ALARM_CORE_LO_HZ = 2850;
const ALARM_CORE_HI_HZ = 3350;

function hzToBin(fHz: number, sampleRate: number, fftSize: number): number {
  return Math.round((fHz * fftSize) / sampleRate);
}

function clamp(i: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, i));
}

/**
 * True only for narrowband, high-pitched alarm-like tones — not speech, music, or TV
 * (those fill many bins; alarms spike in a small range vs quiet rest of spectrum).
 */
function isLikelySmokeAlarmTone(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
): { narrowMax: number; passes: boolean } {
  const n = data.length;
  const iCore0 = clamp(hzToBin(ALARM_CORE_LO_HZ, sampleRate, fftSize), 2, n - 1);
  const iCore1 = clamp(hzToBin(ALARM_CORE_HI_HZ, sampleRate, fftSize), iCore0, n - 1);

  let narrowMax = 0;
  for (let i = iCore0; i <= iCore1; i++) narrowMax = Math.max(narrowMax, data[i]!);

  // Mean level outside core ± guard (rejects broadband: music / room noise)
  const guard = 10;
  const ex0 = Math.max(2, iCore0 - guard);
  const ex1 = Math.min(n - 1, iCore1 + guard);
  let outsideSum = 0;
  let outsideCount = 0;
  for (let i = 2; i < ex0; i++) {
    outsideSum += data[i]!;
    outsideCount++;
  }
  for (let i = ex1 + 1; i < n; i++) {
    outsideSum += data[i]!;
    outsideCount++;
  }
  const outsideMean = outsideCount > 0 ? outsideSum / outsideCount : 0;

  // Bass-heavy content (kick, speech body) — alarm band should dominate
  const iBassEnd = clamp(hzToBin(500, sampleRate, fftSize), 2, n - 1);
  let bassSum = 0;
  let bassN = 0;
  for (let i = 2; i <= iBassEnd; i++) {
    bassSum += data[i]!;
    bassN++;
  }
  const bassMean = bassN > 0 ? bassSum / bassN : 0;

  // How many bins are "loud" — music/TV light up lots of bins; a beep does not
  let loudBinCount = 0;
  for (let i = 2; i < n; i++) {
    if (data[i]! > 42) loudBinCount++;
  }
  const broadbandRatio = loudBinCount / (n - 2);

  const peakVsRest = narrowMax / (outsideMean + 4);
  const beatsBass = narrowMax > bassMean * 1.75 || narrowMax > bassMean + 55;

  const passes =
    narrowMax >= 62 &&
    peakVsRest >= 5.2 &&
    beatsBass &&
    broadbandRatio <= 0.16 &&
    (narrowMax >= 92 || peakVsRest >= 7.5);

  return { narrowMax, passes };
}

/**
 * Listens for narrowband ~3.1 kHz alarm-like tones (not general loud sounds).
 * Requires microphone permission. Resumes AudioContext (required on most browsers).
 */
export function SmokeAlarmListener({ mediaStream, onAlarm, alarmActive }: Props) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [micHint, setMicHint] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const lastTrig = useRef(0);
  const onAlarmRef = useRef(onAlarm);
  onAlarmRef.current = onAlarm;
  /** Require consecutive frames passing strict spectral gate */
  const streakRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setMicHint(null);
    setActive(false);

    if (!mediaStream?.getAudioTracks().length) {
      setMicHint(mediaStream ? "No mic track — allow microphone with camera." : null);
      return;
    }

    (async () => {
      try {
        const ctx = new AudioContext();
        ctxRef.current = ctx;

        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const src = ctx.createMediaStreamSource(mediaStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.28;
        src.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const sr = ctx.sampleRate;
        const fftSize = analyser.fftSize;

        const loop = () => {
          if (cancelled) return;

          if (ctx.state === "suspended") {
            void ctx.resume();
          }

          analyser.getByteFrequencyData(data);
          const { narrowMax, passes } = isLikelySmokeAlarmTone(data, sr, fftSize);
          setLevel(narrowMax / 255);

          if (passes) streakRef.current += 1;
          else streakRef.current = 0;

          if (
            streakRef.current >= 6 &&
            Date.now() - lastTrig.current > 8000
          ) {
            lastTrig.current = Date.now();
            streakRef.current = 0;
            onAlarmRef.current?.();
          }

          requestAnimationFrame(loop);
        };

        setActive(true);
        loop();
      } catch {
        setActive(false);
        setMicHint("Could not analyze mic audio.");
      }
    })();

    return () => {
      cancelled = true;
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [mediaStream]);

  /** Browsers may leave AudioContext suspended until a user gesture — resume on first tap/key. */
  useEffect(() => {
    const wake = () => {
      const c = ctxRef.current;
      if (c?.state === "suspended") void c.resume();
    };
    window.addEventListener("pointerdown", wake, true);
    window.addEventListener("keydown", wake, true);
    return () => {
      window.removeEventListener("pointerdown", wake, true);
      window.removeEventListener("keydown", wake, true);
    };
  }, []);

  return (
    <div
      className={`smoke-indicator${alarmActive ? " smoke-indicator--alarm" : ""}`}
      title="Detects narrow ~3.1 kHz alarm-like tones (not music/TV). Allow mic with camera; tap page once if audio is idle."
    >
      <span className={active ? "pulse" : ""} />
      <span className="smoke-label">{micHint ? "Mic issue" : "Alarm listen"}</span>
      {active ? <span className="smoke-level" style={{ opacity: 0.35 + level * 0.65 }} /> : null}
      {micHint ? <span className="smoke-mic-hint">{micHint}</span> : null}
    </div>
  );
}
