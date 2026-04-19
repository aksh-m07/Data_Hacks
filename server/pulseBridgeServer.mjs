import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

const PORT = Number.parseInt(process.env.PULSE_BRIDGE_PORT ?? "8787", 10);
const APP_LINK_SCHEME = process.env.PULSE_APP_SCHEME ?? "groundzero-pulse://measure";
const WEB_MEASURE_BASE = process.env.PULSE_WEB_MEASURE_URL ?? "http://localhost:8787/iphone-measure";
const SESSION_TTL_MS = 1000 * 60 * 10;

/** @type {Map<string, {createdAt:number, expiresAt:number, result:null|{sessionId:string,bpm:number,source:string,confidence?:number,measuredAt:number}, listeners:Set<import('node:http').ServerResponse>}>} */
const sessions = new Map();
let latestSessionId = null;

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function html(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function upsertSession() {
  const sessionId = randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(sessionId, {
    createdAt: now,
    expiresAt,
    result: null,
    listeners: new Set(),
  });
  latestSessionId = sessionId;
  const query = `session=${encodeURIComponent(sessionId)}`;
  return {
    sessionId,
    expiresAt,
    deepLink: `${APP_LINK_SCHEME}?${query}`,
    webMeasureUrl: `${WEB_MEASURE_BASE}?${query}`,
  };
}

function emitResult(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || !s.result) return;
  const payload = `data: ${JSON.stringify(s.result)}\n\n`;
  for (const client of s.listeners) {
    client.write(payload);
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt > now) continue;
    for (const client of s.listeners) {
      client.end();
    }
    sessions.delete(id);
  }
}

createServer(async (req, res) => {
  if (!req.url) return json(res, 400, { error: "Missing request URL" });
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pulse/sessions") {
    const session = upsertSession();
    return json(res, 201, session);
  }

  if (req.method === "GET" && url.pathname === "/api/pulse/health") {
    return json(res, 200, { ok: true, latestSessionId });
  }

  if (req.method === "GET" && url.pathname === "/api/pulse/sessions/latest") {
    if (!latestSessionId) return json(res, 404, { error: "No sessions yet" });
    const s = sessions.get(latestSessionId);
    if (!s || s.expiresAt <= Date.now()) return json(res, 404, { error: "Latest session expired" });
    return json(res, 200, { sessionId: latestSessionId, expiresAt: s.expiresAt, hasResult: !!s.result });
  }

  if (req.method === "GET" && url.pathname === "/iphone-measure") {
    const sessionId = url.searchParams.get("session") ?? "";
    return html(
      res,
      200,
      `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pulse Measure</title></head>
<body style="font-family: -apple-system, sans-serif; margin: 24px;">
  <h2>Pulse Bridge</h2>
  <p>Session: <code>${sessionId || "missing"}</code></p>
  <p>Use the iOS app for camera-based measurement. This page is a fallback to submit BPM manually.</p>
  <form id="f">
    <input id="bpm" type="number" min="25" max="240" placeholder="BPM" style="font-size:16px;padding:8px;">
    <button type="submit" style="font-size:16px;padding:8px 12px;">Send</button>
  </form>
  <p id="msg"></p>
  <script>
    const sid = ${JSON.stringify(sessionId)};
    const f = document.getElementById('f');
    const msg = document.getElementById('msg');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bpm = Number(document.getElementById('bpm').value);
      const r = await fetch('/api/pulse/sessions/' + encodeURIComponent(sid) + '/result', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ bpm, source: 'iphone-fallback-web' }),
      });
      msg.textContent = r.ok ? 'Sent to dashboard.' : 'Failed: ' + r.status;
    });
  </script>
</body>
</html>`
    );
  }

  const mEvents = url.pathname.match(/^\/api\/pulse\/sessions\/([^/]+)\/events$/);
  if (req.method === "GET" && mEvents) {
    const sessionId = decodeURIComponent(mEvents[1]);
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: "Session not found" });
    if (s.expiresAt <= Date.now()) return json(res, 410, { error: "Session expired" });

    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.write("event: connected\ndata: ok\n\n");
    s.listeners.add(res);
    if (s.result) {
      emitResult(sessionId);
    }
    req.on("close", () => {
      s.listeners.delete(res);
    });
    return;
  }

  const mResult = url.pathname.match(/^\/api\/pulse\/sessions\/([^/]+)\/result$/);
  if (req.method === "POST" && mResult) {
    const sessionId = decodeURIComponent(mResult[1]);
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: "Session not found" });
    if (s.expiresAt <= Date.now()) return json(res, 410, { error: "Session expired" });
    try {
      const body = await readJson(req);
      const bpm = Number(body.bpm);
      if (!Number.isFinite(bpm) || bpm < 25 || bpm > 240) {
        return json(res, 422, { error: "Invalid bpm" });
      }
      s.result = {
        sessionId,
        bpm: Math.round(bpm),
        source: typeof body.source === "string" ? body.source : "iphone-camera-ppg",
        confidence: Number.isFinite(body.confidence) ? Number(body.confidence) : undefined,
        measuredAt: Date.now(),
      };
      emitResult(sessionId);
      return json(res, 200, s.result);
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }
  }

  const mStatus = url.pathname.match(/^\/api\/pulse\/sessions\/([^/]+)$/);
  if (req.method === "GET" && mStatus) {
    const sessionId = decodeURIComponent(mStatus[1]);
    const s = sessions.get(sessionId);
    if (!s) return json(res, 404, { error: "Session not found" });
    return json(res, 200, {
      sessionId,
      expiresAt: s.expiresAt,
      hasResult: !!s.result,
      result: s.result,
    });
  }

  return json(res, 404, { error: "Not found" });
})
  .listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`pulse bridge listening on http://localhost:${PORT}`);
  });

setInterval(cleanupExpiredSessions, 30_000).unref();
