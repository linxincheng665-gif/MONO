import { instrumentMarket, normalizeTicker } from './instruments.mjs';
import {
  cnFundFilingsUrl, cnNavUrl, cnNoticesUrl, disclosureArchive, disclosureSources, discoveryInstrument, newsUrl, parseCnFundFilings,
  parseCnMarketBreadth, parseCnNav, parseCnNotices, parseCnStatements, parseMarketSentiment, parseMarketVolatility, parseNewsRss, parseSpyIssuer, parseSseNotices,
  resolveSecCompany, resolveSecFund, sseNoticesUrl, statementsUrl,
} from './research-discovery.mjs';

const sections = ['macro', 'fundamentals', 'valuation', 'events', 'sentiment'];
const metricSections = {
  macro: new Set(['rateChangeBps']),
  fundamentals: new Set(['revenueGrowthPct', 'operatingCashFlow', 'netIncome', 'dilutedEps', 'expenseRatioPct', 'trackingErrorPct', 'navPerShare']),
  valuation: new Set(['expenseRatioPct', 'trackingErrorPct', 'navPerShare', 'peTtm', 'priceToBook']),
  sentiment: new Set(['sentimentIndex', 'advanceSharePct']),
};
const evidenceKinds = { events: new Set(['filing', 'news']), sentiment: new Set(['marketSentiment', 'newsTone']) };
const DAY = 86_400_000;
const HOUR = 3_600_000;
const maxCacheEntries = 72;
const maxItemsPerSection = 20;
const treasuryUrl = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
const treasuryPage = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve';
const fedUrl = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/5.json';
const fedPage = 'https://www.newyorkfed.org/markets/reference-rates/effr';
const blsUrl = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const tickerMapUrl = 'https://www.sec.gov/files/company_tickers.json';
const secGuide = 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces';
const filingForms = new Set(['10-K', '10-Q', '8-K', '20-F', '40-F', '6-K']);
const fundForms = new Set(['N-CSR', 'N-CSRS', 'N-CEN', 'NPORT-P', '497', '497K', '485BPOS', 'N-1A']);
const annualForms = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);
const quarterlyForms = new Set(['10-Q', '10-Q/A', ...annualForms]);
const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' });

function cleanText(value, limit = 260) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function dateValue(value) {
  const candidate = cleanText(value, 40);
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(candidate)) return candidate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    const timestamp = Date.parse(candidate);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === candidate ? candidate : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(candidate)) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) && dateValue(candidate.slice(0, 10)) ? new Date(timestamp).toISOString() : null;
}

function emptyResult(symbol, now) {
  return { symbol, fetchedAt: new Date(now).toISOString(), macro: [], fundamentals: [], valuation: [], events: [], sentiment: [], errors: [], coverage: [] };
}

function evidence(label, value, { unit = '', asOf = null, publishedAt = null, source, url, detail = '', metric, kind }) {
  return { label, value, unit, asOf, publishedAt, source, url, detail, ...(metric ? { metric } : {}), ...(kind ? { kind } : {}) };
}

export function validateResearchEndpoint(value) {
  const text = cleanText(typeof value === 'string' ? value : value?.url, 2000);
  if (!text) return null;
  const url = safeUrl(text);
  if (!url || url.hash) throw new Error('请输入不含登录凭据或片段的 HTTPS 数据地址。');
  return url.href;
}

export function normalizeResearchEvidence(symbol, payload, now = Date.now()) {
  const ticker = normalizeTicker(symbol);
  if (!ticker) throw new Error('请选择有效的研究标的。');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('投研数据须为 JSON 对象。');
  }
  if (Object.hasOwn(payload, 'symbol') && normalizeTicker(payload.symbol) !== ticker) {
    throw new Error('数据文件的标的与当前研究标的不一致。');
  }

  const output = emptyResult(ticker, now);
  const sourceSections = payload.sections && typeof payload.sections === 'object' ? payload.sections : payload;
  let omitted = 0;
  for (const section of sections) {
    const rows = sourceSections[section];
    if (rows == null) continue;
    if (!Array.isArray(rows)) {
      omitted++;
      continue;
    }
    for (const item of rows.slice(0, 100)) {
      if (output[section].length >= maxItemsPerSection) break;
      const label = cleanText(item?.label ?? item?.title, 100);
      const value = typeof item?.value === 'number' ? numeric(item.value) : cleanText(item?.value, 500);
      const source = cleanText(item?.source, 100);
      const url = safeUrl(item?.url);
      const asOf = dateValue(item?.asOf);
      const publishedAt = dateValue(item?.publishedAt);
      if (!label || !source || !url || (!asOf && !publishedAt) ||
          (section !== 'events' && (value === '' || value === null))) {
        omitted++;
        continue;
      }
      output[section].push(evidence(label, value === '' ? null : value, {
        unit: cleanText(item.unit, 24), asOf, publishedAt, source, url: url.href, detail: cleanText(item.detail, 700),
        metric: metricSections[section]?.has(item.metric) ? item.metric : undefined,
        kind: evidenceKinds[section]?.has(item.kind) ? item.kind : undefined,
      }));
    }
  }
  if (omitted) output.errors.push({ source: '来源数据', message: '已忽略 ' + omitted + ' 条缺少有效内容、来源链接或时间的记录。' });
  return output;
}

function quoteXml(entry, tag) {
  return new RegExp('<(?:[\\w.-]+:)?' + tag + '\\b[^>]*>([^<]*)<\\/(?:[\\w.-]+:)?' + tag + '>', 'i')
    .exec(entry)?.[1]?.trim() ?? '';
}

export function parseTreasuryResearch(xml) {
  const observations = [...String(xml).matchAll(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi)]
    .flatMap(([entry]) => {
      const asOf = dateValue(quoteXml(entry, 'NEW_DATE').slice(0, 10));
      if (!asOf) return [];
      const two = numeric(quoteXml(entry, 'BC_2YEAR'));
      const ten = numeric(quoteXml(entry, 'BC_10YEAR'));
      return two === null && ten === null ? [] : [{ asOf, two, ten }];
    }).sort((left, right) => right.asOf.localeCompare(left.asOf));
  const last = observations[0];
  if (!last) return [];

  const official = { unit: '%', asOf: last.asOf, source: '美国财政部', url: treasuryPage, detail: '日度国债平价收益率，使用官方公布的观测日期。' };
  const records = [];
  if (last.two !== null) records.push(evidence('美国 2 年期国债收益率', last.two, official));
  if (last.ten !== null) records.push(evidence('美国 10 年期国债收益率', last.ten, official));
  if (last.ten !== null && last.two !== null) {
    records.push(evidence('美债 10 年与 2 年利差', Math.round((last.ten - last.two) * 100), {
      ...official, unit: '基点', detail: '以同日 10 年期收益率减去 2 年期收益率计算。',
    }));
  }
  return records;
}

export function parseFedResearch(payload) {
  const allowed = Array.isArray(payload?.refRates) ? payload.refRates : [];
  const last = allowed.flatMap((row) => {
    const asOf = dateValue(row?.effectiveDate);
    const value = numeric(row?.percentRate);
    return asOf && value !== null && row.type === 'EFFR' ? [{ asOf, value }] : [];
  }).sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
  return last ? [evidence('美国有效联邦基金利率', last.value, {
    unit: '%', asOf: last.asOf, source: '纽约联储', url: fedPage, detail: '按联邦基金市场实际交易统计。',
  })] : [];
}

const cpiId = 'CUUR0000SA0';
const unemploymentId = 'LNS14000000';

export function parseBlsResearch(payload, id) {
  if (payload?.status !== 'REQUEST_SUCCEEDED' || ![cpiId, unemploymentId].includes(id)) return [];
  const series = payload.Results?.series;
  const observations = Array.isArray(series) ? series.find((item) => item.seriesID === id)?.data : null;
  if (!Array.isArray(observations)) return [];
  const records = observations.flatMap((row) => {
    if (!/^\d{4}$/.test(row?.year ?? '') || !/^M(?:0[1-9]|1[0-2])$/.test(row.period ?? '')) return [];
    const value = numeric(row.value);
    const asOf = row.year + '-' + row.period.slice(1);
    return value === null ? [] : [{ asOf, value }];
  }).sort((left, right) => right.asOf.localeCompare(left.asOf));
  const last = records[0];
  if (!last) return [];

  const official = { unit: '%', asOf: last.asOf, source: '美国劳工统计局', url: 'https://data.bls.gov/timeseries/' + id };
  if (id === unemploymentId) return [evidence('美国失业率', last.value, { ...official, detail: '季节调整后，月度观测。' })];

  const byMonth = new Map(records.map(({ asOf, value }) => [asOf, value]));
  for (const { asOf, value } of records) {
    const yearAgo = String(Number(asOf.slice(0, 4)) - 1) + asOf.slice(4);
    const prior = byMonth.get(yearAgo);
    if (!(value > 0) || !(prior > 0)) continue;
    return [evidence('美国 CPI 同比', Number(((value / prior - 1) * 100).toFixed(2)), {
      ...official, asOf, detail: '以未季调的全类别 CPI 指数与上年同月比较。' +
        (asOf === last.asOf ? '' : last.asOf + ' 缺少同比基数，此处显示最近可比较月份。'),
    })];
  }
  return last.value > 0 ? [evidence('美国 CPI 指数', last.value, {
    ...official, unit: '指数', detail: '未季调的全类别 CPI 指数，当前来源缺少同月同比基数。',
  })] : [];
}

function filingUrl(cik, accession, document) {
  const id = typeof cik === 'string' && /^\d{1,10}$/.test(cik) ? String(Number(cik)) : '';
  const number = cleanText(accession, 22);
  const file = cleanText(document, 150);
  if (!id || !/^\d{10}-\d{2}-\d{6}$/.test(number)) return null;
  const seg = file.split('/');
  const safe = seg.length <= 2 && seg.every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..');
  return 'https://www.sec.gov/Archives/edgar/data/' + id + '/' + number.replaceAll('-', '') + '/' + (safe ? file : number + '-index.html');
}

export function parseSecEvents(payload, cik, { fund = false, multipleSeries = false } = {}) {
  const recent = payload?.filings?.recent;
  if (!Array.isArray(recent?.form)) return [];
  const output = [];
  for (const [index, form] of recent.form.entries()) {
    if (output.length >= 8) break;
    const type = typeof form === 'string' ? form.replace(/\/A$/, '') : '';
    if (!(fund ? fundForms : filingForms).has(type)) continue;
    const filed = dateValue(recent.filingDate?.[index]);
    const url = filingUrl(cik, recent.accessionNumber?.[index], recent.primaryDocument?.[index]);
    if (!filed || !url) continue;
    const description = cleanText(recent.primaryDocDescription?.[index], 160);
    const items = cleanText(recent.items?.[index], 120);
    output.push(evidence((multipleSeries ? 'SEC 基金注册人申报 ' : 'SEC 申报 ') + form, description || null, {
      source: 'SEC EDGAR', url, asOf: dateValue(recent.reportDate?.[index]) ?? filed,
      publishedAt: dateValue(recent.acceptanceDateTime?.[index]) ?? filed,
      detail: multipleSeries ? '同一注册人可能申报多个基金系列，查阅原文核对所选基金。' : items ? '申报事项编号 ' + items : '', kind: 'filing',
    }));
  }
  return output;
}

export function parseSecFundReport(xml, identity, disclosure) {
  const text = String(xml);
  const ids = [...text.matchAll(/<(?:[\w.-]+:)?seriesId\b[^>]*>\s*(S\d{9})\s*<\//gi)].map(([, id]) => id);
  if (identity.seriesId ? !ids.includes(identity.seriesId) : ids.length > 0 || identity.multipleSeries) return [];
  const asOf = dateValue(quoteXml(text, 'repPdDate')) ?? dateValue(disclosure.asOf);
  const netAssets = numeric(quoteXml(text, 'netAssets'));
  const positions = [...text.matchAll(/<(?:[\w.-]+:)?invstOrSec(?:\s[^>]*)?>/gi)].length;
  if (!asOf) return [];
  const options = { asOf, publishedAt: disclosure.publishedAt, source: 'SEC EDGAR N-PORT', url: disclosure.url };
  const results = [];
  if (netAssets !== null && netAssets > 0) results.push(evidence('基金披露净资产', netAssets, { ...options, unit: 'USD', detail: '基金 N-PORT 报告期末净资产。' }));
  if (positions) results.push(evidence('基金证券投资披露记录数', positions, { ...options, unit: '条', detail: '按公开 N-PORT 表中的投资条目计数，同一发行人可以有多个条目。' }));
  return results;
}

function factRows(facts, concept, unit, annual = false) {
  const permitted = annual ? annualForms : quarterlyForms;
  const rows = facts?.[concept]?.units?.[unit];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const start = dateValue(row?.start);
    const end = dateValue(row?.end);
    const filed = dateValue(row?.filed);
    const value = numeric(row?.val);
    if (!start || !end || !filed || value === null || !permitted.has(row?.form)) return [];
    const length = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
    if (length < (annual ? 330 : 75) || length > (annual ? 400 : 110)) return [];
    return [{ start, end, filed, value, length, accession: row.accn }];
  }).sort((left, right) => right.end.localeCompare(left.end) || right.filed.localeCompare(left.filed));
}

function latestFact(facts, concepts, unit, annual = false) {
  return concepts.flatMap((concept) => {
    const rows = factRows(facts, concept, unit, annual);
    return rows.length ? [{ concept, rows, row: rows[0] }] : [];
  }).sort((left, right) => right.row.end.localeCompare(left.row.end))[0];
}

export function parseSecFundamentals(payload, cik) {
  const facts = payload?.facts?.['us-gaap'];
  const revenue = latestFact(facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], 'USD');
  const profit = latestFact(facts, ['NetIncomeLoss', 'ProfitLoss'], 'USD');
  const earnings = latestFact(facts, ['EarningsPerShareDiluted'], 'USD/shares', true);
  const cashFlow = latestFact(facts, ['NetCashProvidedByUsedInOperatingActivities'], 'USD', true);
  const output = [];
  const add = (fact, label, unit, detail, metric) => {
    if (!fact) return;
    const { row } = fact;
    const url = filingUrl(cik, row.accession) ?? 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json';
    output.push(evidence(label, row.value, { unit, asOf: row.end, publishedAt: row.filed, source: 'SEC EDGAR', url, detail, metric }));
  };

  add(revenue, '最新财季营收', 'USD', '发行人财报申报数据。');
  if (revenue) {
    const { row, rows } = revenue;
    const previous = rows.find((item) => {
      const offset = (Date.parse(row.end) - Date.parse(item.end)) / DAY;
      return offset >= 350 && offset <= 380 && Math.abs(item.length - row.length) <= 10 && item.filed <= row.filed;
    });
    if (previous?.value > 0) {
      add({ row: { ...row, value: Number(((row.value / previous.value - 1) * 100).toFixed(2)) } },
        '最新财季营收同比', '%', '以同一财报字段的上年同期营收计算。', 'revenueGrowthPct');
    }
  }
  add(profit, '最新财季净利润', 'USD', '发行人财报申报数据。', 'netIncome');
  add(earnings, '最新财年稀释每股收益', 'USD/股', '财年申报值。', 'dilutedEps');
  add(cashFlow, '最新财年经营活动现金流', 'USD', '发行人最近完整财年的经营活动现金净额。', 'operatingCashFlow');
  return output;
}

function canceled(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
}

async function requestData(fetcher, url, { signal, type = 'json', userAgent, timeout = 7000, maxBytes = 2_000_000 } = {}) {
  canceled(signal);
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, {
      signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
    });
    if (!response.ok) throw new Error('数据源响应 HTTP ' + response.status + '。');
    if (Number(response.headers?.get?.('Content-Length')) > maxBytes) throw new Error('数据源响应超过读取上限。');
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('数据源响应超过读取上限。');
    canceled(signal);
    return type === 'text' ? text : JSON.parse(text);
  } catch (error) {
    canceled(signal);
    if (controller.signal.aborted) throw new Error('数据源请求超时。');
    if (error instanceof TypeError) throw new Error('无法读取数据源，请检查网络和跨域权限。');
    if (error instanceof SyntaxError) throw new Error('数据源未返回有效的数据格式。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

function monthKey(epoch, offset = 0) {
  const parts = monthFormatter.formatToParts(new Date(epoch));
  const number = (type) => Number(parts.find((item) => item.type === type).value);
  const date = new Date(Date.UTC(number('year'), number('month') - 1 + offset, 1));
  return date.toISOString().slice(0, 7).replace('-', '');
}

function checked(records) {
  if (!records.length) throw new Error('数据源未返回可核验记录。');
  return records;
}

function nativeResearchRequest(transport, url, { signal, maxBytes = 2_000_000, type = 'json' } = {}) {
  canceled(signal);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      reject(new Error('公开数据源请求超时。'));
      controller.abort();
    }, 10_000);
    const abort = () => {
      reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
      controller.abort(signal.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => transport(String(url), { signal: controller.signal })).then((response) => {
      if (!(response?.status >= 200 && response.status < 300)) throw new Error('公开数据源响应 HTTP ' + (response?.status ?? '未知') + '。');
      if (typeof response.body !== 'string' || response.body.length > maxBytes) throw new Error('公开数据源响应超过读取上限。');
      resolve(type === 'text' ? response.body : JSON.parse(response.body));
    }).catch((error) => reject(error instanceof SyntaxError ? new Error('公开数据源未返回有效的数据格式。') : error)).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
  });
}

function requestLimiter(limit) {
  const queued = [];
  let active = 0;
  function pump() {
    while (active < limit && queued.length) {
      const { run, signal, resolve, reject } = queued.shift();
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
        continue;
      }
      active++;
      Promise.resolve().then(run).then(resolve, reject).finally(() => {
        active--;
        pump();
      });
    }
  }
  return (run, signal) => new Promise((resolve, reject) => {
    if (queued.length >= 60) {
      reject(new Error('正在读取多项数据，请稍后重试。'));
      return;
    }
    queued.push({ run, signal, resolve, reject });
    pump();
  });
}

export function createResearchData({ fetcher = globalThis.fetch, now = Date.now, secUserAgent, publicTransport } = {}) {
  const cache = new Map();
  const limit = requestLimiter(5);
  const currentTime = typeof now === 'function' ? now : () => Number(now);
  const agent = cleanText(secUserAgent, 180);
  const hasSecAgent = /\S+@\S+\.\S+/.test(agent) && !/[\r\n]/.test(agent);
  let nextSecRequest = 0;

  async function fromCache(key, ttl, loader, { force, signal }) {
    canceled(signal);
    const prior = cache.get(key);
    if (prior && !force && currentTime() < prior.expires) return { value: prior.value, cached: true };
    try {
      const value = await loader();
      canceled(signal);
      cache.delete(key);
      cache.set(key, { value, expires: currentTime() + ttl });
      if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
      return { value };
    } catch (error) {
      canceled(signal);
      return { value: prior?.value, error: cleanText(error?.message, 200) || '暂时无法读取数据源。', cached: !!prior };
    }
  }

  async function load(symbol, { endpoint, force = false, signal, type, name } = {}) {
    const ticker = normalizeTicker(symbol);
    if (!ticker) throw new Error('请选择有效的研究标的。');
    const gateway = validateResearchEndpoint(endpoint);
    const params = { force, signal };
    const output = emptyResult(ticker, currentTime());
    const instrument = discoveryInstrument(ticker, { type, name });
    const bridge = globalThis.monoPublicResearch;
    const transport = publicTransport ?? (typeof bridge?.request === 'function' ? bridge.request.bind(bridge) : null);
    const fetch = (site, options) => limit(() => requestData(fetcher, site, { signal, ...options }), signal);
    const publicFetch = (site, options) => transport
      ? limit(() => nativeResearchRequest(transport, site, { signal, ...options }), signal) : fetch(site, options);
    const secFetch = async (site, options) => {
      const now = Date.now();
      const delay = Math.max(0, nextSecRequest - now);
      nextSecRequest = now + delay + 150;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      canceled(signal);
      return publicFetch(site, { userAgent: agent || undefined, maxBytes: 12_000_000, ...options });
    };

    const sources = [];
    function source(name, key, ttl, section, loader) {
      sources.push({ name, section, task: fromCache(key, ttl, loader, params) });
    }
    let cnProfile;
    let cnFundDisclosure;
    function getCnProfile() {
      return cnProfile ??= fetch(statementsUrl(ticker)).then((data) => parseCnStatements(data, ticker));
    }
    function getCnFundDisclosure() {
      return cnFundDisclosure ??= publicFetch(cnFundFilingsUrl(instrument.code));
    }

    if (instrument.market === 'US') {
      source('美国财政部', 'treasury-yields', 3 * HOUR, 'macro', async () => {
        for (const offset of [0, -1]) {
          const url = new URL(treasuryUrl);
          url.searchParams.set('data', 'daily_treasury_yield_curve');
          url.searchParams.set('field_tdr_date_value_month', monthKey(currentTime(), offset));
          const parsed = parseTreasuryResearch(await fetch(url, { type: 'text' }));
          if (parsed.length) return parsed;
        }
        return checked([]);
      });
      source('纽约联储', 'ny-fed-effr', 3 * HOUR, 'macro', async () => checked(parseFedResearch(await fetch(fedUrl))));
      source('美国劳工统计局 CPI', cpiId, 12 * HOUR, 'macro', async () => checked(parseBlsResearch(await fetch(blsUrl + cpiId), cpiId)));
      source('美国劳工统计局失业率', unemploymentId, 12 * HOUR, 'macro', async () => checked(parseBlsResearch(await fetch(blsUrl + unemploymentId), unemploymentId)));
      source('CNN Business／Cboe 大盘情绪', 'us-market-sentiment', HOUR, 'sentiment', async () => {
        try {
          return checked(parseMarketSentiment(await fetch(disclosureSources.usSentiment)));
        } catch (error) {
          canceled(signal);
          if (!transport) throw error;
          return checked(parseMarketVolatility(await publicFetch(disclosureSources.cboeVix, { type: 'text' })));
        }
      });

      if (transport || hasSecAgent) {
        let identityTask;
        let disclosuresTask;
        function getIdentity() {
          return identityTask ??= (async () => {
            const registry = await fromCache('sec-ticker-registry', DAY, () => secFetch(tickerMapUrl), { force: false, signal });
            const company = resolveSecCompany(registry.value, ticker);
            if (company && !instrument.type && company.type === 'equity') return company;
            if (company?.type === 'etf' && ticker === 'SPY') return company;
            if (company && instrument.type === 'equity') return company;
            const funds = await fromCache('sec-fund-registry', DAY, () => secFetch(disclosureSources.secFundIndex), { force: false, signal });
            const fund = resolveSecFund(funds.value, ticker);
            if (fund || company) return fund || company;
            throw new Error(registry.error || funds.error || 'SEC 公共索引暂未找到所选标的的准确代码。');
          })();
        }

        function getDisclosures() {
          return disclosuresTask ??= (async () => {
            const identity = await getIdentity();
            const data = await secFetch('https://data.sec.gov/submissions/CIK' + identity.cik + '.json');
            return parseSecEvents(data, identity.cik, { fund: identity.type === 'etf', multipleSeries: identity.multipleSeries });
          })();
        }

        source('SEC 财报及基金数据', 'sec-facts|' + ticker + '|' + (instrument.type ?? ''), 3 * HOUR, 'fundamentals', async () => {
          const identity = await getIdentity();
          if (identity.type !== 'etf') {
            const data = await secFetch('https://data.sec.gov/api/xbrl/companyfacts/CIK' + identity.cik + '.json');
            return checked(parseSecFundamentals(data, identity.cik));
          }
          const candidates = (await getDisclosures()).filter(({ label }) => /NPORT-P/.test(label));
          for (const disclosure of candidates.slice(0, 4)) {
            const primary = disclosure.url.replace(/\/xslForm[\w.-]+\/primary_doc\.xml$/, '/primary_doc.xml');
            if (!primary.endsWith('/primary_doc.xml')) continue;
            const facts = parseSecFundReport(await secFetch(primary, { type: 'text' }), identity, disclosure);
            if (facts.length) return facts;
          }
          throw new Error('近期公开文件中未核验到所选基金系列的 N-PORT 数据。');
        });
        source('SEC 公告及基金披露', 'sec-filings|' + ticker + '|' + (instrument.type ?? ''), HOUR, 'events', async () => checked(await getDisclosures()));

        if (ticker === 'SPY' && transport) {
          source('State Street 官方基金页', 'spy-issuer', 3 * HOUR, null, async () => {
            const data = parseSpyIssuer(await publicFetch(disclosureSources.spyIssuer, { type: 'text' }));
            if (!data.fundamentals.length && !data.valuation.length) throw new Error('暂未取得带日期的基金发行人披露。');
            return data;
          });
        }
      } else {
        const message = 'SEC 浏览器接口暂不支持跨域读取。可在 Android／Windows 安装版获取或配置其它投研数据源。';
        output.errors.push({ source: 'SEC EDGAR', message, url: secGuide });
        output.coverage.push({ source: 'SEC EDGAR', status: 'unavailable', records: 0, message });
      }
    } else if (instrument.type === 'etf') {
      source('东方财富 ETF 净值', 'cn-etf-nav|' + ticker, 3 * HOUR, 'valuation', async () => checked(parseCnNav(await publicFetch(cnNavUrl(instrument.code)), instrument.code)));
      source('东方财富 ETF 披露', 'cn-etf-filings|' + ticker, HOUR, 'events', async () => checked(parseCnFundFilings(
        await getCnFundDisclosure(), instrument.code, currentTime(),
      )));
    } else {
      source('东方财富财务数据', 'cn-facts|' + ticker, 3 * HOUR, 'fundamentals', async () => checked((await getCnProfile()).records));
      source(instrument.exchange === 'SH' ? '上交所／东方财富公告' : '东方财富公告', 'cn-filings|' + ticker, HOUR, 'events', async () => {
        if (instrument.exchange === 'SH') {
          try {
            const official = parseSseNotices(await publicFetch(sseNoticesUrl(instrument.code)), instrument.code);
            if (official.length) return official;
          } catch {
            canceled(signal);
          }
        }
        return checked(parseCnNotices(await publicFetch(cnNoticesUrl(instrument.code)), instrument.code));
      });
    }

    if (instrument.market === 'CN') source('东方财富沪深市场宽度', 'cn-market-breadth', 10 * 60_000, 'sentiment',
      async () => checked(parseCnMarketBreadth(await publicFetch(disclosureSources.cnBreadth), currentTime())));

    const feed = newsUrl({ ...instrument, name: '' });
    if (feed) {
      const sourceName = instrument.market === 'CN' ? 'Google 新闻' : 'Yahoo Finance 新闻';
      source(sourceName, 'news|' + ticker + '|' + (instrument.type ?? ''), 30 * 60_000, null, async () => {
        let address = feed;
        if (instrument.market === 'CN') {
          try {
            const publicName = instrument.type === 'etf'
              ? (await getCnFundDisclosure())?.Data?.find?.((item) => item?.FUNDCODE === instrument.code)?.ShortTitle
              : (await getCnProfile()).name;
            if (publicName) address = newsUrl(discoveryInstrument(ticker, { name: publicName }));
          } catch {
            canceled(signal);
          }
        }
        const records = parseNewsRss(await publicFetch(address, { type: 'text' }), instrument, address, currentTime());
        if (!records.events.length) throw new Error('近期没有可核验的相关新闻。');
        return records;
      });
    }

    if (gateway) {
      source('配置的投研数据源', 'gateway|' + gateway + '|' + ticker, 5 * 60_000, null, async () => {
        const url = new URL(gateway);
        url.searchParams.set('symbol', ticker);
        const records = normalizeResearchEvidence(ticker, await fetch(url), currentTime());
        if (!sections.some((section) => records[section].length) && !records.errors.length) throw new Error('配置的来源未返回投研记录。');
        return records;
      });
    }

    const responses = await Promise.all(sources.map(({ name, section, task }) => task.then((result) => ({ name, section, ...result }))));
    canceled(signal);
    for (const { name, section, value, error, cached } of responses) {
      const available = section ? value?.length ?? 0 : sections.reduce((count, key) => count + (value?.[key]?.length ?? 0), 0);
      const message = error ? error + (cached ? ' 已显示上一次取得的记录。' : '') : undefined;
      if (message) output.errors.push({ source: name, message });
      output.coverage.push({ source: name, status: error ? cached ? 'stale' : 'unavailable' : cached ? 'cached' : 'available', records: available, ...(message ? { message } : {}) });
      if (!value) continue;
      if (section) output[section].push(...value);
      else {
        for (const key of sections) output[key].push(...(value[key] ?? []));
        output.errors.push(...(value.errors ?? []));
      }
    }
    output.archive = disclosureArchive(instrument, output.events.filter((item) => item.source === 'SEC EDGAR'));
    output.fetchedAt = new Date(currentTime()).toISOString();
    return output;
  }

  return { load, clear: () => cache.clear() };
}

const researchData = createResearchData();
export const loadResearchData = (symbol, options) => researchData.load(symbol, options);

