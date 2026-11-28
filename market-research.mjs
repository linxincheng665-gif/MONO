import { instrumentMarket, normalizeTicker } from './instruments.mjs';

const universe = [
  ['600519.SH', '贵州茅台'], ['600036.SH', '招商银行'], ['601318.SH', '中国平安'], ['300750.SZ', '宁德时代'],
  ['600900.SH', '长江电力'], ['000333.SZ', '美的集团'], ['002594.SZ', '比亚迪'],
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['JPM', 'JPMorgan Chase'],
  ['COST', 'Costco'], ['GOOGL', 'Alphabet'], ['AMZN', 'Amazon'],
  ['510300.SH', '沪深 300 ETF', 'etf'], ['510500.SH', '中证 500 ETF', 'etf'], ['159915.SZ', '创业板 ETF', 'etf'],
  ['SPY', '标普 500 ETF', 'etf'], ['QQQ', '纳斯达克 100 ETF', 'etf'], ['IWM', '美国小盘 ETF', 'etf'],
  ['000001.SZ', '平安银行'], ['000002.SZ', '万科 A'], ['000063.SZ', '中兴通讯'], ['000100.SZ', 'TCL 科技'],
  ['000157.SZ', '中联重科'], ['000338.SZ', '潍柴动力'], ['000568.SZ', '泸州老窖'], ['000625.SZ', '长安汽车'],
  ['000651.SZ', '格力电器'], ['000725.SZ', '京东方 A'], ['000858.SZ', '五粮液'], ['000895.SZ', '双汇发展'],
  ['000938.SZ', '紫光股份'], ['001979.SZ', '招商蛇口'], ['002027.SZ', '分众传媒'], ['002050.SZ', '三花智控'],
  ['002142.SZ', '宁波银行'], ['002230.SZ', '科大讯飞'], ['002241.SZ', '歌尔股份'], ['002304.SZ', '洋河股份'],
  ['002415.SZ', '海康威视'], ['002463.SZ', '沪电股份'], ['002475.SZ', '立讯精密'], ['002714.SZ', '牧原股份'],
  ['002920.SZ', '德赛西威'], ['300014.SZ', '亿纬锂能'], ['300015.SZ', '爱尔眼科'], ['300059.SZ', '东方财富'],
  ['300122.SZ', '智飞生物'], ['300274.SZ', '阳光电源'], ['300308.SZ', '中际旭创'], ['300394.SZ', '天孚通信'],
  ['300433.SZ', '蓝思科技'], ['300498.SZ', '温氏股份'], ['300502.SZ', '新易盛'], ['300760.SZ', '迈瑞医疗'],
  ['600028.SH', '中国石化'], ['600030.SH', '中信证券'], ['600050.SH', '中国联通'], ['600089.SH', '特变电工'],
  ['600276.SH', '恒瑞医药'], ['600309.SH', '万华化学'], ['600406.SH', '国电南瑞'], ['600438.SH', '通威股份'],
  ['600585.SH', '海螺水泥'], ['600690.SH', '海尔智家'], ['600809.SH', '山西汾酒'], ['600887.SH', '伊利股份'],
  ['601012.SH', '隆基绿能'], ['601088.SH', '中国神华'], ['601166.SH', '兴业银行'], ['601225.SH', '陕西煤业'],
  ['601288.SH', '农业银行'], ['601398.SH', '工商银行'], ['601601.SH', '中国太保'], ['601628.SH', '中国人寿'],
  ['601668.SH', '中国建筑'], ['601688.SH', '华泰证券'], ['601728.SH', '中国电信'], ['601857.SH', '中国石油'],
  ['601888.SH', '中国中免'], ['601899.SH', '紫金矿业'], ['601919.SH', '中远海控'], ['601988.SH', '中国银行'],
  ['603259.SH', '药明康德'], ['603369.SH', '今世缘'], ['603501.SH', '韦尔股份'], ['603986.SH', '兆易创新'],
  ['688008.SH', '澜起科技'], ['688012.SH', '中微公司'], ['688041.SH', '海光信息'], ['688111.SH', '金山办公'],
  ['688256.SH', '寒武纪'], ['688981.SH', '中芯国际'],
  ['META', 'Meta'], ['TSLA', 'Tesla'], ['AVGO', 'Broadcom'], ['AMD', 'AMD'], ['MU', 'Micron'],
  ['INTC', 'Intel'], ['QCOM', 'Qualcomm'], ['TXN', 'Texas Instruments'], ['ARM', 'Arm'], ['ASML', 'ASML'], ['TSM', 'TSMC'],
  ['AMAT', 'Applied Materials'], ['LRCX', 'Lam Research'], ['KLAC', 'KLA'], ['ADI', 'Analog Devices'],
  ['CRM', 'Salesforce'], ['ORCL', 'Oracle'], ['ADBE', 'Adobe'], ['NOW', 'ServiceNow'], ['PLTR', 'Palantir'],
  ['IBM', 'IBM'], ['CSCO', 'Cisco'], ['PANW', 'Palo Alto Networks'], ['CRWD', 'CrowdStrike'], ['SNOW', 'Snowflake'],
  ['DDOG', 'Datadog'], ['ANET', 'Arista Networks'], ['DELL', 'Dell'], ['NFLX', 'Netflix'], ['DIS', 'Disney'],
  ['BKNG', 'Booking Holdings'], ['UBER', 'Uber'], ['ABNB', 'Airbnb'], ['DASH', 'DoorDash'], ['SPOT', 'Spotify'],
  ['WMT', 'Walmart'], ['TGT', 'Target'], ['HD', 'Home Depot'], ['LOW', 'Lowe’s'], ['NKE', 'Nike'],
  ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'], ['PEP', 'PepsiCo'], ['MCD', 'McDonald’s'], ['SBUX', 'Starbucks'],
  ['V', 'Visa'], ['MA', 'Mastercard'], ['AXP', 'American Express'], ['BAC', 'Bank of America'], ['WFC', 'Wells Fargo'],
  ['C', 'Citigroup'], ['GS', 'Goldman Sachs'], ['MS', 'Morgan Stanley'], ['SCHW', 'Charles Schwab'], ['BLK', 'BlackRock'],
  ['BRK.B', 'Berkshire Hathaway'], ['LLY', 'Eli Lilly'], ['JNJ', 'Johnson & Johnson'], ['UNH', 'UnitedHealth'],
  ['MRK', 'Merck'], ['PFE', 'Pfizer'], ['ABBV', 'AbbVie'], ['AMGN', 'Amgen'], ['GILD', 'Gilead'], ['ISRG', 'Intuitive Surgical'],
  ['TMO', 'Thermo Fisher'], ['XOM', 'ExxonMobil'], ['CVX', 'Chevron'], ['COP', 'ConocoPhillips'], ['SLB', 'SLB'],
  ['CAT', 'Caterpillar'], ['DE', 'Deere'], ['GE', 'GE Aerospace'], ['BA', 'Boeing'], ['RTX', 'RTX'], ['LMT', 'Lockheed Martin'],
  ['UNP', 'Union Pacific'], ['UPS', 'UPS'], ['NEE', 'NextEra Energy'], ['DUK', 'Duke Energy'],
  ['510050.SH', '上证 50 ETF', 'etf'], ['510880.SH', '红利 ETF', 'etf'], ['512000.SH', '券商 ETF', 'etf'],
  ['512480.SH', '半导体 ETF', 'etf'], ['512690.SH', '酒 ETF', 'etf'], ['512800.SH', '银行 ETF', 'etf'],
  ['512880.SH', '证券 ETF', 'etf'], ['515030.SH', '新能源车 ETF', 'etf'], ['515790.SH', '光伏 ETF', 'etf'],
  ['518880.SH', '黄金 ETF', 'etf'], ['588000.SH', '科创 50 ETF', 'etf'], ['159919.SZ', '沪深 300 ETF', 'etf'],
  ['159928.SZ', '消费 ETF', 'etf'], ['159949.SZ', '创业板 50 ETF', 'etf'], ['159995.SZ', '芯片 ETF', 'etf'],
  ['IVV', 'iShares S&P 500 ETF', 'etf'], ['VOO', 'Vanguard S&P 500 ETF', 'etf'], ['VTI', 'Vanguard Total Stock Market ETF', 'etf'],
  ['VT', 'Vanguard Total World Stock ETF', 'etf'], ['DIA', 'SPDR Dow Jones ETF', 'etf'], ['QQQM', 'Invesco Nasdaq 100 ETF', 'etf'],
  ['SCHD', 'Schwab U.S. Dividend Equity ETF', 'etf'], ['XLK', '科技行业 ETF', 'etf'], ['XLF', '金融行业 ETF', 'etf'],
  ['XLE', '能源行业 ETF', 'etf'], ['XLV', '医疗行业 ETF', 'etf'], ['SMH', 'VanEck Semiconductor ETF', 'etf'],
  ['SOXX', 'iShares Semiconductor ETF', 'etf'], ['GLD', 'SPDR Gold Shares', 'etf'], ['SLV', 'iShares Silver Trust', 'etf'],
  ['BND', 'Vanguard Total Bond Market ETF', 'etf'], ['TLT', '美国长期国债 ETF', 'etf'], ['IEF', '美国中期国债 ETF', 'etf'],
].map(([ticker, name, type = 'equity']) => ({ ticker, name, type, market: instrumentMarket(ticker) }));

const catalog = new Map(universe.map((item) => [item.ticker, item]));
const markets = ['all', 'cn', 'us', 'etf'];
const scopes = ['catalog', 'watch', 'custom'];
export const maxCustomTickers = 300;
export const defaultOpportunityPlan = Object.freeze({
  market: 'all', scope: 'catalog', horizon: 'mid', trend: 'any', minRatio: 1.5, minReturn: null, maxVolatility: null, minVolume: null, symbols: [],
});

function inMarket(item, group) {
  return group === 'all' || (group === 'etf' ? item.type === 'etf' : item.market.toLowerCase() === group);
}

export function normalizeOpportunityPlan(input = {}, strict = false) {
  const values = input ?? {};
  const inputSymbols = Array.isArray(values.symbols) ? values.symbols : String(values.symbols ?? '').split(/[\s,，、;；]+/);
  const codes = inputSymbols.filter(Boolean).map(normalizeTicker);
  const symbols = [...new Set(codes.filter(Boolean))];
  const scope = scopes.includes(values.scope) ? values.scope : defaultOpportunityPlan.scope;
  if (strict && (codes.includes('') || symbols.length > maxCustomTickers || (scope === 'custom' && !symbols.length))) {
    throw new Error('自定义名单须填写有效股票代码，最多 ' + maxCustomTickers + ' 个。');
  }
  const bound = (key, low, high) => {
    if (!Object.hasOwn(values, key)) return defaultOpportunityPlan[key];
    if (values[key] === null || values[key] === '') return null;
    const value = Number(values[key]);
    if (Number.isFinite(value) && value >= low && value <= high) return value;
    if (strict) throw new Error('有筛选数值超出范围。');
    return defaultOpportunityPlan[key];
  };
  return {
    scope, market: markets.includes(values.market) ? values.market : 'all',
    horizon: ['short', 'mid', 'long'].includes(values.horizon) ? values.horizon : 'mid',
    trend: ['up', 'down', 'mixed'].includes(values.trend) ? values.trend : 'any',
    minRatio: bound('minRatio', 0, 100), minReturn: bound('minReturn', -100, 1000),
    maxVolatility: bound('maxVolatility', 0, 1000), minVolume: bound('minVolume', 0, 100),
    symbols: symbols.slice(0, maxCustomTickers),
  };
}

export function discoverUniverse(filter, { scope = 'catalog', personal = [], symbols = [] } = {}) {
  const group = String(filter ?? 'all').toLowerCase();
  const entries = scope === 'watch' ? personal : scope === 'custom' ? symbols.map((symbol) => ({ symbol })) : universe;
  const candidates = entries.flatMap((entry) => {
    const ticker = normalizeTicker(entry.symbol ?? entry.ticker);
    if (!ticker) return [];
    const listed = catalog.get(ticker);
    const market = instrumentMarket(ticker);
    const localEtf = /^(?:51|56|58)\d{4}\.SH$|^159\d{3}\.SZ$/.test(ticker);
    const followsEtf = entry.type === 'etf' || /\bETF\b/i.test(entry.name ?? '') || localEtf;
    return [listed ?? { ticker, name: entry.name || ticker, type: followsEtf ? 'etf' : market === 'CN' ? 'equity' : null, market }];
  });
  return [...new Map(candidates.map((item) => [item.ticker, item])).values()].filter((item) => inMarket(item, group));
}

export function candidateFor(ticker) {
  return catalog.get(ticker);
}

export function applyOpportunityPlan(item, plan) {
  if (item.status === 'blocked' || !item.historyReady) return { ...item, match: null, screenReason: '行情不足' };
  if (item.status === 'invalidated') return { ...item, match: false, screenReason: '原条件失效' };
  const conditions = [
    ['趋势', plan.trend === 'any' ? null : plan.trend, item.trend, 'eq'],
    ['情景盈亏比', plan.minRatio, item.ratio, 'min'],
    ['近 20 日涨跌', plan.minReturn, item.return20, 'min'],
    ['年化波动', plan.maxVolatility, item.volatility, 'max'],
    ['相对成交量', plan.minVolume, item.volumeRatio, 'min'],
  ];
  const failed = [], missing = [];
  for (const [label, target, measured, rule] of conditions) {
    if (target === null) continue;
    if (measured == null || (rule !== 'eq' && !Number.isFinite(measured)) || (rule === 'eq' && measured === 'unknown')) missing.push(label);
    else if (rule === 'eq' ? target !== measured : rule === 'min' ? measured < target : measured > target) failed.push(label);
  }
  const screenReason = failed.length ? '未达条件 · ' + failed.join('、') : missing.length ? '待核验 · ' + missing.join('、') : '符合当前计划';
  return { ...item, match: failed.length ? false : missing.length ? null : true, screenReason };
}

export function opportunityFor(instrument, strategy) {
  const { decision, data, technical, conditions, plan, horizon } = strategy;
  const period = strategy.horizons?.find((item) => item.key === horizon);
  const trend = period?.trend?.direction ?? technical.trend;
  const base = { ...instrument, type: strategy.instrumentType ?? instrument.type, action: decision.action, reason: decision.reason, status: decision.status,
    quoteDate: data.quoteDate, source: data.historySource, historyDate: data.lastDate };
  if (data.historyStatus !== 'ready') return { ...base, category: '补齐行情' };
  const valuation = conditions.find((condition) => condition.key === 'valuation');
  const growth = conditions.find((condition) => condition.key === 'fundamentals');
  const qualified = decision.status === 'opportunity';
  const zone = plan?.source === 'observed' ? plan.entryZone : null;
  const categories = [
    ...(qualified ? ['条件已满足'] : []),
    ...(zone && trend === 'up' && technical.return20 > 0 ? ['上升趋势回调'] : []),
    ...(zone && horizon === 'short' && trend !== 'up' && technical.close > technical.ma20 ? ['短线修复'] : []),
    ...(growth?.status === 'pass' && growth.verified ? ['增长待复核'] : []),
    ...(valuation?.status === 'pass' && valuation.verified ? ['估值待复核'] : []),
  ];
  const observed = plan?.source === 'observed' ? plan : null;
  return { ...base, category: categories[0] ?? '等待条件', categories, entry: observed?.entry ?? null,
    stop: observed?.stop ?? null, target: observed?.target ?? null, zone, ratio: observed?.ratio ?? null,
    costBps: observed?.execution?.costBps, gapPercent: observed?.execution?.gapPercent,
    historyReady: true, trend, return20: technical.return20, volatility: technical.volatility,
    volumeRatio: technical.volumeRatio, risk: strategy.uncertainty?.[0], trigger: period?.trigger };
}

export function pulseInstruments(market) {
  return market === 'CN' ? [
    ['510300.SH', '沪深 300 ETF'], ['512480.SH', '半导体 ETF'], ['512800.SH', '银行 ETF'], ['159928.SZ', '消费 ETF'],
  ] : [['SPY', '标普 500 ETF'], ['XLK', '科技 ETF'], ['XLE', '能源 ETF'], ['XLF', '金融 ETF']];
}

export function summarizeMarket({ market, quoteFor, selected, selectedQuote, evidence, now = Date.now() }) {
  const point = (symbol, label) => {
    const quote = quoteFor(symbol);
    if (!['public', 'live'].includes(quote?.source) || !Number.isFinite(quote.change) || !Number.isFinite(Date.parse(quote.date))) return null;
    const age = now - Date.parse(quote.date);
    if (age < -300_000 || age > 96 * 3_600_000) return null;
    return { label, value: quote.change, date: quote.date, detail: '数据时间 ' + new Date(quote.date).toLocaleString('zh-CN', { hour12: false }),
      source: quote.source === 'public' ? '腾讯财经' : '行情网关' };
  };
  const proxies = pulseInstruments(market);
  const benchmark = point(...proxies[0]);
  const sectors = proxies.slice(1).map(([symbol, label]) => point(symbol, label)).filter(Boolean).sort((a, b) => b.value - a.value);
  const latest = ['public', 'live'].includes(selectedQuote?.source) && point(selected, selected);
  const sameWindow = latest && benchmark && Math.abs(Date.parse(latest.date) - Date.parse(benchmark.date)) <= 2 * 3_600_000;
  const relativeMove = sameWindow ? latest.value - benchmark.value : null;
  const related = (evidence?.events ?? []).filter((item) => item?.url && item.label).slice(0, 3);
  return {
    title: market === 'CN' ? 'A 股市场线索' : '美股市场线索',
    summary: benchmark ? '以宽基和行业 ETF 的最近有效报价观察相对表现。' : '等待宽基和行业 ETF 报价。',
    items: [...(benchmark ? [benchmark] : []), ...sectors],
    latest: latest || null, relativeMove, related,
  };
}
