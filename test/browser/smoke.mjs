// Browser smoke test: the built page boots in headless Chrome, the scenario
// reaches its last event, and there are no console errors.
// Usage: npm run build && npm run test:browser
// Chrome: CHROME_PATH, else the installed Google Chrome channel.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = new URL('../../dist/', import.meta.url).pathname;
const BASE = '/lnx_kernel_city/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith(BASE)) return res.writeHead(404).end();
  let rel = normalize(url.pathname.slice(BASE.length)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '.' || rel === '' || rel.endsWith('/')) rel = join(rel, 'index.html');
  try {
    const body = await readFile(join(DIST, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
);
const errors = [];
let failed = false;
try {
  for (const query of ['', '?source=fixture', '?noS']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (m) => m.type() === 'error' && errors.push(`${query} console: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${query} pageerror: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}${BASE}${query}`);
    await page.waitForSelector('#status[data-ready="true"]', { timeout: 10_000 });
    // Run the stream to the end through the same runtime the page uses.
    const result = await page.evaluate(() => {
      const lkc = globalThis.__lkc;
      lkc.clock.pause();
      lkc.runtime.runToEnd();
      const s = lkc.runtime.state;
      return { done: lkc.runtime.done, seq: s.seq, hits: s.counters.cacheHits, misses: s.counters.cacheMisses };
    });
    await page.waitForTimeout(300); // let a few frames render the end state
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `smoke${query.replace(/\W/g, '_') || '_model'}.png`) });
    const ok = result.done && result.hits === 1 && result.misses === 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${query || '(model)'}: last seq ${result.seq}, hits ${result.hits}, misses ${result.misses}`);
    if (!ok) failed = true;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const e of errors) console.error(e);
if (failed || errors.length > 0) process.exit(1);
console.log('smoke test passed');
