import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());


const agents = new Map();
const sseClients = new Map();

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/agents" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const userId = url.searchParams.get("user") || "unknown";

  if (!agents.has(userId)) agents.set(userId, new Set());
  agents.get(userId).add(ws);

  ws.on("message", (raw) => {
    const msg = raw.toString();
    const clients = sseClients.get(userId) || new Set();
    for (const res of clients) res.write(`data: ${msg}\n\n`);
  });

  ws.on("close", () => agents.get(userId)?.delete(ws));
});

app.get("/api/stream", (req, res) => {
  const userId = req.query.userId || "demo-user";
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

function sendToAgent(userId, msg) {
  const sockets = agents.get(userId);
  if (!sockets || sockets.size === 0) {
    throw new Error(`No agent online for user ${userId}`);
  }
  const json = JSON.stringify(msg);
  for (const ws of sockets) {
    ws.send(json);
  }
}

app.post("/api/session/open", (req, res) => {
  const userId = req.header("x-user-id") || "demo-user";
  const id = uuid();
  const { url } = req.body || {};
  try {
    sendToAgent(userId, {
      id,
      type: "openBrowser",
      payload: { url },
    });
    res.json({ id, routed: true });
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) });
  }
});

app.post("/api/session/navigate", (req, res) => {
  const userId = req.header("x-user-id") || "demo-user";
  const id = uuid();
  try {
    sendToAgent(userId, {
      id,
      type: "navigate",
      payload: { url: req.body.url },
    });
    res.json({ id, routed: true });
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) });
  }
});

app.post("/api/session/screenshot", (req, res) => {
  const userId = req.header("x-user-id") || "demo-user";
  const id = uuid();
  try {
    sendToAgent(userId, { id, type: "screenshot" });
    res.json({ id, routed: true });
  } catch (e) {
    res.status(409).json({ error: String(e.message || e) });
  }
});

app.post("/api/session/stop", (req, res) => {
  const userId = req.header("x-user-id") || "single";
  try {
    const id = uuid();
    sendToAgent(userId, {
      id,
      type: "close",
      payload: {},
    });
    res.json({ stopped: true });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Backend on :${PORT}`));
