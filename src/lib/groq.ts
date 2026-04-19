const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqBriefing(
  system: string,
  user: string,
): Promise<{ text: string; error?: string }> {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  if (!key) {
    return {
      text: "",
      error: "Set VITE_GROQ_API_KEY for live Groq briefings.",
    };
  }
  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 220,
        temperature: 0.4,
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { text: "", error: `Groq ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return { text: j.choices[0]?.message?.content?.trim() ?? "" };
  } catch (e) {
    return {
      text: "",
      error: e instanceof Error ? e.message : "Groq request failed",
    };
  }
}

export function wildfireSystemPrompt(
  score: number,
  cls: string,
  drivers: { label: string; pct: number }[],
  temp: number,
  hum: number,
  hi: number,
  aqi: number,
  aqiCat: string,
  wind: number,
  windCard: string,
  spreadBearing: string,
): string {
  const [d1, d2] = drivers;
  return `You are DisasterDocs wildfire intelligence. The headline number is an estimated chance (0–100%) of significant wildfire activity affecting this area within about the next 10 days (${score}% — ${cls} band). Training-time driver mix (not live causal attribution): ${d1?.label ?? "?"} (${d1?.pct ?? 0}%), ${d2?.label ?? "?"} (${d2?.pct ?? 0}%). Weather: ${temp}F, ${hum}% humidity, heat index ${hi}F. EPA/Open-Meteo AQI: ${aqi} (${aqiCat}). Wind: ${wind}mph ${windCard} — fire spread toward ${spreadBearing}. Give a 3-sentence situation briefing then 3 recommended actions. Plain language. Say this is a model estimate, not a guarantee.`;
}

export function helperSystemPrompt(
  bpm: number,
  heartRateNote: string,
  personCount: number,
  personInFrame: boolean,
  aqi: number,
): string {
  return `Wildfire / smoke exposure context. Heart rate: ${bpm} BPM (${heartRateNote}). People detected in frame (on-device vision): ${personCount}. Person clearly visible: ${personInFrame ? "yes" : "no"}. AQI: ${aqi}. Return 5 numbered first-aid steps. Short. No jargon. Prioritise fresh air and emergency services.`;
}
