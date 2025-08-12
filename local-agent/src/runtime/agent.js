import WebSocket from "ws";
import os from "os";
import { v4 as uuid } from "uuid";
import { runCommand, resetSession } from "./command.js";

let ws;
let reconnectTimer;
let cfg = {};

export function startAgent({ backendWsUrl, token, onStatus }) {
  cfg = { backendWsUrl, token, onStatus };
  connect();
}

export function reconnectAgent() {
  try {
    ws?.close();
  } catch {}
}

export function stopAgent() {
  clearTimeout(reconnectTimer);
  try {
    ws?.close();
  } catch {}
}

function connect() {
  const { backendWsUrl, token, onStatus } = cfg;
  onStatus?.("connecting");

  const url = `${backendWsUrl}?token=${encodeURIComponent(
    token
  )}&device=${encodeURIComponent(os.hostname())}&user=${encodeURIComponent(
    process.env.USER_ID || "demo-user"
  )}`;
  ws = new WebSocket(url);

  ws.on("open", () => {
    onStatus?.("online");
    ws.send(
      JSON.stringify({
        type: "hello",
        id: uuid(),
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        agentVersion: "0.1.0",
      })
    );
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const reply = (obj) => ws?.send(JSON.stringify({ id: msg.id, ...obj }));

    try {
      if (msg.type === "ping") return reply({ type: "pong" });
      if (msg.type === "reset") {
        await resetSession();
        return reply({ type: "status", state: "done" });
      }

      const result = await runCommand(msg);
      reply({ type: "status", state: "done", result });
    } catch (err) {
      reply({ type: "error", error: String(err?.stack || err) });
    }
  });

  ws.on("close", () => {
    onStatus?.("offline");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });

  ws.on("error", () => {
    try {
      ws.close();
    } catch {}
  });
}
