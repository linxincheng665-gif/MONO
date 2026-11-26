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

const port = Number(process.env.MONO_PORT || 4173);
createServer(async (request, response) => {
  const path = request.url.split('?')[0];
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
