import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/mono-icon.svg', ['mono-icon.svg', 'image/svg+xml']],
  ['/InterVariable.woff2', ['InterVariable.woff2', 'font/woff2']],
  ['/Inter-OFL.txt', ['Inter-OFL.txt', 'text/plain; charset=utf-8']],
  ...['styles.css', 'views.css', 'market-chart.css'].map((name) => [`/${name}`, [name, 'text/css; charset=utf-8']]),
  ...['app.mjs', 'model.mjs', 'views.mjs', 'feed.mjs', 'instruments.mjs', 'public-stock-feed.mjs', 'stock-history.mjs', 'trend-data.mjs', 'market-chart.mjs', 'chart-navigation.mjs', 'investment-engine.mjs', 'research-data.mjs', 'research-discovery.mjs', 'workspace-analysis.mjs', 'market-research.mjs', 'quant-lab.mjs', 'model-gateway.mjs'].map((name) =>
    [`/${name}`, [name, 'text/javascript; charset=utf-8']]),
]);

const sinaSymbol = 'gb_[a-z][a-z0-9]{0,14}(?:\\$[a-z0-9]{1,4})?';
const sinaQuoteUrl = new RegExp(`^https://hq\\.sinajs\\.cn/list=${sinaSymbol}(?:,${sinaSymbol}){0,29}$`);
const maxQuoteBytes = 64 * 1024;
const quoteHeaders = { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
let quoteRequests = 0;

async function serveSinaQuotes(request, response, encodedUrl) {
  const respond = (status, body) => response.writeHead(status, quoteHeaders).end(body);
  if (request.method !== 'GET') {
    response.writeHead(405, { ...quoteHeaders, Allow: 'GET' }).end();
    return;
  }
  if (encodedUrl.length > 1100) return respond(403);
  let url;
  try { url = decodeURIComponent(encodedUrl); }
  catch { return respond(400); }
  if (sinaQuoteUrl.exec(url)?.[0] !== url) return respond(403);
  if (quoteRequests >= 6) return respond(429);

  quoteRequests++;
  const signal = AbortSignal.timeout(8000);
  try {
    const upstream = await fetch(url, { signal, cache: 'no-store', redirect: 'error',
      headers: { Referer: 'https://finance.sina.com.cn/' } });
    if (upstream.status !== 200 || !upstream.body || Number(upstream.headers.get('content-length')) > maxQuoteBytes) {
      await upstream.body?.cancel();
      return respond(502);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of upstream.body) {
      size += chunk.byteLength;
      if (size > maxQuoteBytes) break;
      chunks.push(chunk);
    }
    if (size > maxQuoteBytes) return respond(502);
    return respond(200, Buffer.concat(chunks, size));
  } catch {
    return respond(signal.aborted ? 504 : 502);
  } finally {
    quoteRequests--;
  }
}

const port = Number(process.env.MONO_PORT || 4173);
createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (path === '/public-research') return serveSinaQuotes(request, response, request.url.slice(path.length + 1));
  const file = files.get(path);
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`MONO is available at http://127.0.0.1:${port}`);
});
