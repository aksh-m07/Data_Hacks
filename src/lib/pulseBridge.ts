export type PulseSession = {
  sessionId: string;
  deepLink: string;
  webMeasureUrl: string;
  expiresAt: number;
};

export type PulseResult = {
  sessionId: string;
  bpm: number;
  source: string;
  confidence?: number;
  measuredAt: number;
};

const DEFAULT_BASE = "http://localhost:8787";

function bridgeBase(): string {
  const envVal = import.meta.env.VITE_PULSE_BRIDGE_URL;
  if (envVal && envVal.trim()) return envVal.trim();
  return DEFAULT_BASE;
}

export async function createPulseSession(): Promise<PulseSession> {
  const r = await fetch(`${bridgeBase()}/api/pulse/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`Failed to create pulse session (${r.status})`);
  return (await r.json()) as PulseSession;
}

export function pulseSessionEventsUrl(sessionId: string): string {
  return `${bridgeBase()}/api/pulse/sessions/${encodeURIComponent(sessionId)}/events`;
}
