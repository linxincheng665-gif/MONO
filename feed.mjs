import { instrumentMarket, normalizeTicker } from './instruments.mjs';

export function validateFeed(value) {
  if (!value.url?.trim()) return null;
  let url;
  try { url = new URL(value.url.trim()); } catch { throw new Error('请输入完整的行情网关地址。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const stream = ['wss:', 'ws:'].includes(url.protocol);
  const allowed = ['wss:', 'https:'].includes(url.protocol) || (local && ['ws:', 'http:'].includes(url.protocol));
  if (!allowed || url.username || url.password || url.hash) throw new Error('请使用 WSS 或 HTTPS 网关地址。');
  const interval = Math.min(60, Math.max(1, Number(value.interval) || 5));
  return { url: url.href, stream, interval };
}

function parseQuotes(payload, symbols) {
  const updates = Array.isArray(payload) ? payload : payload?.quotes ?? [payload];
  if (!Array.isArray(updates)) return [];
  return updates.flatMap((row) => {
    const symbol = normalizeTicker(row?.symbol);
    const price = Number(row?.price);
    const timestamp = row?.timestamp ?? row?.date;
    const numericDate = typeof timestamp === 'number' ? (Math.abs(timestamp) < 1e11 ? timestamp * 1000 : timestamp) : null;
    const zoned = typeof timestamp === 'string' && /T\d\d:.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
    const time = numericDate !== null || zoned ? new Date(numericDate ?? timestamp).getTime() : NaN;
    if (!symbols.includes(symbol) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(time)) return [];
    const change = row?.change;
    const currency = typeof row.currency === 'string' ? row.currency.toUpperCase().trim() : undefined;
    const date = new Date(time).toISOString();
    const suppliedSession = row?.session;
    let session = null;
    if (instrumentMarket(symbol) === 'US') {
      if (suppliedSession != null && !['regular', 'pre', 'post', 'overnight'].includes(suppliedSession)) return [];
      if (suppliedSession == null) {
        const minute = easternTradeMinute(date);
        if (minute >= 4 * 60 && minute < 9 * 60 + 30) session = 'pre';
        else if (minute > 16 * 60 && minute <= 20 * 60) session = 'post';
        else if (minute < 4 * 60 || minute > 20 * 60) return [];
      } else if (suppliedSession !== 'regular') session = suppliedSession;
    } else if (suppliedSession != null && suppliedSession !== 'regular') return [];
    const referenceClose = session && Number(row.referenceClose) > 0 ? positiveNumber(Number(row.referenceClose)) : null;
    const normalizedChange = session ? referenceClose === null ? null : (price / referenceClose - 1) * 100
      : change != null && Number.isFinite(Number(change)) ? Number(change) : null;
    return [{ symbol, price, change: normalizedChange, date, currency, source: 'live',
      ...(session ? { session, referenceClose } : {}) }];
  });
}

export function createFeed(onQuotes, onStatus) {
  let config = null;
  let symbols = [];
  let socket = null;
  let abort = null;
  let timer;
  let quoteTimer;
  let connectTimer;
  let generation = 0;
  let attempt = 0;
  let hasQuotes = false;

  function stop() {
    generation += 1;
    clearTimeout(timer);
    clearTimeout(quoteTimer);
    clearTimeout(connectTimer);
    abort?.abort();
    socket?.close();
    socket = null;
    hasQuotes = false;
  }

  function process(payload, status) {
    const quotes = parseQuotes(payload, symbols);
    if (!quotes.length) return false;
    onQuotes(quotes);
    onStatus(status);
    hasQuotes = true;
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => onStatus('stale'), Math.max(15, config.interval * 3) * 1000);
    return true;
  }

  function subscribe() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', symbols }));
  }

  function stream(id) {
    if (generation !== id) return;
    onStatus('connecting');
    const connection = new WebSocket(config.url);
    socket = connection;
    connectTimer = setTimeout(() => connection.close(), 10000);
    connection.onopen = () => {
      if (generation !== id) return;
      clearTimeout(connectTimer);
      subscribe();
      quoteTimer = setTimeout(() => onStatus('stale'), 15000);
    };
    connection.onmessage = (event) => {
      if (generation !== id) return;
      try { if (process(JSON.parse(event.data), 'stream')) attempt = 0; } catch { /* ignore non-quote frames */ }
    };
    connection.onclose = () => {
      if (generation !== id) return;
      clearTimeout(connectTimer);
      clearTimeout(quoteTimer);
      onStatus(hasQuotes ? 'stale' : 'error');
      timer = setTimeout(() => stream(id), Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
    };
    connection.onerror = () => connection.close();
  }

  async function poll(id) {
    if (generation !== id) return;
    const started = performance.now();
    const url = new URL(config.url);
    url.searchParams.set('symbols', symbols.join(','));
    const request = new AbortController();
    abort = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Quote gateway rejected the request');
      const payload = await response.json();
      if (generation === id && !process(payload, 'poll')) onStatus(hasQuotes ? 'stale' : 'waiting');
    } catch {
      if (generation === id) onStatus(hasQuotes ? 'stale' : 'error');
    } finally {
      clearTimeout(timeout);
      if (generation === id) timer = setTimeout(() => poll(id), Math.max(0, config.interval * 1000 - (performance.now() - started)));
    }
  }

  function refresh() {
    stop();
    attempt = 0;
    if (!config) onStatus('local');
    else if (!symbols.length) onStatus('waiting');
    else if (config.stream) stream(generation);
    else {
      onStatus('connecting');
      void poll(generation);
    }
  }

  return {
    configure(value, tickers) {
      config = value;
      symbols = [...new Set(tickers)].sort();
      refresh();
    },
    setSymbols(tickers) {
      const next = [...new Set(tickers)].sort();
      if (next.join(',') === symbols.join(',')) return;
      symbols = next;
      if (!config) return;
      if (config.stream && symbols.length && socket?.readyState === WebSocket.OPEN) subscribe();
      else refresh();
    },
    refresh,
  };
}

const alpacaHost = 'stream.data.alpaca.markets';

export function validateAlpaca(value) {
  const key = String(value?.key ?? '').trim();
  const secret = String(value?.secret ?? '').trim();
  const feed = value?.feed === 'sip' ? 'sip' : 'iex';
  if (!key && !secret) return null;
  if (![key, secret].every((item) => /^[A-Za-z0-9_-]{5,256}$/.test(item))) {
    throw new Error('请输入有效的 Alpaca API Key ID 和 Secret Key。');
  }
  return { key, secret, feed };
}

function validAlpacaDate(value) {
  if (typeof value !== 'string' || !/T\d\d:/i.test(value)) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

const easternTradeClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function easternTradeMinute(date) {
  const [hour, minute] = easternTradeClock.format(new Date(date)).split(':').map(Number);
  return hour * 60 + minute;
}

function alpacaSession(date, conditions) {
  const time = easternTradeMinute(date);
  if (time < 4 * 60 || time > 20 * 60) return 'outside';
  if (time < 9 * 60 + 30) return 'pre';
  const extendedTrade = Array.isArray(conditions) && conditions.some((condition) => condition === 'T' || condition === 'U');
  if (time > 16 * 60 || (time >= 13 * 60 && extendedTrade)) return 'post';
  return null;
}

function alpacaTrade(symbol, item, priorClose) {
  const price = positiveNumber(item?.p);
  const date = validAlpacaDate(item?.t);
  if (price === null || !date) return null;
  const session = alpacaSession(date, item.c);
  if (session === 'outside') return null;
  if (session) return { symbol, price, date, session, change: null };
  return { symbol, price, date, change: priorClose ? (price / priorClose - 1) * 100 : null };
}

function alpacaBook(symbol, item) {
  const bid = positiveNumber(item?.bp);
  const ask = positiveNumber(item?.ap);
  const bookDate = validAlpacaDate(item?.t);
  if (!bookDate) return null;
  return { symbol, bid, ask, bookDate };
}

export async function alpacaSnapshots(config, symbols, signal) {
  const url = new URL('https://data.alpaca.markets/v2/stocks/snapshots');
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('feed', config.feed);
  const result = await fetch(url, {
    signal, cache: 'no-store', redirect: 'error',
    headers: { 'APCA-API-KEY-ID': config.key, 'APCA-API-SECRET-KEY': config.secret },
  });
  if (!result.ok) throw new Error('无法获取最新行情快照。');
  return result.json();
}

export function createAlpacaFeed(onQuotes, onStatus, requestSnapshots = alpacaSnapshots) {
  let config;
  let symbols = [];
  let subscribed = [];
  let connection;
  let authenticated = false;
  let retry;
  let deadline;
  let controller;
  let generation = 0;
  let retryCount = 0;
  const previousCloses = new Map();
  const latestTrades = new Map();

  function stop() {
    generation += 1;
    clearTimeout(retry);
    clearTimeout(deadline);
    controller?.abort();
    if (connection && connection.readyState < WebSocket.CLOSING) connection.close();
    connection = null;
    authenticated = false;
    subscribed = [];
  }

  function targets(tickers) {
    return [...new Set(tickers.filter((item) => /^[A-Z][A-Z0-9.\-]{0,19}$/.test(item)))].slice(0, config?.feed === 'sip' ? undefined : 30);
  }

  function publish(rows) {
    if (rows.length) onQuotes(rows.map((row) => ({ ...row, source: 'live', provider: `alpaca-${config.feed}` })));
  }

  async function snapshot(list, id) {
    controller?.abort();
    if (!list.length) return;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 7000);
    try {
      const data = await requestSnapshots(config, list, request.signal);
      if (id !== generation || request.signal.aborted) return;
      const rows = [];
      for (const symbol of list) {
        if (!data || !Object.hasOwn(data, symbol) || !symbols.includes(symbol)) continue;
        const item = data[symbol];
        const close = positiveNumber(item?.prevDailyBar?.c);
        if (close !== null) previousCloses.set(symbol, close);
        const trade = alpacaTrade(symbol, item?.latestTrade, close);
        if (trade?.session) rows.push(trade);
        const regular = trade?.session ? null : trade;
        const live = latestTrades.get(symbol);
        if (live && (!regular || live.date >= regular.date)) {
          rows.push({ ...live, change: close ? (live.price / close - 1) * 100 : null });
        } else if (regular) rows.push(regular);
        const book = alpacaBook(symbol, item?.latestQuote);
        if (book) rows.push(book);
      }
      publish(rows);
    } catch {
      // A failed snapshot leaves the authenticated WebSocket stream running.
    } finally {
      clearTimeout(timeout);
    }
  }

  function subscribe(id) {
    if (!authenticated || connection?.readyState !== WebSocket.OPEN) return;
    const remove = subscribed.filter((item) => !symbols.includes(item));
    const add = symbols.filter((item) => !subscribed.includes(item));
    if (remove.length) connection.send(JSON.stringify({ action: 'unsubscribe', trades: remove, quotes: remove }));
    if (add.length) connection.send(JSON.stringify({ action: 'subscribe', trades: add, quotes: add }));
    subscribed = [...symbols];
    if (add.length) void snapshot(symbols, id);
  }

  function connect(id) {
    if (id !== generation || !config) return;
    onStatus('connecting');
    let ws;
    try { ws = new WebSocket(`wss://${alpacaHost}/v2/${config.feed}`); }
    catch { onStatus('error'); return; }
    connection = ws;
    let blocked = false;
    deadline = setTimeout(() => ws.close(), 12000);

    ws.onopen = () => {
      if (id !== generation) return;
      ws.send(JSON.stringify({ action: 'auth', key: config.key, secret: config.secret }));
    };

    ws.onmessage = ({ data }) => {
      if (id !== generation || typeof data !== 'string') return;
      let events;
      try { events = JSON.parse(data); } catch { return; }
      if (!Array.isArray(events)) return;
      const rows = [];
      for (const item of events) {
        if (item?.T === 'success' && item.msg === 'authenticated') {
          authenticated = true;
          retryCount = 0;
          clearTimeout(deadline);
          onStatus('subscribed');
          subscribe(id);
        }
        if (item?.T === 'error') {
          blocked = [401, 402, 405, 406, 409, 410].includes(item.code);
          onStatus(item.code === 406 ? 'occupied' : item.code === 405 ? 'limit' : item.code === 409 ? 'entitlement' : blocked ? 'auth' : 'error');
          ws.close();
          return;
        }
        if (!authenticated || !symbols.includes(item?.S)) continue;
        if (item.T === 't') {
          const trade = alpacaTrade(item.S, item, previousCloses.get(item.S));
          if (trade) {
            if (!trade.session && (latestTrades.get(item.S)?.date ?? '') <= trade.date) latestTrades.set(item.S, trade);
            rows.push(trade);
          }
        } else if (item.T === 'q') {
          const book = alpacaBook(item.S, item);
          if (book) rows.push(book);
        }
      }
      if (rows.length) {
        publish(rows);
        onStatus('stream');
      }
    };

    ws.onclose = () => {
      if (id !== generation) return;
      clearTimeout(deadline);
      authenticated = false;
      subscribed = [];
      if (blocked) return;
      onStatus('reconnecting');
      retry = setTimeout(() => connect(id), Math.min(30000, 1000 * 2 ** Math.min(retryCount++, 5)));
    };
    ws.onerror = () => ws.close();
  }

  function refresh() {
    stop();
    retryCount = 0;
    if (!config) { onStatus('local'); return; }
    connect(generation);
  }

  return {
    configure(value, tickers) {
      config = value;
      symbols = targets(tickers);
      previousCloses.clear();
      latestTrades.clear();
      refresh();
    },
    setSymbols(tickers) {
      const next = targets(tickers);
      if (next.length === symbols.length && next.every((ticker) => symbols.includes(ticker))) return;
      symbols = next;
      if (!config) return;
      if (authenticated) subscribe(generation);
      else refresh();
    },
    refresh,
  };
}
