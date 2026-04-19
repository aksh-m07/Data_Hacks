import { useEffect, useRef, useState } from "react";
import { useBreathing } from "../hooks/useBreathing";
import { useBreathingLandmarks } from "../hooks/useBreathingLandmarks";
import { usePersonDetection } from "../hooks/usePersonDetection";
import { usePersonOverlayCanvas } from "../hooks/usePersonOverlayCanvas";
import { useWildfireLocation } from "../hooks/useWildfireLocation";
import { useWildfireRisk } from "../hooks/useWildfireRisk";
import { useWebcamStream } from "../hooks/useWebcamStream";
import { isWildfireModelInRange } from "../lib/wildfireCalibration";
import { broadcastWildfireShare } from "../lib/crossDashboardShare";
import { appendInboxAlertIfNew } from "../lib/incomingHelperInbox";
import { setLiveMapLocation } from "../lib/liveMapLocation";
import type { SurvivorLiveSnapshot } from "../lib/wildfireCivilianProtocol";
import { SmokeAlarmListener } from "./SmokeAlarmListener";
import { SurvivorWildfireProtocolPanel } from "./SurvivorWildfireProtocolPanel";

type Props = {
  onInboxRefresh: () => void;
  onSmokeAlarm: () => void;
  /** True while a detected alarm is pending (clears after Wildfire shows the toast window). */
  smokeAlarmActive: boolean;
};

/** Hide benign Chrome camera race + help-link noise from the UI */
function formatSurvivorCameraError(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.toLowerCase();
  if (t.includes("play() request was interrupted") || t.includes("interrupted by a new load")) return null;
  if (t.includes("goo.gl/") || t.includes("https://goo.gl")) return null;
  return raw;
}

/** Survivor: webcam person detection + rPPG heartbeat; station broadcasts; one-tap distress (people count only) to Wildfire. */
export function SurvivorDashboard({ onInboxRefresh, onSmokeAlarm, smokeAlarmActive }: Props) {
  const loc = useWildfireLocation();
  const wf = useWildfireRisk(loc.lat, loc.lon);

  useEffect(() => {
    setLiveMapLocation(loc.lat, loc.lon, loc.placeLabel);
  }, [loc.lat, loc.lon, loc.placeLabel]);

  const { videoRef, error: camErr, ready, mediaStream } = useWebcamStream("user", {
    withAudio: true,
  });
  const {
    persons,
    personCount,
    personCountRef,
    getPersonCountNow,
    status: detStatus,
    roiRef,
  } = usePersonDetection(videoRef, ready);
  const { landmarksRef, status: lmStatus } = useBreathingLandmarks(videoRef, ready);
  const breathing = useBreathing(videoRef, roiRef, landmarksRef);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  usePersonOverlayCanvas(
    videoRef,
    overlayCanvasRef,
    persons,
    ready && detStatus === "ready",
    landmarksRef,
    lmStatus === "ready",
  );

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

  const signalQuality =
    detStatus !== "ready"
      ? "Initializing"
      : breathing.bpm != null && breathing.confidence >= 0.2
        ? "Stable"
      : personCount > 0
          ? "Partial"
          : "Low";

  const graphMin = 0;
  const graphMax = 30;
  const graphW = 360;
  const graphH = 130;
  const graphPoints =
    breathing.trend.length > 1
      ? breathing.trend
          .map((v, i, arr) => {
            const x = (i / (arr.length - 1)) * graphW;
            const clamped = Math.max(graphMin, Math.min(graphMax, v));
            const y = graphH - ((clamped - graphMin) / (graphMax - graphMin)) * graphH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";

  const camErrDisplay = formatSurvivorCameraError(camErr);

  const wildfireProtocolSnapshot: SurvivorLiveSnapshot = {
    placeLabel: loc.placeLabel,
    riskBand: wf.cls,
    riskPct: outOfRange ? null : Math.round(wf.tenDayWildfirePct),
    outOfRange,
    personCount,
    breathingNote:
      breathing.bpm != null
        ? `~${breathing.bpm}/min (rough motion trend, non-medical)`
        : "estimating / no stable trend",
  };

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
      <header className="page-head survivor-head">
        <div className="survivor-head-grid">
          <div className="survivor-head-main">
            <h1>Survivor</h1>
            <p className="survivor-head-copy">
              This view uses webcam person detection and breathing trend only. No heart-rate claim is shown here to
              avoid false precision.
            </p>
            {loc.placeLabel ? (
              <p className="place-line survivor-place-line">{loc.placeLabel}</p>
            ) : (
              <p className="small muted survivor-place-line">
                Allow location or set a place from the Wildfire tab for risk context.
              </p>
            )}
          </div>
          <section className="survivor-head-panel" aria-label="Current status">
            <p className="survivor-head-panel-title">Current status</p>
            <div className="survivor-head-kpis">
              <div className="survivor-head-kpi">
                <span className="survivor-head-kpi-label">Risk</span>
                <strong>{outOfRange ? "Out of range" : wf.cls}</strong>
              </div>
              <div className="survivor-head-kpi">
                <span className="survivor-head-kpi-label">People</span>
                <strong>
                  {personCount} person{personCount === 1 ? "" : "s"}
                </strong>
              </div>
              <div className="survivor-head-kpi">
                <span className="survivor-head-kpi-label">Signal</span>
                <strong>{signalQuality}</strong>
              </div>
            </div>
            <div className="survivor-head-alarm-listen">
              <SmokeAlarmListener
                mediaStream={mediaStream}
                onAlarm={onSmokeAlarm}
                alarmActive={smokeAlarmActive}
              />
            </div>
          </section>
        </div>
      </header>

      {camErrDisplay ? (
        <p className="small err survivor-cam-err" role="alert">
          Camera: {camErrDisplay}
        </p>
      ) : null}

      <div className="survivor-shell">
        <section className="survivor-main-card">
          <div className="survivor-main-top">
            <p className="survivor-live-note">Live monitoring</p>
          </div>

          <section className="video-hero video-hero--wide survivor-video-frame">
            <video ref={videoRef} playsInline muted className="video-feed" />
            <canvas ref={overlayCanvasRef} className="video-overlay-canvas" aria-hidden />
          </section>

          <div className="survivor-metrics-grid">
            <div className="metric-card survivor-metric-card">
              <span className="metric-label">People detected</span>
              <span className="metric-value survivor-metric-number">{personCount}</span>
              <span className="survivor-metric-note">{detLabel}</span>
            </div>
            <div className="metric-card survivor-metric-card">
              <span className="metric-label">Camera signal quality</span>
              <span className="metric-value survivor-metric-number">{signalQuality}</span>
              <span className="survivor-metric-note">
                {detStatus === "ready" ? "person ROI tracking" : "warming up"}
              </span>
            </div>
          </div>

          <div className="survivor-breath-card" aria-label="Breathing trend graph">
            <div className="survivor-breath-head">
              <span className="metric-label">Breathing trend (0–30 / min)</span>
              <span className="survivor-breath-readout">
                {breathing.bpm != null ? `~${breathing.bpm}/min` : "estimating…"}
              </span>
            </div>
            <div className="survivor-breath-graph-wrap">
              <svg viewBox={`0 0 ${graphW} ${graphH}`} className="survivor-breath-graph" role="img">
                <line x1="0" y1={graphH} x2={graphW} y2={graphH} className="graph-axis" />
                <line x1="0" y1={graphH * (2 / 3)} x2={graphW} y2={graphH * (2 / 3)} className="graph-grid" />
                <line x1="0" y1={graphH * (1 / 3)} x2={graphW} y2={graphH * (1 / 3)} className="graph-grid" />
                <line x1="0" y1="0" x2={graphW} y2="0" className="graph-grid" />
                {graphPoints ? <polyline points={graphPoints} className="graph-line-red" /> : null}
              </svg>
              <div className="survivor-breath-ylabels" aria-hidden>
                <span>30</span>
                <span>20</span>
                <span>10</span>
                <span>0</span>
              </div>
            </div>
          </div>

          <p className="small helper-hint survivor-help-note">
            Green overlay = person centroid. Breathing trend is rough and non-medical.
          </p>

          <SurvivorWildfireProtocolPanel snapshot={wildfireProtocolSnapshot} embedded />
        </section>

        <aside className="survivor-side-card">
          <section className="survivor-status-card">
            <p className="survivor-status-label">Current scan</p>
            <p className="survivor-status-value">
              {personCount} person{personCount === 1 ? "" : "s"}
            </p>
            <p className="survivor-status-sub">
              Distress call sends the latest scanned count directly to Wildfire station.
            </p>
          </section>
          <section className="survivor-status-card">
            <p className="survivor-status-label">Breathing trend</p>
            <p className="survivor-status-value">
              {breathing.bpm != null ? `~${breathing.bpm}/min` : "Estimating…"}
            </p>
            <p className="survivor-status-sub">For motion trend only, not a medical respiratory value.</p>
          </section>

          <section className="survivor-distress-section survivor-distress-card survivor-distress-card--side">
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
        </aside>
      </div>
    </div>
  );
}
