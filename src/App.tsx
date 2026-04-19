import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SharedWildfirePopup } from "./components/SharedWildfirePopup";
import { SmokeAlarmListener } from "./components/SmokeAlarmListener";
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
  const [alarmFlash, setAlarmFlash] = useState(false);
  const [sharePopup, setSharePopup] = useState<WildfireShareMessage | null>(null);
  const [helperInboxTick, setHelperInboxTick] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastShareDeliveryId = useRef<string | null>(null);
  const localTabIdRef = useRef<string | null>(null);
  if (localTabIdRef.current === null) {
    localTabIdRef.current = getOrCreateBroadcastTabId();
  }

  const onAlarm = useCallback(() => {
    setAlarmFlash(true);
    window.setTimeout(() => setAlarmFlash(false), 4000);
  }, []);

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
            <span className="app-brand-mark" aria-hidden />
            <div>
              <span className="app-brand-title">DisasterDocs</span>
              <span className="app-brand-sub">DataHacks 2026 · DS3 UCSD</span>
            </div>
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
          <div className="app-header-tools">
            <SmokeAlarmListener onAlarm={onAlarm} />
          </div>
        </div>
      </header>

      {alarmFlash ? (
        <div className="alarm-toast" role="status">
          Possible smoke-alarm tone — seek fresh air and check the briefing.
        </div>
      ) : null}

      {sharePopup && shouldShowSharePopup(mode, sharePopup, localTabIdRef.current) ? (
        <SharedWildfirePopup message={sharePopup} onDismiss={dismissShare} />
      ) : null}

      <main className="app-main">
        {mode === "wildfire" ? (
          <WildfireDashboard
            survivorDistressRows={helperInboxRows.filter((r) => r.source === "survivor")}
            onInboxRefresh={() => setHelperInboxTick((t) => t + 1)}
          />
        ) : null}
        {mode === "survivor" ? (
          <SurvivorDashboard onInboxRefresh={() => setHelperInboxTick((t) => t + 1)} />
        ) : null}
      </main>
    </div>
  );
}
