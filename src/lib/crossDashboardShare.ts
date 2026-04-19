/** Same-origin tab/window messaging for Wildfire → Helper (and Home) popups. */

export const SHARE_CHANNEL_NAME = "disasterdocs-wildfire-share";

export type WildfireShareMessage = {
  type: "wildfire-share";
  instructions: string;
  riskLine: string;
  placeLabel: string | null;
  ts: number;
  /** Tab that created this message — receivers ignore only on that tab’s sender dashboard. */
  originTabId?: string;
  /** True when sender just clicked Share — TTS already fired with user gesture; skip duplicate in popup. */
  fromShareClick?: boolean;
  /** Which dashboard sent the alert (popup copy + TTS intro). */
  alertSource?: "wildfire" | "helper" | "survivor";
  /** COCO-SSD person count at send time (Survivor distress). */
  personCountScanned?: number | null;
  /** WGS-84 coordinates at send time (for inbox / logs). */
  lat?: number | null;
  lon?: number | null;
};

const STORAGE_KEY = "disasterdocs-pending-share";
const TAB_ID_KEY = "disasterdocs-broadcast-tab-id";

/** In-memory id when sessionStorage is blocked — must be stable for the whole page lifetime. */
let cachedBroadcastTabId: string | null = null;

/** Stable per-tab id (sessionStorage is not shared across tabs). Used to ignore this tab’s own broadcast. */
export function getOrCreateBroadcastTabId(): string {
  if (cachedBroadcastTabId) return cachedBroadcastTabId;
  const gen = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing) {
      cachedBroadcastTabId = existing;
      return existing;
    }
  } catch {
    /* */
  }
  const id = gen();
  try {
    sessionStorage.setItem(TAB_ID_KEY, id);
  } catch {
    /* private mode / quota — still cache so broadcast + App use the same id */
  }
  cachedBroadcastTabId = id;
  return id;
}

/** Same-origin other tabs only (storage event does not fire in the tab that wrote). */
export const LOCAL_STORAGE_BROADCAST_KEY = "disasterdocs-alert-broadcast-v1";

export function broadcastWildfireShare(payload: {
  instructions: string;
  riskLine: string;
  placeLabel: string | null;
  fromShareClick?: boolean;
  alertSource?: "wildfire" | "helper" | "survivor";
  personCountScanned?: number | null;
  lat?: number | null;
  lon?: number | null;
}): WildfireShareMessage {
  const msg: WildfireShareMessage = {
    type: "wildfire-share",
    instructions: payload.instructions,
    riskLine: payload.riskLine,
    placeLabel: payload.placeLabel,
    ts: Date.now(),
    originTabId: getOrCreateBroadcastTabId(),
    fromShareClick: payload.fromShareClick,
    alertSource: payload.alertSource ?? "wildfire",
    personCountScanned:
      payload.personCountScanned === undefined ? undefined : payload.personCountScanned,
    lat: payload.lat === undefined ? undefined : payload.lat,
    lon: payload.lon === undefined ? undefined : payload.lon,
  };
  const serialized = JSON.stringify(msg);
  try {
    const bc = new BroadcastChannel(SHARE_CHANNEL_NAME);
    bc.postMessage(msg);
    bc.close();
  } catch {
    /* BroadcastChannel unsupported */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    /* */
  }
  try {
    localStorage.setItem(LOCAL_STORAGE_BROADCAST_KEY, serialized);
  } catch {
    /* private mode / quota */
  }
  return msg;
}

export function peekPendingShareFromStorage(): WildfireShareMessage | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WildfireShareMessage;
  } catch {
    return null;
  }
}

export function clearPendingShareStorage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
  try {
    localStorage.removeItem(LOCAL_STORAGE_BROADCAST_KEY);
  } catch {
    /* */
  }
}
