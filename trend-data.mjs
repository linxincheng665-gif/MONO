const barsKey = 'mono-chart-bars-v1';
const observationsKey = 'mono-chart-observations-v1';
const maxStoredSeries = 24;
const maxObservationPoints = 288;

function loadMap(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem(key));
    return new Map(Array.isArray(parsed) ? parsed.filter((item) => Array.isArray(item) && typeof item[0] === 'string') : []);
  } catch {
    return new Map();
  }
}

function saveMap(storage, key, map) {
  try { storage?.setItem(key, JSON.stringify([...map].slice(-maxStoredSeries))); } catch { /* data remains available in this session */ }
}

export function createTrendStore(fetchHistory, storage) {
  const cache = loadMap(storage, barsKey);
  const transient = new Set();
  const observations = loadMap(storage, observationsKey);
  const requests = new Map();
  const failures = new Map();
  const queue = [];
  let running = 0;
  let saveTimer;

  function read(symbol, interval) {
    const key = `${symbol}|${interval}`;
    const entry = cache.get(key);
    const bars = Array.isArray(entry?.bars) ? entry.bars : [];
    return { bars, status: requests.has(key) ? 'loading' : bars.length ? 'ready' : failures.has(key) ? 'unavailable' : 'idle' };
  }

  function pump() {
    while (running < 4 && queue.length) {
      running++;
      void queue.shift()().finally(() => { running--; pump(); });
    }
  }

  function savePriceCache() {
    saveMap(storage, barsKey, new Map([...cache].filter(([key]) => !transient.has(key))));
  }

  function load(symbol, interval = 'day', { force = false, temporary = false } = {}) {
    if (!symbol) return Promise.resolve(false);
    const key = `${symbol}|${interval}`;
    if (requests.has(key)) return requests.get(key);
    const now = Date.now();
    const ttl = interval.startsWith('day') ? 15 * 60_000 : 60_000;
    if (!force && now - (cache.get(key)?.at ?? 0) < ttl) {
      if (!temporary && transient.delete(key)) savePriceCache();
      return Promise.resolve(false);
    }
    if (!force && now - (failures.get(key) ?? 0) < 60_000) return Promise.resolve(false);
    const request = new Promise((resolve) => {
      queue.push(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const rows = await fetchHistory(symbol, interval, { signal: controller.signal });
          if (!Array.isArray(rows) || !rows.length) throw new Error('No price history');
          const stored = cache.has(key) && !transient.has(key);
          cache.delete(key);
          cache.set(key, { at: Date.now(), bars: rows.slice(-400) });
          failures.delete(key);
          if (temporary && !stored) {
            transient.delete(key);
            transient.add(key);
            if (transient.size > 400) {
              const oldest = transient.values().next().value;
              transient.delete(oldest);
              cache.delete(oldest);
            }
          } else {
            transient.delete(key);
            savePriceCache();
          }
        } catch {
          failures.set(key, Date.now());
        } finally {
          clearTimeout(timeout);
          requests.delete(key);
          resolve(true);
        }
      });
    });
    requests.set(key, request);
    pump();
    return request;
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saveMap(storage, observationsKey, observations);
  }

  function observe(symbol, quote) {
    if (!['live', 'public', 'manual', 'imported'].includes(quote?.source) || !Number.isFinite(quote.price) || quote.price <= 0) return;
    const time = Date.parse(quote.date);
    if (!Number.isFinite(time)) return;
    const date = new Date(time).toISOString();
    const points = observed(symbol);
    const previous = points.at(-1);
    if (previous && previous.date >= date) return;
    const lastTwoWithinBucket = points.length > 1 && Math.floor(Date.parse(points.at(-2).date) / 30_000) === Math.floor(time / 30_000);
    const next = { date, close: quote.price };
    if (lastTwoWithinBucket) points[points.length - 1] = next;
    else points.push(next);
    observations.delete(symbol);
    observations.set(symbol, points.filter((point) => time - Date.parse(point.date) <= 7 * 86_400_000).slice(-maxObservationPoints));
    while (observations.size > maxStoredSeries) observations.delete(observations.keys().next().value);
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = undefined; flush(); }, 1200);
  }

  function observed(symbol) { return Array.isArray(observations.get(symbol)) ? observations.get(symbol) : []; }
  return { read, load, observe, observed, flush };
}

export function mergeSeries(rows, extra) {
  const unique = new Map();
  for (const row of [...rows, ...extra]) if (row?.date && Number.isFinite(row.close ?? row.value)) unique.set(row.date, row);
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateBars(rows, period) {
  if (period === 'day' || period === 'm1') return rows;
  const minutes = period.startsWith('m') ? Number(period.slice(1)) : 0;
  const buckets = new Map();
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    const time = Date.parse(row.date);
    const dayIndex = new Date(`${day}T00:00:00Z`).getUTCDay();
    const key = minutes ? Math.floor(time / (60_000 * minutes)) : period === 'month' ? day.slice(0, 7) : Date.parse(day) - (dayIndex + 6) % 7 * 86_400_000;
    if (typeof key === 'number' && !Number.isFinite(key)) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  return [...buckets.values()].map((bucket) => {
    const first = bucket[0];
    const last = bucket.at(-1);
    const bar = { date: last.date, close: last.close };
    if (bucket.every((row) => [row.open, row.high, row.low].every(Number.isFinite))) {
      bar.open = first.open;
      bar.high = Math.max(...bucket.map((row) => row.high));
      bar.low = Math.min(...bucket.map((row) => row.low));
    }
    if (bucket.every((row) => Number.isFinite(row.volume))) bar.volume = bucket.reduce((sum, row) => sum + row.volume, 0);
    return bar;
  });
}

export function portfolioObserved(positions, cash, quoteForSymbol) {
  const entries = positions.map(({ symbol, shares }) => ({ shares, marks: quoteForSymbol(symbol) }));
  if (!entries.length || entries.some(({ marks }) => !marks.length)) return [];
  const earliest = Math.max(...entries.map(({ marks }) => Date.parse(marks[0].date)));
  const times = [...new Set(entries.flatMap(({ marks }) => marks.map(({ date }) => date)))].sort();
  const offsets = entries.map(() => 0);
  return times.filter((date) => Date.parse(date) >= earliest).flatMap((date) => {
    const values = entries.map(({ shares, marks }, index) => {
      while (offsets[index] + 1 < marks.length && marks[offsets[index] + 1].date <= date) offsets[index]++;
      const mark = marks[offsets[index]];
      return mark.date <= date ? mark.close * shares : null;
    });
    return values.every(Number.isFinite) ? [{ date, value: values.reduce((sum, value) => sum + value, cash) }] : [];
  }).slice(-300);
}
