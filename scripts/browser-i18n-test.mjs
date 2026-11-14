import { chromium } from "playwright";
import { startPreview } from "./preview.mjs";
import { captureDemo } from "./marketplace-demo.mjs";
const { server, url } = await startPreview(0);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  await captureDemo(browser, url, "test-results/i18n-en", "en-US", true);
  console.log("English browser passed: no untranslated plugin labels, continuous annotation, Worker search, nested filters, batch save and undo, tool settings, canonical built-in labels and custom names across languages.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
