import { app, Menu, Tray, nativeImage, dialog } from "electron";
import path from "path";
import fs from "fs";
import { startAgent, reconnectAgent, stopAgent } from "./runtime/agent.js";

let tray;

const config = {
  backendWsUrl: process.env.BACKEND_WS || "ws://localhost:8080/agents",
  token: process.env.AGENT_TOKEN || "demo-token",
  userId: process.env.USER_ID || "demo-user",
};

function resolveTrayIcon() {
  const prodIcon = path.join(process.resourcesPath, "assets", "playwright.ico");
  const devIcon = path.join(process.cwd(), "assets", "playwright.ico");
  const iconPath = fs.existsSync(prodIcon) ? prodIcon : devIcon;
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Tray icon not found: ${iconPath}`);
  }
  return iconPath;
}

function updateTrayTooltip(status = "offline") {
  tray?.setToolTip(
    `Playwright Agent\nStatus: ${status}\nWS: ${config.backendWsUrl}`
  );
}

function createTray() {
  const iconPath = resolveTrayIcon();
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) throw new Error("Invalid tray icon (.ico).");

  tray = new Tray(img);
  const menu = Menu.buildFromTemplate([
    { label: "Reconnect", click: () => reconnectAgent() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        stopAgent();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  updateTrayTooltip("starting");
}

function requireConfig() {
  if (!config.token) {
    dialog.showErrorBox("Agent not configured", "AGENT_TOKEN is missing.");
    return false;
  }
  return true;
}

app.setLoginItemSettings({ openAtLogin: true });

app.whenReady().then(() => {
  createTray();
  if (requireConfig()) {
    startAgent({
      backendWsUrl: config.backendWsUrl,
      token: config.token,
      userId: config.userId,
      onStatus: (s) => updateTrayTooltip(s),
    });
  } else {
    updateTrayTooltip("missing token");
  }
});

app.on("window-all-closed", (e) => e.preventDefault());
