import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────────────
// In-memory registries
// ───────────────────────────────────────────────────────────────────────────────
const agents = new Map();
const sseClients = new Map();
const pending = new Map();

function userFromReq(req) {
  return req.header("x-user-id") || "single";
}

// ───────────────────────────────────────────────────────────────────────────────
// HTTP server + WS upgrade
// ───────────────────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/agents" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const userId = url.searchParams.get("user") || "single";

  if (!agents.has(userId)) agents.set(userId, new Set());
  agents.get(userId).add(ws);

  ws.on("message", (raw) => {
    const text = raw.toString();

    const clients = sseClients.get(userId) || new Set();
    for (const res of clients) res.write(`data: ${text}\n\n`);

    try {
      const msg = JSON.parse(text);
      if (msg?.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
    }
  });

  ws.on("close", () => {
    agents.get(userId)?.delete(ws);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Helpers to talk to agent
// ───────────────────────────────────────────────────────────────────────────────
function sendToAgent(userId, payload) {
  const pool = agents.get(userId);
  if (!pool || pool.size === 0) throw new Error("No agent online");
  const ws = [...pool][0];
  ws.send(JSON.stringify(payload));
}

function sendAndWait(userId, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!payload.id) payload.id = uuid();

    try {
      sendToAgent(userId, payload);
    } catch (e) {
      return reject(e);
    }

    const timer = setTimeout(() => {
      pending.delete(payload.id);
      resolve({ timeout: true, id: payload.id }); // resolve gracefully on timeout
    }, timeoutMs);

    pending.set(payload.id, { resolve, reject, timer });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
/** Live event stream (agent -> browser via backend). Optional but useful. */
app.get("/api/stream", (req, res) => {
  const userId = req.query.userId || "single";
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 1000\n\n");

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  req.on("close", () => sseClients.get(userId)?.delete(res));
});

// Health
app.get("/healthz", (_req, res) => res.send("ok"));

// ───────────────────────────────────────────────────────────────────────────────
// Endpoints that WAIT for agent return values
// ───────────────────────────────────────────────────────────────────────────────

/** Open (returns { currentUrl }) */
app.post("/api/session/open", async (req, res) => {
  const userId = userFromReq(req);
  try {
    const msg = await sendAndWait(userId, {
      type: "openBrowser",
      payload: { url: req.body?.url },
    });

    if (msg.timeout) return res.status(504).json({ error: "Agent timeout" });
    if (msg.type === "error") return res.status(500).json({ error: msg.error });

    return res.json(msg.result ?? {});
  } catch (e) {
    return res.status(409).json({ error: String(e.message || e) });
  }
});

/** Navigate (returns { currentUrl }) */
app.post("/api/session/navigate", async (req, res) => {
  const userId = userFromReq(req);
  try {
    const msg = await sendAndWait(userId, {
      type: "navigate",
      payload: { url: req.body?.url },
    });

    if (msg.timeout) return res.status(504).json({ error: "Agent timeout" });
    if (msg.type === "error") return res.status(500).json({ error: msg.error });

    return res.json(msg.result ?? {});
  } catch (e) {
    return res.status(409).json({ error: String(e.message || e) });
  }
});

/** Screenshot (returns { screenshotBase64 }) */
app.post("/api/session/screenshot", async (req, res) => {
  const userId = userFromReq(req);
  try {
    const msg = await sendAndWait(
      userId,
      { type: "screenshot", payload: {} },
      20000
    );

    if (msg.timeout) return res.status(504).json({ error: "Agent timeout" });
    if (msg.type === "error") return res.status(500).json({ error: msg.error });

    return res.json(msg.result ?? {});
  } catch (e) {
    return res.status(409).json({ error: String(e.message || e) });
  }
});

/** STOP (idempotent). Returns { closed: true, alreadyClosed?: boolean } */
app.post("/api/session/stop", async (req, res) => {
  const userId = userFromReq(req);
  try {
    const msg = await sendAndWait(userId, { type: "close", payload: {} });

    // If agent replied, surface its payload
    if (!msg.timeout) {
      if (msg.type === "status")
        return res.json({ stopped: true, ...(msg.result ?? {}) });
      if (msg.type === "error")
        return res.status(500).json({ stopped: false, error: msg.error });
    }

    // Timeout: assume success (idempotent stop)
    return res.json({
      stopped: true,
      assumed: true,
      note: "No reply before timeout; assuming session already closed.",
    });
  } catch (e) {
    return res
      .status(409)
      .json({ stopped: false, error: String(e.message || e) });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => console.log(`Backend on :${PORT}`));
