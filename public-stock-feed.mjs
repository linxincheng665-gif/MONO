import { instrumentCurrency, tencentSymbol } from './instruments.mjs';

const endpoint = 'https://qt.gtimg.cn/q=';
const activePollInterval = 5_000;
const passivePollInterval = 15_000;
const quoteFreshFor = 90_000;
const maxBatchSize = 40;
const maxConcurrentBatches = 3;
const requestTimeout = 12_000;

const timestampPatterns = {
  CNY: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  USD: /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
};
const timestampFormatters = Object.fromEntries([
  ['CNY', 'Asia/Shanghai'],
  ['USD', 'America/New_York'],
].map(([currency, timeZone]) => [currency, new Intl.DateTimeFormat('en-US', {
  timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})]));

function utcFromParts([year, month, day, hour, minute, second]) {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function wallTimeAsUtc(formatter, instant) {
  const parts = formatter.formatToParts(instant);
  const components = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((key) =>
    Number(parts.find(({ type }) => type === key).value));
  return utcFromParts(components);
}

function providerTimestamp(raw, currency) {
  const match = timestampPatterns[currency]?.exec(raw);
  if (!match) return null;
  const parts = match.slice(1);
  const requestedTime = utcFromParts(parts.map(Number));
  const normalized = new Date(requestedTime).toISOString().slice(0, 19).replace(/\D/g, '');
  if (parts.join('') !== normalized) return null;

  const formatter = timestampFormatters[currency];
  const firstEstimate = requestedTime * 2 - wallTimeAsUtc(formatter, requestedTime);
  const corrected = firstEstimate + requestedTime - wallTimeAsUtc(formatter, firstEstimate);
  return wallTimeAsUtc(formatter, corrected) === requestedTime ? new Date(corrected).toISOString() : null;
}

function suppliedNumber(value) {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function groupSymbols(symbols) {
  const groups = new Map();
  for (const symbol of symbols) {
    const code = tencentSymbol(symbol);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(symbol);
  }
  return groups;
}

function providerValuation(fields, symbol, currency, date, price) {
  const category = fields[currency === 'CNY' ? 61 : 56];
  if (category === 'ETF' || category === 'GP-ETF') return { symbol, kind: 'etf', asOf: date };
  if (currency === 'CNY' ? !/^GP-A(?:-[A-Z]+)*$/.test(category ?? '') : category !== 'GP') return null;

  // Tencent supplies different positions for the A-share and U.S. quote layouts.
  const pe = suppliedNumber(fields[39]);
  const pb = suppliedNumber(fields[currency === 'CNY' ? 46 : 51]);
  const earnings = currency === 'USD' ? suppliedNumber(fields[47]) : null;
  // When the U.S. feed also provides EPS, confirm the reported ratio matches its basis.
  const matchesEarnings = !earnings || (pe && Math.abs(price / pe - earnings) <= Math.max(.011, Math.abs(earnings) * .015));
  return {
    symbol, kind: 'equity', asOf: date,
    peTtm: pe > 0 && matchesEarnings ? pe : null,
    pb: pb > 0 ? pb : null,
    earningsNonPositive: pe < 0 && matchesEarnings,
    bookNonPositive: pb < 0,
  };
}

export function parseTencentQuotes(text, symbols) {
  const requested = new Map([...groupSymbols(new Set(symbols))].map(([code, matching]) => [code.toLowerCase(), matching]));
  const bySymbol = new Map();
  const assignments = String(text).matchAll(/\bv_([a-z0-9_.-]+)\s*=\s*"([^"\r\n]*)"\s*;/gi);
  for (const [, code, assignment] of assignments) {
    const matching = requested.get(code.toLowerCase());
    if (!matching) continue;
    const fields = assignment.split('~');
    const price = suppliedNumber(fields[3]);
    if (price === null || price <= 0) continue;
    const prior = suppliedNumber(fields[4]);
    const change = suppliedNumber(fields[32]) ?? (prior > 0 ? (price / prior - 1) * 100 : null);
    for (const symbol of matching) {
      const currency = instrumentCurrency(symbol);
      const reportedCurrency = fields[currency === 'CNY' ? 82 : 35];
      if (/^[A-Z]{3}$/.test(reportedCurrency ?? '') && reportedCurrency !== currency) continue;
      const date = providerTimestamp(fields[30], currency);
      if (!date || (bySymbol.get(symbol)?.date ?? '') >= date) continue;
      const valuation = providerValuation(fields, symbol, currency, date, price);
      bySymbol.set(symbol, { symbol, price, change, date, currency, source: 'public', ...(valuation ? { valuation } : {}) });
    }
  }
  return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function fetchBatch(batch, signal) {
  const codes = batch.map(([code]) => encodeURIComponent(code)).join(',');
  const symbols = batch.flatMap(([, matching]) => matching);
  const response = await fetch(endpoint + codes, {
    signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Tencent quote HTTP ${response.status}`);
  const body = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const quotes = parseTencentQuotes(body, symbols);
  const found = new Set(quotes.map(({ symbol }) => symbol));
  return { quotes, unavailable: symbols.filter((symbol) => !found.has(symbol)) };
}

export function createPublicStockFeed(onQuotes, onStatus) {
  let symbols = [];
  let activeRequest = null;
  let timer = null;
  let enabled = false;
  let lastStatus = 'idle';
  let failureStreak = 0;
  let priority = false;

  function report(status, details) {
    lastStatus = status;
    onStatus?.(status, details);
  }

  function clearScheduled() {
    clearTimeout(timer);
    timer = null;
  }

  function abortActive() {
    const request = activeRequest;
    activeRequest = null;
    request?.controller.abort();
  }

  function visibilityChanged() {
    if (globalThis.document?.hidden) {
      clearScheduled();
      abortActive();
      return;
    }
    refresh();
  }

  function attach() {
    if (enabled) return;
    enabled = true;
    globalThis.document?.addEventListener('visibilitychange', visibilityChanged);
  }

  async function poll(request, batches, unavailable) {
    const { controller, requested } = request;
    const quotes = [];
    const failed = [];
    const timeout = setTimeout(() => controller.abort(), requestTimeout);
    try {
      for (let index = 0; index < batches.length && !controller.signal.aborted; index += maxConcurrentBatches) {
        const group = batches.slice(index, index + maxConcurrentBatches);
        const outcomes = await Promise.allSettled(group.map((batch) => fetchBatch(batch, controller.signal)));
        outcomes.forEach((result, offset) => {
          if (result.status === 'fulfilled') {
            quotes.push(...result.value.quotes);
            unavailable.push(...result.value.unavailable);
          } else {
            failed.push(...group[offset].flatMap(([, matching]) => matching));
          }
        });
      }
    } finally {
      clearTimeout(timeout);
    }
    if (activeRequest !== request) return [];
    activeRequest = null;

    const received = new Set([...quotes.map(({ symbol }) => symbol), ...unavailable, ...failed]);
    failed.push(...requested.filter((symbol) => !received.has(symbol)));
    quotes.sort((left, right) => left.symbol.localeCompare(right.symbol));
    const now = Date.now();
    const meta = {
      requested,
      unavailable: unavailable.sort(),
      failed: failed.sort(),
      fetchedAt: new Date(now).toISOString(),
    };
    onQuotes?.(quotes, meta);

    if (!quotes.length) {
      failureStreak += 1;
      report('error', meta);
    } else {
      failureStreak = 0;
      const recent = quotes.some(({ date }) => Math.abs(now - Date.parse(date)) <= quoteFreshFor);
      report(recent ? 'ready' : 'stale', meta);
    }
    if (enabled && !activeRequest && !globalThis.document?.hidden) {
      const interval = (priority ? activePollInterval : passivePollInterval) * Math.min(4, 2 ** failureStreak);
      timer = setTimeout(refresh, Math.max(1000, interval - (Date.now() - request.startedAt)));
    }
    return quotes;
  }

  function refresh() {
    attach();
    clearScheduled();
    if (activeRequest) return activeRequest.promise;
    if (globalThis.document?.hidden) return Promise.resolve([]);

    const groups = [...groupSymbols(symbols)];
    const unavailable = symbols.filter((symbol) => !tencentSymbol(symbol));
    if (!groups.length) {
      const meta = { requested: symbols, unavailable, failed: [], fetchedAt: null };
      onQuotes?.([], meta);
      report('idle', meta);
      return Promise.resolve([]);
    }
    const batches = [];
    for (let index = 0; index < groups.length; index += maxBatchSize) {
      batches.push(groups.slice(index, index + maxBatchSize));
    }
    const request = { controller: new AbortController(), requested: symbols, startedAt: Date.now() };
    activeRequest = request;
    request.promise = Promise.resolve().then(() => poll(request, batches, unavailable));
    if (lastStatus === 'idle' || lastStatus === 'error') report('connecting');
    return request.promise;
  }

  function setSymbols(tickers) {
    const next = [...new Set(tickers)].sort();
    if (symbols.join('|') === next.join('|') && enabled) return activeRequest?.promise;
    symbols = next;
    failureStreak = 0;
    abortActive();
    lastStatus = 'idle';
    return refresh();
  }

  function stop() {
    enabled = false;
    clearScheduled();
    abortActive();
    globalThis.document?.removeEventListener('visibilitychange', visibilityChanged);
    report('idle');
  }

  function setPriority(value) {
    if (priority === value) return;
    priority = value;
    if (priority && enabled && !activeRequest && !failureStreak) void refresh();
  }

  return { setSymbols, setPriority, refresh, stop };
}

export async function fetchPublicQuoteSnapshot(tickers, signal) {
  const groups = [...groupSymbols(tickers)];
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, requestTimeout * 2);
  const batches = [];
  for (let index = 0; index < groups.length; index += maxBatchSize) batches.push(groups.slice(index, index + maxBatchSize));
  const quotes = [];
  try {
    for (let index = 0; index < batches.length && !controller.signal.aborted; index += maxConcurrentBatches) {
      const group = batches.slice(index, index + maxConcurrentBatches);
      const results = await Promise.allSettled(group.map((batch) => fetchBatch(batch, controller.signal)));
      for (const result of results) if (result.status === 'fulfilled') quotes.push(...result.value.quotes);
    }
    return quotes;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
