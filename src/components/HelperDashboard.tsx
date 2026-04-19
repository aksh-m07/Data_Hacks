import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useGeolocation } from "../hooks/useGeolocation";
import { useBreathing } from "../hooks/useBreathing";
import { useFalseColorOverlay } from "../hooks/useFalseColorOverlay";
import { usePersonDetection } from "../hooks/usePersonDetection";
import { usePersonOverlayCanvas } from "../hooks/usePersonOverlayCanvas";
import { useRppg } from "../hooks/useRppg";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import type { FacingMode } from "../hooks/useWebcamStream";
import { useWebcamStream } from "../hooks/useWebcamStream";
import { fetchAirQuality } from "../lib/airQuality";
import { broadcastWildfireShare } from "../lib/crossDashboardShare";
import { groqBriefing, helperSystemPrompt } from "../lib/groq";

export function HelperDashboard() {
  const { lat, lon } = useGeolocation();
  const [facing, setFacing] = useState<FacingMode>("user");
  const [falseColor, setFalseColor] = useState(false);

  const { videoRef, error: camErr, ready } = useWebcamStream(facing);
  const { persons, personCount, status: detStatus, roiRef } = usePersonDetection(
    videoRef,
    ready,
  );
  const rppg = useRppg(videoRef, roiRef);
  const breathing = useBreathing(videoRef, roiRef);

  const falseColorCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  useFalseColorOverlay(videoRef, falseColorCanvasRef, falseColor && ready);
  usePersonOverlayCanvas(
    videoRef,
    overlayCanvasRef,
    persons,
    ready && detStatus === "ready",
  );

  const speech = useSpeechRecognition();

  const [aqi, setAqi] = useState<number | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [groqErr, setGroqErr] = useState<string | null>(null);
  const [manualBpm, setManualBpm] = useState("");
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const manualParsed =
    manualBpm.trim() === "" ? null : Number.parseInt(manualBpm.trim(), 10);
  const manualValid =
    manualParsed != null &&
    !Number.isNaN(manualParsed) &&
    manualParsed >= 30 &&
    manualParsed <= 240;
  const effectiveBpm = manualValid ? manualParsed! : (rppg.bpm ?? 0);
  const heartRateNote = manualValid
    ? "user-entered BPM (watch, finger on neck pulse, oximeter — not verified here)"
    : "webcam rPPG only — very rough on laptops; not medical grade";

  useEffect(() => {
    if (lat == null || lon == null) return;
    void fetchAirQuality(lat, lon).then((a) => setAqi(a.aqi));
  }, [lat, lon]);

  function blurFocusedField() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function sendHelperAlert(ev: MouseEvent<HTMLButtonElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    blurFocusedField();
    const voicePart = speech.text.trim();
    const stepPart =
      steps.length > 0 ? `First-aid steps: ${steps.slice(0, 6).join(" · ")}` : "";
    const instructions = [voicePart, stepPart].filter(Boolean).join("\n\n");
    const riskLine = `Helper · AQI ${aqi ?? "—"} · HR ~${effectiveBpm} BPM · ${personCount} person(s) detected`;
    const placeLabel =
      lat != null && lon != null ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : null;
    broadcastWildfireShare({
      instructions: instructions || "Helper sent an alert (add voice or steps for more detail).",
      riskLine,
      placeLabel,
      fromShareClick: true,
      alertSource: "helper",
      lat,
      lon,
    });
  }

  function onBroadcastPointerDown() {
    blurFocusedField();
  }

  async function askGroq() {
    const sys = helperSystemPrompt(
      effectiveBpm,
      heartRateNote,
      personCount,
      personCount > 0,
      aqi ?? 0,
    );
    const userLine = speech.text
      ? `Caller speech (live): ${speech.text}. Prioritize first aid for smoke / unconscious victim context.`
      : "The helper is with a victim who may be non-responsive. Give 5 numbered first-aid steps.";
    const g = await groqBriefing(sys, userLine);
    setGroqErr(g.error ?? null);
    if (g.text) {
      const lines = g.text
        .split(/\n/)
        .map((l) => l.replace(/^\d+[\).\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 8);
      setSteps(lines);
      setChecked({});
    }
  }

  const detLabel =
    detStatus === "loading"
      ? "Loading vision model…"
      : detStatus === "error"
        ? "Vision model failed to load"
        : `${personCount} person${personCount === 1 ? "" : "s"} (COCO-SSD)`;

  return (
    <div className="dashboard helper-page">
      <header className="page-head">
        <div>
          <h1>Helper console</h1>
          <p className="badge blue">Webcam · on-device vision</p>
        </div>
      </header>

      <p className="helper-lede">
        Person detection runs in your browser. <strong>Mac Touch ID, trackpad, and fingerprint sensors cannot
        be read by websites</strong> — Apple does not expose them to web apps, so there is no way to use them
        for pulse in the browser. Use a real measurement below, or a rough webcam estimate.
      </p>

      <div className="aqi-strip">
        AQI {aqi ?? "—"} · stay low if smoke · call emergency if unconscious
      </div>

      {camErr ? (
        <p className="small err" role="alert">
          Camera: {camErr}
        </p>
      ) : null}

      <div className="helper-layout">
        <div className="helper-video-col">
          <div className="cam-controls">
            <span className="cam-controls-label">Camera</span>
            <button
              type="button"
              className={`chip ${facing === "user" ? "chip-on" : ""}`}
              onClick={() => setFacing("user")}
            >
              Front
            </button>
            <button
              type="button"
              className={`chip ${facing === "environment" ? "chip-on" : ""}`}
              onClick={() => setFacing("environment")}
            >
              Back
            </button>
            <button
              type="button"
              className={`chip ${falseColor ? "chip-on" : ""}`}
              onClick={() => setFalseColor((x) => !x)}
            >
              False-color
            </button>
          </div>

          <section className="video-hero video-hero--wide">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`video-feed ${falseColor ? "video-feed--hidden" : ""}`}
            />
            <canvas
              ref={falseColorCanvasRef}
              className={`video-feed video-feed--false ${falseColor ? "" : "video-feed--hidden"}`}
            />
            <canvas ref={overlayCanvasRef} className="video-overlay-canvas" aria-hidden />
          </section>

          <div className="helper-metrics helper-metrics--row">
            <div className="metric-card">
              <span className="metric-label">Green dot (COCO-SSD)</span>
              <span className="metric-value">{detLabel}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">rPPG Pulse</span>
              <span className="metric-value">
                {manualValid ? (
                  <>
                    <strong>{manualParsed}</strong> BPM <span className="muted">(entered)</span>
                  </>
                ) : rppg.bpm != null ? (
                  <>
                    ~{rppg.bpm} BPM · {rppg.status}
                  </>
                ) : (
                  <>{rppg.status}</>
                )}
              </span>
            </div>
          </div>

          <div className="breath-section">
            <span className="metric-label">Breathing bars</span>
            <div className="breath-bars" aria-label="Breathing animation">
              {[0, 1, 2, 3, 4].map((i) => {
                const bpm = breathing.bpm ?? 14;
                const cycleMs = Math.round((60 / bpm) * 1000);
                return (
                  <span
                    key={i}
                    className="breath-bar"
                    style={{
                      animationDuration: `${cycleMs}ms`,
                      animationDelay: `${(i / 5) * cycleMs}ms`,
                    }}
                  />
                );
              })}
              <span className="breath-label">
                {breathing.bpm != null ? `~${breathing.bpm}/min` : "estimating…"}
              </span>
            </div>
          </div>

          <div className="safe-surface">
            <span className="safe-surface-icon" aria-hidden>⬜</span>
            <span>Safe surface scan — point back camera at floor.
              <span className="muted"> WebXR depth planned for LiDAR devices.</span>
            </span>
          </div>

          <p className="small helper-hint">
            Green dot = COCO-SSD person centroid. False-color = luma pseudocolor (not thermal).
            rPPG needs steady face + good light — not medical grade.
          </p>
        </div>

        <aside className="helper-side-col">
          <section className="hr-panel">
            <h2 className="hr-panel-title">Heart rate</h2>
            <label className="hr-label" htmlFor="manual-bpm">
              Measured BPM (optional)
            </label>
            <p className="hr-explain">
              Best: watch, fingertip pulse, or pulse oximeter. Enter a number to override the webcam estimate
              for first-aid context.
            </p>
            <div className="hr-row">
              <input
                id="manual-bpm"
                type="number"
                inputMode="numeric"
                min={30}
                max={240}
                className="hr-input"
                placeholder="e.g. 72"
                value={manualBpm}
                onChange={(e) => setManualBpm(e.target.value)}
              />
              <span className="hr-unit">BPM</span>
            </div>
            {manualBpm.trim() !== "" && !manualValid ? (
              <p className="small err">Enter 30–240 or clear the field.</p>
            ) : null}
          </section>

          <section className="groq-box">
            <h2>First aid (Groq)</h2>
            <button type="button" className="btn" onClick={() => void askGroq()}>
              Get smoke-inhalation steps
            </button>
            {speech.supported ? (
              <button
                type="button"
                className={`btn ghost ${speech.listening ? "btn-live" : ""}`}
                onClick={() => speech.toggle()}
              >
                {speech.listening ? "Stop voice" : "Speak situation (browser)"}
              </button>
            ) : (
              <p className="small">Voice-to-text not supported in this browser.</p>
            )}
            {speech.text ? (
              <p className="speech-preview">
                <span className="muted">Heard:</span> {speech.text}
              </p>
            ) : null}
            {groqErr ? <p className="small err">{groqErr}</p> : null}
            {steps.length > 0 ? (
              <ol className="steps">
                {steps.map((s, i) => (
                  <li
                    key={i}
                    className={checked[i] ? "step-done" : ""}
                    onClick={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                    style={{ cursor: "pointer", userSelect: "none" }}
                  >
                    <span className="step-check">{checked[i] ? "✓" : "○"}</span> {s}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>

          <a className="call911" href="tel:911">
            CALL 911
          </a>
          <button
            type="button"
            className="broadcast-alert-btn"
            aria-label="Broadcast in-app alert to Home and Wildfire (does not use system Share)"
            onPointerDown={onBroadcastPointerDown}
            onClick={sendHelperAlert}
          >
            Broadcast alert
          </button>
          <p className="small helper-share-hint">
            In-app broadcast only (no WhatsApp / AirDrop / system share). Open Home or Wildfire in another tab to
            see the popup. Nothing speaks until someone taps <strong>Read aloud</strong> on the alert.
          </p>
        </aside>
      </div>
    </div>
  );
}
