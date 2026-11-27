// Takes the screen images used in the docs (docs/images/screen-*.png) from the built Storybook.
// Run `npm run build-storybook` first, then `npm run capture:docs`. Needs Google Chrome.
// Only story data appears in the images, never a real data folder.
//
// Chrome is driven over the DevTools protocol (Node's built-in WebSocket): open the story, wait
// for it to settle, take the picture. `--screenshot` alone hangs on stories that keep timers going.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const site = join(root, "storybook-static");
const out = join(root, "docs/images");

// [story id, output name, width, height]
const SHOTS = [
  ["screens-desktop--d-01", "screen-project", 1440, 900],
  ["screens-desktop--d-01-b", "screen-subtasks", 1440, 900],
  ["screens-desktop--d-02", "screen-quick-add", 1440, 900],
  ["screens-desktop--d-03", "screen-task-dialog", 1440, 900],
  ["screens-desktop--d-04", "screen-today", 1440, 900],
  ["screens-desktop--d-05", "screen-upcoming", 1440, 900],
  ["screens-desktop--d-06", "screen-labels", 1440, 900],
  ["screens-desktop--d-07", "screen-date-picker", 1440, 900],
  ["screens-desktop--d-07-b", "screen-recurrence", 1440, 900],
  ["screens-desktop--d-01-k", "screen-row-menu", 1440, 900],
  ["screens-desktop--d-15", "screen-calendar", 1440, 900],
  ["screens-desktop--d-09", "screen-settings", 1440, 900],
  ["screens-desktop--d-09-f", "screen-settings-nas", 1440, 900],
  ["screens-desktop--d-09-b", "screen-conflict", 1440, 900],
  ["screens-desktop--d-10", "screen-board", 1440, 900],
  ["screens-desktop--d-12", "screen-onboarding", 1440, 900],
  ["screens-dark--d-01-dark", "screen-project-dark", 1440, 900],
  ["views-attachments--dialog-with-note-files", "screen-attachments", 1440, 900],
  ["views-attachments--viewer", "screen-attachment-viewer", 1440, 900],
  ["screens-mobile--m-04", "screen-mobile-today", 390, 844],
  ["screens-mobile--m-01", "screen-mobile-project", 390, 844],
  ["screens-mobile--m-03", "screen-mobile-task", 390, 844],
  ["screens-mobile--m-06", "screen-mobile-browse", 390, 844],
  ["views-mobile-attachments--comment-sheet", "screen-mobile-comments", 390, 844],
];

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const SETTLE_MS = 1500;

if (!existsSync(join(site, "iframe.html"))) {
  console.error("storybook-static がありません。先に npm run build-storybook を実行してください。");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

// Chrome cannot load ES modules from file://, so the built site is served on localhost.
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(site) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

const profile = mkdtempSync(join(tmpdir(), "powertodo-capture-"));
const chrome = spawn(CHROME, ["--headless=new", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok, fail) => {
  let err = "";
  chrome.stderr.on("data", (d) => {
    err += d;
    const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) ok(m[1]);
  });
  chrome.on("exit", () => fail(new Error("Chrome が起動しませんでした")));
});

// One page target, one WebSocket. `send` returns the result of a DevTools method.
const browser = new WebSocket(wsUrl);
await new Promise((ok) => browser.addEventListener("open", ok, { once: true }));
let nextId = 0;
const pending = new Map();
browser.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, fail) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)));
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page("Page.enable");
  await page("Runtime.enable");
  for (const [id, name, w, h] of SHOTS) {
    try {
      await page("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await page("Page.navigate", { url: `http://127.0.0.1:${port}/iframe.html?id=${id}&viewMode=story` });
      // Wait for Storybook to mount the story, then let fonts and entry animations settle.
      for (let i = 0; i < 40; i++) {
        const { result } = await page("Runtime.evaluate", { expression: "document.querySelector('#storybook-root')?.childElementCount ?? 0", returnByValue: true });
        if (result.value > 0) break;
        await sleep(250);
      }
      await page("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
      await sleep(SETTLE_MS);
      const { data } = await page("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
      console.log(`ok  ${name}.png`);
    } catch (e) {
      console.log(`NG  ${name}.png (${id}): ${e.message}`);
    }
  }
} finally {
  browser.close();
  chrome.kill();
  server.close();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
