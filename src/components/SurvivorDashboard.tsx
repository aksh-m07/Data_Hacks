import { useEffect, useRef, useState } from "react";
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
import { createPulseSession, pulseSessionEventsUrl, type PulseResult, type PulseSession } from "../lib/pulseBridge";

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

  const [distressSending, setDistressSending] = useState(false);
  const [distressSentFlash, setDistressSentFlash] = useState(false);
  const [phonePulse, setPhonePulse] = useState<PulseResult | null>(null);
  const [pulseSession, setPulseSession] = useState<PulseSession | null>(null);
  const [pulseStatus, setPulseStatus] = useState<"idle" | "starting" | "waiting" | "received" | "error">("idle");
  const [pulseErr, setPulseErr] = useState<string | null>(null);

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

  const pulseBpm = phonePulse?.bpm ?? rppg.bpm;
  const pulseSource = phonePulse ? "iPhone camera PPG" : "webcam rPPG";

  useEffect(() => {
    if (!pulseSession) return;
    const es = new EventSource(pulseSessionEventsUrl(pulseSession.sessionId));
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as PulseResult;
        if (parsed && typeof parsed.bpm === "number") {
          setPhonePulse(parsed);
          setPulseStatus("received");
          setPulseErr(null);
        }
      } catch {
        /* ignore malformed event payloads */
      }
    };
    es.onerror = () => {
      setPulseStatus((prev) => (prev === "received" ? prev : "error"));
    };
    return () => es.close();
  }, [pulseSession]);

  async function startPhonePulseMeasure() {
    if (pulseStatus === "starting" || pulseStatus === "waiting") return;
    setPulseStatus("starting");
    setPulseErr(null);
    try {
      const session = await createPulseSession();
      setPulseSession(session);
      setPulseStatus("waiting");
      const isIPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIPhone) {
        window.location.href = session.deepLink;
      } else {
        window.open(session.webMeasureUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setPulseStatus("error");
      setPulseErr(e instanceof Error ? e.message : "Could not start iPhone pulse measurement.");
    }
  }

  async function copySessionCode() {
    if (!pulseSession) return;
    try {
      await navigator.clipboard.writeText(pulseSession.sessionId);
      setPulseErr(null);
    } catch {
      setPulseErr("Could not copy automatically. Copy session code manually.");
    }
  }

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
            <p className="badge">Check-in · Vision · Distress</p>
            <p className="survivor-head-copy">
              Person detection and heartbeat (rPPG) run in your browser and are not medical-grade. Wildfire station
              broadcasts still open here with Read aloud.
            </p>
            {loc.placeLabel ? (
              <p className="place-line survivor-place-line">
                <span className="place-pin" aria-hidden>
                  ◎
                </span>
                {loc.placeLabel}
              </p>
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
                <span className="survivor-head-kpi-label">Pulse</span>
                <strong>{pulseBpm != null ? `~${pulseBpm} BPM` : "Estimating"}</strong>
              </div>
            </div>
          </section>
        </div>
      </header>

      {camErr ? (
        <p className="small err survivor-cam-err" role="alert">
          Camera: {camErr}
        </p>
      ) : null}

      <div className="survivor-shell">
        <section className="survivor-main-card">
          <div className="survivor-main-top">
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
            <p className="survivor-live-note">Live monitoring</p>
          </div>

          <section className="video-hero video-hero--wide survivor-video-frame">
            <video ref={videoRef} playsInline muted className="video-feed" />
            <canvas ref={overlayCanvasRef} className="video-overlay-canvas" aria-hidden />
          </section>

          <div className="survivor-metrics-grid">
            <div className="metric-card survivor-metric-card">
              <span className="metric-label">Detection (COCO-SSD)</span>
              <span className="metric-value">{detLabel}</span>
            </div>
            <div className="metric-card survivor-metric-card">
              <span className="metric-label">rPPG pulse</span>
              <span className="metric-value">
                {pulseBpm != null ? (
                  <>
                    ~{pulseBpm} BPM · {phonePulse ? "iPhone measurement" : rppg.status}
                  </>
                ) : (
                  <>{rppg.status}</>
                )}
              </span>
            </div>
          </div>

          <div className="survivor-breath-card">
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

          <p className="small helper-hint survivor-help-note">
            Green overlay = person centroid. rPPG needs a steady face and good light.
          </p>
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
            <p className="survivor-status-label">Heart rate source</p>
            <p className="survivor-status-value">
              {pulseBpm != null ? `~${pulseBpm} BPM` : "Estimating…"}
            </p>
            <p className="survivor-status-sub">Using {pulseSource}.</p>
          </section>
          <section className="survivor-status-card">
            <p className="survivor-status-label">iPhone pulse</p>
            <button
              type="button"
              className="btn survivor-pulse-btn"
              onClick={() => void startPhonePulseMeasure()}
              disabled={pulseStatus === "starting" || pulseStatus === "waiting"}
            >
              {pulseStatus === "starting"
                ? "Starting…"
                : pulseStatus === "waiting"
                  ? "Waiting for iPhone…"
                  : "Measure Pulse on iPhone"}
            </button>
            <p className="survivor-status-sub">
              {pulseSession
                ? "Use this full session code in the iPhone app."
                : "Starts phone camera measurement and syncs BPM back here."}
            </p>
            {pulseSession ? (
              <div className="survivor-session-row">
                <code className="survivor-session-code">{pulseSession.sessionId}</code>
                <button type="button" className="btn survivor-copy-btn" onClick={() => void copySessionCode()}>
                  Copy
                </button>
              </div>
            ) : null}
            {pulseErr ? <p className="small err">{pulseErr}</p> : null}
          </section>
        </aside>
      </div>

      <section className="survivor-distress-section survivor-distress-card">
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
