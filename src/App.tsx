import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SharedWildfirePopup } from "./components/SharedWildfirePopup";
import { SurvivorDashboard } from "./components/SurvivorDashboard";
import { WildfireDashboard } from "./components/WildfireDashboard";
import type { WildfireShareMessage } from "./lib/crossDashboardShare";
import {
  LOCAL_STORAGE_BROADCAST_KEY,
  SHARE_CHANNEL_NAME,
  clearPendingShareStorage,
  getOrCreateBroadcastTabId,
  peekPendingShareFromStorage,
} from "./lib/crossDashboardShare";
import { appendInboxAlertIfNew, getHelperInboxRows } from "./lib/incomingHelperInbox";

const SMOKE_ALARM_BC = "groundzero-smoke-alarm-v1";

/** Only two workspaces: Wildfire station vs Survivor. */
export type AppMode = "wildfire" | "survivor";

/**
 * Full-screen alert with Read aloud: Survivor only. Wildfire station never shows this overlay.
 */
export function shouldShowSharePopup(
  viewerMode: AppMode,
  msg: WildfireShareMessage,
  localTabId?: string | null,
): boolean {
  if (viewerMode !== "survivor") {
    return false;
  }

  const src = msg.alertSource ?? "wildfire";
  const sameTabOrigin = !!(
    msg.originTabId &&
    localTabId &&
    msg.originTabId === localTabId
  );
  if (sameTabOrigin && src === "survivor") return false;
  if (!msg.originTabId && src === "survivor") return false;
  return true;
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("wildfire");
  /** Set when Survivor mic detects a tone; cleared after 7s on Wildfire station (stays pending if user stays on Survivor). */
  const [smokeAlarmPending, setSmokeAlarmPending] = useState(false);
  const [sharePopup, setSharePopup] = useState<WildfireShareMessage | null>(null);
  const [helperInboxTick, setHelperInboxTick] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastShareDeliveryId = useRef<string | null>(null);
  const localTabIdRef = useRef<string | null>(null);
  if (localTabIdRef.current === null) {
    localTabIdRef.current = getOrCreateBroadcastTabId();
  }

  const onSmokeAlarm = useCallback(() => {
    setSmokeAlarmPending(true);
    try {
      const bc = new BroadcastChannel(SMOKE_ALARM_BC);
      bc.postMessage("fire");
      bc.close();
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(SMOKE_ALARM_BC);
      bc.onmessage = (ev: MessageEvent<string>) => {
        if (ev.data === "fire") setSmokeAlarmPending(true);
        if (ev.data === "clear") setSmokeAlarmPending(false);
      };
    } catch {
      /* */
    }
    return () => bc?.close();
  }, []);

  useEffect(() => {
    if (!smokeAlarmPending || mode !== "wildfire") return;
    const id = window.setTimeout(() => {
      setSmokeAlarmPending(false);
      try {
        const bc = new BroadcastChannel(SMOKE_ALARM_BC);
        bc.postMessage("clear");
        bc.close();
      } catch {
        /* */
      }
    }, 7000);
    return () => window.clearTimeout(id);
  }, [smokeAlarmPending, mode]);

  const showShare = useCallback((msg: WildfireShareMessage) => {
    const id = `${msg.ts}:${msg.alertSource ?? "wildfire"}`;
    if (lastShareDeliveryId.current === id) return;
    lastShareDeliveryId.current = id;

    const src = msg.alertSource ?? "wildfire";
    if (src === "survivor" && appendInboxAlertIfNew(msg)) {
      setHelperInboxTick((t) => t + 1);
    }

    if (!shouldShowSharePopup(modeRef.current, msg, localTabIdRef.current)) return;
    setSharePopup(msg);
  }, []);

  const helperInboxRows = useMemo(() => getHelperInboxRows(), [helperInboxTick, mode]);

  useEffect(() => {
    if (!sharePopup) return;
    if (appendInboxAlertIfNew(sharePopup)) {
      setHelperInboxTick((t) => t + 1);
    }
  }, [sharePopup]);

  useEffect(() => {
    lastShareDeliveryId.current = null;
    setSharePopup(null);
    clearPendingShareStorage();
  }, []);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(SHARE_CHANNEL_NAME);
      bc.onmessage = (ev: MessageEvent<WildfireShareMessage>) => {
        if (ev.data?.type === "wildfire-share") showShare(ev.data);
      };
    } catch {
      /* */
    }

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== LOCAL_STORAGE_BROADCAST_KEY || !ev.newValue) return;
      try {
        const parsed = JSON.parse(ev.newValue) as WildfireShareMessage;
        if (parsed?.type === "wildfire-share") showShare(parsed);
      } catch {
        /* */
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      bc?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [showShare]);

  useEffect(() => {
    const tabId = localTabIdRef.current;
    setSharePopup((prev) => {
      if (prev && !shouldShowSharePopup(mode, prev, tabId)) {
        return null;
      }
      const pending = peekPendingShareFromStorage();
      if (!prev && pending && shouldShowSharePopup(mode, pending, tabId)) {
        return pending;
      }
      return prev;
    });
  }, [mode]);

  useEffect(() => {
    const tabId = localTabIdRef.current;
    if (sharePopup && !shouldShowSharePopup(mode, sharePopup, tabId)) {
      setSharePopup(null);
    }
  }, [mode, sharePopup]);

  function dismissShare() {
    lastShareDeliveryId.current = null;
    setSharePopup(null);
    clearPendingShareStorage();
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <span className="app-brand-title">GroundZero</span>
          </div>
          <nav className="app-nav" aria-label="Main">
            <button
              type="button"
              className={`app-nav-link ${mode === "wildfire" ? "is-active" : ""}`}
              onClick={() => setMode("wildfire")}
            >
              Wildfire station
            </button>
            <button
              type="button"
              className={`app-nav-link ${mode === "survivor" ? "is-active" : ""}`}
              onClick={() => setMode("survivor")}
            >
              Survivor
            </button>
          </nav>
        </div>
      </header>

      {sharePopup && shouldShowSharePopup(mode, sharePopup, localTabIdRef.current) ? (
        <SharedWildfirePopup message={sharePopup} onDismiss={dismissShare} />
      ) : null}

      <main className="app-main">
        {mode === "wildfire" ? (
          <WildfireDashboard
            survivorDistressRows={helperInboxRows.filter((r) => r.source === "survivor")}
            onInboxRefresh={() => setHelperInboxTick((t) => t + 1)}
            smokeAlarmVisible={smokeAlarmPending}
          />
        ) : null}
        {mode === "survivor" ? (
          <SurvivorDashboard
            onInboxRefresh={() => setHelperInboxTick((t) => t + 1)}
            onSmokeAlarm={onSmokeAlarm}
            smokeAlarmActive={smokeAlarmPending}
          />
        ) : null}
      </main>
    </div>
  );
}
