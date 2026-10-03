import fs from 'fs';
import puppeteer from 'puppeteer-core';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome() {
  const p = CANDIDATES.find((c) => fs.existsSync(c));
  if (!p) throw new Error('No Chrome or Edge found. Install one, or set CHROME_PATH to its executable.');
  return p;
}

/** Runs fn(browser) and ALWAYS tears the browser down, even on error or timeout. */
export async function withBrowser(fn, { watchdogMs = 280000 } = {}) {
  const extra = (process.env.E2E_CHROME_ARGS || '--no-sandbox --disable-setuid-sandbox').split(/\s+/).filter(Boolean);
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'shell', args: extra, defaultViewport: { width: 1366, height: 900 } });
  const proc = browser.process();
  const kill = () => { try { proc?.kill('SIGKILL'); } catch { /* gone */ } };
  const dog = setTimeout(() => { console.error('WATCHDOG: the browser run took too long'); kill(); process.exit(3); }, watchdogMs);
  try { return await fn(browser); } finally { clearTimeout(dog); try { await browser.close(); } catch { /* gone */ } kill(); }
}
