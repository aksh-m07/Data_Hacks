import { useEffect } from "react";
import { speakWildfireAlert, stopWildfireSpeech } from "../lib/criticalAlertSpeech";
import type { WildfireShareMessage } from "../lib/crossDashboardShare";

type Props = {
  message: WildfireShareMessage;
  onDismiss: () => void;
};

export function SharedWildfirePopup({ message, onDismiss }: Props) {
  useEffect(() => {
    return () => stopWildfireSpeech();
  }, [message.ts]);

  const title =
    message.alertSource === "helper"
      ? "Critical alert — Helper console"
      : message.alertSource === "survivor"
        ? "Critical alert — Survivor distress"
        : "Message from Wildfire station";

  function dismiss() {
    stopWildfireSpeech();
    onDismiss();
  }

  return (
    <div className="wf-alert-modal-backdrop" role="alertdialog" aria-modal aria-labelledby="wf-alert-modal-title">
      <div className="wf-alert-modal wf-alert-modal--critical">
        <p className="wf-alert-modal-kicker">Critical alert · tap Read aloud to hear</p>
        <h2 id="wf-alert-modal-title">{title}</h2>
        <p className="wf-alert-modal-meta">
          {message.placeLabel ? <span>{message.placeLabel}</span> : null}
          <span className="wf-alert-modal-time">{new Date(message.ts).toLocaleString()}</span>
        </p>
        <div className="wf-alert-modal-risk">{message.riskLine}</div>
        {message.instructions.trim() ? (
          <div className="wf-alert-modal-body">
            <h3>Voice / text message</h3>
            <p className="wf-alert-modal-instructions">{message.instructions}</p>
          </div>
        ) : (
          <p className="wf-alert-modal-empty">No voice or typed instructions were included.</p>
        )}
        <div className="wf-alert-modal-actions">
          <button
            type="button"
            className="btn wf-alert-modal-read"
            onClick={() => speakWildfireAlert(message)}
          >
            Read aloud
          </button>
          <button type="button" className="btn wf-alert-modal-close" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
