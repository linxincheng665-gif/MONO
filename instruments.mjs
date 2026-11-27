const chinaExchanges = new Map([
  ['SH', 'SH'], ['SS', 'SH'], ['SSE', 'SH'], ['SHSE', 'SH'], ['XSHG', 'SH'],
  ['SZ', 'SZ'], ['SZSE', 'SZ'], ['XSHE', 'SZ'],
  ['BJ', 'BJ'], ['BSE', 'BJ'], ['BJSE', 'BJ'],
]);

const chinaLabels = { SH: '沪市', SZ: '深市', BJ: '北交所' };
const explicitChinaPrefix = /^([A-Z]+)[.: _-]*(\d{6})$/;
const explicitChinaSuffix = /^(\d{6})[.: _-]*([A-Z]+)$/;
const canonicalChina = /^(\d{6})\.(SH|SZ|BJ)$/;
const gatewayTicker = /^[A-Z0-9][A-Z0-9.^=_-]{0,19}$/;

function inferChinaExchange(code) {
  if (/^(?:51|56|58)\d{4}$/.test(code)) return 'SH';
  if (/^159\d{3}$/.test(code)) return 'SZ';
  if (/^(?:60[0135]|68[89])\d{3}$/.test(code)) return 'SH';
  if (code !== '000000' && /^(?:00[0-4]|30\d)\d{3}$/.test(code)) return 'SZ';
  // The current Beijing stock range is distinct from the old codes shared with NEEQ.
  if (/^920\d{3}$/.test(code)) return 'BJ';
  return '';
}

export function normalizeTicker(value) {
  const text = String(value ?? '').normalize('NFKC').trim().toUpperCase();
  const prefix = explicitChinaPrefix.exec(text);
  if (prefix && chinaExchanges.has(prefix[1])) return `${prefix[2]}.${chinaExchanges.get(prefix[1])}`;
  const suffix = explicitChinaSuffix.exec(text);
  if (suffix && chinaExchanges.has(suffix[2])) return `${suffix[1]}.${chinaExchanges.get(suffix[2])}`;

  const exchange = inferChinaExchange(text);
  if (exchange) return `${text}.${exchange}`;

  const candidate = text.replace(/^(?:US|NASDAQ|NYSE|NYSEARCA|AMEX|ARCA|CBOE):\s*(?=[A-Z])/, '')
    .replace(/^(?=[A-Z])(.+)\.US$/, '$1');
  return gatewayTicker.test(candidate) ? candidate : '';
}

export function instrumentMarket(symbol) {
  return canonicalChina.test(normalizeTicker(symbol)) ? 'CN' : 'US';
}

export function instrumentCurrency(symbol) {
  return instrumentMarket(symbol) === 'CN' ? 'CNY' : 'USD';
}

export function buyQuantityRules(symbol, fractional = false) {
  const local = canonicalChina.exec(normalizeTicker(symbol));
  if (!local) return fractional ? { minimum: .0001, increment: .0001 } : { minimum: 1, increment: 1 };
  const [, code, exchange] = local;
  if (exchange === 'SH' && /^68[89]/.test(code)) return { minimum: 200, increment: 1 };
  if (exchange === 'BJ') return { minimum: 100, increment: 1 };
  return { minimum: 100, increment: 100 };
}

export function marketLabel(symbol) {
  const local = canonicalChina.exec(normalizeTicker(symbol));
  return local ? chinaLabels[local[2]] : '美股';
}

export function tencentSymbol(symbol) {
  const normalized = normalizeTicker(symbol);
  const local = canonicalChina.exec(normalized);
  if (local) return `${local[2].toLowerCase()}${local[1]}`;
  return /^[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)?$/.test(normalized) ? `us${normalized}` : '';
}
