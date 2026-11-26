import { instrumentMarket, normalizeTicker } from './instruments.mjs';

export const disclosureSources = {
  secFundIndex: 'https://www.sec.gov/files/company_tickers_mf.json',
  cnStatements: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
  sseNotices: 'https://query.sse.com.cn/security/stock/queryCompanyBulletin.do',
  cnNotices: 'https://np-anotice-stock.eastmoney.com/api/security/ann',
  cnFundNav: 'https://api.fund.eastmoney.com/f10/lsjz',
  cnFundFilings: 'https://api.fund.eastmoney.com/f10/JJGG',
  cnBreadth: 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001%2C0.399001&fields=f12%2Cf14%2Cf104%2Cf105%2Cf106%2Cf124',
  usNews: 'https://feeds.finance.yahoo.com/rss/2.0/headline',
  cnNews: 'https://news.google.com/rss/search',
  usSentiment: 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
  cboeVix: 'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
  spyIssuer: 'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy',
};

const dayMs = 86_400_000;
const commonEtfs = new Set(['DIA', 'GLD', 'IWM', 'QQQ', 'QQQM', 'SCHD', 'SLV', 'SPY', 'TLT', 'VOO', 'VT', 'VTI', 'VUG', 'VWO', 'IVV', 'XLE', 'XLK', 'XLF']);
const bearish = /\b(?:cuts? (?:its )?(?:guidance|outlook)|miss(?:es|ed)? (?:estimates|expectations)|shares? (?:fall|sink|drop|plunge)|downgrad(?:e|ed|es))\b|下调(?:评级|预期|指引)|业绩下滑|净(?:亏损|流出)|终止合作|暴跌|被立案调查/i;
const bullish = /\b(?:rais(?:es|ed) (?:its )?(?:guidance|outlook)|beat(?:s|ing)? (?:estimates|expectations)|shares? (?:rise|jump|rally|surge)|upgrad(?:e|ed|es))\b|上调(?:评级|预期|指引)|业绩增长|净流入|超预期增长|获批上市|大涨/i;

function number(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value) {
  const iso = typeof value === 'string' ? value.slice(0, 10) : '';
  const parsed = Date.parse(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === iso ? iso : null;
}

function timestamp(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function url(value, origin) {
  try {
    const resolved = new URL(value, origin);
    return resolved.protocol === 'https:' && !resolved.username && !resolved.password ? resolved.href : null;
  } catch {
    return null;
  }
}

function query(address, params) {
  const request = new URL(address);
  for (const [name, value] of Object.entries(params)) request.searchParams.set(name, value);
  return request.href;
}

function decode(value, limit = 280) {
  if (typeof value !== 'string') return '';
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole;
      const base = /x/i.test(entity[1]) ? 16 : 10;
      const code = parseInt(entity.slice(base === 16 ? 2 : 1), base);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function row(label, value, { unit = '', asOf = null, publishedAt = null, source, url, detail = '', metric, kind }) {
  return { label, value, unit, asOf, publishedAt, source, url, detail, ...(metric ? { metric } : {}), ...(kind ? { kind } : {}) };
}

export function discoveryInstrument(ticker, { type, name } = {}) {
  const market = instrumentMarket(ticker);
  const code = market === 'CN' ? ticker.slice(0, 6) : ticker;
  const exchange = market === 'CN' ? ticker.slice(7) : '';
  const publicName = String(name ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} .·()\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  const etfCode = /^(?:51|56|58)\d{4}\.SH$|^159\d{3}\.SZ$/.test(ticker);
  const etf = etfCode || /\bETF\b/i.test(publicName) || commonEtfs.has(ticker);
  return { ticker, market, code, exchange, name: publicName, type: ['equity', 'etf'].includes(type) ? type : etf ? 'etf' : null };
}

export function disclosureArchive(instrument, filings) {
  const { market, type, code, exchange } = instrument;
  if (market === 'CN') {
    if (type === 'etf') return { label: '基金公告档案', url: 'https://fundf10.eastmoney.com/jjgg_' + code + '.html' };
    if (exchange === 'SH') return { label: '上交所公告档案', url: 'https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=' + code };
    return { label: '上市公司公告档案', url: 'https://data.eastmoney.com/notices/stock/' + code + '.html' };
  }
  const secFiling = filings.find((item) => item.kind === 'filing' && item.url.startsWith('https://www.sec.gov/Archives/edgar/data/'));
  const cik = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/(\d{1,10})\//.exec(secFiling?.url ?? '')?.[1];
  return cik ? { label: type === 'etf' ? 'SEC 基金注册人档案' : 'SEC 申报档案', url: 'https://www.sec.gov/edgar/browse/?CIK=' + cik } : null;
}

export function resolveSecCompany(payload, ticker) {
  const secTicker = ticker.replaceAll('.', '-');
  const record = Object.values(payload ?? {}).find((item) => normalizeTicker(item?.ticker).replaceAll('.', '-') === secTicker);
  const cik = String(record?.cik_str ?? '');
  if (!/^\d{1,10}$/.test(cik) || +cik === 0) return null;
  return { cik: cik.padStart(10, '0'), name: decode(record.title), type: /\bETF\b/i.test(record.title) ? 'etf' : 'equity' };
}

export function resolveSecFund(payload, ticker) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const cikIndex = fields.indexOf('cik');
  const seriesIndex = fields.indexOf('seriesId');
  const symbolIndex = fields.indexOf('symbol');
  if (cikIndex < 0 || seriesIndex < 0 || symbolIndex < 0 || !Array.isArray(payload.data)) return null;
  const secTicker = ticker.replaceAll('.', '-');
  const match = payload.data.find((item) => Array.isArray(item) && normalizeTicker(item[symbolIndex]).replaceAll('.', '-') === secTicker);
  const cik = String(match?.[cikIndex] ?? '');
  const seriesId = match?.[seriesIndex];
  if (!/^\d{1,10}$/.test(cik) || +cik === 0 || !/^S\d{9}$/.test(seriesId ?? '')) return null;
  const seriesCount = new Set(payload.data.filter((item) => Array.isArray(item) && String(item[cikIndex]) === cik && /^S\d{9}$/.test(item[seriesIndex])).map((item) => item[seriesIndex])).size;
  return { cik: cik.padStart(10, '0'), seriesId, multipleSeries: seriesCount > 1, type: 'etf' };
}

export function statementsUrl(symbol) {
  return query(disclosureSources.cnStatements, {
    sortColumns: 'REPORT_DATE', sortTypes: '-1', pageSize: '3', pageNumber: '1',
    reportName: 'RPT_F10_FINANCE_MAINFINADATA', columns: 'ALL', filter: '(SECUCODE="' + symbol + '")',
  });
}

export function parseCnStatements(payload, symbol) {
  if (payload?.success !== true || !Array.isArray(payload.result?.data)) return { records: [], name: '' };
  const matching = payload.result.data.filter((item) => item?.SECUCODE === symbol && date(item.REPORT_DATE));
  const latest = matching.sort((left, right) => right.REPORT_DATE.localeCompare(left.REPORT_DATE))[0];
  if (!latest) return { records: [], name: '' };
  const name = decode(latest.SECURITY_NAME_ABBR, 90);
  const asOf = date(latest.REPORT_DATE);
  const publishedAt = date(latest.NOTICE_DATE);
  const options = {
    asOf, publishedAt, source: '东方财富数据中心', url: 'https://data.eastmoney.com/bbsj/' + symbol.slice(0, 6) + '.html',
    detail: (decode(latest.REPORT_TYPE, 24) || '最近一期报告') + '报告期累计值，由东方财富采集，查阅原始公告可核对口径。',
  };
  const fields = [
    ['报告期累计营收', 'TOTALOPERATEREVE', 'CNY'],
    ['报告期累计营收同比', 'TOTALOPERATEREVETZ', '%', 'revenueGrowthPct'],
    ['报告期累计归母净利润', 'PARENTNETPROFIT', 'CNY', 'netIncome'],
    ['报告期累计经营现金流', 'NETCASH_OPERATE_PK', 'CNY', 'operatingCashFlow'],
    ['报告期基本每股收益', 'EPSJB', 'CNY/股'],
  ];
  const records = fields.flatMap(([label, field, unit, metric]) => {
    const value = number(latest[field]);
    return value === null ? [] : [row(label, value, { ...options, unit, metric })];
  });
  return { records, name };
}

export function sseNoticesUrl(code) {
  return query(disclosureSources.sseNotices, {
    isPagination: 'true', productId: code, securityType: '0101,120100,020100,020200,120200', 'pageHelp.pageSize': '5', 'pageHelp.pageNo': '1',
  });
}

export function parseSseNotices(payload, code) {
  const rows = payload?.pageHelp?.data;
  if (!Array.isArray(rows)) return [];
  return rows.filter((item) => item?.SECURITY_CODE === code).flatMap((item) => {
    const label = decode(item.TITLE);
    const publishedAt = date(item.SSEDATE);
    const path = /^\/disclosure\/listedinfo\/announcement\/[\w/.%-]+\.pdf$/i.test(item.URL ?? '') ? item.URL : '';
    if (!label || !publishedAt || !path) return [];
    return [row(label, null, {
      asOf: publishedAt, publishedAt, source: '上海证券交易所', url: 'https://www.sse.com.cn' + path,
      detail: decode(item.BULLETIN_TYPE, 50), kind: 'filing',
    })];
  }).slice(0, 5);
}

export function cnNoticesUrl(code) {
  return query(disclosureSources.cnNotices, { sr: '-1', page_size: '8', page_index: '1', ann_type: 'A', client_source: 'web', stock_list: code });
}

export function parseCnNotices(payload, code) {
  if (payload?.success !== 1 || !Array.isArray(payload.data?.list)) return [];
  return payload.data.list.flatMap((item) => {
    if (!item?.codes?.some?.((entry) => entry?.stock_code === code)) return [];
    const label = decode(item.title);
    const publishedAt = date(item.notice_date);
    const id = /^AN\d{12,24}$/.test(item.art_code ?? '') ? item.art_code : '';
    if (!label || !publishedAt || !id) return [];
    return [row(label, null, {
      asOf: publishedAt, publishedAt, source: '东方财富公告', url: 'https://data.eastmoney.com/notices/detail/' + code + '/' + id + '.html',
      detail: '转发上市公司公告，可通过公告页面核对原文。', kind: 'filing',
    })];
  }).slice(0, 5);
}

export function cnNavUrl(code) {
  return query(disclosureSources.cnFundNav, { fundCode: code, pageIndex: '1', pageSize: '5' });
}

export function parseCnNav(payload, code) {
  const values = payload?.Data?.LSJZList;
  if (!Array.isArray(values) || payload.ErrCode !== 0) return [];
  const latest = values.flatMap((item) => {
    const asOf = date(item?.FSRQ);
    const nav = number(item?.DWJZ);
    return asOf && nav > 0 ? [{ asOf, nav }] : [];
  }).sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
  return latest ? [row('基金单位净值', latest.nav, {
    unit: 'CNY/股', asOf: latest.asOf, source: '东方财富基金档案', url: 'https://fundf10.eastmoney.com/jjjz_' + code + '.html',
    detail: '基金管理人披露的净值日期，来源接口未提供精确发布时间。', metric: 'navPerShare',
  })] : [];
}

export function cnFundFilingsUrl(code) {
  return query(disclosureSources.cnFundFilings, { fundcode: code, pageIndex: '1', pageSize: '8', type: '0' });
}

export function parseCnFundFilings(payload, code, epoch = Date.now()) {
  if (!Array.isArray(payload?.Data) || payload.ErrCode !== 0) return [];
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epoch);
  return payload.Data.flatMap((item) => {
    const label = decode(item?.TITLE);
    const publishedAt = date(item?.PUBLISHDATEDesc ?? item?.PUBLISHDATE);
    if (!label || !publishedAt || publishedAt > today || item?.FUNDCODE !== code || !/^AN\d{12,24}$/.test(item?.ID ?? '')) return [];
    return [row(label, null, {
      asOf: publishedAt, publishedAt, source: '东方财富基金档案', url: 'https://qcloud.fund.eastmoney.com/gonggao/' + code + '%2C' + item.ID + '.html',
      detail: '基金管理人披露，由基金档案收录。公告编号 ' + item.ID + '。', kind: 'filing',
    })];
  }).slice(0, 5);
}

export function parseSpyIssuer(html) {
  const decoded = String(html).replace(/&#34;|&quot;/g, '"');
  if (!/"[\w-]*ticker"\s*:\s*\{[^{}]*"value"\s*:\s*"SPY"/i.test(decoded)) return { fundamentals: [], valuation: [] };
  const navField = /"nav"\s*:\s*\{([^{}]+)\}/.exec(decoded)?.[1] ?? '';
  const nav = number(/"originalValue"\s*:\s*"([\d.]+)"/.exec(navField)?.[1]);
  const asOf = timestamp(/"asOfDateSimple"\s*:\s*"([A-Za-z]{3}\s+\d{1,2}\s+\d{4})"/.exec(navField)?.[1] + ' UTC')?.slice(0, 10);
  const ratioField = /"gross-expense-ratio"\s*:\s*\{([^{}]+)\}/.exec(decoded)?.[1] ?? '';
  const ratio = number(/"originalValue"\s*:\s*"([\d.]+)"/.exec(ratioField)?.[1]);
  const options = { source: 'State Street 官方基金页', url: disclosureSources.spyIssuer, asOf };
  return {
    valuation: nav > 0 && asOf ? [row('基金单位净值', nav, { ...options, unit: 'USD/股', metric: 'navPerShare', detail: '基金发行人公布的每日单位净值。' })] : [],
    fundamentals: ratio !== null && ratio >= 0 && asOf ? [row('基金年度总费用率', ratio, {
      ...options, unit: '%', metric: 'expenseRatioPct', detail: '发行人基金页面所列总费用率。页面未给出该费率的精确生效时间，观测日期为该页面同时发布的净值日期。',
    })] : [],
  };
}

export function newsUrl(instrument) {
  if (instrument.market === 'CN') {
    return query(disclosureSources.cnNews, { q: '"' + (instrument.name || instrument.code) + '"', hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' });
  }
  const ticker = instrument.ticker.replaceAll('.', '-');
  return /^[A-Z][A-Z0-9-]{0,13}$/.test(ticker)
    ? query(disclosureSources.usNews, { s: ticker, region: 'US', lang: 'en-US' }) : null;
}

function rssTag(item, tag) {
  return new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(item)?.[1] ?? '';
}

export function parseNewsRss(xml, instrument, feedUrl, epoch = Date.now()) {
  const aggregator = instrument.market === 'CN' ? 'Google 新闻' : 'Yahoo Finance';
  const items = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  const news = new Map();
  for (const [, item] of items.slice(0, 100)) {
    const title = decode(rssTag(item, 'title'));
    const publishedAt = timestamp(decode(rssTag(item, 'pubDate'), 70));
    const href = url(decode(rssTag(item, 'link'), 2200));
    const publisher = decode(rssTag(item, 'source'), 85);
    const time = Date.parse(publishedAt);
    if (!title || !href || !publishedAt || time > epoch + dayMs || time < epoch - 30 * dayMs || news.has(title)) continue;
    news.set(title, row(title, null, {
      asOf: publishedAt, publishedAt, source: publisher ? publisher + ' · ' + aggregator : aggregator, url: href,
      detail: '聚合 RSS 新闻标题，打开可看来源页面。', kind: 'news',
    }));
  }
  const articles = [...news.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const week = articles.filter(({ publishedAt }) => Date.parse(publishedAt) >= epoch - 7 * dayMs);
  const tone = [];
  if (week.length) {
    const counts = week.reduce((acc, item) => {
      const up = bullish.test(item.label), down = bearish.test(item.label);
      if (up && !down) acc.up++;
      if (down && !up) acc.down++;
      return acc;
    }, { up: 0, down: 0 });
    tone.push(row('近 7 日新闻标题样本', week.length, {
      unit: '条', asOf: week[0].publishedAt, publishedAt: week[0].publishedAt, source: aggregator, url: feedUrl, kind: 'newsTone',
      detail: '规则匹配的偏正面 ' + counts.up + ' 条，偏负面 ' + counts.down + ' 条，其余未归类。仅反映所取标题，样本可能遗漏报道，不用于推断资金流和交易方向。',
    }));
  }
  return { events: articles.slice(0, 6), sentiment: tone };
}

const mood = { 'extreme fear': '极度恐惧', fear: '恐惧', neutral: '中性', greed: '贪婪', 'extreme greed': '极度贪婪' };

export function parseMarketSentiment(payload) {
  const field = payload?.fear_and_greed;
  const value = number(field?.score);
  const asOf = timestamp(field?.timestamp);
  if (value === null || value < 0 || value > 100 || !asOf) return [];
  const category = Object.hasOwn(mood, field?.rating) ? mood[field.rating] : '';
  return [row('美国市场恐惧与贪婪指数', Number(value.toFixed(1)), {
    unit: '0–100', asOf, publishedAt: asOf, source: 'CNN Business', url: 'https://www.cnn.com/markets/fear-and-greed',
    detail: [category, '覆盖美股大盘，来源以市场动量、广度、波动等构建指标。'].filter(Boolean).join('。'), metric: 'sentimentIndex', kind: 'marketSentiment',
  })];
}

export function parseCnMarketBreadth(payload, now = Date.now()) {
  if (payload?.rc !== 0 || !Array.isArray(payload.data?.diff)) return [];
  const indexes = [['000001', '上海市场'], ['399001', '深圳市场']];
  return indexes.flatMap(([code, name]) => {
    const item = payload.data.diff.find((record) => record?.f12 === code);
    const counts = [item?.f104, item?.f105, item?.f106].map(number);
    const time = number(item?.f124) * 1000;
    if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0) || time <= 0 || time > now + 300_000) return [];
    const [up, down, flat] = counts;
    const total = up + down + flat;
    if (total < 100 || total > 10_000) return [];
    const publishedAt = new Date(time).toISOString();
    return [row(name + '上涨家数占比', Math.round(up / total * 1000) / 10, {
      asOf: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time),
      publishedAt, source: '东方财富指数行情', url: 'https://quote.eastmoney.com/zs' + code + '.html',
      unit: '%', kind: 'marketSentiment', metric: 'advanceSharePct',
      detail: `上涨 ${up} 家，下降 ${down} 家，平盘 ${flat} 家。按来源家数口径计算。`,
    })];
  });
}

export function parseMarketVolatility(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  if (lines.shift()?.trim().toUpperCase() !== 'DATE,OPEN,HIGH,LOW,CLOSE') return [];
  const line = lines.at(-1)?.split(',');
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(line?.[0] ?? '');
  const asOf = parts ? date(parts[3] + '-' + parts[1] + '-' + parts[2]) : null;
  const value = number(line?.[4]);
  return asOf && value > 0 ? [row('美股大盘隐含波动率 VIX', value, {
    unit: '点', asOf, source: 'Cboe Global Markets', url: 'https://www.cboe.com/tradable_products/vix/vix_historical_data/',
    detail: 'Cboe 官方日线收盘值，反映标普 500 指数期权隐含波动，可作为大盘风险情绪的背景。', kind: 'marketSentiment',
  })] : [];
}

