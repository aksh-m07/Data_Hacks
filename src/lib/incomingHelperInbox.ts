import type { WildfireShareMessage } from "./crossDashboardShare";

const STORAGE_KEY = "disasterdocs-helper-inbox-v1";
const MAX_ROWS = 50;

export type HelperInboxRow = {
  id: string;
  ts: number;
  placeLabel: string | null;
  instructions: string;
  riskLine: string;
  /** Who logged this row (older stored rows may omit — treated as helper). */
  source?: "helper" | "survivor";
  /** People detected by COCO-SSD when distress was sent (Survivor). */
  personCountScanned?: number | null;
  /** WGS-84 coordinates when the alert was sent (optional). */
  lat?: number | null;
  lon?: number | null;
};

/** Persist Helper and Survivor distress broadcasts for the Wildfire inbox table. */
export function appendInboxAlertIfNew(msg: WildfireShareMessage): boolean {
  const src = msg.alertSource ?? "wildfire";
  if (src !== "helper" && src !== "survivor") return false;
  try {
    const id = `${msg.ts}:${msg.originTabId ?? "na"}:${src}`;
    const raw = localStorage.getItem(STORAGE_KEY);
    let rows: HelperInboxRow[] = raw ? (JSON.parse(raw) as HelperInboxRow[]) : [];
    if (!Array.isArray(rows)) rows = [];
    if (rows.some((r) => r.id === id)) return false;
    rows.unshift({
      id,
      ts: msg.ts,
      placeLabel: msg.placeLabel,
      instructions: msg.instructions,
      riskLine: msg.riskLine,
      source: src === "survivor" ? "survivor" : "helper",
      personCountScanned:
        msg.personCountScanned === undefined ? undefined : msg.personCountScanned,
      lat: msg.lat === undefined ? undefined : msg.lat,
      lon: msg.lon === undefined ? undefined : msg.lon,
    });
    rows = rows.slice(0, MAX_ROWS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

export function getHelperInboxRows(): HelperInboxRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as HelperInboxRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Remove one row by id (curate the log). Returns whether a row was removed. */
export function removeInboxRowById(id: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    let rows: HelperInboxRow[] = JSON.parse(raw) as HelperInboxRow[];
    if (!Array.isArray(rows)) return false;
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
