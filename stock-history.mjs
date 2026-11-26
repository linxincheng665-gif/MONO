import { instrumentMarket, tencentSymbol } from './instruments.mjs';

const quoteUrl = 'https://qt.gtimg.cn/q=';
const dayUrl = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const usAdjustedDayUrl = 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get';
const minuteUrl = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline';
const usMinuteUrls = [
  'https://push2his.eastmoney.com/api/qt/stock/trends2/get',
  'https://63.push2his.eastmoney.com/api/qt/stock/trends2/get',
];
const usIntervals = Object.freeze(['day', 'm1']);
const noIntervals = Object.freeze([]);
const usProviderCodes = new Map();
const eastmoneyMarkets = new Map([['OQ', 105], ['N', 106], ['AM', 107]]);

export const STOCK_HISTORY_INTERVALS = Object.freeze(['day', 'm1', 'm5', 'm15', 'm30', 'm60']);

export function stockHistoryIntervals(symbol) {
  if (!tencentSymbol(symbol)) return noIntervals;
  return instrumentMarket(symbol) === 'CN' ? STOCK_HISTORY_INTERVALS : usIntervals;
}

function priceValue(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function barDate(value, interval) {
  if (typeof value !== 'string') return null;
  if (interval === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
  }

  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  if (+hour > 23 || +minute > 59) return null;
  const date = barDate(`${year}-${month}-${day}`, 'day');
  if (!date) return null;
  return new Date(`${date}T${hour}:${minute}:00+08:00`).toISOString();
}

function parseBars(rows, readDate) {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [timestamp, rawOpen, rawClose, rawHigh, rawLow, rawVolume] = row;
    const date = readDate(timestamp);
    const [open, close, high, low, volume] = [rawOpen, rawClose, rawHigh, rawLow, rawVolume].map(priceValue);
    if (!date || ![open, close, high, low].every((price) => price !== null && price > 0)
      || low > Math.min(open, close) || high < Math.max(open, close) || volume === null || volume < 0) continue;
    byDate.set(date, { date, open, high, low, close, volume });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseStockHistory(payload, providerSymbol, interval = 'day') {
  if (payload?.code !== 0) return [];
  const response = payload.data?.[providerSymbol];
  if (interval === 'day-adjusted') return parseBars(response?.qfqday, (date) => barDate(date, 'day'));
  if (!STOCK_HISTORY_INTERVALS.includes(interval)) return [];
  return parseBars(response?.[interval], (date) => barDate(date, interval));
}

export function parseEastmoneyMinuteHistory(payload) {
  if (payload?.rc !== 0 || !Array.isArray(payload.data?.trends)) return [];
  const rows = payload.data.trends.filter((row) => typeof row === 'string').map((row) => row.split(','));
  return parseBars(rows, (date) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date)
    ? barDate(date.replace(/\D/g, ''), 'm1') : null);
}

export function parseUsProviderCode(text, quoteSymbol) {
  for (const [, code, row] of String(text).matchAll(/\bv_([a-z0-9_.-]+)\s*=\s*"([^"\r\n]*)"\s*;/gi)) {
    if (code.toLowerCase() !== quoteSymbol.toLowerCase()) continue;
    const name = row.split('~')[2]?.toUpperCase();
    const prefix = `${quoteSymbol.slice(2).toUpperCase()}.`;
    if (name?.startsWith(prefix) && /^[A-Z0-9]{1,6}$/.test(name.slice(prefix.length))) return `us${name}`;
  }
  return null;
}

async function readProvider(url, signal) {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error(`历史行情请求失败（HTTP ${response.status}）。`);
  return response;
}

async function lookupUsCode(quoteSymbol, signal) {
  if (usProviderCodes.has(quoteSymbol)) return usProviderCodes.get(quoteSymbol);
  const response = await readProvider(quoteUrl + encodeURIComponent(quoteSymbol), signal);
  const body = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const code = parseUsProviderCode(body, quoteSymbol);
  if (code) usProviderCodes.set(quoteSymbol, code);
  return code;
}

async function fetchUsMinuteHistory(providerSymbol, signal) {
  const suffixIndex = providerSymbol.lastIndexOf('.');
  const market = eastmoneyMarkets.get(providerSymbol.slice(suffixIndex + 1));
  if (!market) return [];
  const ticker = providerSymbol.slice(2, suffixIndex);
  let lastError = null;
  let emptyResponse = false;
  for (const endpoint of usMinuteUrls) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      secid: `${market}.${ticker}`,
      fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
      ndays: '1',
      iscr: '0',
      iscca: '0',
    });
    try {
      const response = await readProvider(url, signal);
      const bars = parseEastmoneyMinuteHistory(await response.json());
      if (bars.length) return bars;
      emptyResponse = true;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  if (emptyResponse) return [];
  throw lastError;
}

export async function fetchStockHistory(symbol, interval = 'day', { signal } = {}) {
  const adjusted = interval === 'day-adjusted';
  const period = adjusted ? 'day' : interval;
  if (!stockHistoryIntervals(symbol).includes(period)) return [];
  const quoteSymbol = tencentSymbol(symbol);
  const isUs = instrumentMarket(symbol) === 'US';
  const providerSymbol = isUs ? await lookupUsCode(quoteSymbol, signal) : quoteSymbol;
  if (!providerSymbol) return [];
  if (isUs && period === 'm1') return fetchUsMinuteHistory(providerSymbol, signal);

  // The empty final daily parameter requests unadjusted prices. Tencent minute K lines use raw prices.
  const dailyEndpoint = adjusted && isUs ? usAdjustedDayUrl : dayUrl;
  const url = new URL(period === 'day' ? dailyEndpoint : minuteUrl);
  const parameters = period === 'day' ? [providerSymbol, period, '', '', 650, adjusted ? 'qfq' : '']
    : [providerSymbol, period, '', 320];
  url.searchParams.set('param', parameters.join(','));
  const response = await readProvider(url, signal);
  return parseStockHistory(await response.json(), providerSymbol, interval);
}
