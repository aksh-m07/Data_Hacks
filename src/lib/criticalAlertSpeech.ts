import type { WildfireShareMessage } from "./crossDashboardShare";

/** Build spoken text for TTS (critical alert + risk + instructions). */
export function wildfireAlertSpeechText(m: WildfireShareMessage): string {
  const intro =
    m.alertSource === "helper"
      ? "Critical alert. Helper console message."
      : m.alertSource === "survivor"
        ? "Critical alert. Survivor distress call."
        : "Critical alert. Wildfire station message.";
  const parts = [
    intro,
    m.riskLine,
    m.placeLabel ? `Location: ${m.placeLabel}.` : "",
    m.instructions.trim() ? `Details: ${m.instructions.trim()}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Speak using Web Speech API synthesis (best right after a user click). */
export function speakWildfireAlert(m: WildfireShareMessage): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(wildfireAlertSpeechText(m));
    u.lang = "en-US";
    u.rate = 0.95;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* */
  }
}

export function stopWildfireSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* */
  }
}
