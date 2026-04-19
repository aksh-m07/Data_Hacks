import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEATURE_LABELS,
  gatherLiveFeatures,
  riskClass,
  toModelInput,
  topContributions,
  type RawFeatures,
  type ScrippsRef,
} from "../lib/features";
import { groqBriefing, wildfireSystemPrompt } from "../lib/groq";
import { stableLocationKey } from "../lib/locationKey";
import { downwindBearingCardinal, windFromCardinal } from "../lib/osrm";
import { loadFeatureImportances, predictRisk } from "../lib/riskInference";
import {
  computeEnvironmentalWildfireIndex,
  estimateTenDayWildfireProbabilityPercent,
} from "../lib/tenDayWildfireProbability";

/** Auto refresh cadence (fixed interval; skips a tick if the previous fetch is still running). */
export const WILDFIRE_AUTO_REFRESH_MS = 5 * 60 * 1000;

/**
 * GPS `watchPosition` updates continuously. Rounding to ~100 m avoids restarting the interval
 * on every micro-move (which was causing rapid repeat loads + UI glitches).
 */
function coordKey(lat: number | null, lon: number | null): string | null {
  return stableLocationKey(lat, lon);
}

export type RiskInspect = {
  features: number[];
  rawScore: number;
  outputDims: number[];
  /** Same inputs as headline % — for ?debug=risk. */
  environmentalIndex: number;
};

export type WildfireState = {
  raw: RawFeatures | null;
  /** ONNX calibrated index 0–100 (debug / internal). */
  score: number;
  /** Heuristic % — headline “wildfire in next ~10 days” on the gauge. */
  tenDayWildfirePct: number;
  cls: ReturnType<typeof riskClass>;
  drivers: { label: string; pct: number }[];
  wxSource: string;
  briefing: string;
  briefingErr: string | null;
  aqSource: string;
  spreadCardinal: string;
  firmsHotspots: number;
  nearestFireKm: number | null;
  scrippsRef: ScrippsRef | null;
  loading: boolean;
  err: string | null;
  lastUpdate: Date | null;
  nextRefreshAt: number;
  riskInspect: RiskInspect | null;
};

export function useWildfireRisk(lat: number | null, lon: number | null) {
  const [s, setS] = useState<WildfireState>({
    raw: null,
    score: 0,
    tenDayWildfirePct: 0,
    cls: "LOW",
    drivers: [],
    wxSource: "",
    briefing: "",
    briefingErr: null,
    aqSource: "",
    spreadCardinal: "",
    firmsHotspots: 0,
    nearestFireKm: null,
    scrippsRef: null,
    loading: true,
    err: null,
    lastUpdate: null,
    nextRefreshAt: 0,
    riskInspect: null,
  });

  const impRef = useRef<number[] | null>(null);
  const latRef = useRef(lat);
  const lonRef = useRef(lon);
  latRef.current = lat;
  lonRef.current = lon;

  const inFlightRef = useRef(false);

  const locationKey = useMemo(() => coordKey(lat, lon), [lat, lon]);

  const runFetch = useCallback(async (opts?: { force?: boolean }) => {
    const la = latRef.current;
    const lo = lonRef.current;
    if (la == null || lo == null) return;
    if (inFlightRef.current && !opts?.force) return;
    inFlightRef.current = true;
    setS((p) => ({ ...p, loading: true, err: null }));
    try {
      if (!impRef.current) {
        impRef.current = await loadFeatureImportances();
      }
      const { raw, meta } = await gatherLiveFeatures(la, lo);
      const wxSource = meta.wxSource;
      const firmsHotspots = meta.firmsHotspots;
      const nearestFireKm = meta.nearestFireKm;
      const vec = toModelInput(raw);
      const { score, error: infErr, rawScore, outputDims } = await predictRisk(vec);
      if (infErr) throw new Error(infErr);
      const environmentalIndex = computeEnvironmentalWildfireIndex(raw, nearestFireKm, firmsHotspots);
      const tenDayWildfirePct = estimateTenDayWildfireProbabilityPercent({
        calibratedScore: score,
        rawOnnxScore: rawScore,
        raw,
        nearestFireKm,
        firmsHotspots,
      });
      const cls = riskClass(tenDayWildfirePct);
      const imps = impRef.current ?? Array(11).fill(1 / 11);
      const drivers = topContributions(imps, FEATURE_LABELS);
      const spreadCardinal = downwindBearingCardinal(raw.windDirDeg);
      const aqiCat =
        raw.aqi <= 50
          ? "Good"
          : raw.aqi <= 100
            ? "Moderate"
            : raw.aqi <= 150
              ? "Unhealthy (sensitive)"
              : "Unhealthy";

      const sys = wildfireSystemPrompt(
        Math.round(tenDayWildfirePct),
        cls,
        drivers,
        raw.tempF,
        raw.humidity,
        raw.heatIndex,
        raw.aqi,
        aqiCat,
        raw.windMph,
        windFromCardinal(raw.windDirDeg),
        spreadCardinal,
      );
      const g = await groqBriefing(
        sys,
        "Give the briefing and actions now.",
      );

      const now = Date.now();
      const nextAt = now + WILDFIRE_AUTO_REFRESH_MS;

      setS((prev) => ({
        ...prev,
        raw,
        score,
        tenDayWildfirePct,
        cls,
        drivers,
        wxSource,
        briefing: g.text,
        briefingErr: g.error ?? null,
        aqSource: meta.aqSource,
        spreadCardinal,
        firmsHotspots,
        nearestFireKm,
        scrippsRef: meta.scrippsRef,
        loading: false,
        err: null,
        lastUpdate: new Date(),
        nextRefreshAt: nextAt,
        riskInspect: {
          features: Array.from(vec),
          rawScore,
          outputDims,
          environmentalIndex,
        },
      }));
    } catch (e) {
      setS((p) => ({
        ...p,
        loading: false,
        err: e instanceof Error ? e.message : "Update failed",
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const refresh = useCallback(() => {
    void runFetch({ force: true });
  }, [runFetch]);

  useEffect(() => {
    if (locationKey == null) return;

    void runFetch({ force: true });
    const id = window.setInterval(() => {
      void runFetch();
    }, WILDFIRE_AUTO_REFRESH_MS);

    return () => window.clearInterval(id);
  }, [locationKey, runFetch]);

  return { ...s, refresh, locationKey };
}
