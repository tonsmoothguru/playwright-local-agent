import { chromium } from "playwright";
import os from "os";
import fs from "fs";

let browser = null;
let context = null;
let page = null;

function getEdgePath() {
  if (os.platform() === "win32") {
    const paths = [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    for (const p of paths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    return paths[0];
  }
  if (os.platform() === "darwin") {
    return "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
  }
  return "/usr/bin/microsoft-edge";
}

function isBrowserAlive() {
  try {
    return !!browser && browser.isConnected();
  } catch {
    return false;
  }
}

function isPageAlive() {
  try {
    return !!page && !page.isClosed();
  } catch {
    return false;
  }
}

async function createFreshSession() {
  await resetSession();
  browser = await chromium.launch({
    headless: false,
    executablePath: getEdgePath(),
  });

  browser.on("disconnected", () => {
    browser = null;
    context = null;
    page = null;
  });

  context = await browser.newContext();
  page = await context.newPage();

  page.on("close", () => {
    page = null;
  });
}

async function ensureEdgeSession() {
  if (!isBrowserAlive()) {
    await createFreshSession();
    return { browser, context, page };
  }

  if (!isPageAlive()) {
    try {
      await context?.close();
    } catch {}
    try {
      context = await browser.newContext();
    } catch {}
    page = await context.newPage();
    page.on("close", () => {
      page = null;
    });
  }
  return { browser, context, page };
}

export async function resetSession() {
  try {
    await page?.close();
  } catch {}
  try {
    await context?.close();
  } catch {}
  try {
    await browser?.close();
  } catch {}
  browser = context = page = null;
}

export async function runCommand(msg) {
  const { type, payload = {} } = msg;

  if (type === "openBrowser") {
    const { url } = payload;
    const s = await ensureEdgeSession();
    if (url) await s.page.goto(url, { waitUntil: "load" });
    return { currentUrl: s.page.url() };
  }

  if (type === "navigate") {
    const s = await ensureEdgeSession();
    const { url } = payload;
    await s.page.goto(url, { waitUntil: "load" });
    return { currentUrl: s.page.url() };
  }

  if (type === "click") {
    const s = await ensureEdgeSession();
    const { selector, timeout = 15000 } = payload;
    await s.page.waitForSelector(selector, { timeout, state: "visible" });
    await s.page.click(selector);
    return { clicked: selector };
  }

  if (type === "type") {
    const s = await ensureEdgeSession();
    const { selector, text, clear = true, timeout = 15000 } = payload;
    await s.page.waitForSelector(selector, { timeout, state: "visible" });
    if (clear) await s.page.fill(selector, text ?? "");
    else await s.page.type(selector, text ?? "");
    return { typed: selector, textLength: (text || "").length };
  }

  if (type === "screenshot") {
    const s = await ensureEdgeSession();
    const buf = await s.page.screenshot({ fullPage: true });
    return { screenshotBase64: buf.toString("base64") };
  }

  if (type === "close") {
    const already = !isBrowserAlive();
    await resetSession();
    return { closed: true, alreadyClosed: already };
  }

  throw new Error(`Unknown command: ${type}`);
}
