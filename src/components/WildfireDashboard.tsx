import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useCountdown } from "../hooks/useCountdown";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useWildfireRisk } from "../hooks/useWildfireRisk";
import { useWildfireLocation } from "../hooks/useWildfireLocation";
import { broadcastWildfireShare } from "../lib/crossDashboardShare";
import { removeInboxRowById } from "../lib/incomingHelperInbox";
import { searchPlaces, type GeocodeHit } from "../lib/geocode";
import { FEATURE_LABELS } from "../lib/features";
import type { HelperInboxRow } from "../lib/incomingHelperInbox";
import { isWildfireModelInRange } from "../lib/wildfireCalibration";
import { SpreadMap } from "./SpreadMap";

type Props = {
  /** Distress calls from the Survivor dashboard (same browser inbox). */
  survivorDistressRows: HelperInboxRow[];
  onInboxRefresh: () => void;
};

export function WildfireDashboard({ survivorDistressRows, onInboxRefresh }: Props) {
  const loc = useWildfireLocation();
  const wf = useWildfireRisk(loc.lat, loc.lon);
  const cd = useCountdown(wf.nextRefreshAt || Date.now());

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [instructionText, setInstructionText] = useState("");
  const voice = useSpeechRecognition();

  const wasListening = useRef(false);
  useEffect(() => {
    if (voice.listening && voice.text) {
      setInstructionText(voice.text);
    }
    if (wasListening.current && !voice.listening && voice.text) {
      setInstructionText(voice.text);
    }
    wasListening.current = voice.listening;
  }, [voice.text, voice.listening]);

  const [showRiskDebug, setShowRiskDebug] = useState(false);
  useEffect(() => {
    const sync = () =>
      new URLSearchParams(window.location.search).get("debug") === "risk";
    setShowRiskDebug(sync());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const { lat, lon } = loc;
  const outOfRange =
    lat != null && lon != null && !isWildfireModelInRange(lat, lon);

  const borderClass = outOfRange
    ? "dash-oor"
    : wf.cls === "CRITICAL"
      ? "dash-critical"
      : wf.cls === "HIGH"
        ? "dash-high"
        : wf.cls === "MODERATE"
          ? "dash-mod"
          : "dash-low";

  async function runSearch() {
    setSearching(true);
    setSearchErr(null);
    try {
      const h = await searchPlaces(q);
      setHits(h);
      if (h.length === 0) setSearchErr("No places found — try a city or region name.");
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "Search failed");
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  function pickHit(h: GeocodeHit) {
    loc.setManualPlace({
      lat: h.latitude,
      lon: h.longitude,
      label: h.label,
    });
    setHits([]);
    setQ("");
    setSearchErr(null);
  }

  function blurFocusedField() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  /** Station → Survivor dashboard: popup + Read aloud (no modal on this screen). */
  function broadcastAlert(ev: MouseEvent<HTMLButtonElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    blurFocusedField();
    const riskLine = outOfRange
      ? "OUT OF RANGE — model not calibrated for this location"
      : `Fire risk ${wf.cls} — ~${Math.round(wf.tenDayWildfirePct)}% estimated wildfire chance in next ~10 days`;
    broadcastWildfireShare({
      instructions: instructionText.trim(),
      riskLine,
      placeLabel: loc.placeLabel,
      fromShareClick: true,
      alertSource: "wildfire",
      lat: loc.lat,
      lon: loc.lon,
    });
  }

  function removeInboxRow(rowId: string) {
    if (removeInboxRowById(rowId)) {
      onInboxRefresh();
    }
  }

  function onBroadcastPointerDown() {
    blurFocusedField();
  }

  return (
    <div className={`dashboard wf-page ${borderClass}`}>
      <header className="page-head wf-page-head">
        <div>
          <h1>Wildfire station</h1>
          <p className="badge">{outOfRange ? "OUT OF RANGE" : wf.cls}</p>
          {loc.placeLabel ? (
            <p className="place-line">
              <span className="place-pin" aria-hidden>
                ◎
              </span>
              {loc.placeLabel}
              {loc.isManual ? (
                <button type="button" className="linkish" onClick={() => loc.clearManualUseGps()}>
                  Use GPS instead
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      <p className="coverage-note">
        <strong>Coverage:</strong> Weather and maps use Open-Meteo / OSRM worldwide where data exists.
        EPA <strong>AirNow</strong> (optional API key) is <strong>United States</strong> only; without it, AQI
        comes from Open-Meteo globally. The <strong>~10-day wildfire %</strong> headline is a{" "}
        <strong>model estimate</strong> (not a forecast guarantee) and only applies inside a{" "}
        <strong>Western US calibration box</strong> (roughly Pacific to ~102°W); elsewhere the banner reads{" "}
        <strong>OUT OF RANGE</strong> — live weather and map still update.
      </p>

      <div className="wf-layout">
        <div className="wf-col wf-col-main">
          <section className="location-panel">
            <h2 className="location-panel-title">Location</h2>
            <p className="location-panel-hint">
              Search any city or region, or keep using your device GPS when available.
            </p>
            <div className="location-form">
              <input
                type="search"
                className="location-input"
                placeholder="e.g. San Diego, CA · Denver · Athens GR"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
              />
              <button
                type="button"
                className="btn location-search-btn"
                onClick={() => void runSearch()}
                disabled={searching || q.trim().length < 2}
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {searchErr ? <p className="banner err location-search-err">{searchErr}</p> : null}
            {hits.length > 0 ? (
              <ul className="location-hits">
                {hits.map((h) => (
                  <li key={`${h.label}-${h.latitude}-${h.longitude}`}>
                    <button type="button" className="location-hit-btn" onClick={() => pickHit(h)}>
                      {h.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {!loc.isManual && loc.geoErr ? (
              <p className="banner err">GPS: {loc.geoErr} — use search above.</p>
            ) : null}
            {loc.gpsPending && !loc.isManual ? (
              <p className="banner">Waiting for GPS… or enter a place above.</p>
            ) : null}
          </section>

          {wf.err ? <p className="banner err">{wf.err}</p> : null}

          <div className={`risk-banner ${borderClass}`}>
            {outOfRange
              ? "OUT OF RANGE — model not calibrated for this location"
              : `${wf.cls} RISK · ~${Math.round(wf.tenDayWildfirePct)}% wildfire in next ~10 days (estimate)`}
          </div>

          {showRiskDebug && wf.riskInspect ? (
            <section className="risk-debug" aria-label="Risk model verification">
              <h2 className="risk-debug-title">Verification (?debug=risk)</h2>
              <p className="risk-debug-lede">
                The headline <strong>~10-day wildfire %</strong> comes from{" "}
                <code>tenDayWildfireProbability.ts</code>. The ONNX row below is the underlying regressor index (
                <code>scoreCalibration.ts</code>) before that blend.
              </p>
              <dl className="risk-debug-dl">
                <dt>~10-day wildfire % (headline)</dt>
                <dd>
                  <code>{Math.round(wf.tenDayWildfirePct)}</code> — class{" "}
                  <code>{wf.cls}</code>
                </dd>
                <dt>Raw ONNX → calibrated index (not the headline)</dt>
                <dd>
                  <code>{wf.riskInspect.rawScore.toFixed(6)}</code> → {Math.round(wf.score)} (
                  <code>scoreCalibration.ts</code>)
                </dd>
                <dt>Output tensor shape</dt>
                <dd>
                  <code>{JSON.stringify(wf.riskInspect.outputDims)}</code>
                </dd>
              </dl>
              <table className="risk-debug-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Normalized input</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_LABELS.map((label, i) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>
                        <code>
                          {wf.riskInspect.features[i] !== undefined
                            ? wf.riskInspect.features[i].toFixed(4)
                            : "—"}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="why">
            <h2>
              {outOfRange ? "Feature mix (not a valid score here)" : "Training-time drivers (not “why 73 today”)"}
            </h2>
            {outOfRange ? (
              <p className="small oor-hint">
                Driver percentages reflect the trained model’s inputs but the headline risk number does not
                apply outside the Western US training region.
              </p>
            ) : (
              <p className="small why-footnote muted">
                The headline <strong>~10-day %</strong> is a <strong>wildfire estimate</strong> from live conditions (
                see footer). These <strong>three pills</strong> are a <strong>fixed training-time ranking</strong> — they{" "}
                <strong>do not</strong> update per city. Their % only split the top three importances (sum ~100%
                among those three); they are <strong>not</strong> the same as the headline 10-day %.
              </p>
            )}
            <div className="pills">
              {wf.drivers.map((d) => (
                <span
                  key={d.label}
                  className="pill"
                  title="Training importance among the model’s top 3 features — global snapshot, same for every location"
                >
                  {d.label} · {d.pct}% of top-3
                </span>
              ))}
            </div>
          </section>

          {wf.raw ? (
            <section className="metrics3">
              <div className="metric">
                <h3>Air (AQI)</h3>
                <p className="big">{wf.raw.aqi}</p>
                <p className="small">{wf.aqSource}</p>
              </div>
              <div className="metric">
                <h3>Heat</h3>
                <p className="big">{Math.round(wf.raw.tempF)}°F</p>
                <p className="small">
                  RH {Math.round(wf.raw.humidity)}% · HI {Math.round(wf.raw.heatIndex)}°F
                </p>
                {wf.wxSource ? (
                  <p className="small muted">{wf.wxSource}</p>
                ) : null}
              </div>
              <div className="metric">
                <h3>Wind</h3>
                <p className="big">{Math.round(wf.raw.windMph)} mph</p>
                <p className="small">Spread toward {wf.spreadCardinal}</p>
              </div>
            </section>
          ) : null}

          {wf.scrippsRef ? (
            <section className="scripps-strip" aria-label="Scripps AWN challenge dataset">
              <span className="scripps-strip-label">Scripps AWN</span>
              <span className="scripps-strip-body">
                {wf.scrippsRef.stationId} · {Math.round(wf.scrippsRef.tempF)}°F ·{" "}
                {Math.round(wf.scrippsRef.humidity)}% RH · {Math.round(wf.scrippsRef.windMph)} mph wind ·{" "}
                {Math.round(wf.scrippsRef.distanceKm)} km to UCSD station
              </span>
            </section>
          ) : null}

          {wf.firmsHotspots > 0 || wf.nearestFireKm !== null ? (
            <section className="firms-strip">
              <span className="firms-dot" aria-hidden>🔥</span>
              <span>
                NASA FIRMS (7d): <strong>{wf.firmsHotspots}</strong> active California hotspots
                {wf.nearestFireKm !== null ? (
                  <> · nearest <strong>{wf.nearestFireKm} km</strong> away</>
                ) : null}
              </span>
            </section>
          ) : wf.raw ? (
            <section className="firms-strip firms-strip--none">
              <span>NASA FIRMS: no active California hotspots in last 7 days</span>
            </section>
          ) : null}

          <div className="refresh-row">
            <span>
              Next auto refresh: {Math.floor(cd / 60)}:
              {(cd % 60).toString().padStart(2, "0")}
            </span>
            <button type="button" className="btn" onClick={() => wf.refresh()} disabled={wf.loading}>
              {wf.loading ? "Updating…" : "Refresh now"}
            </button>
          </div>
        </div>

        <aside className="wf-col wf-col-side wf-side-stack">
          {lat != null && lon != null && wf.raw ? (
            <SpreadMap lat={lat} lon={lon} windFromDeg={wf.raw.windDirDeg} />
          ) : (
            <div className="map-placeholder">Map appears when a location is set and weather loads.</div>
          )}

          <section className="groq-box">
            <h2>Voice briefing (Groq)</h2>
            {wf.briefingErr ? <p className="small err">{wf.briefingErr}</p> : null}
            <p className="briefing">{wf.briefing || (wf.loading ? "Generating briefing…" : "—")}</p>
          </section>

          <section className="wf-voice-panel">
            <h2 className="wf-voice-title">Instructions for helpers (voice → text)</h2>
            <p className="wf-voice-hint">
              Dictate or type a message, then <strong>Broadcast alert</strong>. The <strong>Survivor</strong> dashboard
              shows a popup with <strong>Read aloud</strong> — not here. Incoming distress from Survivor is listed in
              the table below.
            </p>
            {voice.supported ? (
              <button
                type="button"
                className={`btn ghost wf-voice-btn ${voice.listening ? "btn-live" : ""}`}
                onClick={() => voice.toggle()}
              >
                {voice.listening ? "Stop recording" : "Start voice dictation"}
              </button>
            ) : (
              <p className="wf-voice-unsupported small">
                Speech recognition not available in this browser — type in the message field.
              </p>
            )}
            <label className="wf-voice-label" htmlFor="wf-instructions">
              Message for broadcast
            </label>
            <textarea
              id="wf-instructions"
              className="wf-voice-textarea"
              rows={5}
              placeholder="Spoken instructions appear here — or type directly."
              value={instructionText}
              onChange={(e) => setInstructionText(e.target.value)}
            />
            <button
              type="button"
              className="broadcast-alert-btn"
              aria-label="Broadcast station message to other tabs"
              onPointerDown={onBroadcastPointerDown}
              onClick={broadcastAlert}
            >
              Broadcast alert
            </button>
          </section>
        </aside>
      </div>

      <section
        className="wf-survivor-inbox wf-survivor-inbox--bottom"
        aria-label="Survivor distress calls"
      >
        <h2 className="wf-survivor-inbox-title">Distress calls (from Survivor)</h2>
        <p className="wf-survivor-inbox-lede">
          Rows come from <strong>Send distress call</strong> on the Survivor dashboard in this browser.{" "}
          <strong>Remove</strong> clears this device only.
        </p>
        {survivorDistressRows.length === 0 ? (
          <p className="wf-survivor-inbox-empty">
            No distress calls yet. Switch to <strong>Survivor</strong> in the header and send a distress call.
          </p>
        ) : (
          <div className="wf-inbox-table-wrap">
            <table className="wf-inbox-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Location</th>
                  <th scope="col">Coordinates</th>
                  <th scope="col">People scanned</th>
                  <th scope="col">Message</th>
                  <th scope="col">Risk / context</th>
                  <th scope="col">Curate</th>
                </tr>
              </thead>
              <tbody>
                {survivorDistressRows.map((row) => (
                  <tr key={row.id}>
                    <td className="wf-inbox-nowrap">{new Date(row.ts).toLocaleString()}</td>
                    <td>{row.placeLabel ?? "—"}</td>
                    <td className="wf-inbox-nowrap wf-inbox-coords">
                      {row.lat != null && row.lon != null
                        ? `${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}`
                        : "—"}
                    </td>
                    <td className="wf-inbox-num">
                      {row.personCountScanned !== undefined && row.personCountScanned !== null
                        ? row.personCountScanned
                        : "—"}
                    </td>
                    <td className="wf-inbox-msg">
                      {row.instructions.trim() ? row.instructions : "—"}
                    </td>
                    <td className="wf-inbox-meta">{row.riskLine}</td>
                    <td className="wf-inbox-curate">
                      <button
                        type="button"
                        className="btn ghost wf-inbox-remove-btn"
                        aria-label="Remove this distress call from the log"
                        onClick={() => removeInboxRow(row.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="attr">
        The <strong>~10-day wildfire %</strong> blends ONNX output with weather, FIRMS proximity, and season (
        <code>tenDayWildfireProbability.ts</code>). Data: <strong>local Open-Meteo</strong>; <strong>Scripps SIO AWN</strong> CSV is
        loaded from <code>public/scripps/</code> (or <code>VITE_SCRIPPS_CSV_URL</code>) for the challenge dataset ·
        Air quality: Open-Meteo or EPA AirNow (<code>VITE_AIRNOW_API_KEY</code>) ·
        Fire hotspots: <strong>NASA FIRMS VIIRS 7-day public CSV</strong> ·
        Soil moisture: Open-Meteo · Evac routing: OSRM ·
        ONNX model: <code>npm run export-model</code> ({" "}
        <code>public/models/training_meta.json</code> — {" "}
        {(() => {
          try {
            return null;
          } catch {
            return null;
          }
        })()}
        trained on NOAA + CNRA + Open-Meteo + <strong>required Scripps AWN</strong>).
      </footer>
    </div>
  );
}
