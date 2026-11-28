import { instrumentCurrency, instrumentMarket, normalizeTicker, tencentSymbol } from './instruments.mjs';
import { indicators, tradeExecution, tradePlan } from './model.mjs';

const dayMs = 86_400_000;
const horizonRules = [
  { key: 'short', label: '短线', sessions: '5–15 个交易日', window: 20, fast: 10, slow: 30, holding: 10 },
  { key: 'mid', label: '中线', sessions: '约 1–3 个月', window: 60, fast: 20, slow: 50, holding: 30 },
  { key: 'long', label: '长线', sessions: '约 3–12 个月', window: 120, fast: 50, slow: 120, holding: 60 },
];
const eventReviewDays = 45;
const evidenceFields = [
  ['fundamentals', 'fundamental', '基本面', 180],
  ['valuation', 'valuation', '估值', 90],
  ['macro', 'macro', '宏观环境', 90],
  ['events', 'event', '重大事件', eventReviewDays],
  ['sentiment', 'sentiment', '市场情绪', 30],
];
const typedMetrics = new Set(['revenueGrowthPct', 'operatingCashFlow', 'expenseRatioPct', 'trackingErrorPct',
  'rateChangeBps', 'navPerShare', 'peTtm', 'priceToBook', 'sentimentIndex', 'advanceSharePct', 'netIncome', 'dilutedEps']);
const clocks = {
  CN: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  US: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
};
const researchPrice = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });

function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value) {
  const result = numeric(value);
  return result !== null && result > 0 ? result : null;
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function marketDay(now, market) {
  const fields = Object.fromEntries(clocks[market].formatToParts(now).map(({ type, value }) => [type, value]));
  return { day: `${fields.year}-${fields.month}-${fields.day}`,
    closed: Number(fields.hour) >= (market === 'CN' ? 15 : 16) };
}

function completedBars(rows, calendar) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = dateOnly(row?.date);
    const close = positive(row?.close ?? row?.value);
    if (!date || close === null || row.complete === false || date > calendar.day
      || (date === calendar.day && !calendar.closed)) continue;
    const open = positive(row.open), high = positive(row.high), low = positive(row.low);
    const ohlc = open !== null && high !== null && low !== null && low <= Math.min(open, close)
      && high >= Math.max(open, close);
    const volume = numeric(row.volume);
    byDate.set(date, { date, close, open: ohlc ? open : null, high: ohlc ? high : null,
      low: ohlc ? low : null, volume: volume !== null && volume >= 0 ? volume : null });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function trailingMean(bars, count) {
  return bars.length >= count ? mean(bars.slice(-count).map(({ close }) => close)) : null;
}

function trendFor(bars, rule) {
  const close = bars.at(-1)?.close;
  const fast = trailingMean(bars, rule.fast), slow = trailingMean(bars, rule.slow);
  const direction = slow === null ? 'unknown' : close >= fast && fast > slow ? 'up'
    : close <= fast && fast < slow ? 'down' : 'mixed';
  const requirement = `收盘价 ≥ MA${rule.fast}，且 MA${rule.fast} > MA${rule.slow}`;
  const detail = direction === 'unknown' ? `至少需要 ${rule.slow} 根完整日线计算 MA${rule.slow}。`
    : `收盘 ${researchPrice.format(close)}，MA${rule.fast} 为 ${researchPrice.format(fast)}，MA${rule.slow} 为 ${researchPrice.format(slow)}。规则要求${requirement}。`;
  return { direction, detail, requirement };
}

function discontinuities(bars) {
  return bars.slice(1).flatMap((bar, index) => {
    const ratio = (bar.open ?? bar.close) / bars[index].close;
    return ratio < .55 || ratio > 1.65 ? [bar.date] : [];
  });
}

function relativeStrength(bars, benchmark) {
  const base = new Map(benchmark.map(({ date, close }) => [date, close]));
  const paired = bars.filter(({ date }) => base.has(date)).slice(-21);
  if (paired.length < 21) return null;
  const first = paired[0], last = paired.at(-1);
  return 100 * (last.close / first.close - base.get(last.date) / base.get(first.date));
}

function technicalState(bars, benchmark) {
  const indicator = indicators(bars);
  const last = bars.at(-1);
  const previousVolumes = bars.slice(-21, -1).map(({ volume }) => volume);
  const meanVolume = previousVolumes.length === 20 && previousVolumes.every(Number.isFinite)
    ? mean(previousVolumes) : null;
  const closes = bars.slice(-21).map(({ close }) => close);
  const logarithms = closes.slice(1).map((close, index) => Math.log(close / closes[index]));
  const center = mean(logarithms);
  const volatility = logarithms.length === 20
    ? Math.sqrt(logarithms.reduce((sum, value) => sum + (value - center) ** 2, 0) / 19 * 252) * 100 : null;
  const { ma20, ma50, rsi14 } = indicator;
  const trend = ma50 === null ? 'unknown' : last.close >= ma20 && ma20 >= ma50 ? 'up'
    : last.close <= ma20 && ma20 <= ma50 ? 'down' : 'mixed';
  return {
    close: last?.close ?? null, ma20, ma50, rsi: rsi14, rsi14, trend,
    volumeRatio: meanVolume > 0 && Number.isFinite(last?.volume) ? last.volume / meanVolume : null,
    volatility, realizedVolatility: volatility, relativeStrength: relativeStrength(bars, benchmark),
    return20: closes.length === 21 ? (closes.at(-1) / closes[0] - 1) * 100 : null,
    support: null, resistance: null,
  };
}

function pivotRows(rows, direction) {
  const atPrice = direction === 'low' ? (row) => row.low ?? row.close : (row) => row.high ?? row.close;
  const extrema = direction === 'low' ? Math.min : Math.max;
  return rows.slice(2, -2).flatMap((row, index) => {
    const price = atPrice(row);
    const neighbors = rows.slice(index, index + 5).map(atPrice);
    return price === extrema(...neighbors) && neighbors.some((value) => value !== price)
      ? [{ row, price, index: index + 2 }] : [];
  });
}

function observedLevels(bars, rule, assumptions) {
  if (bars.length < rule.slow + 1) return null;
  const anchor = bars.at(-1).close;
  const window = bars.slice(-(rule.window + 1), -1);
  const support = pivotRows(window, 'low').filter(({ price }) => price < anchor)
    .sort((a, b) => b.price - a.price || b.index - a.index)[0];
  const resistance = pivotRows(window, 'high').filter(({ price }) => price > anchor)
    .sort((a, b) => a.price - b.price || b.index - a.index)[0];
  if (!support) return { support: null, resistance: resistance?.price ?? null, bracket: null };
  if (!resistance) return { support: support.price, resistance: null, bracket: null };

  const zone = [...new Set([
    support.row.open, support.row.close, ...window.slice(support.index - 1, support.index + 2).map(({ close }) => close),
  ].filter((value) => value !== null && value > support.price && value <= anchor))].sort((a, b) => a - b);
  if (!zone.length) return { support: support.price, resistance: resistance.price, bracket: null };
  const low = zone[0], high = zone[Math.min(zone.length - 1, 1)];
  const stop = support.price, target = resistance.price;
  const execution = tradeExecution({ ...assumptions, entry: high, stop, target });
  return {
    support: stop, resistance: target,
    bracket: { entryZone: { low, high }, entry: high, stop, target, ratio: execution.ratio ?? null, execution,
      levels: { supportDate: support.row.date, resistanceDate: resistance.row.date,
        basis: '已完成日线的局部低点、邻近日线的开收盘价及已观察的局部高点' } },
  };
}

function safeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function manualCitation(inputs, group, shortKey, day, maxAge) {
  const supplied = inputs.evidence?.[group] ?? inputs.evidence?.[shortKey];
  const url = safeURL(supplied?.url ?? inputs[`${shortKey}Source`] ?? inputs[`${group}Source`]);
  const asOf = dateOnly(supplied?.date ?? supplied?.asOf ?? inputs[`${shortKey}Date`] ?? inputs[`${group}Date`]);
  const age = asOf ? (Date.parse(day) - Date.parse(asOf)) / dayMs : Infinity;
  return { url, asOf, verified: Boolean(url && age >= 0 && age <= maxAge) };
}

function filingPublication(value, now, market, today) {
  const date = dateOnly(value);
  if (date) return date <= today ? { day: date, time: -Infinity } : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    || !dateOnly(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now ? { day: marketDay(time, market).day, time } : null;
}

function providerEvidence(evidence, now, market, today) {
  const store = {};
  let latestFiling = null;
  for (const [key] of evidenceFields) {
    store[key] = (Array.isArray(evidence?.[key]) ? evidence[key] : []).flatMap((item) => {
      if (!item || typeof item.label !== 'string') return [];
      const url = safeURL(item.url);
      const publishedAt = typeof item.publishedAt === 'string' ? item.publishedAt : null;
      const asOf = typeof item.asOf === 'string' ? item.asOf : null;
      const kind = key === 'events' && ['filing', 'news'].includes(item.kind) ? item.kind : null;
      // Older cached SEC rows identified registrant-wide disclosures in their generated label.
      const registrant = kind === 'filing' && (item.scope === 'registrant'
        || (item.source === 'SEC EDGAR' && item.label.startsWith('SEC 基金注册人申报 ')));
      const publication = kind === 'filing' ? filingPublication(publishedAt, now, market, today) : null;
      if (publishedAt && (kind === 'filing' ? !publication : Date.parse(publishedAt) > now + 60_000)) return [];
      const record = {
        label: item.label.slice(0, 120), value: typeof item.value === 'string' ? item.value.slice(0, 180) : numeric(item.value),
        unit: typeof item.unit === 'string' ? item.unit.slice(0, 30) : '',
        asOf, publishedAt, source: typeof item.source === 'string' ? item.source.slice(0, 100) : '',
        url, metric: typedMetrics.has(item.metric) ? item.metric : null,
        ...(kind ? { kind } : {}),
        ...(registrant ? { scope: 'registrant' } : {}),
        detail: typeof item.detail === 'string' ? item.detail.slice(0, 300) : '',
      };
      if (publication && !registrant && url && record.source.trim() && record.label.trim()
        && (!latestFiling || publication.day > latestFiling.day
          || (publication.day === latestFiling.day && publication.time > latestFiling.time))) {
        latestFiling = { record, ...publication };
      }
      return [record];
    }).slice(0, 12);
  }
  return {
    evidence: { ...store, symbol: evidence?.symbol ?? null, fetchedAt: evidence?.fetchedAt ?? null,
      errors: Array.isArray(evidence?.errors) ? evidence.errors.slice(0, 12) : [] },
    latestFiling,
  };
}

function sourcedMetric(records, metric, units, day, maxAge, allowUndatedRelease = false) {
  const today = Date.parse(day);
  return records.filter((item) => {
    const asOf = Date.parse(dateOnly(item.asOf?.slice(0, 10)) ?? '');
    const published = item.publishedAt
      ? Date.parse(dateOnly(item.publishedAt.slice(0, 10)) ?? '')
      : allowUndatedRelease ? asOf : NaN;
    return item.metric === metric && item.url && item.source && units.includes(item.unit) && Number.isFinite(item.value)
      && asOf <= today && today - asOf <= maxAge * dayMs && published >= asOf && published <= today;
  }).sort((left, right) => right.asOf.localeCompare(left.asOf) || (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''))[0] ?? null;
}

function quoteValuation(value, symbol, now) {
  const code = tencentSymbol(symbol);
  const observed = Date.parse(value?.asOf);
  if (!code || value?.symbol !== symbol || !Number.isFinite(observed) || observed > now + 60_000 ||
    now - observed > 7 * dayMs || !['equity', 'etf'].includes(value.kind)) return null;

  const source = { source: '腾讯财经公开报价', asOf: new Date(observed).toISOString(), url: 'https://qt.gtimg.cn/q=' + encodeURIComponent(code) };
  const ratios = [];
  const items = [
    ['滚动市盈率', 'peTtm', value.peTtm, value.earningsNonPositive, '过去十二个月每股收益为负，滚动市盈率不适用。'],
    ['市净率', 'priceToBook', value.pb, value.bookNonPositive, '每股账面净资产为负，市净率不适用。'],
  ];
  if (value.kind === 'equity') {
    for (const [label, metric, amount, nonPositive, detail] of items) {
      const ratio = positive(amount);
      if (ratio !== null) ratios.push({ ...source, label, metric, value: ratio, unit: '倍', detail: '报价快照中的供应商估值口径。' });
      else if (nonPositive === true) ratios.push({ ...source, label, metric, value: '不适用', unit: '', detail });
    }
  }
  return { kind: value.kind, ratios };
}

function evidenceChecks(inputs, instrumentType, bars, calendar, records, currency, marketRatios, latestFiling) {
  const growth = numeric(inputs.revenueGrowth), pe = numeric(inputs.pe), expense = numeric(inputs.expenseRatio);
  const nav = positive(inputs.nav), fair = positive(inputs.fairValue);
  const close = bars.at(-1)?.close;
  const notes = new Map();
  const record = (key, status, detail, source = null) => notes.set(key, { status, detail, source });
  const growthFact = sourcedMetric(records.fundamentals, 'revenueGrowthPct', ['%'], calendar.day, 180);
  const cashFlow = sourcedMetric(records.fundamentals, 'operatingCashFlow', [currency], calendar.day, 450);
  const expenseFact = sourcedMetric(records.fundamentals, 'expenseRatioPct', ['%'], calendar.day, 365);
  const tracking = sourcedMetric(records.fundamentals, 'trackingErrorPct', ['%'], calendar.day, 180);
  const navFact = sourcedMetric(records.valuation, 'navPerShare', [currency, `${currency}/股`], calendar.day, 7, true);
  if (instrumentType === 'etf') {
    const expenseValue = expense ?? expenseFact?.value;
    const maxExpense = positive(inputs.maxExpenseRatio) ?? .75;
    if (Number.isFinite(expenseValue) && expenseValue >= 0) {
      const trackingText = tracking && tracking.value >= 0 ? `；同期来源记录的跟踪误差为 ${tracking.value.toFixed(2)}%` : '';
      record('fundamentals', expenseValue <= maxExpense ? 'pass' : 'watch',
        `基金年费率 ${expenseValue.toFixed(2)}%${trackingText}。本规则观察上限为 ${maxExpense.toFixed(2)}%。`,
        expense === null ? expenseFact : null);
    }
    const navValue = nav ?? positive(navFact?.value);
    const navDate = nav === null ? navFact?.asOf.slice(0, 10)
      : dateOnly(inputs.valuationDate ?? inputs.evidence?.valuation?.date ?? inputs.evidence?.valuation?.asOf);
    if (navValue !== null && close > 0 && navDate === bars.at(-1)?.date) {
      const premium = (close / navValue - 1) * 100;
      record('valuation', premium > 2 ? 'fail' : premium < -2 ? 'watch' : 'pass',
        `按同日收盘和净值计算，溢价 ${premium.toFixed(2)}%。本规则观察 ±2% 以外的偏离。`, nav === null ? navFact : null);
    } else if (navValue !== null) record('valuation', 'watch',
      `单位净值 ${navValue.toFixed(4)} ${currency}。同日收盘价齐备后可核对折溢价。`, nav === null ? navFact : null);
  } else if (instrumentType === 'equity') {
    const growthValue = growth ?? growthFact?.value;
    if (Number.isFinite(growthValue)) {
      const flowText = cashFlow ? (cashFlow.value < 0 ? ' 所载期间的经营现金流为负，需核对增长质量。' : ' 所载期间的经营现金流非负。') : '';
      record('fundamentals', growthValue > 0 && !(cashFlow?.value < 0) ? 'pass' : 'fail',
        `营收同比 ${growthValue.toFixed(1)}%。本规则要求正增长。${flowText}`, growth === null ? growthFact : null);
    }
    const valuationFacts = marketRatios.length ? marketRatios : ['peTtm', 'priceToBook']
      .map((metric) => sourcedMetric(records.valuation, metric, ['倍', 'x'], calendar.day, 7))
      .filter((item) => item?.value > 0);
    const observed = valuationFacts.length
      ? valuationFacts.map(({ label, value, detail }) => typeof value === 'number' ? `${label} ${value.toFixed(2)} 倍` : detail.replace(/。$/, '')).join('，') + '。'
      : '';
    if (fair !== null && close > 0) {
      const upside = (fair / close - 1) * 100;
      record('valuation', upside >= 10 ? 'pass' : upside < 0 ? 'fail' : 'watch',
        `相对录入的合理价值有 ${upside.toFixed(1)}% 空间。本规则要求至少 10%。${observed}`);
    } else if (observed) record('valuation', 'watch', observed + '用于比较估值，入场判断仍需可核验的估值基准。', valuationFacts[0]);
    else if (pe !== null) record('valuation', 'watch', `录入市盈率 ${pe.toFixed(1)} 倍，仍需录入估值基准。`);
  } else if (growth !== null || pe !== null || expense !== null || fair !== null || nav !== null) {
    record('fundamentals', 'watch', '先确认标的是股票还是 ETF，再使用相应研究口径。');
  }
  const macro = { headwind: 'fail', neutral: 'pass', tailwind: 'pass' };
  if (Object.hasOwn(macro, inputs.macro)) record('macro', macro[inputs.macro],
    `你的宏观判断为${{ headwind: '逆风', neutral: '中性', tailwind: '顺风' }[inputs.macro]}。`);
  else {
    const rate = sourcedMetric(records.macro, 'rateChangeBps', ['基点', 'bps'], calendar.day, 90);
    if (rate) record('macro', 'watch', `来源记录的利率变化为 ${rate.value.toFixed(0)} 个基点。影响取决于标的利率敏感性。`, rate);
  }
  const eventReview = manualCitation(inputs, 'events', 'event', calendar.day, eventReviewDays);
  if (inputs.eventsStatus === 'pass' && eventReview.verified && latestFiling?.day > eventReview.asOf) {
    const { record: disclosure, day } = latestFiling;
    record('events', 'watch', `${day} 发布了「${disclosure.label}」，晚于 ${eventReview.asOf} 的核验。查阅原文后更新事件结论和核验截至日期。`,
      { ...disclosure, asOf: day });
  } else if (['pass', 'watch', 'fail'].includes(inputs.eventsStatus)) {
    record('events', inputs.eventsStatus, String(inputs.event ?? '').trim().slice(0, 180)
      || { pass: '已录入事件核验结果。', watch: '事件仍需观察。', fail: '已录入事件阻碍。' }[inputs.eventsStatus]);
  } else if (String(inputs.event ?? '').trim()) record('events', 'watch', String(inputs.event).trim().slice(0, 180));
  const sentiment = { 'risk-on': 'pass', neutral: 'watch', 'risk-off': 'fail' };
  if (Object.hasOwn(sentiment, inputs.sentiment)) record('sentiment', sentiment[inputs.sentiment],
    `你的情绪判断为${{ 'risk-on': '偏风险', neutral: '中性', 'risk-off': '偏避险' }[inputs.sentiment]}。`);
  else {
    const index = sourcedMetric(records.sentiment, 'sentimentIndex', ['0–100', '0-100'], calendar.day, 30);
    const breadth = sourcedMetric(records.sentiment, 'advanceSharePct', ['%'], calendar.day, 7);
    if (index && index.value >= 0 && index.value <= 100) record('sentiment', 'watch',
      `来源记录的情绪指数为 ${index.value.toFixed(1)}／100。保留为背景，方向需结合指数定义。`, index);
    else if (breadth && breadth.value >= 0 && breadth.value <= 100) record('sentiment', 'watch',
      `${breadth.label}为 ${breadth.value.toFixed(1)}%。可用于观察市场宽度。`, breadth);
  }

  return evidenceFields.map(([key, shortKey, label, days]) => {
    const note = notes.get(key);
    const citation = note?.source ? { url: note.source.url, asOf: note.source.asOf, sourceLabel: note.source.source, verified: true }
      : manualCitation(inputs, key, shortKey, calendar.day, days);
    const sources = key === 'valuation' ? [...new Map(records[key].filter((item) => item.url !== citation.url || item.asOf !== citation.asOf)
      .map((item) => [`${item.url}|${item.asOf}`, item])).values()]
      : key === 'events' && note?.source ? records[key].filter((item) => item.url !== note.source.url || item.publishedAt !== note.source.publishedAt)
      : records[key];
    const status = note?.status === 'pass' && !citation.verified ? 'watch' : (note?.status ?? 'pending');
    const detail = note ? note.detail + (note.status === 'pass' && !citation.verified ? ' 补充有效的来源链接及日期后方可通过。' : '')
      : sources.length ? '已取得出处。数据先列为研究背景，等你核验后再用于条件判断。' : '待补充研究依据。';
    return { key, label, detail, status, url: citation.url, asOf: citation.asOf, sourceLabel: citation.sourceLabel, verified: citation.verified, sources };
  });
}

export function researchQuoteStatus(quote, currency, now, demo = false) {
  const quoteTime = Date.parse(quote?.date ?? '');
  const quoteAgeSeconds = Number.isFinite(quoteTime) ? (now - quoteTime) / 1000 : null;
  const hasPrice = positive(quote?.price) !== null;
  const quoteStatus = demo || quote?.source === 'demo' ? 'demo' : !hasPrice ? 'missing'
    : !['live', 'public'].includes(quote?.source) || (quote.currency && quote.currency !== currency) || quoteAgeSeconds === null
      ? 'unverified' : quoteAgeSeconds < -60 || quoteAgeSeconds > 300 ? 'stale' : 'fresh';
  return { quoteStatus, quoteAgeSeconds };
}

function dataState(bars, quote, calendar, now, historySource, demo, currency) {
  const last = bars.at(-1);
  const historyAgeDays = last ? (Date.parse(calendar.day) - Date.parse(last.date)) / dayMs : null;
  const historyStatus = demo ? 'demo' : !last ? 'missing' : !historySource ? 'unverified'
    : historyAgeDays > 7 ? 'stale' : bars.length < 31 ? 'thin' : 'ready';
  return { historyStatus, ...researchQuoteStatus(quote, currency, now, demo), historySource, historyAgeDays, barCount: bars.length,
    lastDate: last?.date ?? null, lastBarDate: last?.date ?? null, quoteDate: quote?.date ?? null };
}

function statusFor(rule, observed, freshness, quote, checks, type, splitDate, volumeRatio, held, trend) {
  const bracket = observed?.bracket;
  const result = (status, action, reason, next, nextView = 'basis', position = {}) =>
    ({ status, action, reason, next, nextView, ...position });
  if (freshness.historyStatus !== 'ready' || freshness.barCount < rule.slow + 1 || freshness.quoteStatus === 'demo') {
    const reason = freshness.quoteStatus === 'demo' ? '当前报价来自演示数据。'
      : freshness.historyStatus === 'stale' ? `末根日线为 ${freshness.lastDate}，已超过 7 个自然日。`
      : freshness.historyStatus === 'unverified' ? '日线数据缺少来源。'
      : `${rule.label}判断需要 ${rule.slow + 1} 根完整日线，当前有 ${freshness.barCount} 根。`;
    return result('blocked', '补齐数据', reason, '更新有来源的日线及报价后重新判断。', 'evidence');
  }
  if (splitDate) {
    return result('blocked', '核对价格口径', `${splitDate} 出现异常隔夜价差。`,
      '核对拆股、复权口径或缺失日线后重新计算。', 'evidence');
  }
  const invalidation = held ? observed?.support : bracket?.stop;
  if (Number.isFinite(invalidation) && freshness.quoteStatus === 'fresh' && Number(quote.price) <= invalidation) {
    if (held) return result('invalidated', '复核减仓或退出', '最新报价已触及或跌破已观察支撑。',
      '核对持仓依据、预设失效价和可成交价格。', 'basis', { positionAction: 'review-exit', positionLevel: invalidation });
    return result('invalidated', '取消观察计划', '最新报价已触及或跌破已观察支撑。',
      '等待新的日线结构形成，再确认观察区间与失效价。', 'tracking');
  }
  const check = (key) => checks.find((item) => item.key === key);
  if (check('events').status === 'fail') {
    return result('wait', '等待事件明朗', '研究记录显示重大事件仍构成阻碍。', '核对事件结果并更新事件判断。');
  }
  if (bracket && !bracket.execution.valid) {
    return result('watch', '核对成交假设', bracket.execution.error, '修改成交成本或止损下方偏离后重新计算。');
  }
  if (!bracket || bracket.ratio < 1.5) {
    const reason = bracket ? `情景盈亏比为 ${bracket.ratio.toFixed(2)} 倍，低于规则的 1.50 倍。`
      : '当前观察窗缺少一组可复核的入场区间、支撑或目标价。';
    return result('wait', '继续观察价格', reason, '等待新价位形成后复算盈亏比。', 'tracking');
  }
  if (trend.direction !== 'up') {
    return result('watch', '跟踪趋势修复', trend.detail, `等待完整日线满足${trend.requirement}。`);
  }
  if (rule.key === 'short' && volumeRatio !== null && volumeRatio < .65) {
    return result('watch', '等待成交量恢复', `最近完整日线成交量为此前 20 日均量的 ${(volumeRatio * 100).toFixed(0)}%。`,
      '观察完整日线成交量能否恢复到此前 20 日均量的 65%。');
  }
  if (freshness.quoteStatus !== 'fresh') {
    return result('watch', '等待可核对报价', '观察区间来自历史日线，当前报价不足以确认是否入场。',
      '等可核验报价更新后，核对价格是否进入观察区间。', 'evidence');
  }
  const required = rule.key === 'short' ? ['events'] : rule.key === 'mid'
    ? ['events', 'macro', 'valuation'] : ['events', 'macro', 'valuation', 'fundamentals'];
  const missing = required.map(check).filter(({ status }) => status !== 'pass').map(({ label }) => label);
  if (rule.key === 'long' && !type) missing.push('资产类型');
  if (check('sentiment').status === 'fail') missing.push('市场情绪');
  const evidenceNext = missing.length ? `复核${missing.join('、')}。` : '';
  const price = Number(quote.price);
  if (price < bracket.entryZone.low || price > bracket.entryZone.high) {
    const above = price > bracket.entryZone.high;
    const direction = above ? '高于' : '低于';
    const waiting = above ? '等待报价回到区间，再复核剩余盈亏比。' : '等待报价回到区间，同时跟踪与失效价的距离。';
    if (held && !missing.length) return result('watch', '继续跟踪持仓，暂缓加仓',
      `最新报价仍在支撑之上，${direction}加仓观察区间。`, waiting, 'tracking',
      { positionAction: 'hold', positionLevel: invalidation });
    return result('watch', '等待报价进入观察区', `当前报价${direction}观察区间。`,
      waiting + evidenceNext, missing.length ? 'basis' : 'tracking');
  }
  if (missing.length) {
    return result('watch', '复核研究依据', `报价已进入观察区间，${missing.join('、')}仍待确认。`, evidenceNext);
  }
  if (held) return result('opportunity', '复核加仓额度', '报价在观察区间内，当前周期的趋势和研究条件已满足。',
    '按现有仓位、现金储备和风险预算核对加仓额度。', 'basis',
    { positionAction: 'hold', positionLevel: invalidation });
  return result('opportunity', '核对计划仓位', '报价在观察区间内，当前周期的趋势和研究条件已满足。',
    '核对预算内数量、失效价与实际可成交价格。');
}

function scenarioList(horizon) {
  const { entryZone, stop, target } = horizon;
  return [
    { key: 'base', label: '回踩观察区', status: horizon.status, entryZone, condition: horizon.trigger, action: horizon.action },
    { key: 'upside', label: '向上测试前高', status: target === null ? 'pending' : 'watch', target,
      condition: target === null ? '当前窗内没有可观察的向上参考。' : '若报价接近已观察的局部高点，复核剩余盈亏比。',
      action: '等待突破后的新价位确认。' },
    { key: 'downside', label: '跌破支撑', status: horizon.status === 'invalidated' ? 'invalidated' : 'watch', stop,
      condition: horizon.invalidation, action: horizon.positionAction === 'review-exit' ? horizon.action : '取消该观察计划，重新核验趋势与事件。' },
  ];
}

function estimateSize(portfolio, bracket, symbol, metadata) {
  if (bracket.execution?.valid === false) return bracket.execution;
  const weight = numeric(portfolio.weight ?? portfolio.currentWeight);
  const equity = positive(portfolio.equity);
  const positionValue = portfolio.positionValue ?? (weight === null || equity === null ? null : equity * weight / 100);
  return { ...tradePlan({ ...portfolio, ...bracket, symbol, positionValue, riskPercent: portfolio.riskPercent ?? 1,
    lotSize: numeric(metadata.lotSize), costBps: bracket.execution?.costBps, gapPercent: bracket.execution?.gapPercent }), demo: portfolio.demo };
}

function manualScenarioFor(inputs) {
  const keys = ['entry', 'stop', 'target'];
  if (!keys.some((key) => typeof inputs[key] === 'number' || String(inputs[key] ?? '').trim())) return null;
  const [entry, stop, target] = keys.map((key) => positive(inputs[key]));
  if (entry === null || stop === null || target === null || stop >= entry || entry >= target) {
    return { valid: false, reason: '完善手动价格情景，确保止损价低于入场价，入场价低于目标价。' };
  }
  const execution = tradeExecution({ entry, stop, target, costBps: inputs.costBps, gapPercent: inputs.gapPercent });
  if (!execution.valid) return { valid: false, reason: execution.error };
  return { valid: true, entryZone: { low: entry, high: entry }, entry, stop, target, ratio: execution.ratio, execution,
    levels: { supportDate: null, resistanceDate: null, basis: '手动输入的假设价位。' } };
}

export function dailySampleIssue(dates) {
  if (dates.length < 2) return null;
  const times = dates.map((date) => Date.parse(date));
  if (times.some((time, index) => index > 0 && time - times[index - 1] > 14 * dayMs)) return 'gap';
  // Approximate weekday coverage without assuming an exchange-specific holiday calendar.
  const calendarDays = (times.at(-1) - times[0]) / dayMs + 1;
  return dates.length < calendarDays * 5 / 7 * .75 ? 'sparse' : null;
}

export function hasPriceHistoryJump(previousClose, nextPrice) {
  const ratio = nextPrice / previousClose;
  return ratio < .55 || ratio > 1.65;
}

function rollingAverage(bars, end, count) {
  return mean(bars.slice(end + 1 - count, end + 1).map(({ close }) => close));
}

function passiveSegment(bars, first, end, friction) {
  const entryCost = bars[first].open * (1 + friction);
  const terminalValue = bars[end - 1].open * (1 - friction) / entryCost;
  let peak = 1, maxDrawdown = 0;
  for (let session = first; session < end - 1; session += 1) {
    const value = bars[session].close / entryCost;
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, 1 - value / peak);
  }
  return { totalReturn: (terminalValue - 1) * 100, maxDrawdown: Math.max(maxDrawdown, 1 - terminalValue / peak) * 100 };
}

function simulateSegment(bars, first, end, rule, friction) {
  const breakout = rule.breakout ?? 20;
  let equity = 1, peak = 1, maxDrawdown = 0;
  const completed = [];
  for (let i = Math.max(first - 1, rule.slow - 1, breakout); i + 1 + rule.holding < end; i += 1) {
    const signal = bars[i];
    const formerHigh = Math.max(...bars.slice(i - breakout, i).map(({ high }) => high));
    const fast = rollingAverage(bars, i, rule.fast), slow = rollingAverage(bars, i, rule.slow);
    if (!(signal.close > formerHigh && fast > slow && signal.close >= fast)) continue;
    const enter = bars[i + 1], exit = bars[i + 1 + rule.holding];
    if (enter.open < formerHigh) continue;
    const fill = enter.open * (1 + friction);
    for (let session = i + 1; session < i + 1 + rule.holding; session += 1) {
      const marked = equity * bars[session].close / fill;
      peak = Math.max(peak, marked);
      maxDrawdown = Math.max(maxDrawdown, 1 - marked / peak);
    }
    const change = exit.open * (1 - friction) / fill - 1;
    equity *= 1 + change;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
    completed.push({ signalDate: signal.date, entryDate: enter.date, exitDate: exit.date, returnPercent: change * 100 });
    i += rule.holding;
  }
  const baseline = passiveSegment(bars, first, end, friction);
  const totalReturn = completed.length ? (equity - 1) * 100 : null;
  return { trades: completed.length, winRate: completed.length ? completed.filter(({ returnPercent }) => returnPercent > 0).length / completed.length * 100 : null,
    totalReturn, maxDrawdown: completed.length ? maxDrawdown * 100 : null, baseline,
    exposure: completed.length * rule.holding / (end - first - 1) * 100,
    excessReturn: totalReturn === null ? null : totalReturn - baseline.totalReturn,
    averageTrade: mean(completed.map(({ returnPercent }) => returnPercent)), recent: completed.slice(-5) };
}

export function walkForwardTradeRule(bars, rule = horizonRules[1], { demo = false, costBps = 10, trainingOnly = false } = {}) {
  if (typeof rule === 'string') rule = horizonRules.find(({ key }) => key === rule) ?? horizonRules[1];
  const breakout = rule.breakout ?? 20;
  const modeledCost = Math.max(0, Math.min(1000, numeric(costBps) ?? 10));
  const assumptions = [
    '按日期先后切分约 70% 训练区和 30% 留出区。两个区间使用事先确定的相同参数，各自统计。',
    `每根完整日线收盘后检查前 ${breakout} 日最高价及 MA${rule.fast}/MA${rule.slow}。下一条日线开盘仍在突破价之上或持平时模拟入场，持有 ${rule.holding} 个开盘至开盘时段，仅统计在区间内完成的交易。`,
    '单一多头仓位，空仓期按零现金收益处理。持仓占比按区间内开盘至下一开盘的时段计算。',
    '买入持有对照在每段首日开盘买入、末日开盘卖出，采用同一价格序列及相同的单边成本。',
    `每边成本 ${modeledCost} 个基点，按开盘成交和持有期收盘估算回撤。收益仅反映输入价格序列。模型未模拟分红、税费差异、涨跌停、成交量限制及盘中回撤。`,
  ];
  const boundary = Math.floor(bars.length * .7);
  const sample = { total: bars.length, training: boundary, holdout: bars.length - boundary,
    trainingStart: boundary ? bars[0].date : null, trainingEnd: bars[boundary - 1]?.date ?? null,
    holdoutStart: bars[boundary]?.date ?? null, holdoutEnd: bars.at(-1)?.date ?? null };
  const checkedBars = trainingOnly ? bars.slice(0, boundary) : bars;
  const unavailable = (reason) => ({ status: 'unavailable', reason, sample, assumptions, train: null, holdout: null, costBps: modeledCost });
  if (demo) return unavailable('演示序列不参与历史检验。');
  if (!checkedBars.every(({ open, high, low, close }) => [open, high, low, close].every((price) => Number.isFinite(price) && price > 0))) {
    return unavailable('历史检验需要完整、连续记录的真实日线 OHLC。');
  }
  const trainingIssue = dailySampleIssue(bars.slice(0, boundary).map(({ date }) => date));
  const holdoutIssue = trainingOnly ? null : dailySampleIssue(bars.slice(Math.max(0, boundary - 1)).map(({ date }) => date));
  if (trainingIssue === 'gap' || holdoutIssue === 'gap') {
    return unavailable('历史序列的交易日间隔过长，当前无法确认下一交易日是否完整记录。');
  }
  if (trainingIssue === 'sparse' || holdoutIssue === 'sparse') {
    return unavailable('前段或留出区的记录频率过低，规则检验需要较连续的日线。请核对是否导入了周线或缺少交易日。');
  }
  if (boundary < Math.max(rule.slow, breakout) + rule.holding + 10 || (!trainingOnly && sample.holdout < rule.holding + 10)) {
    return unavailable('留出区或校准区的完整交易日不足。');
  }
  const jumps = discontinuities(checkedBars);
  if (jumps.length) return unavailable('检测到可能的拆股或异常隔夜价差，需可比价格口径后再做检验。');
  const friction = modeledCost / 10_000;
  return { status: 'ready', reason: '', sample, assumptions, costBps: modeledCost,
    train: simulateSegment(bars, 0, boundary, rule, friction),
    holdout: trainingOnly ? null : simulateSegment(bars, boundary, bars.length, rule, friction) };
}

export function runInvestmentResearch({
  symbol, bars = [], quote = {}, inputs = {}, portfolio = {}, metadata = {}, benchmarkBars = [],
  historySource = '', now = Date.now(), demo = false, evidence: suppliedEvidence, publicValuation = quote?.valuation, includeBacktest = true,
} = {}) {
  const normalized = normalizeTicker(symbol);
  const market = metadata.market === 'CN' || metadata.market === 'US' ? metadata.market : instrumentMarket(normalized);
  const currency = metadata.currency === 'USD' || metadata.currency === 'CNY' ? metadata.currency : instrumentCurrency(normalized);
  const parsedNow = typeof now === 'string' ? Date.parse(now) : new Date(now).getTime();
  const time = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const quoteFacts = !demo ? quoteValuation(publicValuation, normalized, time) : null;
  const inferredType = metadata.type ?? inputs.instrumentType ?? quoteFacts?.kind;
  const instrumentType = ['equity', 'etf'].includes(inferredType) ? inferredType : null;
  const calendar = marketDay(time, market);
  const daily = completedBars(bars, calendar);
  const benchmark = completedBars(benchmarkBars, calendar);
  const acceptedEvidence = suppliedEvidence?.symbol && normalizeTicker(suppliedEvidence.symbol) !== normalized ? null : suppliedEvidence;
  const { evidence, latestFiling } = providerEvidence(acceptedEvidence, time, market, calendar.day);
  const marketRatios = instrumentType === 'equity' ? quoteFacts?.ratios ?? [] : [];
  evidence.valuation.unshift(...marketRatios);
  const checks = evidenceChecks(inputs, instrumentType, daily, calendar, evidence, currency, marketRatios, latestFiling);
  const technical = technicalState(daily, benchmark);
  const data = dataState(daily, quote, calendar, time, historySource, demo, currency);
  const splitDates = discontinuities(daily);
  const assumptions = { costBps: inputs.costBps, gapPercent: inputs.gapPercent };
  const held = !demo && !portfolio.demo && (positive(portfolio.positionValue) !== null
    || positive(portfolio.weight ?? portfolio.currentWeight) !== null);
  const horizons = horizonRules.map((rule) => {
    const trend = trendFor(daily, rule);
    const enoughData = data.historyStatus === 'ready' && data.quoteStatus !== 'demo' && daily.length >= rule.slow + 1;
    const splitDate = enoughData && splitDates.at(-1) >= daily.at(-(rule.slow + 1)).date ? splitDates.at(-1) : null;
    const observed = enoughData && !splitDate ? observedLevels(daily, rule, assumptions) : null;
    const bracket = observed?.bracket;
    const decision = statusFor(rule, observed, data, quote, checks, instrumentType, splitDate, technical.volumeRatio, held, trend);
    const stop = bracket?.stop ?? (held ? observed?.support : null) ?? null;
    return { key: rule.key, label: rule.label, sessions: rule.sessions, ...decision, trend,
      entryZone: bracket?.entryZone ?? null, entry: bracket?.entry ?? null, target: bracket?.target ?? null,
      stop, ratio: bracket?.ratio ?? null, levels: bracket?.levels ?? null, execution: bracket?.execution ?? null,
      support: observed?.support ?? null, resistance: observed?.resistance ?? null,
      trigger: decision.next,
      invalidation: stop === null ? '尚无可核对的失效价。'
        : held ? '报价触及或跌破此前局部低点时，复核持仓依据。' : '报价触及或跌破此前局部低点，原观察计划失效。' };
  });
  const selected = horizons.find(({ key }) => key === inputs.horizon) ?? horizons[1];
  technical.support = selected.support;
  technical.resistance = selected.resistance;
  const selectedRule = horizonRules.find(({ key }) => key === selected.key);
  const dataNote = data.historyStatus === 'ready' ? `已完成日线 ${data.barCount} 根，末日 ${data.lastDate}。`
    : { missing: '等待可用日线。', demo: '当前为演示数据。', unverified: '待确认历史行情来源。', stale: '日线超过 7 个自然日未更新。', thin: '至少需要 31 根完整日线。' }[data.historyStatus];
  const enoughBars = data.barCount >= selectedRule.slow + 1;
  const shortVolume = selectedRule.key === 'short' && technical.volumeRatio !== null;
  const conditions = [
    { key: 'history', label: '数据依据', detail: dataNote + (data.historyStatus === 'ready' && !enoughBars
      ? `${selected.label}价位判断需要 ${selectedRule.slow + 1} 根完整日线。` : ''),
      status: selected.status === 'blocked' ? 'pending' : 'pass' },
    { key: 'trend', label: `${selected.label}趋势`, detail: selected.trend.detail,
      status: { up: 'pass', down: 'fail', mixed: 'watch', unknown: 'pending' }[selected.trend.direction] },
    { key: 'volume', label: '相对成交量', detail: technical.volumeRatio === null ? '核对最近日线与此前 20 日成交量后可计算。'
      : `最近成交量为此前 20 日平均的 ${technical.volumeRatio.toFixed(2)} 倍。${shortVolume ? '短线规则至少需要 0.65 倍。' : ''}`,
      status: technical.volumeRatio === null ? 'pending' : shortVolume ? technical.volumeRatio >= .65 ? 'pass' : 'fail' : 'watch' },
    ...checks,
  ];
  const manualScenario = manualScenarioFor(inputs);
  const display = manualScenario?.valid ? manualScenario : selected;
  const canTransfer = Boolean(normalized && (manualScenario?.valid || selected.status === 'opportunity'));
  const sized = display.entry !== null && !demo && (manualScenario?.valid || selected.status !== 'invalidated')
    ? estimateSize(portfolio, display, normalized, metadata) : null;
  const plan = display.entry !== null ? { entryZone: display.entryZone, entry: display.entry, stop: display.stop,
    target: display.target, ratio: display.ratio, size: sized, levels: display.levels, execution: display.execution,
    source: manualScenario?.valid ? 'manual' : 'observed' } : null;
  const uncertainty = [
    '价格情景为已观察价位的条件演算。跳空可能穿越失效价，成交价和实际损失可能不同。',
    ...(data.quoteStatus !== 'fresh' ? ['当前报价不可用于确认入场。'] : []),
    ...(technical.relativeStrength === null ? ['缺少近 21 个共同交易日的基准，暂不判断相对强弱。'] : []),
    ...(splitDates.length ? ['历史序列出现异常隔夜价差，跨口径的历史回放暂不可用。'] : []),
    ...(sized?.error ? [sized.error] : []),
    ...(manualScenario?.valid ? ['当前仓位计算使用手动假设。市场机会状态仍按实际行情和研究依据独立判断。'] : []),
  ];
  return { symbol: normalized, market, currency, instrumentType, data, technical, evidence, conditions, horizons, horizon: selected.key,
    decision: { status: selected.status, action: selected.action, reason: selected.reason, next: selected.next, nextView: selected.nextView,
      positionAction: selected.positionAction ?? null, positionLevel: selected.positionLevel ?? null },
    summary: manualScenario?.valid === false ? manualScenario.reason : selected.reason,
    entry: display.entry, target: display.target, stop: display.stop, ratio: display.ratio,
    canTransfer, levelSource: canTransfer ? plan?.source : null, plan, manualScenario,
    scenarios: scenarioList(selected), uncertainty,
    ...(includeBacktest ? { backtest: walkForwardTradeRule(daily, selectedRule,
      { demo: demo || !historySource, costBps: inputs.costBps ?? 10 }) } : {}) };
}
