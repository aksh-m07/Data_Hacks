/**
 * Wildfire-only civilian protocol: optional Nia retrieval + Groq generation.
 * Answers are steered to vary via live snapshot, variation directives, and sampling.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const NIA_BASE = "https://apigcp.trynia.ai";

const GROQ_MODEL = "llama-3.1-8b-instant";

export type NiaHit = { title: string; content: string; source?: string };

export type SurvivorLiveSnapshot = {
  placeLabel: string | null;
  riskBand: string;
  riskPct: number | null;
  outOfRange: boolean;
  personCount: number;
  breathingNote: string;
};

/** Rotating emphasis when the scenario does not pick a clear primary topic. */
const WILDFIRE_VARIATION_GENERAL = [
  "Lead with smoke, airway, and getting to clean air—then evacuation or shelter.",
  "Lead with whether to leave or shelter in place for this scenario—then smoke and burns.",
  "Lead with burns and stopping fire on clothing—then smoke and movement.",
  "Lead with coordinating everyone present: roles, headcounts, and clear signals.",
  "Lead with watching for delayed breathing problems after smoke—even if someone seems fine.",
  "Lead with protecting eyes and skin from ash/heat—then breathing and movement.",
] as const;

/** What the user is mainly asking about — drives ordering and snapshot use. */
export type ScenarioFocusKind = "eyes" | "breathing" | "burns" | "evacuation" | "general";

export type ScenarioFocus = {
  kind: ScenarioFocusKind;
  /** Short line for the model: what to address first */
  primaryConcern: string;
  /** Include breathing trend line from the app snapshot (never inject numbers for eye-only issues). */
  includeBreathingInSnapshot: boolean;
};

/**
 * Detect primary topic from user text so responses are personalized (e.g. eyes vs generic smoke).
 */
export function analyzeScenarioFocus(scenario: string): ScenarioFocus {
  const s = scenario.toLowerCase();
  const eyesRx =
    /\b(eye|eyes|eyelid|vision|visual|blind|blinding|blurry|blur|sight|see|seeing|irritat|sting|stinging|tear|tearing|watering|grit|gritty|ash in\s+eye|foreign body|red eye)\b/i;
  const breathRx =
    /\b(breath|breathe|breathing|lung|lungs|cough|coughing|inhale|chok|choking|wheez|gasp|can'?t catch breath|short of breath|sob)\b/i;
  const burnsRx = /\b(burn|burns|burned|skin|blister|charred|thermal)\b/i;
  const evacRx = /\b(evacuat|escape|trapped|route|flee|leave|stuck|can'?t get out)\b/i;

  const eyes = eyesRx.test(s);
  const breath = breathRx.test(s);
  const burns = burnsRx.test(s);
  const evac = evacRx.test(s);

  if (eyes && !breath) {
    return {
      kind: "eyes",
      primaryConcern:
        "EYES / VISION / IRRITATION — steps 1–3 must address eye pain, watering, blur, ash, or vision trouble from smoke. Do not start with generic face-mask/wet-cloth-for-nose steps unless you already covered eyes.",
      includeBreathingInSnapshot: false,
    };
  }
  if (eyes && breath) {
    return {
      kind: "eyes",
      primaryConcern:
        "EYES and BREATHING both — address the most urgent first (vision loss or trouble breathing), then the other. Name both topics explicitly in early steps.",
      includeBreathingInSnapshot: true,
    };
  }
  if (breath && !eyes) {
    return {
      kind: "breathing",
      primaryConcern:
        "BREATHING / SMOKE INHALATION — lead with clean air, positioning, and breathing; shorter eye/skin notes only if relevant.",
      includeBreathingInSnapshot: true,
    };
  }
  if (burns && !evac) {
    return {
      kind: "burns",
      primaryConcern: "BURNS — lead with cooling and stopping fire on clothing; then smoke/airway as needed.",
      includeBreathingInSnapshot: false,
    };
  }
  if (evac && !burns) {
    return {
      kind: "evacuation",
      primaryConcern: "EVACUATION / GETTING OUT — lead with orientation, visibility, and shelter vs movement; then injuries.",
      includeBreathingInSnapshot: true,
    };
  }

  const i = Math.floor(Math.random() * WILDFIRE_VARIATION_GENERAL.length);
  return {
    kind: "general",
    primaryConcern: `Follow this emphasis: ${WILDFIRE_VARIATION_GENERAL[i] ?? WILDFIRE_VARIATION_GENERAL[0]}`,
    includeBreathingInSnapshot: true,
  };
}

export function pickVariationForFocus(focus: ScenarioFocus): string {
  if (focus.kind === "eyes") {
    return `${focus.primaryConcern}

EYE-SMOKE RULES: Prefer irrigation with clean water or saline if available; do not rub the eyes. Shield eyes from more smoke (goggles, swim mask, cupped wet hands, or clear wrap with care). Say when sudden vision loss or severe pain means urgent medical care. Wet cloth over nose/mouth comes after eye-specific steps unless breathing is the emergency.`;
  }
  if (focus.kind === "breathing") {
    return `${focus.primaryConcern}

AIRWAY RULES: Clean air first; wet barrier over nose/mouth; low position if thick smoke; watch for delayed problems.`;
  }
  if (focus.kind === "burns") {
    return `${focus.primaryConcern}`;
  }
  if (focus.kind === "evacuation") {
    return `${focus.primaryConcern}`;
  }
  return focus.primaryConcern;
}

const WILDFIRE_MODE_CTX = `DISASTER CONTEXT: WILDFIRE / SMOKE / BURNS
The bystander is near a wildfire or escaped from one. There is heavy smoke and possible burns.
LIKELY INJURIES: Smoke inhalation (lungs filling with smoke), carbon monoxide poisoning from smoke (invisible, odorless — makes people confused and sleepy), thermal burns on skin and inside the airway, eye injuries from ash, cuts and broken bones from evacuating in panic.
AVAILABLE MATERIALS ON SITE: Water, clothing, vehicles for shelter, wet towels or rags, dirt and sand (for smothering small flames on clothing).
SPECIAL HAZARDS: Someone who breathed a lot of smoke may seem fine then collapse hours later — they need hospital even if they feel okay. Never go back into a burning building. If clothing is on fire — stop, drop, roll. Inhaled smoke can swell the airway silently — watch breathing carefully.
IMPROVISE WITH WHAT'S AROUND: Wet cloth over nose and mouth for smoke, dirt or sand to smother flames on skin or ground, cool (not ice cold) water poured slowly over burns, cover burns loosely with clean dry cloth.
Tailor ALL advice to fire and smoke conditions. Emphasize airway risk from smoke and how to cool burns with what's available.`;

const WILDFIRE_SYSTEM = `You are an emergency response guide for WILDFIRE and SMOKE situations only. Give clear, calm, plain-English steps that anyone can follow.

PERSONALIZATION (critical — read before writing):
- The EMERGENCY SCENARIO and PRIMARY FOCUS lines tell you what problem to solve first. Match your numbered steps to the user's exact words (eyes vs lungs vs burns vs evacuation).
- If they describe eye irritation, vision problems, blurriness, "going blind," ash in eyes, or stinging—your steps 1–3 MUST be about eyes (rinse, don't rub, shield from smoke, when to seek care). Do NOT start with the same generic "cover nose and mouth with wet cloth" checklist unless breathing is their main issue or you already addressed eyes.
- Never copy a one-size-fits-all wildfire list. Reorder and rewrite so the first steps fit THIS scenario.
- Do NOT cite app "breathing rate" or "~X/min" figures unless PRIMARY FOCUS is breathing-related or the user asked about breathing. The app snapshot is not a vital sign.

LANGUAGE:
- Avoid medical jargon; say "bleeding" not "hemorrhage", "press hard on the wound" not "apply direct pressure".
- If you must use a medical term, explain it briefly in plain words.

EQUIPMENT:
- Never assume professional medical gear. For every tool, offer an everyday alternative (belt, cloth, water bottle, vehicle, etc.).

OUTPUT FORMAT:
1. Number every action step (1. 2. 3.)
2. Start with the most urgent action for THIS scenario—no generic intro paragraph.
3. Keep each step to 1–2 short sentences. Use words a 12-year-old understands.
4. Mark dangerous steps with ⚠️ and say why in plain words.
5. End with exactly one line: "MONITOR: [what to watch for in plain English]"
6. Assume emergency services may be overwhelmed—focus on what to do NOW.
7. The EMERGENCY SCENARIO is the source of truth; do not invent injuries or events not described.

VARIETY:
- When scenarios differ, wording and step order must differ. When PRIMARY FOCUS is narrow (e.g. eyes only), stay narrow—do not pad with unrelated steps before addressing the focus.

NIA SOURCES:
- If RETRIEVED PROTOCOLS appear, weave them in; if none, rely on established wildfire/smoke first-aid principles.`;

function extractMedTerms(query: string): string {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "is",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "with",
    "from",
    "by",
    "of",
    "this",
    "that",
    "i",
    "my",
    "we",
    "our",
    "your",
    "his",
    "her",
    "its",
    "they",
    "their",
    "what",
    "how",
    "when",
    "where",
    "which",
    "who",
  ]);
  const joined =
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !stop.has(w))
      .slice(0, 8)
      .join(" ") || query;
  return `${joined} wildfire smoke evacuation burn FEMA`.trim();
}

function parseNiaData(data: unknown): NiaHit[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const items = (d.results ?? d.documents ?? d.hits ?? d.data ?? []) as unknown[];
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const meta = o.metadata && typeof o.metadata === "object" ? (o.metadata as Record<string, unknown>) : {};
      const title = String(o.title ?? o.source ?? o.url ?? "Protocol");
      const content = String(o.content ?? o.text ?? o.snippet ?? o.body ?? "");
      const source = String(o.source ?? o.url ?? meta.source ?? "");
      return content ? { title, content, source } : null;
    })
    .filter((x): x is NiaHit => x != null);
}

async function niaPackageSearch(query: string, key: string): Promise<NiaHit[]> {
  const r = await fetch(`${NIA_BASE}/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: 3 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Nia /v1/search ${r.status}`);
  return parseNiaData(await r.json());
}

async function niaWebSearch(query: string, key: string): Promise<NiaHit[] | null> {
  for (const endpoint of ["/v1/web-search", "/v1/websearch", "/v1/search/web"]) {
    try {
      const r = await fetch(`${NIA_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit: 2 }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const parsed = parseNiaData(await r.json());
        if (parsed.length) return parsed;
      }
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

/**
 * Optional Nia retrieval (wildfire-oriented query). Returns null if no key or no results.
 */
export async function searchNiaWildfireProtocols(scenario: string): Promise<NiaHit[] | null> {
  const key = import.meta.env.VITE_NIA_API_KEY?.trim();
  if (!key) return null;

  const focus = analyzeScenarioFocus(scenario);
  const medQuery = extractMedTerms(scenario);
  const eyeBoost =
    focus.kind === "eyes"
      ? " eye irrigation chemical exposure smoke conjunctivitis flush eyewash "
      : " ";
  const webQuery = `${medQuery} WHO FEMA wildfire ${focus.kind === "eyes" ? "eye injury smoke " : "smoke inhalation "}${eyeBoost}protocol`;

  const [pkgRes, webRes] = await Promise.allSettled([
    niaPackageSearch(`${medQuery}${eyeBoost}`.trim(), key),
    niaWebSearch(webQuery, key),
  ]);

  const results: NiaHit[] = [];
  if (pkgRes.status === "fulfilled") results.push(...pkgRes.value);
  if (webRes.status === "fulfilled" && webRes.value) results.push(...webRes.value);

  const seen = new Set<string>();
  const dedup: NiaHit[] = [];
  for (const h of results) {
    const k = `${h.title}:${h.content.slice(0, 80)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(h);
  }
  return dedup.length > 0 ? dedup.slice(0, 5) : null;
}

function formatNiaContext(nia: NiaHit[] | null): string {
  if (!nia?.length) return "";
  let out = "\n\n--- RETRIEVED PROTOCOLS (from Nia search) ---\n";
  nia.forEach((r, i) => {
    out += `\n[Source ${i + 1}: ${r.title}]\n${r.content.slice(0, 700)}\n`;
  });
  out += "\n--- END PROTOCOLS ---\n";
  return out;
}

function formatSnapshot(snapshot: SurvivorLiveSnapshot, focus: ScenarioFocus): string {
  const risk =
    snapshot.outOfRange || snapshot.riskPct == null
      ? "local wildfire risk model: out of range or unavailable"
      : `local wildfire risk band ${snapshot.riskBand} (~${snapshot.riskPct}% estimated chance of significant activity in ~10 days — model estimate only)`;
  const place = snapshot.placeLabel ?? "location not set in app";
  const lines = [
    "LIVE APP SNAPSHOT (context for tailoring only — not a diagnosis):",
    `- Place label: ${place}`,
    `- ${risk}`,
    `- People detected in frame (vision estimate): ${snapshot.personCount}`,
  ];
  if (focus.includeBreathingInSnapshot) {
    lines.push(`- Breathing motion trend (rough app estimate, not medical): ${snapshot.breathingNote}`);
  } else {
    lines.push(
      "- Breathing numbers: omitted for this request — the scenario is not mainly about breathing. Do not quote or invent \"~X/min\" breathing rates.",
    );
  }
  return lines.join("\n");
}

export function formatGroqErrorForUi(message: string): string {
  if (!message) return message;
  if (/tokens per day|\bTPD\b|rate.?limit/i.test(message)) {
    const tryIn = message.match(/try again in ([^.\n]+)/i);
    const when = tryIn ? ` Retry after ${tryIn[1].trim()}.` : "";
    return `Daily Groq token limit reached.${when} Try again later or use a smaller model in Groq settings.`;
  }
  return message;
}

export async function generateWildfireCivilianGuidance(args: {
  scenario: string;
  niaResults: NiaHit[] | null;
  snapshot: SurvivorLiveSnapshot;
}): Promise<{ text: string; error?: string }> {
  const key = import.meta.env.VITE_GROQ_API_KEY?.trim();
  if (!key) {
    return { text: "", error: "Set VITE_GROQ_API_KEY in .env for wildfire protocol guidance." };
  }

  const { scenario, niaResults, snapshot } = args;
  const focus = analyzeScenarioFocus(scenario);
  const focusInstructions = pickVariationForFocus(focus);
  const niaContext = formatNiaContext(niaResults);
  const snap = formatSnapshot(snapshot, focus);
  const nonce = Math.random().toString(36).slice(2, 10);

  const userMsg = `EMERGENCY SCENARIO (source of truth — wildfire / smoke / burns):
${scenario.trim()}

INSTRUCTIONS FOR STEP ORDER AND CONTENT (follow closely):
${focusInstructions}

${WILDFIRE_MODE_CTX}${niaContext}

${snap}

REQUEST_ID (ignore): ${nonce}`;

  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: WILDFIRE_SYSTEM },
          { role: "user", content: userMsg },
        ],
        max_tokens: 1200,
        temperature: focus.kind === "eyes" ? 0.48 : 0.62,
        top_p: 0.9,
      }),
    });
    if (!r.ok) {
      let errMsg = `Groq error ${r.status}`;
      try {
        const e = (await r.json()) as { error?: { message?: string } };
        errMsg = e.error?.message ?? errMsg;
      } catch {
        /* ignore */
      }
      return { text: "", error: formatGroqErrorForUi(errMsg) };
    }
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content?.trim() ?? "";
    return { text };
  } catch (e) {
    return {
      text: "",
      error: e instanceof Error ? e.message : "Groq request failed",
    };
  }
}
