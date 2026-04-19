import { useRef, useState } from "react";
import { useBreathing } from "../hooks/useBreathing";
import { usePersonDetection } from "../hooks/usePersonDetection";
import { usePersonOverlayCanvas } from "../hooks/usePersonOverlayCanvas";
import { useRppg } from "../hooks/useRppg";
import { useWildfireLocation } from "../hooks/useWildfireLocation";
import { useWildfireRisk } from "../hooks/useWildfireRisk";
import type { FacingMode } from "../hooks/useWebcamStream";
import { useWebcamStream } from "../hooks/useWebcamStream";
import { isWildfireModelInRange } from "../lib/wildfireCalibration";
import { broadcastWildfireShare } from "../lib/crossDashboardShare";
import { appendInboxAlertIfNew } from "../lib/incomingHelperInbox";

type Props = {
  onInboxRefresh: () => void;
};

/** Survivor: webcam person detection + rPPG heartbeat; station broadcasts; one-tap distress (people count only) to Wildfire. */
export function SurvivorDashboard({ onInboxRefresh }: Props) {
  const loc = useWildfireLocation();
  const wf = useWildfireRisk(loc.lat, loc.lon);

  const [facing, setFacing] = useState<FacingMode>("user");
  const { videoRef, error: camErr, ready } = useWebcamStream(facing);
  const {
    persons,
    personCount,
    personCountRef,
    getPersonCountNow,
    status: detStatus,
    roiRef,
  } = usePersonDetection(videoRef, ready);
  const rppg = useRppg(videoRef, roiRef);
  const breathing = useBreathing(videoRef, roiRef);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  usePersonOverlayCanvas(
    videoRef,
    overlayCanvasRef,
    persons,
    ready && detStatus === "ready",
  );

  const [manualBpm, setManualBpm] = useState("");
  const manualParsed =
    manualBpm.trim() === "" ? null : Number.parseInt(manualBpm.trim(), 10);
  const manualValid =
    manualParsed != null &&
    !Number.isNaN(manualParsed) &&
    manualParsed >= 30 &&
    manualParsed <= 240;

  const [distressSending, setDistressSending] = useState(false);
  const [distressSentFlash, setDistressSentFlash] = useState(false);

  const lat = loc.lat;
  const lon = loc.lon;
  const outOfRange =
    lat != null && lon != null && !isWildfireModelInRange(lat, lon);

  const detLabel =
    detStatus === "loading"
      ? "Loading vision model…"
      : detStatus === "error"
        ? "Vision model failed to load"
        : `${personCount} person${personCount === 1 ? "" : "s"} (COCO-SSD)`;

  async function sendDistressCall() {
    if (distressSending) return;
    setDistressSending(true);
    try {
      const snapshot = personCountRef.current;
      const fresh = await getPersonCountNow();
      const scanned = Math.max(fresh, snapshot, personCountRef.current);

      const riskLine = outOfRange
        ? "OUT OF RANGE — model not calibrated for this location"
        : `Fire risk ${wf.cls} — ~${Math.round(wf.tenDayWildfirePct)}% estimated wildfire chance in next ~10 days`;

      const msg = broadcastWildfireShare({
        instructions: "",
        riskLine,
        placeLabel: loc.placeLabel,
        fromShareClick: true,
        alertSource: "survivor",
        personCountScanned: scanned,
        lat: loc.lat,
        lon: loc.lon,
      });
      if (appendInboxAlertIfNew(msg)) {
        onInboxRefresh();
      }
      setDistressSentFlash(true);
      window.setTimeout(() => setDistressSentFlash(false), 2500);
    } finally {
      setDistressSending(false);
    }
  }

  return (
    <div className="dashboard survivor-page">
      <header className="page-head">
        <div>
          <h1>Survivor</h1>
          <p className="badge">Check-in · vision · distress</p>
          {loc.placeLabel ? (
            <p className="place-line">
              <span className="place-pin" aria-hidden>
                ◎
              </span>
              {loc.placeLabel}
            </p>
          ) : (
            <p className="small muted">Allow location or set a place from the Wildfire tab for risk context.</p>
          )}
        </div>
      </header>

      <p className="survivor-vision-lede small">
        <strong>Person detection</strong> and <strong>heartbeat (rPPG)</strong> run in your browser — not medical
        grade. Station broadcasts still open as alerts with <strong>Read aloud</strong>.
      </p>

      {camErr ? (
        <p className="small err" role="alert">
          Camera: {camErr}
        </p>
      ) : null}

      <div className="helper-layout survivor-vision-grid">
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
          </div>

          <section className="video-hero video-hero--wide">
            <video ref={videoRef} playsInline muted className="video-feed" />
            <canvas ref={overlayCanvasRef} className="video-overlay-canvas" aria-hidden />
          </section>

          <div className="helper-metrics helper-metrics--row">
            <div className="metric-card">
              <span className="metric-label">Detection (COCO-SSD)</span>
              <span className="metric-value">{detLabel}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">rPPG pulse</span>
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
            <span className="metric-label">Breathing (estimate)</span>
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

          <p className="small helper-hint">
            Green overlay = person centroid. rPPG needs a steady face and good light.
          </p>
        </div>

        <aside className="helper-side-col">
          <section className="hr-panel">
            <h2 className="hr-panel-title">Heart rate</h2>
            <label className="hr-label" htmlFor="sv-manual-bpm">
              Measured BPM (optional)
            </label>
            <p className="hr-explain">
              Override the webcam estimate with a watch, pulse oximeter, or manual count if needed.
            </p>
            <div className="hr-row">
              <input
                id="sv-manual-bpm"
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
        </aside>
      </div>

      <section className="survivor-distress-section">
        <p className="survivor-distress-lede">
          When the <strong>Wildfire station</strong> sends a broadcast, it opens here with <strong>Read aloud</strong>.
          <strong> Send distress call</strong> immediately logs the <strong>number of people scanned</strong> to the
          Wildfire table (no message form).
        </p>
        <button
          type="button"
          className="broadcast-alert-btn survivor-distress-btn"
          onClick={() => void sendDistressCall()}
          disabled={distressSending}
        >
          {distressSending ? "Sending…" : "Send distress call"}
        </button>
        {distressSentFlash ? (
          <p className="survivor-distress-sent small" role="status">
            Sent — check the Wildfire station table.
          </p>
        ) : null}
      </section>
    </div>
  );
}
