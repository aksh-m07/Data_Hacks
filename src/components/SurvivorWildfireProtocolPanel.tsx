import { useCallback, useEffect, useRef, useState } from "react";
import type { SurvivorLiveSnapshot } from "../lib/wildfireCivilianProtocol";
import {
  generateWildfireCivilianGuidance,
  searchNiaWildfireProtocols,
  type NiaHit,
} from "../lib/wildfireCivilianProtocol";

const DETAIL_CHIPS: { label: string; append: string }[] = [
  { label: "Eyes / vision", append: "smoke is irritating the eyes and vision is blurry or hard to see" },
  { label: "Heavy smoke nearby", append: "there is heavy smoke nearby and visibility is poor" },
  { label: "Trouble breathing", append: "someone is having trouble breathing from the smoke" },
  { label: "Burns", append: "there are burns from heat or flames" },
  { label: "Clothing caught fire", append: "clothing is on fire or smoldering" },
  { label: "Evacuate", append: "we need to evacuate but routes are unclear" },
  { label: "Child / elderly", append: "a child or elderly person needs help" },
  { label: "Group", append: "there are several people here and we need a plan" },
  { label: "No supplies", append: "we have almost no medical supplies—only everyday items" },
];

const QUICK_SCENARIOS: { label: string; query: string }[] = [
  {
    label: "Smoke inhalation",
    query:
      "Wildfire smoke exposure — someone coughing, sore throat, trouble catching breath, we are trying to move to cleaner air",
  },
  {
    label: "Burns",
    query: "Thermal burns from wildfire — reddened skin and pain, need cooling and cover, smoke in the air",
  },
  {
    label: "Stop, drop, roll",
    query: "Clothing caught fire near wildfire — need to stop the flames on the person and get away from heat",
  },
  {
    label: "Evacuation",
    query: "Evacuating through wildfire smoke — low visibility, need steps to protect breathing and stay oriented",
  },
  {
    label: "Delayed effects",
    query: "Someone seemed okay after smoke exposure but now is confused or very sleepy — wildfire area",
  },
  {
    label: "Ash in eyes",
    query: "Ash and smoke irritating eyes badly during wildfire — rinsing and protection with limited water",
  },
];

type Props = {
  snapshot: SurvivorLiveSnapshot;
  /** Tighter spacing when placed directly under the breath graph in the main column */
  embedded?: boolean;
};

export function SurvivorWildfireProtocolPanel({ snapshot, embedded }: Props) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "nia" | "groq">("idle");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [niaHits, setNiaHits] = useState<NiaHit[] | null>(null);
  const busyRef = useRef(false);

  const hasGroq = Boolean(import.meta.env.VITE_GROQ_API_KEY?.trim());

  const appendChip = useCallback((text: string) => {
    setQuery((q) => {
      const t = q.trim();
      if (!t) return text;
      if (t.toLowerCase().includes(text.toLowerCase().slice(0, 24))) return t;
      return `${t}; ${text}`;
    });
  }, []);

  const runProtocol = useCallback(
    async (overrideScenario?: string) => {
      const scenario = (overrideScenario ?? query).trim();
      if (!scenario || busyRef.current || !hasGroq) return;

      busyRef.current = true;
      setError(null);
      setResponse("");
      setNiaHits(null);

      setPhase("nia");
      let niaResults: NiaHit[] | null = null;
      try {
        niaResults = await searchNiaWildfireProtocols(scenario);
        if (niaResults?.length) setNiaHits(niaResults);
      } catch {
        /* Nia optional — Groq still runs */
      }

      setPhase("groq");
      try {
        const { text, error: err } = await generateWildfireCivilianGuidance({
          scenario,
          niaResults,
          snapshot,
        });
        if (err) {
          setError(err);
          return;
        }
        setResponse(text);
      } finally {
        setPhase("idle");
        busyRef.current = false;
      }
    },
    [query, snapshot, hasGroq],
  );

  const busy = phase !== "idle";

  function speakAloud() {
    if (!response || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = response
      .replace(/⚠️/g, "Warning. ")
      .replace(/MONITOR:/g, "Monitor for: ")
      .replace(/#{1,3}\s*/g, "")
      .replace(/\*\*/g, "");
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  }

  useEffect(() => {
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  return (
    <section
      className={`survivor-wf-protocol${embedded ? " survivor-wf-protocol--embedded" : ""}`}
      aria-label="Wildfire civilian protocol"
    >
      <h2 className="survivor-wf-protocol-title">Wildfire steps (Nia + Groq)</h2>

      {!hasGroq ? (
        <p className="small err" role="status">
          Add VITE_GROQ_API_KEY in .env to enable this panel.
        </p>
      ) : null}

      <div className="survivor-wf-detail">
        <div className="survivor-wf-detail-title">💬 Add detail (tap to append)</div>
        <div className="survivor-wf-chips">
          {DETAIL_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chip survivor-wf-chip"
              onClick={() => appendChip(c.append)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        id="survivor-wf-query"
        className="survivor-wf-textarea"
        rows={3}
        placeholder="Describe what’s happening — smoke, burns, evacuation, people…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        aria-label="Describe the wildfire or smoke situation"
      />

      <div className="survivor-wf-actions">
        <button
          type="button"
          className="btn primary survivor-wf-send"
          onClick={() => void runProtocol()}
          disabled={!query.trim() || busy || !hasGroq}
        >
          {phase === "nia" ? "Searching…" : phase === "groq" ? "Generating…" : "Get steps"}
        </button>
      </div>

      <div className="survivor-wf-quick">
        <span className="survivor-wf-quick-label">Quick scenarios</span>
        <div className="survivor-wf-quick-row">
          {QUICK_SCENARIOS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip survivor-wf-proto"
              disabled={busy}
              onClick={() => {
                setQuery(p.query);
                void runProtocol(p.query);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {busy ? (
        <p className="small survivor-wf-status" role="status">
          {phase === "nia" ? "Searching protocols (Nia)…" : "Generating wildfire steps (Groq)…"}
        </p>
      ) : null}

      {error ? (
        <p className="small err" role="alert">
          {error}
        </p>
      ) : null}

      <div className="survivor-wf-response-card">
        <div className="survivor-wf-response-toolbar">
          <span className="survivor-wf-response-label">Protocol response</span>
          {niaHits?.length ? (
            <span className="survivor-wf-nia-pill" title="Nia sources were used">
              🔍 Nia protocols
            </span>
          ) : null}
          <button type="button" className="chip survivor-wf-speak" onClick={speakAloud} disabled={!response}>
            🔊 Read aloud
          </button>
        </div>
        <div className="survivor-wf-response-body">
          {response ? (
            <pre className="survivor-wf-response-pre">{response}</pre>
          ) : (
            <p className="small muted survivor-wf-placeholder">
              Ready. Describe a wildfire or smoke situation—or tap a quick scenario—for step-by-step guidance.
            </p>
          )}
        </div>
        {niaHits?.length ? (
          <div className="survivor-wf-sources" aria-label="Nia sources">
            {niaHits.map((h, i) => (
              <span key={`${h.title}-${i}`} className="survivor-wf-source-chip">
                📄 {h.title.slice(0, 52)}
                {h.title.length > 52 ? "…" : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
