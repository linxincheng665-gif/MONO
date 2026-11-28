import { seedState, loadState, saveState, quoteFor, portfolioSummary, parseHistory, indicators, tradePlan, stressTest, portfolioHistory } from './model.mjs';
import { renderWorkspace, renderTradeResult, renderRiskKpis, renderRiskResult, renderResearchResult, renderMarketQuote, renderWatchQuote, renderDailyIndicators, renderQuantResult, renderOpportunities, renderMarketPulse } from './views.mjs';
import { createAlpacaFeed, createFeed, validateAlpaca, validateFeed } from './feed.mjs';
import { createPublicStockFeed, fetchPublicQuoteSnapshot } from './public-stock-feed.mjs';
import { instrumentCurrency, instrumentMarket, marketLabel as exchangeLabel, normalizeTicker } from './instruments.mjs';
import { createTrendStore, aggregateBars, mergeSeries, portfolioObserved } from './trend-data.mjs';
import { fetchStockHistory, stockHistoryIntervals } from './stock-history.mjs';
import { renderMarketChart } from './market-chart.mjs';
import { createChartNavigation } from './chart-navigation.mjs';
import { runInvestmentResearch } from './investment-engine.mjs';
import { loadResearchData, normalizeResearchEvidence, validateResearchEndpoint } from './research-data.mjs';
import { buildRiskLab, diagnosePortfolio, evaluateAllocation, evaluateResearchAlerts, recordStrategy, strategyKey, trackedExitReviewAt, STRATEGY_LIMIT } from './workspace-analysis.mjs';
import { runQuantLab } from './quant-lab.mjs';
import { validateModelGateway, requestModelReview } from './model-gateway.mjs';
import { applyOpportunityPlan, candidateFor, defaultOpportunityPlan, discoverUniverse, maxCustomTickers,
  normalizeOpportunityPlan, opportunityFor, pulseInstruments, summarizeMarket } from './market-research.mjs';

const root = document.querySelector('#app');
const dialog = document.querySelector('#workspace-dialog');
const toast = document.querySelector('#toast');
const desktopWidth = matchMedia('(min-width: 836px)');
const desktopWorkspace = () => location.hostname === 'mono.windows.local'
  || (location.hostname !== 'mono.android.local' && desktopWidth.matches);
const pages = {
  overview: ['资产总览', 'overview'], holdings: ['持仓管理', 'layers'], market: ['市场观察', 'activity'],
  research: ['股票研究', 'search'], opportunities: ['投资机会', 'target'], trades: ['交易工作台', 'sliders'],
  risk: ['风险实验室', 'shield'], quant: ['量化实验室', 'chart'],
};
const mobileGroups = [
  [['overview', '资产总览'], ['holdings', '持仓管理']],
  [['market', '市场观察'], ['opportunities', '投资机会']],
  [['research', '股票研究'], ['quant', '量化实验室']],
];
const groupFor = (route) => mobileGroups.find((items) => items.some(([key]) => key === route));

function renderMobileGroup() {
  const group = groupFor(page);
  return group ? `<nav class="mobile-workspaces" aria-label="当前工作区">${group.map(([route, label]) =>
    `<a href="#${route}"${page === route ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : '';
}

if (['mono.android.local', 'mono.windows.local'].includes(location.hostname)) {
  globalThis.monoPublicResearch = Object.freeze({
    async request(url, options = {}) {
      const result = await fetch('/public-research?' + encodeURIComponent(String(url)), { credentials: 'omit', signal: options?.signal });
      return { status: result.status, body: await result.text() };
    },
  });
}
const path = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  activity: '<path d="M3 18h18M4 14l5-5 4 4 6-7m-4 0h4v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.8"/><path d="m15 15 5 5m-12-9 1.7 1.7L13 9"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--panel)"/><circle cx="15" cy="12" r="2" fill="var(--panel)"/><circle cx="8" cy="17" r="2" fill="var(--panel)"/>',
  shield: '<path d="M12 3 4.5 6v5c0 4.4 3.1 8.5 7.5 10 4.4-1.5 7.5-5.6 7.5-10V6z"/><path d="M8 12h2l1-3 2 6 1-3h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.5 14a7 7 0 0 0 0-4l1.5-1.2-1.7-3-1.8.7a8 8 0 0 0-3.5-2L13.7 3h-3.4L10 4.5a8 8 0 0 0-3.5 2l-1.8-.7-1.7 3L4.5 10a7 7 0 0 0 0 4L3 15.2l1.7 3 1.8-.7a8 8 0 0 0 3.5 2l.3 1.5h3.4l.3-1.5a8 8 0 0 0 3.5-2l1.8.7 1.7-3z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/>',
  wallet: '<path d="M19 8V5H6a2 2 0 0 0 0 4h14v10H6a2 2 0 0 1-2-2V7m16 5h-5v4h5"/><path d="M16 14h.1"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.1m11.9 0h.1"/>',
  pie: '<path d="M11 4a8 8 0 1 0 9 9h-9V4z"/><path d="M14 3v7h7a8 8 0 0 0-7-7z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.1"/>',
  connection: '<path d="M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 3a4.5 4.5 0 0 1 6 0m-3 3h.1"/>',
  pencil: '<path d="m4 20 1-5L16.8 3.3l4 4L9 19zM14 6l4 4"/>',
  trash: '<path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13m-9 0V4h6v3"/>',
  chart: '<path d="M4 4v16h16M7 15l4-5 3 2 5-7"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  watch: '<path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.4"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  box: '<path d="m4 8 8-4 8 4v8l-8 4-8-4zm0 0 8 4 8-4m-8 4v8"/>',
  bolt: '<path d="m13.5 3-8 11h6l-1 7 8-11h-6z"/>',
  'eye-off': '<path d="m3 3 18 18M10 10a3 3 0 0 0 4 4m-7.6-6C3.8 9.7 2.5 12 2.5 12s3.5 5.5 9.5 5.5c1.5 0 2.8-.3 4-.9M10 6.8c.6-.2 1.3-.3 2-.3 6 0 9.5 5.5 9.5 5.5s-.8 1.2-2.2 2.6"/>',
  expand: '<path d="M14 4h6v6M20 4l-6 6m-4 10H4v-6m0 6 6-6"/>',
};
const iconAliases = { 'arrow-right': 'arrow', 'arrow-up-right': 'activity', 'chevron-right': 'chevron', edit: 'pencil', delete: 'trash', upload: 'import', download: 'import', radio: 'connection', wifi: 'connection', 'bar-chart': 'chart', 'trend-up': 'activity', 'trending-up': 'activity', 'circle-plus': 'plus', database: 'layers', activity: 'activity', 'circle-help': 'info' };
const icons = (name, size = 17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path[name] ?? path[iconAliases[name]] ?? path.info}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
const currencyFormats = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
  CNY: new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }),
};
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const money = (value, currencyCode = 'USD') => Number.isFinite(value) ? currencyFormats[currencyCode].format(value) : '—';
const signedMoney = (value, currencyCode = 'USD') => Number.isFinite(value) ? `${value < 0 ? '−' : '+'}${money(Math.abs(value), currencyCode)}` : '—';
const percent = (value, digits = 2) => Number.isFinite(value) ? `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(typeof digits === 'number' ? digits : 2)}%` : '—';
const signedPercent = (value) => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${percent(value)}` : '—';
const number = (value) => Number.isFinite(value) ? decimal.format(value) : '—';
const tone = (value) => value == null || value === 0 ? '' : value < 0 ? 'bad' : 'good';

let state = loadState();
state.strategyJournal = Object.fromEntries(Object.entries(state.strategyJournal ?? {}).filter(([, value]) => Array.isArray(value?.versions)));
state.researchAlerts = Array.isArray(state.researchAlerts) ? state.researchAlerts.filter((item) => item?.symbol && item.type) : [];
state.overviewDismissals = Array.isArray(state.overviewDismissals) ? state.overviewDismissals.filter((id) => typeof id === 'string') : [];
state.researchEvidence = state.researchEvidence && typeof state.researchEvidence === 'object' ? state.researchEvidence : {};
state.importedResearch = state.importedResearch && typeof state.importedResearch === 'object' ? state.importedResearch : {};
for (const [ticker, packet] of Object.entries(state.researchEvidence)) {
  if (!packet?.imported) continue;
  state.importedResearch[ticker] ??= packet;
  delete state.researchEvidence[ticker];
}
const researchSections = ['macro', 'fundamentals', 'valuation', 'events', 'sentiment'];
const researchRequests = new Map();
let researchEndpoint = null;
try { researchEndpoint = validateResearchEndpoint(state.researchEndpoint); } catch { /* an obsolete endpoint needs reconfiguration */ }
let strategyReviewTimer;
let opportunityScan = null;
let customOpportunityPlan = state.opportunityPlan ? normalizeOpportunityPlan(state.opportunityPlan) : null;
let opportunityMode = state.opportunityMode === 'custom' && customOpportunityPlan ? 'custom' : 'default';
let opportunityPlan = opportunityMode === 'custom' ? customOpportunityPlan : defaultOpportunityPlan;
let opportunityView = 'all';
let opportunityVisibleRows = 14;
let discoveredSymbol = '';
let researchTab = 'overview';
let quantTab = 'analysis';
let quantSettings = { fast: 20, slow: 50, breakout: 20, holding: 30, costBps: 10, optimize: false, ...state.quantSettings };
let modelConfig = null;
try { modelConfig = validateModelGateway(state.modelGateway); } catch { /* wait for valid user configuration */ }
let sessionModelToken = '';
let externalRequest;
let externalQuant = {};
let chartStorage;
try { chartStorage = window.localStorage; } catch { /* charts still work in this session */ }
const trendStore = createTrendStore(fetchStockHistory, chartStorage);
const periods = new Map([['m1', '分时'], ['m5', '5 分'], ['m15', '15 分'], ['m30', '30 分'], ['m60', '1 小时'], ['day', '日线'], ['week', '周线'], ['month', '月线']]);
let chartPeriod = periods.has(state.chartPrefs?.period) ? state.chartPrefs.period : 'day';
let chartPrefs = { type: 'line', scale: 'price', cost: true, ma20: false, ma50: false, volume: true, area: true, ...state.chartPrefs };
let trendRefreshPending = false;
let chartExpanded = false;
let reopenExpandedChart = false;
let page = getPage();
let menu = false;
let range = '1M';
let symbol = state.watchlist[0]?.symbol ?? state.holdings[0]?.symbol ?? '';
let portfolioCurrency = state.portfolioCurrency === 'CNY' ? 'CNY' : 'USD';
let marketFilter = 'all';
let shock = -20;
let riskTab = 'stress';
let riskScenario = {};
let riskSimulation = {};
let tradeInputs = initialTrade();
let dialogSubmit = null;
let toastTimer;
let feedStatus = 'local';
let publicStatus = 'idle';
let feedFrame;
const pendingValuations = new Set();
const pendingBooks = new Set();
const pendingExtended = new Set();
const liveExtendedQuotes = new Map();
const publicExtendedQuotes = new Map();
let feedConfig = null;
let alpacaConfig = null;
try { feedConfig = validateFeed(state.feed ?? {}); } catch { /* load the local workspace without an invalid cached setting */ }
try { alpacaConfig = validateAlpaca(JSON.parse((await globalThis.MonoNative?.loadAlpaca()) ?? 'null')); } catch { /* unavailable credentials require reconnecting */ }

function newRecordId() {
  return globalThis.crypto.randomUUID?.() ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}

function getPage() { const key = location.hash.slice(1); return Object.hasOwn(pages, key) ? key : 'overview'; }
function cashField(currencyCode) { return currencyCode === 'CNY' ? 'cashCny' : 'cash'; }
function scopedPortfolio(currencyCode) {
  return { ...state, cash: state[cashField(currencyCode)] ?? 0,
    holdings: state.holdings.filter((holding) => instrumentCurrency(holding.symbol) === currencyCode),
    demo: state.demo && currencyCode === 'USD' };
}
function initialTrade(forSymbol = state.watchlist[0]?.symbol ?? state.holdings[0]?.symbol ?? '') {
  const currencyCode = instrumentCurrency(forSymbol);
  return { symbol: forSymbol, entry: '', target: '', stop: '', amount: '', riskPercent: 1, fractional: currencyCode === 'USD' };
}
function tradePortfolioContext(ticker, portfolio, summary = portfolioSummary(portfolio)) {
  const positionValue = summary.rows.reduce((total, row) =>
    total + (row.symbol === ticker ? row.value ?? 0 : 0), 0);
  return { cash: summary.cash, equity: summary.total, positionValue, incomplete: summary.incomplete, demo: portfolio.demo,
    capPercent: state.riskProfile?.cap ?? 25, reservePercent: state.riskProfile?.maxCashTarget ?? 20 };
}
function tickers() {
  return [...new Set([...state.watchlist, ...state.holdings, ...Object.values(state.strategyJournal).filter((item) => !item.paused),
    ...state.researchAlerts.filter((item) => !item.firedAt && item.type !== 'event')].map((item) => item.symbol))];
}
function publicTickers() {
  return [...new Set([...tickers(), discoveredSymbol,
    ...(page === 'market' ? pulseInstruments(instrumentMarket(symbol)).map(([code]) => code) : []),
  ].filter(Boolean))];
}
function feedTickers() {
  const list = tickers();
  return [...new Set([...(list.includes(symbol) ? [symbol] : []), ...state.holdings.map((item) => item.symbol), ...list])];
}
function marketLabel() {
  if (!alpacaConfig && !feedConfig) return ({ ready: '免费行情', connecting: '正在获取行情', stale: '最近公开报价', error: '免费行情暂不可用', idle: '免费行情' })[publicStatus] ?? '免费行情';
  const source = alpacaConfig?.feed.toUpperCase();
  return ({ local: state.demo ? '演示数据' : '行情未连接', connecting: '正在连接', subscribed: `${source} 已连接`, stream: source ? `${source} 实时` : '实时推送', poll: '轮询行情', stale: '报价待更新', waiting: '等待报价', reconnecting: '行情重连中', auth: '鉴权失败', occupied: '连接已占用', entitlement: '权限不足', limit: '订阅超限', error: '行情连接异常' })[feedStatus];
}
function quoteSignal(quote) {
  if (quote?.source === 'public') {
    const recent = Math.abs(Date.now() - Date.parse(quote.date)) <= 90_000;
    return { label: recent ? '公开报价' : '最近公开报价', status: recent && publicStatus !== 'error' ? 'public' : 'stale' };
  }
  if (quote?.source === 'live') return { label: quote.provider?.startsWith('alpaca-') ? `${quote.provider.slice(7).toUpperCase()} 成交` : '自定义网关', status: feedStatus };
  if (quote?.source === 'imported') return { label: '历史收盘价', status: 'local' };
  if (quote?.source === 'manual') return { label: '手动记录', status: 'local' };
  if (quote?.source === 'demo') return { label: '演示数据', status: 'local' };
  return { label: publicStatus === 'connecting' ? '正在获取报价' : '暂无报价', status: publicStatus };
}

function updateQuoteSignal() {
  const signal = root.querySelector('.quote-signal');
  if (!signal) return;
  const status = quoteSignal(quoteFor(state, symbol));
  signal.dataset.status = status.status;
  signal.textContent = status.label;
}
function updateFeedChip() {
  const chip = root.querySelector('.feed-chip');
  if (!chip) return;
  chip.dataset.status = alpacaConfig || feedConfig ? feedStatus : publicStatus;
  chip.lastElementChild.textContent = marketLabel();
}
function extendedQuotesFor(ticker) {
  if (!ticker || instrumentMarket(ticker) !== 'US') return [];
  return ['pre', 'post', 'overnight'].flatMap((session) => {
    const key = ticker + '|' + session;
    const live = liveExtendedQuotes.get(key), published = publicExtendedQuotes.get(key);
    const quote = live && (!published || live.date >= published.date) ? live : published;
    return quote && Date.now() - Date.parse(quote.date) <= 7 * 86_400_000 ? [quote] : [];
  });
}
function updateQuotes(quotes, isPublic = false) {
  const store = isPublic ? state.publicQuotes : state.liveQuotes;
  for (const { symbol: ticker, ...quote } of quotes) {
    if (quote.currency && quote.currency !== instrumentCurrency(ticker)) continue;
    if (quote.session) {
      const time = Date.parse(quote.date);
      if (instrumentMarket(ticker) !== 'US' || !Number.isFinite(time) || time > Date.now() + 60_000 ||
          !Number.isFinite(quote.price) || quote.price <= 0) continue;
      const extended = isPublic ? publicExtendedQuotes : liveExtendedQuotes;
      const key = ticker + '|' + quote.session;
      const previous = extended.get(key);
      if (previous && (previous.date > quote.date ||
          previous.date === quote.date && previous.price === quote.price && previous.change === quote.change)) continue;
      extended.set(key, { ...quote, currency: 'USD' });
      pendingExtended.add(ticker);
      continue;
    }
    const current = store[ticker];
    const mark = quote.date && (!current?.date || current.date <= quote.date);
    const book = quote.bookDate && (!current?.bookDate || current.bookDate <= quote.bookDate);
    const priceChanged = mark && (current?.date !== quote.date || current.price !== quote.price || current.change !== quote.change);
    const bookChanged = book && (current?.bookDate !== quote.bookDate || current.bid !== quote.bid || current.ask !== quote.ask);
    const valuationChanged = isPublic && mark && JSON.stringify(current?.valuation ?? null) !== JSON.stringify(quote.valuation ?? null);
    if (!priceChanged && !bookChanged && !valuationChanged) continue;
    store[ticker] = {
      ...current,
      ...(mark ? { price: quote.price, date: quote.date, change: quote.change } : {}),
      ...(isPublic && mark ? { valuation: quote.valuation ?? null } : {}),
      ...(book ? { bid: quote.bid, ask: quote.ask, bookDate: quote.bookDate } : {}),
      provider: quote.provider,
      currency: quote.currency ?? instrumentCurrency(ticker),
      source: isPublic ? 'public' : 'live',
    };
    if (priceChanged) {
      const effective = quoteFor(state, ticker);
      if (ticker === symbol || state.holdings.some((holding) => holding.symbol === ticker)) trendStore.observe(ticker, effective);
    }
    if (priceChanged || valuationChanged) pendingValuations.add(ticker);
    if (bookChanged) pendingBooks.add(ticker);
  }
  if (feedFrame || (!pendingValuations.size && !pendingBooks.size && !pendingExtended.size)) return;
  feedFrame = requestAnimationFrame(() => {
    feedFrame = null;
    if (page === 'market') {
      if (pendingValuations.has(symbol) || pendingBooks.has(symbol) || pendingExtended.has(symbol)) {
        const target = root.querySelector('#market-mark');
        if (target) target.innerHTML = renderMarketQuote({ symbol, quote: quoteFor(state, symbol), orderBook: state.liveQuotes[symbol],
          extendedQuotes: extendedQuotesFor(symbol), alpacaFeed: alpacaConfig?.feed, money, signedPercent });
        updateQuoteSignal();
        if (pendingValuations.has(symbol)) {
          ensurePageHistory();
          refreshTrend();
        }
      }
      for (const row of root.querySelectorAll('[data-watch-symbol]')) {
        const ticker = row.dataset.watchSymbol;
        if (!pendingValuations.has(ticker) && !pendingExtended.has(ticker)) continue;
        const quote = quoteFor(state, ticker);
        row.querySelector('.ws-watch-price').innerHTML = renderWatchQuote(quote, { money, signedPercent }, extendedQuotesFor(ticker));
        row.querySelector('.watch-demo').hidden = quote.source !== 'demo';
      }
      if (pendingValuations.size) updateResults();
    } else if (pendingValuations.size) {
      const active = document.activeElement;
      if (page === 'overview') {
        refreshOverview();
      } else if (page === 'holdings' && !active?.matches('input, textarea, select')) {
        renderContent();
        if (active && active !== document.body && !root.contains(active)) restoreFocus(active);
      } else if (page !== 'overview' && !dialog.open) updateResults();
    }
    const reviewNeeded = pendingValuations.size > 0 || pendingBooks.size > 0;
    pendingValuations.clear();
    pendingBooks.clear();
    pendingExtended.clear();
    if (reviewNeeded) queueStrategyReview();
  });
}

function updateFeedStatus(status) {
  if (feedStatus === status) return;
  feedStatus = status;
  updateFeedChip();
  updateQuoteSignal();
}

const feed = createFeed((quotes) => { if (!alpacaConfig) updateQuotes(quotes); }, (status) => { if (!alpacaConfig) updateFeedStatus(status); });
const alpacaFeed = createAlpacaFeed((quotes) => { if (alpacaConfig) updateQuotes(quotes); }, (status) => { if (alpacaConfig) updateFeedStatus(status); });
const publicFeed = createPublicStockFeed((quotes) => updateQuotes(quotes, true), (status) => {
  publicStatus = status;
  updateFeedChip();
  updateQuoteSignal();
});

function activateFeed() {
  publicFeed.setPriority(page === 'market');
  publicFeed.setSymbols(publicTickers());
  if (alpacaConfig) {
    feed.configure(null, []);
    alpacaFeed.configure(alpacaConfig, feedTickers());
  } else {
    alpacaFeed.configure(null, []);
    feed.configure(feedConfig, tickers());
  }
}

function restoreFocus(previous) {
  if (previous.id && root.querySelector('#' + CSS.escape(previous.id))) {
    root.querySelector('#' + CSS.escape(previous.id)).focus({ preventScroll: true });
    return;
  }
  if (previous.matches('.chart-hit, [data-chart-zoom]')) {
    const host = previous.closest('[data-chart-key]');
    const replacement = [...document.querySelectorAll('[data-chart-key]')].find((node) => node.dataset.chartKey === host?.dataset.chartKey);
    const selector = previous.matches('.chart-hit') ? '.chart-hit' : '[data-chart-zoom="' + previous.dataset.chartZoom + '"]';
    replacement?.querySelector(selector)?.focus({ preventScroll: true });
    return;
  }
  const { action, symbol: ticker, id, range: selectedRange, period } = previous.dataset ?? {};
  if (!action) return;
  const candidates = [...root.querySelectorAll('[data-action]')].filter((el) => el.dataset.action === action
    && el.dataset.symbol === ticker && el.dataset.id === id && el.dataset.range === selectedRange && el.dataset.period === period
    && el.getClientRects().length);
  const replacement = candidates.find((el) => el.className === previous.className) ?? candidates[0];
  replacement?.focus({ preventScroll: true });
}

function dailyHistory(ticker) {
  const imported = state.histories[ticker] ?? [];
  const provider = trendStore.read(ticker, 'day');
  if (imported.length > 1) return { bars: imported, source: 'CSV 日线', status: 'ready' };
  if (provider.bars.length) return { ...provider, source: '腾讯财经 · 日线' };
  return { ...provider, bars: imported, source: imported.length ? 'CSV 日线' : '' };
}

function observedPrices(ticker) {
  const live = quoteFor(state, ticker);
  const mark = ['live', 'public', 'manual'].includes(live.source) && (live.date?.length ?? 0) > 10 && Number.isFinite(live.price)
    ? [{ date: live.date, close: live.price }] : [];
  return mergeSeries(trendStore.observed(ticker), mark);
}

function historicalPortfolio(portfolio) {
  const histories = Object.fromEntries(portfolio.holdings.map(({ symbol: ticker }) => {
    const imported = state.histories[ticker] ?? [];
    const adjusted = trendStore.read(ticker, 'day-adjusted').bars;
    return [ticker, imported.length > 1 || !adjusted.length ? imported : adjusted];
  }));
  return { ...portfolio, histories };
}

function providerInterval(ticker, period) {
  if (period === 'day' || period === 'week' || period === 'month') return 'day';
  const available = stockHistoryIntervals(ticker);
  return available.includes(period) ? period : available.includes('m1') ? 'm1' : null;
}

function ensurePageHistory(force = false) {
  if (document.hidden) return;
  const targets = new Map();
  const add = (ticker, interval) => {
    const daily = interval === 'day' || interval === 'day-adjusted';
    if (ticker && interval && (force || !daily || (state.histories[ticker]?.length ?? 0) < 2)) targets.set(`${ticker}|${interval}`, [ticker, interval]);
  };
  if (page === 'market' || page === 'research' || page === 'quant') {
    add(symbol, 'day');
    if (page === 'market') add(symbol, providerInterval(symbol, chartPeriod));
    else add(benchmarkFor(symbol), 'day');
    if (page !== 'quant') {
      void ensureResearchEvidence(symbol);
    }
  } else if (['overview', 'holdings', 'risk'].includes(page)) {
    if (page === 'risk') add(portfolioCurrency === 'CNY' ? '510300.SH' : 'SPY', 'day-adjusted');
    for (const { symbol: ticker } of scopedPortfolio(portfolioCurrency).holdings) {
      add(ticker, 'day-adjusted');
      if (page === 'overview' && range === '1D') add(ticker, providerInterval(ticker, 'm5'));
    }
  }
  for (const tracked of Object.values(state.strategyJournal)) if (!tracked.paused) add(tracked.symbol, 'day');
  for (const [ticker, interval] of targets.values()) {
    const before = trendStore.read(ticker, interval).status;
    if (before === 'loading') continue;
    void trendStore.load(ticker, interval, { force }).then((attempted) => {
      if (attempted) {
        if (ticker === symbol || ticker === benchmarkFor(symbol) || page === 'risk' ||
          state.holdings.some((holding) => holding.symbol === ticker)) scheduleTrendRefresh();
        queueStrategyReview();
      }
    });
  }
}

function scheduleTrendRefresh() {
  if (trendRefreshPending) return;
  trendRefreshPending = true;
  requestAnimationFrame(() => {
    trendRefreshPending = false;
    refreshTrend();
  });
}

function refreshTrend() {
  if (chartNavigation.busy()) { trendRefreshPending = true; return; }
  if (page === 'market') {
    const panel = root.querySelector('#market-trend');
    if (!panel) return;
    const active = document.activeElement;
    const ctx = buildContext();
    panel.innerHTML = renderInstrumentTrend(ctx);
    root.querySelector('#market-indicators').innerHTML = renderDailyIndicators(ctx);
    if (active && !active.isConnected) restoreFocus(active);
    if (chartExpanded) updateExpandedChart();
  } else if (['research', 'quant', 'risk'].includes(page)) {
    updateResults();
  } else if (page === 'overview') {
    refreshOverview();
  }
}

function buildContext() {
  const portfolio = scopedPortfolio(portfolioCurrency);
  const tradePortfolio = tradePortfolioContext(tradeInputs.symbol, scopedPortfolio(instrumentCurrency(tradeInputs.symbol)));
  const summary = portfolioSummary(portfolio);
  const history = dailyHistory(symbol).bars;
  const researchInputs = state.research[symbol] ?? {};
  const portfolioWithHistory = historicalPortfolio(portfolio);
  const stress = stressTest(portfolioWithHistory, shock);
  const watchQuotes = state.watchlist.map((item) => ({ ...item, ...quoteFor(state, item.symbol) }));
  const quote = quoteFor(state, symbol);
  const evidence = evidenceFor(symbol);
  const orderBook = state.liveQuotes[symbol];
  const privateAmounts = state.privateAmounts === true;
  const displayedCurrency = page === 'trades' ? instrumentCurrency(tradeInputs.symbol) : ['market', 'research', 'quant'].includes(page) ? instrumentCurrency(symbol) : portfolioCurrency;
  const signal = quoteSignal(quote);
  const strategy = page === 'research' ? analyzeInstrument(symbol) : null;
  const diagnostics = page === 'risk' && !state.demo && !privateAmounts ? diagnosePortfolio(summary, portfolioWithHistory.histories, {
    ...state.riskProfile, shock,
  }) : null;
  const riskBenchmark = portfolioCurrency === 'CNY' ? '510300.SH' : 'SPY';
  const scenario = riskScenario[portfolioCurrency] ?? {};
  const simulation = riskSimulation[portfolioCurrency] ?? {};
  const riskLab = page === 'risk' && !privateAmounts && !portfolio.demo ? buildRiskLab(summary, portfolioWithHistory.histories, {
    ...state.riskProfile, shock, scenario, simulation,
    benchmarkBars: portfolioWithHistory.histories[riskBenchmark] ?? trendStore.read(riskBenchmark, 'day-adjusted').bars,
  }) : null;
  const journalKey = strategyKey(symbol, researchInputs.horizon);
  const benchmarkSymbol = benchmarkFor(symbol);
  const quant = page === 'quant' ? runQuantLab({ symbol, bars: history, benchmarkSymbol,
    benchmarkBars: benchmarkSymbol !== symbol ? dailyHistory(benchmarkSymbol).bars : [], historySource: dailyHistory(symbol).source,
    quote, settings: quantSettings }) : null;
  const marketPulse = page === 'market' ? summarizeMarket({ market: instrumentMarket(symbol), selected: symbol,
    selectedQuote: quote, quoteFor: (ticker) => quoteFor(state, ticker), evidence }) : null;
  const newsContext = (evidence.events ?? []).filter((item) => item.kind === 'news');
  const allocationCandidates = page === 'risk' && diagnostics && opportunityScan?.results
    ? opportunityScan.results.filter((item) => item.match === true && instrumentCurrency(item.ticker) === portfolioCurrency) : [];
  const alternative = allocationCandidates.length ? evaluateAllocation(summary, {
    ...Object.fromEntries(allocationCandidates.map((item) => [item.ticker, dailyHistory(item.ticker).bars])),
    ...portfolioWithHistory.histories,
  }, allocationCandidates, state.riskProfile) : null;
  return { state: ['holdings', 'risk'].includes(page) ? portfolio : state, portfolio: portfolioWithHistory, portfolioCurrency, displayedCurrency, privateAmounts,
    summary, symbol, quote, orderBook, extendedQuotes: extendedQuotesFor(symbol), extendedQuotesFor,
    marketFilter, exchangeLabel, marketStatus: signal.status, marketLabel: signal.label, alpacaFeed: alpacaConfig?.feed,
    history, indicators: indicators(history), tradeInputs, researchInputs,
    trade: tradePlan({ ...tradeInputs, ...tradePortfolio }), tradeCash: tradePortfolio.cash, tradeDemo: tradePortfolio.demo,
    shock, stress, strategy, diagnostics, alternative, riskLab, riskTab, riskScenario: scenario, riskSimulation: simulation,
    watchQuotes, journal: state.strategyJournal[journalKey], alerts: state.researchAlerts.filter((alert) => alert.symbol === symbol),
    evidence, evidenceState: researchRequests.get(symbol)?.loading ?? false,
    opportunityScan, opportunityPlan, opportunityMode,
    opportunityCount: page === 'opportunities' ? scanCandidates().length : 0, opportunityView, opportunityVisibleRows,
    researchTab, quant, quantTab, quantSettings, marketPulse, newsContext, externalQuant: {
      ...(externalQuant.symbol === symbol ? externalQuant : {}), configured: Boolean(modelConfig), provider: modelConfig?.provider, model: modelConfig?.model,
    },
    icons, renderInstrumentTrend, instrumentMarket, instrumentCurrency,
    money: (value, currencyCode = displayedCurrency) => money(value, currencyCode),
    signedMoney: (value, currencyCode = displayedCurrency) => signedMoney(value, currencyCode), percent, signedPercent, number };
}

function benchmarkFor(ticker) {
  return ticker ? instrumentCurrency(ticker) === 'CNY' ? '510300.SH' : 'SPY' : '';
}

function evidenceFor(ticker) {
  const connected = state.researchEvidence[ticker] ?? {};
  const imported = state.importedResearch[ticker];
  if (!imported) return connected;
  const combined = { ...connected, imported: true, symbol: ticker };
  for (const section of researchSections) {
    const rows = [...(connected[section] ?? []), ...(imported[section] ?? []).map((item) => ({ ...item, imported: true }))];
    combined[section] = [...new Map(rows.map((item) => [[item.url, item.asOf, item.metric ?? item.label].join('|'), item])).values()]
      .sort((a, b) => String(b.asOf ?? b.publishedAt ?? '').localeCompare(String(a.asOf ?? a.publishedAt ?? '')));
  }
  return combined;
}

function analyzeInstrument(ticker, horizon, selectedType, screening = false) {
  const daily = dailyHistory(ticker);
  const saved = state.research[ticker] ?? {};
  const { entry, stop, target, ...screeningInputs } = saved;
  const inputs = { ...(screening ? screeningInputs : saved), ...(horizon ? { horizon } : {}) };
  const currency = instrumentCurrency(ticker);
  const scoped = scopedPortfolio(currency);
  const name = [...state.holdings, ...state.watchlist].find((item) => item.symbol === ticker)?.name ?? '';
  const evidence = evidenceFor(ticker);
  const basis = evidence.fundamentals ?? [];
  const publicValuation = state.publicQuotes[ticker]?.valuation;
  const kind = inputs.assetType || selectedType || publicValuation?.kind || candidateFor(ticker)?.type || (/\bETF\b/i.test(name) || /^(?:51|56|58)\d{4}\.SH$|^159\d{3}\.SZ$/.test(ticker) ||
    basis.some((entry) => ['expenseRatioPct', 'trackingErrorPct'].includes(entry.metric)) ? 'etf'
    : /^(?:60|68)\d{4}\.SH$|^(?:00|30)\d{4}\.SZ$|^\d{6}\.BJ$/.test(ticker) || basis.some((entry) => entry.metric === 'revenueGrowthPct') ||
      /\b(?:Inc|Corp|Ltd)\b/i.test(name) ? 'equity' : null);
  return runInvestmentResearch({
    symbol: ticker, bars: daily.bars, historySource: daily.source, quote: quoteFor(state, ticker), inputs,
    metadata: { market: instrumentMarket(ticker), currency, type: kind, benchmark: benchmarkFor(ticker) },
    benchmarkBars: ticker === benchmarkFor(ticker) ? [] : dailyHistory(benchmarkFor(ticker)).bars,
    evidence, includeBacktest: false, publicValuation,
    portfolio: { ...tradePortfolioContext(ticker, scoped), amount: inputs.amount, riskPercent: inputs.riskPercent ?? 1,
      fractional: currency === 'USD' },
  });
}

const alertNames = { above: '价格达到', below: '价格跌至', event: '事件时间', invalidate: '策略失效', opportunity: '机会触发' };

function ensureResearchEvidence(ticker, force = false) {
  if (!ticker || document.hidden) return;
  const before = researchRequests.get(ticker);
  if (before?.loading) return before.promise;
  if (!force && before && Date.now() - before.at < 30 * 60_000) return;
  const request = { loading: true, at: Date.now() };
  researchRequests.set(ticker, request);
  request.promise = refreshResearchEvidence(ticker, force, request);
  return request.promise;
}

async function refreshResearchEvidence(ticker, force, request) {
  try {
    const known = candidateFor(ticker);
    const name = known?.name ?? [...state.watchlist, ...state.holdings].find((item) => item.symbol === ticker)?.name;
    const type = state.research[ticker]?.assetType || known?.type;
    const evidence = await loadResearchData(ticker, { endpoint: researchEndpoint, force, name, type });
    if (researchRequests.get(ticker) !== request) return;
    if (evidence) {
      const hasEvidence = researchSections.some((key) => evidence[key]?.length);
      if (hasEvidence || !state.researchEvidence[ticker]) {
        state.researchEvidence[ticker] = evidence;
        if (hasEvidence) {
          delete state.researchEvidence[ticker].loading;
          const keys = Object.keys(state.researchEvidence).filter((key) => key !== ticker);
          for (const key of keys.slice(0, Math.max(0, keys.length - 24))) delete state.researchEvidence[key];
          saveState(undefined, state);
        }
      } else state.researchEvidence[ticker] = { ...state.researchEvidence[ticker], errors: evidence.errors, coverage: evidence.coverage };
    }
  } catch {
    if (researchRequests.get(ticker) === request && !state.researchEvidence[ticker]) state.researchEvidence[ticker] = { errors: [{ message: '研究数据暂无法获取' }] };
  } finally {
    request.loading = false;
    if (['research', 'market'].includes(page) && ticker === symbol) updateResults();
    queueStrategyReview();
  }
}

function queueStrategyReview() {
  if (strategyReviewTimer || document.hidden) return;
  strategyReviewTimer = setTimeout(() => {
    strategyReviewTimer = null;
    if (!document.hidden) reviewStrategies();
  }, 900);
}

function reviewStrategies() {
  const analyses = new Map();
  let changed = false;
  for (const [key, tracked] of Object.entries(state.strategyJournal)) {
    if (tracked.paused) continue;
    const daily = dailyHistory(tracked.symbol);
    if (!daily.bars.length) continue;
    const strategy = analyzeInstrument(tracked.symbol, tracked.horizon);
    analyses.set(key, strategy);
    const updated = recordStrategy(tracked, strategy);
    if (updated === tracked) continue;
    state.strategyJournal[key] = updated;
    changed = true;
  }
  const { alerts, fired } = evaluateResearchAlerts(state.researchAlerts, {
    analysisFor: (key) => analyses.get(key), quoteFor: (ticker) => quoteFor(state, ticker), strategies: state.strategyJournal,
  });
  if (fired.length) {
    state.researchAlerts = alerts;
    announce(`${fired[0].symbol} · ${alertNames[fired[0].type]}${fired.length > 1 ? `等 ${fired.length} 条提醒` : ''}`);
  }
  if (changed || fired.length) {
    saveState(undefined, state);
    if (page === 'research') updateResults();
    if (page === 'overview') refreshOverview();
  }
}

function marketTrend(ctx) {
  const isIntraday = /^m\d/.test(chartPeriod);
  const interval = providerInterval(ctx.symbol, chartPeriod);
  const daily = dailyHistory(ctx.symbol);
  const view = isIntraday ? trendStore.read(ctx.symbol, interval) : daily;
  const observed = observedPrices(ctx.symbol);
  const useObserved = !view.bars.length && observed.length > 0;
  const source = useObserved ? '本机记录的报价' : isIntraday && view.bars.length ? `${instrumentMarket(ctx.symbol) === 'CN' ? '腾讯财经' : '东方财富'} · 分钟行情` : isIntraday ? '' : daily.source;
  const rows = useObserved ? (isIntraday ? aggregateBars(observed, chartPeriod) : observed) : interval === chartPeriod ? view.bars : aggregateBars(view.bars, chartPeriod);
  const lots = state.holdings.filter((holding) => holding.symbol === ctx.symbol && holding.shares > 0);
  const shares = lots.reduce((sum, holding) => sum + holding.shares, 0);
  const cost = shares ? lots.reduce((sum, holding) => sum + holding.shares * holding.cost, 0) / shares : null;
  const canCandle = !useObserved && rows.some((row) => [row.open, row.high, row.low].every(Number.isFinite));
  const series = indicators(rows).series;
  return { rows, source, canCandle, cost, series, loading: Boolean(interval) && view.status === 'loading', observed: useObserved };
}

function renderInstrumentTrend(ctx, expanded = false) {
  const view = marketTrend(ctx);
  const common = ['m1', 'm5', 'day', 'week', 'month'];
  if (!common.includes(chartPeriod)) common[1] = chartPeriod;
  const controls = `<div class="trend-toolbar"><div class="trend-periods" aria-label="图表周期">${common.map((key) => `<button type="button" data-action="chart-period" data-period="${key}" aria-pressed="${key === chartPeriod}">${periods.get(key)}</button>`).join('')}</div><div class="trend-tools"><button type="button" class="trend-tool" data-action="chart-periods" title="更多周期" aria-label="更多周期">•••</button><button type="button" class="trend-tool" data-action="chart-settings" title="图表设置" aria-label="图表设置">${icons('sliders', 17)}</button>${expanded ? '' : `<button type="button" class="trend-tool" data-action="expand-chart" title="展开图表" aria-label="展开图表">${icons('expand', 17)}</button>`}</div></div>`;
  const hasVolume = view.rows.some((row) => Number.isFinite(row.volume));
  const chartType = chartPrefs.type === 'candle' && view.canCandle ? 'candle' : 'line';
  const chart = view.rows.length ? chartNavigation.render(view.rows, {
    kind: 'market', type: chartType, chartId: expanded ? 'stock-expanded' : 'stock',
    currencyCode: ctx.displayedCurrency, money: ctx.money, signedPercent,
    cost: chartPrefs.cost && !state.privateAmounts ? view.cost : null,
    latest: ctx.quote.price, showVolume: chartPrefs.volume && hasVolume, showArea: chartPrefs.area,
    scale: chartPrefs.scale, ma20: chartPrefs.ma20 ? view.series.map(({ date, ma20 }) => ({ date, value: ma20 })) : [],
    ma50: chartPrefs.ma50 ? view.series.map(({ date, ma50 }) => ({ date, value: ma50 })) : [],
  }, `stock|${ctx.symbol}|${chartPeriod}`) : `<div class="chart-empty">${!ctx.symbol ? '选择一个标的查看走势图。' : view.loading ? '正在加载历史行情…' : '等待可用报价。也可导入收盘价。'}</div>`;
  const details = [view.source, view.loading ? '正在补载历史' : '', view.rows.length === 1 ? '已有 1 个报价点' : '', chartPrefs.type === 'candle' && !view.canCandle && view.rows.length ? '此数据仅支持线图' : ''].filter(Boolean);
  return `${controls}<div class="trend-plot">${chart}</div><div class="trend-meta"><span>${esc(details.join(' · '))}</span>${ctx.symbol ? '<button type="button" class="link-button" data-action="reload-chart">更新</button>' : ''}</div>`;
}

function portfolioTrend(portfolio) {
  const holdings = portfolio.holdings.filter((holding) => holding.shares > 0);
  const history = portfolioHistory(portfolio);
  const observed = portfolioObserved(holdings, portfolio.cash, observedPrices);
  const intraday = range === '1D' ? portfolioObserved(holdings, portfolio.cash, (ticker) => {
    const interval = providerInterval(ticker, 'm5');
    const bars = trendStore.read(ticker, interval).bars;
    const rows = interval === 'm5' ? bars : aggregateBars(bars, 'm5');
    return mergeSeries(rows, observedPrices(ticker));
  }) : [];
  if (range === '1D' && intraday.length > 1) {
    const lastTime = Date.parse(intraday.at(-1).date);
    return { rows: intraday.filter(({ date }) => lastTime - Date.parse(date) <= 24 * 60 * 60_000), source: '近 24 小时 · 按当前仓位估值' };
  }
  const newest = observed.at(-1);
  const afterHistory = newest && (!history.length || newest.date > history.at(-1).date);
  const series = history.length ? mergeSeries(history, afterHistory ? [newest] : []) : observed;
  const days = { '1W': 7, '1M': 31, '3M': 93, '1Y': 366 }[range];
  const threshold = days && series.length ? Date.parse(series.at(-1).date) - (days - 1) * 86_400_000 : -Infinity;
  const rows = range === '1D' ? series.slice(-2) : series.filter(({ date }) => Date.parse(date) >= threshold);
  let source = '等待持仓报价';
  if (history.length) {
    const demo = portfolio.demo && !Object.values(portfolio.histories).some((bars) => bars.length);
    const imported = holdings.some(({ symbol: ticker }) => (state.histories[ticker]?.length ?? 0) > 1);
    source = demo ? '演示走势' : imported ? '历史日线 · 按当前仓位与现金回算' : '前复权日线 · 按当前仓位与现金回算';
    if (afterHistory) source += ' · 含最近估值';
  } else if (observed.length) source = observed.length === 1 ? '当前估值 · 已有 1 个报价点' : '按本机报价记录估值';
  return { rows, source };
}

const colors = ['#2346e8', '#1b2034', '#7283c2', '#9caad1', '#bac4dd', '#d7ddea'];
function spark(item) {
  const daily = dailyHistory(item.symbol).bars;
  const adjusted = trendStore.read(item.symbol, 'day-adjusted').bars;
  const bars = [daily, adjusted, observedPrices(item.symbol)].find((rows) => rows.length > 1) ?? [];
  const points = bars.slice(-15).map(({ close }) => close).filter(Number.isFinite);
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const span = Math.max(Math.max(...points) - min, .01);
  const coords = points.map((value, i) => `${1 + i / (points.length - 1) * 53},${17 - (value - min) / span * 14}`).join(' ');
  return `<svg class="watch-spark" viewBox="0 0 55 20" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function assetLink(item) {
  const name = item.name && item.name !== item.symbol ? `<small>${esc(item.name)}</small>` : '';
  return `<button class="asset-link" data-action="select-symbol" data-symbol="${esc(item.symbol)}"><span class="asset-label"><strong>${esc(item.symbol)}</strong>${name}</span></button>`;
}

function overviewSteps(portfolio = scopedPortfolio(portfolioCurrency), summary = portfolioSummary(portfolio)) {
  if (state.privateAmounts) return [];
  const held = new Set(state.holdings.filter((item) => item.shares > 0 && item.source !== 'demo').map((item) => item.symbol));
  const exitReviews = Object.values(state.strategyJournal).filter((item) => !item.paused && held.has(item.symbol))
    .map((item) => ({ ...item, at: trackedExitReviewAt(item) })).filter((item) => item.at)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .map(({ symbol, horizon, at }) => ({ id: `exit|${strategyKey(symbol, horizon)}|${at}`, kind: 'research', symbol, horizon,
      message: `${symbol} 的已跟踪策略触及失效条件，请复核减仓或退出的依据。`, label: '查看策略跟踪' }));
  const alerts = state.researchAlerts.filter((item) => item.id && item.firedAt && Object.hasOwn(alertNames, item.type))
    .sort((left, right) => Date.parse(right.firedAt) - Date.parse(left.firedAt))
    .map(({ id, symbol, type, key, firedAt }) => ({ id: `alert|${id}|${firedAt}`, kind: 'research', symbol, horizon: typeof key === 'string' ? key.split('|')[1] : null,
      message: `${symbol} 的「${alertNames[type]}」提醒已触发。`, label: '查看研究提醒' }));
  if (portfolio.demo) return alerts;
  const prefix = `portfolio|${portfolioCurrency}|`;
  if (summary.incomplete) {
    const missing = [...new Set(summary.rows.filter((item) => item.shares > 0 && item.value === null).map((item) => item.symbol))].sort();
    return [...exitReviews, { id: `${prefix}valuation|${missing.join(',')}`, message: '先补齐无法估值的持仓。', label: '核对持仓', href: '#holdings' }, ...alerts];
  }
  const cap = Number(state.riskProfile?.cap ?? 25);
  const reductions = summary.allocation.filter((item) => item.label === item.symbol && item.weight > cap)
    .map(({ symbol }) => ({ id: `${prefix}concentration|${symbol}|${cap}`, kind: 'reduction', symbol, targetWeight: cap,
      message: `${symbol} 超过单标的上限，可先看减仓后的风险。`, label: '查看减仓风险' }));
  const reserve = Number(state.riskProfile?.maxCashTarget ?? 20);
  const cashReview = summary.total > 0 && summary.cashPercent < reserve ? [{ id: `${prefix}cash|${reserve}`, kind: 'cash',
    message: '现金低于设定的储备比例，核对可用资金后再考虑加仓。', label: '核对现金' }] : [];
  return [...exitReviews, ...reductions, ...alerts, ...cashReview];
}

function overviewFocus(portfolio, summary) {
  const steps = overviewSteps(portfolio, summary);
  if (!state.privateAmounts && !portfolio.demo && state.overviewDismissals.length) {
    const prefix = `portfolio|${portfolioCurrency}|`;
    const active = new Set(steps.map(({ id }) => id));
    const remaining = state.overviewDismissals.filter((id) => !id.startsWith(prefix) || active.has(id) ||
      (summary.incomplete && !id.startsWith(`${prefix}valuation|`)));
    if (remaining.length !== state.overviewDismissals.length) {
      state.overviewDismissals = remaining;
      saveState(undefined, state);
    }
  }
  const dismissed = new Set(state.overviewDismissals);
  const next = steps.find(({ id }) => !dismissed.has(id));
  if (!next) return steps.length ? `<button type="button" class="link-button overview-focus-trigger" data-action="show-overview-focus">重新查看下一步 ${icons('arrow', 14)}</button>` : '';
  const label = `${esc(next.label)} ${icons('arrow', 14)}`;
  const action = next.href ? `<a class="link-button" href="${next.href}">${label}</a>`
    : `<button type="button" class="link-button" data-action="open-overview-step" data-id="${esc(next.id)}">${label}</button>`;
  return `<section class="overview-focus" aria-labelledby="overview-focus-heading">
    <div><h2 id="overview-focus-heading" tabindex="-1">下一步</h2><p>${esc(next.message)}</p></div>
    <div class="overview-focus-actions">${action}<button type="button" class="icon-button overview-focus-dismiss" data-action="hide-overview-focus" aria-label="关闭下一步" title="关闭下一步">${icons('close', 17)}</button></div>
  </section>`;
}

function overview(ctx) {
  const { summary, portfolio } = ctx;
  const trend = portfolioTrend(portfolio);
  const privateValues = ctx.privateAmounts;
  const amount = privateValues ? () => '••••' : ctx.money;
  const signedAmount = privateValues ? () => '••••' : ctx.signedMoney;
  const names = new Map(portfolio.holdings.map((holding) => [holding.symbol, holding.name]));
  const allocation = [...summary.allocation];
  if (allocation.length > 6) {
    const cash = allocation.find((item) => item.symbol === 'CASH');
    const holdings = allocation.filter((item) => item.symbol !== 'CASH');
    const top = holdings.slice(0, cash ? 4 : 5);
    const weight = holdings.slice(top.length).reduce((sum, item) => sum + item.weight, 0);
    allocation.splice(0, allocation.length, ...top, { label: '其他', symbol: 'OTHER', weight }, ...(cash ? [cash] : []));
  }
  const starter = !portfolio.holdings.length && portfolio.cash === 0;
  const hasPositions = portfolio.holdings.length > 0;
  const backfill = portfolio.holdings.some(({ symbol: ticker }) => trendStore.read(ticker, 'day-adjusted').status === 'loading');
  const graph = privateValues ? '' : trend.rows.length
    ? chartNavigation.render(trend.rows, { kind: 'portfolio', type: 'line', chartId: 'portfolio', currencyCode: portfolioCurrency, money: ctx.money, signedPercent, showGrid: true, showArea: true }, `portfolio|${portfolioCurrency}|${range}`)
    : `<div class="chart-empty">${backfill ? '正在加载持仓行情…' : hasPositions ? '收到持仓报价后开始记录走势。' : '添加持仓后查看组合走势。'}</div>`;
  const chartSection = privateValues
    ? '<div class="hero-chart-heading"><h2>组合走势</h2></div><p class="private-panel">组合走势已隐藏</p>'
    : `<div class="hero-chart-heading"><h2>组合走势</h2>${hasPositions ? `<div class="range-control" aria-label="组合走势区间">${['1D', '1W', '1M', '3M', '1Y', 'ALL'].map((item) => `<button data-action="range" data-range="${item}" aria-pressed="${item === range}">${item}</button>`).join('')}</div>` : ''}</div>
      <div class="portfolio-trend"><div class="portfolio-plot" data-overview-region="plot">${graph}</div>
        <div class="trend-meta" data-overview-region="plot-note"><span>${esc(trend.rows.length ? trend.source + (backfill ? ' · 正在补载历史' : '') : '')}</span>${hasPositions ? '<button type="button" class="link-button" data-action="reload-chart">更新</button>' : ''}</div>
      </div>`;
  const pnlClass = privateValues ? '' : tone(summary.pnl);
  const headlinePnl = privateValues ? '••••' : starter ? '—' : `${signedAmount(summary.pnl)} <span>(${signedPercent(summary.pnlPercent)})</span>`;
  const allocationDetails = privateValues
    ? '<p class="private-panel">持仓与现金比例已隐藏</p>'
    : `<div class="allocation-body">
        <div class="allocation-headline"><strong>${percent(summary.total ? 100 - summary.cashPercent : 0, 1)}</strong><span>已投资</span></div>
        <div class="allocation-spectrum" aria-hidden="true">${allocation.map((item, i) => `<span style="--segment-weight:${item.weight}%;--swatch:${colors[i]}"></span>`).join('')}</div>
      </div>${allocation.length ? `<ul class="allocation-legend">${allocation.map((item, i) => `<li><i style="--swatch:${colors[i]}"></i><span><strong>${esc(item.label)}</strong>${names.has(item.symbol) && names.get(item.symbol) !== item.symbol ? `<small>${esc(names.get(item.symbol))}</small>` : ''}</span><b>${percent(item.weight, 1)}</b></li>`).join('')}</ul>` : ''}`;
  const holdings = summary.rows.slice(0, 4).map((item) => `<tr>
    <th scope="row">${assetLink(item)}</th><td class="holding-detail">${privateValues ? '••••' : number(item.shares)}</td>
    <td class="holding-detail">${amount(item.cost)}</td><td>${amount(item.value)}</td>
    <td class="${privateValues ? '' : tone(item.pnl)}">${item.pnl === null && !privateValues ? '—' : signedAmount(item.pnl)}</td>
  </tr>`).join('');
  const watch = ctx.watchQuotes.slice(0, 4).map((item) => `<li>${assetLink(item)}
    <span class="watch-spark-wrap">${spark(item)}</span>
    <span class="watch-values"><strong>${money(item.price, item.currency)}</strong><small class="${tone(item.change)}">${signedPercent(item.change)}</small></span></li>`).join('');
  const focus = overviewFocus(portfolio, summary);
  return `<div class="overview-intro"><h1>资产总览</h1><div class="action-row overview-actions" aria-label="资产总览操作">
      <button class="button quiet overview-history" data-action="import-history">${icons('import', 15)} 导入行情</button>
      <button class="button" data-action="add-watch">${icons('plus', 16)} 添加自选</button>
      <button class="button primary" data-action="add-holding">${icons('plus', 16)} 新增持仓</button>
    </div></div>
    <div class="overview-grid portfolio-lead">
      <section class="portfolio-hero" aria-label="组合总资产">
        <header class="portfolio-heading">
          <p class="hero-label">总资产 <span>${portfolioCurrency}</span></p>
          <strong class="hero-value"${privateValues ? ' aria-label="资产已隐藏"' : ` data-total="${summary.total}"`}>${amount(summary.total)}</strong>
          <p class="hero-pnl"><strong class="${pnlClass}">${headlinePnl}</strong><span>浮动盈亏</span></p>
          <div data-overview-region="valuation">${summary.incomplete ? '<p class="hero-caption">部分持仓待估值</p>' : ''}</div>
        </header>
        ${starter ? `<div class="hero-start"><p>添加持仓或现金，开始跟踪组合。</p><button type="button" class="link-button" data-action="set-cash">设置可用现金 ${icons('arrow', 14)}</button></div>` : chartSection}
      </section>
      <aside class="overview-side" aria-label="组合构成">
        <section class="metrics" data-overview-region="metrics" aria-label="资产指标">
          <div class="metric"><p class="metric-label">持仓市值</p><strong class="metric-value">${amount(summary.invested)}</strong><small class="metric-note">${new Set(portfolio.holdings.map((item) => item.symbol)).size} 个持仓标的</small></div>
          <div class="metric"><p class="metric-label">可用现金</p><strong class="metric-value">${amount(summary.cash)}</strong><small class="metric-note">${privateValues ? '资产占比已隐藏' : `${percent(summary.cashPercent, 1)} 资产占比`}</small></div>
        </section>
        <section class="allocation-panel">
          <header class="overview-panel-head"><h2>资产配置</h2><a class="link-button" href="#risk">查看风险 ${icons('arrow', 14)}</a></header>
          <div data-overview-region="allocation">${allocationDetails}</div>
        </section>
      </aside>
    </div>
    <div class="overview-focus-region" data-overview-region="investment-focus">${focus}</div>
    <div class="overview-grid overview-ledger">
      <section class="overview-holdings">
        <header class="overview-panel-head"><h2>持仓表现</h2><a class="link-button" href="#holdings">全部持仓 ${icons('arrow', 14)}</a></header>
        ${holdings ? `<div class="table-wrap"><table class="hold-table"><thead><tr><th scope="col">标的</th><th class="holding-detail" scope="col">数量</th><th class="holding-detail" scope="col">成本价</th><th scope="col">市值</th><th scope="col">浮动盈亏</th></tr></thead><tbody data-overview-region="holdings">${holdings}</tbody></table></div>` : '<p class="empty-row">添加持仓以查看表现。</p>'}
      </section>
      <section class="overview-watch">
        <header class="overview-panel-head"><h2>自选行情 <small>${ctx.watchQuotes.length}</small></h2><a class="link-button" href="#market">全部自选 ${icons('arrow', 14)}</a></header>
        ${watch ? `<ul class="watch-overview" data-overview-region="watch">${watch}</ul>` : '<p class="empty-row">添加股票以建立关注列表。</p>'}
      </section>
    </div>
    ${portfolio.demo ? '<p class="overview-note">当前工作区含历史演示资产。</p>' : ''}`;
}

function navItem(key) {
  const [label, icon] = pages[key];
  return `<a class="nav-item" href="#${key}" title="${label}"${key === page ? ' aria-current="page"' : ''}>${icons(icon, 17)}<span>${label}</span></a>`;
}

function renderShell() {
  const currency = ['overview', 'holdings', 'risk'].includes(page);
  const nav = Object.keys(pages).map(navItem).join('');
  root.innerHTML = `<div class="shell"${desktopWorkspace() ? ' data-desktop-workspace' : ''} data-menu="${menu ? 'open' : 'closed'}" data-market-palette="${state.pricePalette === 'cn' ? 'cn' : 'us'}">
    <aside class="sidebar" id="mobile-drawer" aria-label="工作空间菜单">
      <div class="drawer-head"><a class="brand" href="#overview" aria-label="MONO 首页"><span>MONO</span><i aria-hidden="true"></i><img class="workspace-monogram" src="mono-icon.svg" alt="" width="32" height="32"></a><button class="icon-button" data-action="close-menu" aria-label="关闭导航">${icons('close', 19)}</button></div>
      <nav aria-label="主导航">${nav}</nav>
      <div class="sidebar-bottom"><button class="nav-item" data-action="settings" title="数据与设置" aria-label="数据与设置">${icons('settings', 17)}<span>数据与设置</span></button><span class="version">MONO 3.3.3</span></div>
    </aside>
    <header class="topbar"><div class="topbar-content">
      <div class="topbar-brand">
        <button class="icon-button mobile-toggle" data-action="toggle-menu" aria-label="导航菜单" aria-controls="mobile-drawer" aria-expanded="${menu}">${icons('menu', 19)}</button>
        <a class="brand" href="#overview" aria-label="MONO 资产总览">MONO<i aria-hidden="true"></i></a>
      </div>
      <nav class="desktop-nav" aria-label="主导航">${nav}</nav>
      <div class="topbar-right">
        <button class="feed-chip" data-action="market-feed" data-status="${feedStatus}" aria-label="行情连接"><i></i><span>${marketLabel()}</span></button>
        ${currency ? `<button class="currency-toggle" data-action="toggle-currency" aria-label="切换人民币和美元组合" title="切换人民币和美元组合">${portfolioCurrency}</button>` : ''}
        <button class="icon-button privacy-toggle" data-action="toggle-privacy" aria-pressed="${!!state.privateAmounts}" aria-label="${state.privateAmounts ? '显示资产金额' : '隐藏资产金额'}" title="${state.privateAmounts ? '显示资产金额' : '隐藏资产金额'}">${icons(state.privateAmounts ? 'eye-off' : 'watch', 19)}</button>
        <button class="icon-button desktop-settings" data-action="settings" aria-label="数据与设置" title="数据与设置">${icons('settings', 18)}</button>
      </div>
    </div></header>
    <button class="mobile-shade" data-action="close-menu" aria-label="关闭导航" tabindex="-1"></button>
    <main class="main-content" id="main-content" data-page="${page}"></main>
    <nav class="mobile-tabs" aria-label="快捷导航">${[['overview', '总览'], ['market', '行情'], ['research', '研究'], ['trades', '交易'], ['risk', '风险']].map(([key, label]) => {
      const current = key === page ? 'page' : groupFor(page)?.[0][0] === key ? 'true' : '';
      return `<a href="#${key}"${current ? ' aria-current="' + current + '"' : ''}>${icons(pages[key][1], 19)}<span>${label}</span></a>`;
    }).join('')}</nav>
  </div>`;
  updateFeedChip();
  renderContent();
}

function renderContent() {
  ensurePageHistory();
  const ctx = buildContext();
  const content = root.querySelector('#main-content');
  content.toggleAttribute('data-empty-portfolio', page === 'overview' && !ctx.portfolio.holdings.length && ctx.portfolio.cash === 0);
  content.toggleAttribute('data-empty-watchlist', page === 'overview' && !state.watchlist.length);
  content.innerHTML = renderMobileGroup() + (page === 'overview' ? overview(ctx) : renderWorkspace(page, ctx));
  if (page === 'opportunities' && !opportunityScan) queueMicrotask(() => {
    if (page === 'opportunities' && !opportunityScan) void scanOpportunities();
  });
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function refreshOverview() {
  const active = document.activeElement;
  const updated = document.createElement('template');
  updated.innerHTML = overview(buildContext());
  const previousTotal = root.querySelector('.hero-value[data-total]');
  const nextTotal = updated.content.querySelector('.hero-value[data-total]');
  if (previousTotal && nextTotal && previousTotal.dataset.total !== nextTotal.dataset.total) {
    previousTotal.dataset.total = nextTotal.dataset.total;
    if (previousTotal.textContent !== nextTotal.textContent) {
      previousTotal.textContent = nextTotal.textContent;
      if (!reducedMotion.matches) {
        previousTotal.getAnimations().forEach((animation) => animation.cancel());
        previousTotal.animate([{ opacity: 0.8 }, { opacity: 1 }], { duration: 130, easing: 'ease-out' });
      }
    }
  }
  for (const region of root.querySelectorAll('.hero-pnl, [data-overview-region]')) {
    const name = region.dataset.overviewRegion;
    if (name === 'plot' && chartNavigation.busy()) {
      trendRefreshPending = true;
      continue;
    }
    const selector = name ? '[data-overview-region="' + name + '"]' : '.hero-pnl';
    const next = updated.content.querySelector(selector);
    if (next && region.innerHTML !== next.innerHTML) {
      if (name === 'plot' && region.contains(active)) continue;
      region.replaceChildren(...next.childNodes);
    }
  }
  if (active && !active.isConnected) restoreFocus(active);
}

function replaceResult(target, html) {
  if (!target || html === target.innerHTML) return;
  const sections = [...target.querySelectorAll('details')];
  const sectionName = (details) => details.querySelector('summary')?.textContent.split(' · ')[0];
  const expanded = new Map(sections.map((details) => [sectionName(details), details.open]));
  target.innerHTML = html;
  for (const details of target.querySelectorAll('details')) {
    const key = sectionName(details);
    if (expanded.has(key)) details.open = expanded.get(key);
  }
}

function updateResults() {
  const renderers = { trades: ['#trade-results', renderTradeResult], research: ['#research-results', renderResearchResult],
    risk: ['#risk-results', renderRiskResult], quant: ['#quant-results', renderQuantResult],
    opportunities: ['#opportunities-results', renderOpportunities], market: ['#market-pulse', renderMarketPulse] };
  const view = renderers[page];
  if (view) {
    const target = root.querySelector(view[0]);
    if (target) {
      const context = buildContext();
      const active = document.activeElement;
      replaceResult(target, view[1](context));
      if (page === 'risk') replaceResult(root.querySelector('#risk-kpis'), renderRiskKpis(context));
      if (active && !active.isConnected) restoreFocus(active);
    }
  }
}

function navigate(next) {
  if (location.hash !== `#${next}`) location.hash = next;
  else {
    menu = false;
    renderShell();
  }
}

window.addEventListener('hashchange', () => {
  page = getPage();
  publicFeed.setPriority(['market', 'opportunities'].includes(page));
  publicFeed.setSymbols(publicTickers());
  menu = false;
  renderShell();
  window.scrollTo(0, 0);
  if (!reducedMotion.matches) root.querySelector('.main-content').animate?.([{ opacity: 0.78, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 145, easing: 'ease-out' });
});

function setMenu(open) {
  menu = open;
  root.querySelector('.shell').dataset.menu = open ? 'open' : 'closed';
  root.querySelector('.mobile-toggle').setAttribute('aria-expanded', String(open));
  for (const region of root.querySelectorAll('.topbar, .main-content, .mobile-tabs')) region.inert = open;
  if (open) root.querySelector('.sidebar a').focus();
  else root.querySelector('.mobile-toggle').focus();
}

function announce(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3700);
}

function persist(message) {
  const saved = saveState(undefined, state);
  queueStrategyReview();
  updateFeedChip();
  if (!saved) announce('当前浏览器无法保存本地数据。本次修改在当前会话仍可用。');
  else if (message) announce(message);
  return saved;
}

function field(name, label, value = '', options = '') {
  return `<label class="form-field${name === 'file' || name === 'url' ? ' full' : ''}" for="field-${name}"><span>${label}</span><input id="field-${name}" name="${name}" value="${esc(value)}" ${options}></label>`;
}

function openDialog(title, fields, apply, { description = '', submit = '保存', extra = '' } = {}) {
  dialog.className = '';
  chartExpanded = false;
  reopenExpandedChart = false;
  dialogSubmit = apply;
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭">${icons('close', 17)}</button></div><form id="dialog-form" class="dialog-content">${description ? `<p>${description}</p>` : ''}<div class="form-grid">${fields}</div><p class="form-error" role="alert" hidden></p><div class="dialog-actions">${extra}<button type="button" class="button" data-action="close-dialog">取消</button>${apply ? `<button type="submit" class="button primary">${submit}</button>` : ''}</div></form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input, select, .dialog-actions button')?.focus();
}

function saveChartPreferences() {
  state.chartPrefs = { ...chartPrefs, period: chartPeriod };
  persist();
}

function selectChartPeriod(period) {
  if (!periods.has(period)) return;
  chartPeriod = period;
  saveChartPreferences();
  ensurePageHistory();
  refreshTrend();
}

function reloadCharts() {
  ensurePageHistory(true);
  void publicFeed.refresh();
  refreshTrend();
}

function showChartPeriods() {
  const fromExpanded = chartExpanded;
  const items = [...periods].map(([key, label]) => `<button type="button" class="trend-option" data-action="chart-period" data-period="${key}" aria-pressed="${chartPeriod === key}">${label}</button>`).join('');
  openDialog('时间周期', `<div class="trend-sheet-grid form-field full">${items}</div>`, null);
  reopenExpandedChart = fromExpanded;
  dialog.classList.add('chart-sheet');
  dialog.querySelector('[aria-pressed="true"]')?.focus();
}

function showChartSettings() {
  const fromExpanded = chartExpanded;
  const radio = (name, options, current) => `<div class="trend-choice">${options.map(([key, label]) => `<label><input type="radio" name="${name}" value="${key}"${key === current ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
  const show = [['cost', '成本价'], ['ma20', 'MA20'], ['ma50', 'MA50'], ['volume', '成交量'], ['area', '面积填充']];
  const filters = show.map(([key, label]) => `<label><input type="checkbox" name="${key}"${chartPrefs[key] ? ' checked' : ''}><span>${label}</span></label>`).join('');
  const fields = `<div class="form-field full trend-preferences"><fieldset><legend>图表类型</legend>${radio('type', [['line', '折线图'], ['candle', '蜡烛图']], chartPrefs.type)}</fieldset><fieldset><legend>价格坐标</legend>${radio('scale', [['price', '价格'], ['percent', '百分比'], ['log', '对数']], chartPrefs.scale)}</fieldset><fieldset><legend>显示图层</legend><div class="trend-choice">${filters}</div></fieldset></div>`;
  openDialog('图表设置', fields, (data) => {
    chartPrefs = { type: data.type === 'candle' ? 'candle' : 'line', scale: ['price', 'percent', 'log'].includes(data.scale) ? data.scale : 'price',
      ...Object.fromEntries(show.map(([key]) => [key, Boolean(data[key])])) };
    saveChartPreferences();
  }, { description: '蜡烛和成交量需要对应的历史数据。均线按当前图表周期计算。', submit: '应用' });
  reopenExpandedChart = fromExpanded;
  dialog.classList.add('chart-sheet');
}

function updateExpandedChart() {
  const expanded = dialog.querySelector('.expanded-chart-body');
  if (expanded) expanded.innerHTML = renderInstrumentTrend(buildContext(), true);
}

function showExpandedChart() {
  const title = `${esc(symbol || '标的')} 价格走势`;
  openDialog(title, '<div class="expanded-chart-body form-field full"></div>', null);
  chartExpanded = true;
  dialog.classList.add('chart-expanded');
  updateExpandedChart();
}

function tickerValue(value) {
  const ticker = normalizeTicker(value);
  if (!ticker) throw new Error('请输入有效的股票代码，例如 600519.SH 或 AAPL。');
  return ticker;
}

function numeric(value, label, { optional = false, positive = false } = {}) {
  if (!String(value ?? '').trim() && optional) return null;
  const result = Number(value);
  if (!String(value ?? '').trim() || !Number.isFinite(result) || result < 0 || (positive && result === 0)) throw new Error(`请填写有效的${label}。`);
  return result;
}

function updateSymbols() {
  const options = tickers();
  if (symbol && !options.includes(symbol) && !state.histories[symbol]) symbol = state.watchlist[0]?.symbol ?? state.holdings[0]?.symbol ?? '';
  if (!symbol) symbol = state.watchlist[0]?.symbol ?? state.holdings[0]?.symbol ?? '';
  if (!options.includes(tradeInputs.symbol)) tradeInputs = initialTrade(options[0] ?? '');
  for (const ticker of Object.keys(state.liveQuotes)) if (!options.includes(ticker)) delete state.liveQuotes[ticker];
  for (const ticker of Object.keys(state.publicQuotes)) if (!options.includes(ticker)) delete state.publicQuotes[ticker];
  publicFeed.setSymbols(publicTickers());
  if (alpacaConfig) alpacaFeed.setSymbols(feedTickers());
  else feed.setSymbols(options);
}

function editHolding(id) {
  const existing = state.holdings.find((item) => item.id === id);
  const privateEntry = state.privateAmounts && existing;
  const numberInput = privateEntry ? 'type="password" inputmode="decimal" autocomplete="off"' : 'type="number" step="any" min="0"';
  openDialog(existing ? '编辑持仓' : '新增持仓', [
    field('symbol', '股票代码', existing?.symbol, 'required maxlength="24" placeholder="如 600519.SH 或 AAPL"'),
    field('name', '标的名称', existing?.name, 'maxlength="80" placeholder="选填"'),
    field('shares', '持仓数量（支持碎股）', existing?.shares, `required ${numberInput} placeholder="如 2.5"`),
    field('cost', '每股成本', existing?.cost, `required ${numberInput}`),
    field('price', '参考价格', existing?.price, `${numberInput} placeholder="选填"`),
  ].join(''), (data) => {
    const ticker = tickerValue(data.symbol);
    const shares = numeric(data.shares, '持仓数量', { positive: true });
    const cost = numeric(data.cost, '每股成本');
    const price = numeric(data.price, '参考价格', { optional: true, positive: true });
    const name = data.name.trim() || state.watchlist.find((item) => item.symbol === ticker)?.name || ticker;
    const holding = { id: existing?.id ?? newRecordId(), symbol: ticker, name, shares, cost, price };
    if (price !== null && price === existing?.price && ticker === existing?.symbol) {
      holding.source = existing.source;
      holding.date = existing.date;
    } else if (price !== null) {
      holding.source = 'manual';
      holding.date = new Date().toISOString();
    }
    state.holdings = existing ? state.holdings.map((item) => item.id === id ? holding : item) : [...state.holdings, holding];
    if (['overview', 'holdings'].includes(page)) setPortfolioCurrency(instrumentCurrency(ticker));
    updateSymbols();
    persist(existing ? '持仓已更新' : `已添加 ${ticker} 持仓`);
  }, { description: 'A 股以人民币录入，美股以美元录入。参考价格留空时，可使用行情或导入数据估值。', submit: existing ? '保存修改' : '添加持仓' });
}

function setCash() {
  const key = cashField(portfolioCurrency);
  const inputOptions = state.privateAmounts ? 'type="password" inputmode="decimal" autocomplete="off"' : 'type="number" step="0.01" min="0"';
  openDialog('设置可用现金', field('cash', `现金余额（${portfolioCurrency}）`, state[key] ?? 0, `required ${inputOptions}`), (data) => {
    state[key] = numeric(data.cash, '现金余额');
    persist('现金余额已更新');
  });
}

function setPortfolioCurrency(currencyCode) {
  portfolioCurrency = currencyCode;
  state.portfolioCurrency = currencyCode;
  const button = root.querySelector('.currency-toggle');
  if (button) button.textContent = currencyCode;
}

function selectInstrument(ticker) {
  if (ticker !== symbol) {
    researchTab = 'overview';
    if (page === 'quant') externalRequest?.abort();
  }
  symbol = ticker;
  if (discoveredSymbol && discoveredSymbol !== ticker) discoveredSymbol = '';
  if (page === 'market') publicFeed.setSymbols(publicTickers());
  if (marketFilter !== 'all' && marketFilter !== instrumentMarket(ticker)) marketFilter = 'all';
  if (alpacaConfig) alpacaFeed.setSymbols(feedTickers());
}

function addWatch() {
  openDialog('添加自选', field('symbol', '股票代码', '', 'required maxlength="24" placeholder="如 600519 或 AAPL"') + field('name', '标的名称', '', 'maxlength="80" placeholder="选填"'), (data) => {
    const ticker = tickerValue(data.symbol);
    if (state.watchlist.some((item) => item.symbol === ticker)) throw new Error('该股票已在自选列表。');
    const name = data.name.trim() || state.holdings.find((item) => item.symbol === ticker)?.name || ticker;
    state.watchlist.push({ symbol: ticker, name });
    selectInstrument(ticker);
    updateSymbols();
    persist(`已关注 ${ticker}`);
  }, { submit: '添加自选' });
}

function importHistory() {
  openDialog('导入历史行情', field('symbol', '股票代码', page === 'market' ? symbol : '', 'required maxlength="24" placeholder="如 000001.SZ 或 AAPL"') + field('file', 'CSV 文件', '', 'required type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"'), async (data, form) => {
    const ticker = tickerValue(data.symbol);
    const file = form.elements.file.files[0];
    if (!file?.size) throw new Error('请选择非空 CSV 文件。');
    if (file.size > 10 * 1024 * 1024) throw new Error('请选择 10 MB 以内的文件。');
    const rows = parseHistory(await file.text());
    const merged = new Map((state.histories[ticker] ?? []).map((item) => [item.date, item]));
    for (const item of rows) merged.set(item.date, item);
    state.histories[ticker] = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!tickers().includes(ticker)) state.watchlist.push({ symbol: ticker, name: ticker });
    selectInstrument(ticker);
    updateSymbols();
    persist(`已导入 ${ticker} 的 ${rows.length} 条日线`);
    navigate('market');
  }, { description: '文件需包含 Date 和 Close，可同时提供 Open、High、Low、Volume。蜡烛图与历史验证使用完整、同口径的 OHLC。同日以本次导入为准。', submit: '导入行情' });
}

function editAlpaca() {
  const saved = alpacaConfig;
  const hasVault = typeof globalThis.MonoNative?.saveAlpaca === 'function';
  const feeds = `<label class="form-field full" for="field-feed"><span>美股数据源</span><select id="field-feed" name="feed"><option value="iex"${saved?.feed !== 'sip' ? ' selected' : ''}>IEX · 实时单交易所</option><option value="sip"${saved?.feed === 'sip' ? ' selected' : ''}>SIP · 实时综合行情，需数据权限</option></select></label>`;
  const inputOptions = 'spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="256"';
  const extra = '<button type="button" class="button" data-action="market-feed">行情来源</button>';
  openDialog('连接实时报价', field('key', 'Alpaca API Key ID', '', `${inputOptions} ${saved ? 'placeholder="留空沿用已存密钥"' : 'required'}`) +
    field('secret', 'Alpaca Secret Key', '', `${inputOptions} type="password" ${saved ? 'placeholder="留空沿用已存密钥"' : 'required'}`) + feeds,
  async (data) => {
    const key = data.key.trim(), secret = data.secret.trim();
    if ((key && !secret) || (secret && !key)) throw new Error('更换凭据时请同时填写 Key ID 和 Secret Key。');
    const config = validateAlpaca({ key: key || saved?.key, secret: secret || saved?.secret, feed: data.feed });
    if (!config) throw new Error('请填写 Alpaca API Key ID 和 Secret Key。');
    if (hasVault && !(await globalThis.MonoNative.saveAlpaca(JSON.stringify(config)))) throw new Error('当前设备无法加密保存行情凭据。');
    alpacaConfig = config;
    state.liveQuotes = {};
    liveExtendedQuotes.clear();
    activateFeed();
    announce('正在连接 Alpaca 行情');
  }, {
    description: `IEX 支持最多 30 个标的，优先当前标的和持仓。${hasVault ? 'Alpaca 凭据由系统加密保存在本机。' : 'Alpaca 凭据仅在当前会话有效。'}`,
    submit: '连接 Alpaca', extra,
  });
}

function marketFeedSettings() {
  const active = alpacaConfig ? `Alpaca ${alpacaConfig.feed.toUpperCase()}` : feedConfig ? '自定义网关' : '腾讯财经公开行情';
  const fields = `<div class="feed-settings form-field full"><strong>当前优先来源</strong><span>${active}</span><small>沪深和美股常规报价来自腾讯财经。新浪财经提供美股公开盘前或盘后快照，按来源时间显示。支持夜盘的自定义网关可单独提供夜盘价。</small></div>`;
  const extra = `<button type="button" class="button" data-action="refresh-public">刷新免费行情</button><button type="button" class="button" data-action="alpaca-feed">Alpaca 美股</button><button type="button" class="button" data-action="custom-feed">自定义网关</button>${alpacaConfig || feedConfig ? '<button type="button" class="button" data-action="disconnect-feed">恢复默认来源</button>' : ''}`;
  openDialog('行情来源', fields, null, { extra });
}

async function clearStoredAlpaca() {
  const vault = globalThis.MonoNative;
  if (!alpacaConfig || typeof vault?.clearAlpaca !== 'function') return true;
  try { return Boolean(await vault.clearAlpaca()); } catch { return false; }
}

async function disconnectFeed() {
  if (!(await clearStoredAlpaca())) {
    announce('无法清除已存凭据，请重试。');
    return;
  }
  alpacaConfig = null;
  feedConfig = null;
  state.feed = null;
  state.liveQuotes = {};
  liveExtendedQuotes.clear();
  activateFeed();
  persist('已恢复默认免费行情');
  dialog.close();
  renderContent();
}

function editFeed() {
  openDialog('行情连接', `${field('url', '行情网关地址', feedConfig?.url, 'type="url" placeholder="wss://行情网关 或 https://行情网关"')}${field('interval', 'HTTPS 轮询间隔（秒）', feedConfig?.interval ?? 5, 'type="number" min="1" max="60" step="any"')}` + `<details class="form-field full"><summary>查看网关格式</summary><div>WebSocket 连接后发送订阅消息，HTTPS 使用 symbols 查询参数。报价时间应包含时区。美股延长时段使用 session 字段，值为 pre、post 或 overnight。提供对应常规收盘价 referenceClose 后才计算延长时段涨跌幅。</div><pre>${esc(JSON.stringify({ type: 'subscribe', symbols: ['AAPL'] }))}\n${esc(JSON.stringify({ quotes: [{ symbol: 'AAPL', price: 123.45, change: 0.42, timestamp: '2026-11-24T14:30:00Z' }] }))}</pre></details>`, async (data) => {
    const next = validateFeed(data);
    if (!(await clearStoredAlpaca())) throw new Error('无法清除 Alpaca 凭据，请重试。');
    alpacaConfig = null;
    feedConfig = next;
    state.feed = feedConfig;
    state.liveQuotes = {};
    liveExtendedQuotes.clear();
    activateFeed();
    persist(feedConfig ? '行情网关设置已保存' : '已恢复默认免费行情');
  }, { description: 'WSS 支持推送，HTTPS 支持 1–60 秒轮询。网关无报价时，使用可用的免费行情。清空地址可恢复默认来源。', submit: '应用连接', extra: '<button type="button" class="button" data-action="market-feed">行情来源</button>' });
}

function settings() {
  const palette = `<label class="form-field full" for="field-palette"><span>涨跌配色</span><select id="field-palette" name="palette"><option value="us"${state.pricePalette !== 'cn' ? ' selected' : ''}>美股习惯 · 绿涨红跌</option><option value="cn"${state.pricePalette === 'cn' ? ' selected' : ''}>A 股习惯 · 红涨绿跌</option></select></label>`;
  openDialog('数据与设置', palette, (data) => {
    state.pricePalette = data.palette === 'cn' ? 'cn' : 'us';
    root.querySelector('.shell').dataset.marketPalette = state.pricePalette;
    persist('显示设置已保存');
  }, { description: state.demo ? '当前工作区含预置的演示持仓与报价。可保留已录入的数据，只移除预置示例。' : '持仓、自选、研究记录和交易计划均保存在本机。', extra: `<button type="button" class="button" data-action="set-cash">设置现金</button><button type="button" class="button" data-action="market-feed">行情连接</button>${state.demo ? '<button type="button" class="button" data-action="clear-demo">移除演示数据</button>' : ''}` });
}

function setOverviewFocus(open) {
  const steps = overviewSteps();
  if (!steps.length) return;
  const ids = steps.map(({ id }) => id);
  state.overviewDismissals = open ? state.overviewDismissals.filter((id) => id !== ids[0])
    : [...new Set([...state.overviewDismissals, ...ids])].slice(-160);
  persist();
  refreshOverview();
  root.querySelector(open ? '#overview-focus-heading' : '[data-action="show-overview-focus"]')?.focus({ preventScroll: true });
}

function openOverviewStep(id) {
  const next = overviewSteps().find((item) => item.id === id);
  if (!next) {
    refreshOverview();
    return;
  }
  if (next.kind === 'cash') return setCash();
  if (next.kind === 'reduction') {
    riskSimulation[portfolioCurrency] = { symbol: next.symbol, targetWeight: next.targetWeight };
    riskTab = 'simulation';
    navigate('risk');
  } else if (next.kind === 'research') {
    selectInstrument(next.symbol);
    discoveredSymbol = next.symbol;
    const horizon = ['short', 'mid', 'long'].includes(next.horizon) ? next.horizon : state.research[next.symbol]?.horizon ?? 'mid';
    state.research[next.symbol] = { ...state.research[next.symbol], horizon };
    researchTab = 'tracking';
    persist();
    navigate('research');
  }
}

function clearDemo() {
  openDialog('移除演示数据', '', () => {
    const original = seedState();
    state.holdings = state.holdings.filter((item) => {
      const example = original.holdings.find(({ id }) => id === item.id);
      if (item.source !== 'demo') return true;
      if (!example || ['symbol', 'name', 'shares', 'cost', 'price'].some((key) => item[key] !== example[key])) {
        item.source = 'demo-removed';
        item.price = null;
        return true;
      }
      return false;
    });
    state.watchlist = state.watchlist.filter((item) => item.source !== 'demo' || state.histories[item.symbol]?.length).map((item) => item.source === 'demo' ? { symbol: item.symbol, name: item.name } : item);
    if (state.cash === original.cash) state.cash = 0;
    state.demo = false;
    updateSymbols();
    persist('演示数据已移除');
  }, { description: '移除预置示例持仓与报价，以及仍为预置金额的现金余额。', submit: '移除演示数据' });
}

function deleteRecord(kind, key) {
  const list = { holding: 'holdings', watch: 'watchlist', trade: 'trades' }[kind];
  const fieldName = kind === 'watch' ? 'symbol' : 'id';
  const target = state[list].find((item) => item[fieldName] === key);
  if (!target) return;
  const label = { holding: '持仓', watch: '自选', trade: '交易计划' }[kind];
  openDialog(`删除${label}`, '', () => {
    state[list] = state[list].filter((item) => item[fieldName] !== key);
    updateSymbols();
    persist(`${label}已删除`);
  }, { description: `确定删除 ${esc(target.symbol)} 的${label}？`, submit: '确认删除' });
}

function saveTrade() {
  const ctx = buildContext();
  const { trade } = ctx;
  if (!tradeInputs.symbol || !trade.valid || trade.shares <= 0) {
    announce(!tradeInputs.symbol ? '请先添加或选择交易标的。' : trade.error ?? '当前预算无法建立仓位。');
    return;
  }
  const { entry, target, stop, amount, riskPercent, fractional } = tradeInputs;
  state.trades.unshift({ id: newRecordId(), symbol: tradeInputs.symbol,
    entry: Number(entry), target: Number(target), stop: Number(stop), amount: amount === '' ? null : Number(amount),
    riskPercent: Number(riskPercent), fractional, shares: trade.shares, investment: trade.investment,
    ratio: trade.ratio, risk: trade.risk, reward: trade.reward, createdAt: new Date().toISOString() });
  persist('交易计划已保存');
  renderContent();
}

function useStrategy() {
  const { strategy } = buildContext();
  if (!strategy?.symbol || !strategy.canTransfer) { announce('暂无可带入的完整计划，请核对行情及价位。'); return; }
  const inputs = state.research[strategy.symbol] ?? {};
  tradeInputs = { ...initialTrade(strategy.symbol), entry: strategy.entry, target: strategy.target, stop: strategy.stop,
    amount: inputs.amount ?? '', riskPercent: inputs.riskPercent ?? 1 };
  navigate('trades');
}

function editRiskProfile() {
  const current = state.riskProfile ?? {};
  openDialog('组合风险参数', field('cap', '单一标的上限（%）', current.cap ?? 25, 'type="number" min="1" max="100" step="0.1" required') +
    field('reserve', '目标现金储备（%）', current.maxCashTarget ?? 20, 'type="number" min="0" max="100" step="0.1" required'), (values) => {
    const cap = Number(values.cap);
    const maxCashTarget = Number(values.reserve);
    if (![cap, maxCashTarget].every(Number.isFinite) || cap < 1 || cap > 100 || maxCashTarget < 0 || maxCashTarget > 100) throw new Error('检查比例，范围为 0–100%。');
    state.riskProfile = { cap, maxCashTarget };
    persist('风险参数已保存');
  }, { description: '仓位上限和现金目标用于同币种组合的测算。' });
}

function setRiskShock(value) {
  if (!Number.isFinite(value) || value < -100 || value > 100) return;
  shock = value;
  const slider = root.querySelector('#risk-shock');
  if (slider) {
    slider.value = shock;
    slider.style.setProperty('--risk-progress', `${(shock + 100) / 2}%`);
    root.querySelector('#risk-shock-value').textContent = signedPercent(shock);
    for (const preset of root.querySelectorAll('[data-action="risk-shock-preset"]')) preset.setAttribute('aria-pressed', String(Number(preset.dataset.shock) === shock));
  }
  updateResults();
}

function applyRiskForm(form) {
  const values = Object.fromEntries(new FormData(form));
  const ticker = normalizeTicker(values.symbol);
  if (ticker && !scopedPortfolio(portfolioCurrency).holdings.some((item) => item.symbol === ticker)) return;
  if (form.id === 'risk-scenario-form') {
    if (ticker) riskScenario[portfolioCurrency] = { symbol: ticker, shock: Number(values.holdingShock) };
    else delete riskScenario[portfolioCurrency];
    setRiskShock(Number(values.marketShock));
  } else if (ticker) {
    riskSimulation[portfolioCurrency] = { symbol: ticker, targetWeight: Number(values.targetWeight) };
    updateResults();
  }
}

function configureResearch() {
  openDialog('研究数据来源', field('url', '研究数据网关（HTTPS）', researchEndpoint ?? '', 'type="url" maxlength="300" placeholder="https://你的服务/mono/research"'), (values) => {
    researchEndpoint = validateResearchEndpoint(values.url);
    state.researchEndpoint = researchEndpoint;
    state.researchEvidence = {};
    researchRequests.clear();
    persist('研究数据设置已保存');
    void ensureResearchEvidence(symbol, true);
  }, { description: '默认连接官方公开宏观数据。网关仅接收 symbol，用于接入已授权的财报、宏观、公告和市场数据。网关费用由提供方确定，MONO 不代购数据。' });
}

function importResearchEvidence() {
  if (!symbol) { announce('请先选择研究标的。'); return; }
  const ticker = symbol;
  openDialog('导入研究数据', field('file', '研究 JSON 文件', '', 'type="file" accept=".json,application/json" required'), async (_, form) => {
    const file = form.elements.file.files[0];
    if (!file?.size || file.size > 512_000) throw new Error('请选择小于 500 KB 的 JSON 文件。');
    const packet = normalizeResearchEvidence(ticker, JSON.parse(await file.text()));
    if (!researchSections.some((key) => packet[key].length)) throw new Error('缺少可核验记录。检查来源链接、记录时间和字段。');
    state.importedResearch[ticker] = packet;
    persist('研究记录已导入');
  }, { description: `选择当前 ${esc(ticker)} 的数据文件。导入记录会和自动取得的资料一起显示。`, submit: '导入研究数据' });
}

function resetImportedEvidence() {
  if (!state.importedResearch[symbol]) return;
  delete state.importedResearch[symbol];
  persist('导入快照已移除');
  updateResults();
}

function toggleStrategyTracking() {
  if (!symbol) return;
  const horizon = state.research[symbol]?.horizon ?? 'mid';
  const key = strategyKey(symbol, horizon);
  const tracked = state.strategyJournal[key];
  if (tracked && !tracked.paused) {
    state.strategyJournal[key] = { ...tracked, paused: true };
    persist('已暂停策略跟踪');
  } else {
    if (Object.values(state.strategyJournal).filter((item) => !item.paused).length >= STRATEGY_LIMIT) {
      announce(`最多跟踪 ${STRATEGY_LIMIT} 项，请先暂停一项。`);
      return;
    }
    const strategy = analyzeInstrument(symbol, horizon);
    state.strategyJournal[key] = recordStrategy({ ...tracked, symbol, horizon, paused: false }, strategy);
    updateSymbols();
    persist('已开始跟踪 · 判断变化会保存在本机');
  }
  if (tracked && !tracked.paused) updateSymbols();
  updateResults();
}

function addResearchAlert() {
  if (!symbol) return;
  if (state.researchAlerts.length >= 40) { announce('已保存 40 条提醒，请先删除一条。'); return; }
  const ticker = symbol;
  const horizon = state.research[ticker]?.horizon ?? 'mid';
  const options = Object.entries(alertNames).map(([value, title]) => `<option value="${value}">${title}</option>`).join('');
  const type = `<label class="form-field full" for="field-kind"><span>提醒类型</span><select id="field-kind" name="kind">${options}</select></label>`;
  openDialog(`${esc(ticker)} · 新建提醒`, type +
    field('price', '价格（用于上穿或下穿）', '', 'type="number" min="0" step="any"') +
    field('date', '时间（仅用于事件，使用设备时区）', '', 'type="datetime-local"'), (values) => {
    if (!Object.hasOwn(alertNames, values.kind)) throw new Error('请选择提醒类型。');
    const createdAt = new Date().toISOString();
    const key = strategyKey(ticker, horizon);
    const item = { id: newRecordId(), symbol: ticker, key, type: values.kind, createdAt };
    if (['above', 'below'].includes(item.type)) item.price = numeric(values.price, '触发价格', { positive: true });
    if (item.type === 'event') {
      if (!Number.isFinite(Date.parse(values.date)) || Date.parse(values.date) <= Date.now()) throw new Error('请选择将来的事件时间。');
      item.date = new Date(values.date).toISOString();
    }
    if (item.type === 'invalidate') {
      const stop = analyzeInstrument(ticker, horizon).horizons.find(({ key: period }) => period === horizon)?.stop;
      if (!Number.isFinite(stop)) throw new Error('当前周期暂无行情失效价。手填价位可使用价格提醒。');
      item.price = stop;
    }
    if (item.type === 'opportunity') {
      if (!state.strategyJournal[key] || state.strategyJournal[key].paused) throw new Error('请先跟踪这个周期的策略。');
      item.baseline = analyzeInstrument(ticker, horizon).decision?.status;
      if (item.baseline === 'opportunity') throw new Error('当前已满足机会条件。可改设价格提醒。');
    }
    state.researchAlerts.unshift(item);
    updateSymbols();
    persist('提醒已保存 · 应用打开并取得数据时检查');
  }, { description: '提醒在应用运行期间检查。关闭应用后，由下次打开时继续检查。', submit: '保存提醒' });
}

function removeResearchAlert(id) {
  state.researchAlerts = state.researchAlerts.filter((alert) => alert.id !== id);
  updateSymbols();
  persist('提醒已移除');
  updateResults();
}

function scanCandidates(plan = opportunityPlan) {
  return discoverUniverse(plan.market, { scope: plan.scope, personal: [...state.watchlist, ...state.holdings], symbols: plan.symbols });
}

function stopOpportunityScan() {
  if (!opportunityScan?.running) return;
  opportunityScan.controller.abort();
  opportunityScan.running = false;
  opportunityScan.stage = 'stopped';
  if (page === 'opportunities') updateResults();
}

function chooseOpportunityPlan(mode, changes) {
  stopOpportunityScan();
  opportunityScan = null;
  opportunityMode = mode;
  opportunityPlan = normalizeOpportunityPlan({ ...(mode === 'custom' ? customOpportunityPlan : defaultOpportunityPlan), ...changes });
  if (mode === 'custom') {
    customOpportunityPlan = opportunityPlan;
    state.opportunityPlan = opportunityPlan;
  }
  opportunityView = 'all';
  opportunityVisibleRows = 14;
  state.opportunityMode = mode;
  persist();
  updateResults();
}

function editOpportunityPlan() {
  const plan = customOpportunityPlan ?? opportunityPlan;
  const selector = (key, title, values) => `<label class="form-field" for="field-${key}"><span>${title}</span><select id="field-${key}" name="${key}">${values.map(([id, text]) =>
    `<option value="${id}"${plan[key] === id ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
  const threshold = (key, title, low, high) => field(key, title, plan[key] ?? '', `type="number" inputmode="decimal" step="any" min="${low}" max="${high}" placeholder="不限"`);
  openDialog('自定义筛选计划',
    selector('scope', '扫描范围', [['catalog', '内置市场名单'], ['watch', '自选与持仓'], ['custom', '自定义代码']]) +
    selector('market', '市场', [['all', '全部市场'], ['cn', 'A 股'], ['us', '美股'], ['etf', 'ETF']]) +
    selector('horizon', '研究周期', [['short', '短期'], ['mid', '中期'], ['long', '长期']]) +
    selector('trend', '技术趋势', [['any', '不限'], ['up', '上行'], ['mixed', '分化'], ['down', '下行']]) +
    threshold('minRatio', '最低情景盈亏比', 0, 100) + threshold('minReturn', '最低近 20 日涨跌（%）', -100, 1000) +
    threshold('maxVolatility', '最高年化波动（%）', 0, 1000) + threshold('minVolume', '最低相对成交量（倍）', 0, 100) +
    `<label class="form-field full" for="field-opp-symbols"><span>自定义名单 · 最多 ${maxCustomTickers} 个代码</span>
    <textarea id="field-opp-symbols" name="symbols" rows="3" maxlength="7000" spellcheck="false" placeholder="NVDA, 600519.SH, SPY">${esc(plan.symbols.join(', '))}</textarea></label>`, (values) => {
    customOpportunityPlan = normalizeOpportunityPlan(values, true);
    chooseOpportunityPlan('custom');
    void scanOpportunities();
  }, { description: '留空的数值条件不参与筛选。自定义名单可用逗号、空格或换行分隔。', submit: '保存并运行' });
}

async function scanOpportunities() {
  if (opportunityScan?.running) return;
  const plan = opportunityPlan;
  const candidates = scanCandidates(plan);
  const scan = { running: true, results: [], total: candidates.length, stage: 'prices', reviewed: 0, reviewTotal: 0, controller: new AbortController() };
  opportunityScan = scan;
  opportunityVisibleRows = 14;
  const { signal } = scan.controller;
  const refresh = () => { if (page === 'opportunities' && opportunityScan === scan) updateResults(); };
  refresh();
  let lastRefresh = 0;
  try {
    const quoteRefresh = fetchPublicQuoteSnapshot(candidates.map((item) => item.ticker), signal)
      .then((quotes) => { if (!signal.aborted) updateQuotes(quotes, true); }).catch(() => {});
    let offset = 0;
    const worker = async () => {
      while (offset < candidates.length && !signal.aborted) {
        const candidate = candidates[offset++];
        try {
          await Promise.all([trendStore.load(candidate.ticker, 'day', { temporary: true }), quoteRefresh]);
          if (signal.aborted) break;
          const analysis = analyzeInstrument(candidate.ticker, plan.horizon, candidate.type, true);
          scan.results.push(applyOpportunityPlan(opportunityFor(candidate, analysis), plan));
        } catch {
          if (!signal.aborted) scan.results.push({ ...candidate, status: 'blocked', match: null, action: '资料暂不可用', reason: '这次未取得足够资料，可稍后重试。' });
        }
        if (performance.now() - lastRefresh > 130) { refresh(); lastRefresh = performance.now(); }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (signal.aborted) return;
    const shortlist = scan.results.map((item, index) => ({ item, index })).filter(({ item }) => item.match === true)
      .sort((a, b) => Number(b.item.status === 'opportunity') - Number(a.item.status === 'opportunity') || (b.item.ratio ?? 0) - (a.item.ratio ?? 0)).slice(0, 24);
    scan.reviewTotal = shortlist.length;
    scan.stage = 'review';
    refresh();
    let reviewIndex = 0;
    const review = async () => {
      while (!signal.aborted && reviewIndex < shortlist.length) {
        const { item, index } = shortlist[reviewIndex++];
        try {
          await ensureResearchEvidence(item.ticker);
          if (signal.aborted) break;
          const analysis = analyzeInstrument(item.ticker, plan.horizon, item.type, true);
          scan.results[index] = applyOpportunityPlan(opportunityFor(item, analysis), plan);
        } catch { /* keep the initial scan if supplemental research is temporarily unavailable */ }
        scan.reviewed++;
        refresh();
      }
    };
    await Promise.all(Array.from({ length: 3 }, review));
  } finally {
    scan.running = false;
    if (!signal.aborted) {
      scan.stage = 'complete';
      scan.completedAt = new Date().toISOString();
    }
    refresh();
  }
}

function choosePanel(type, key) {
  const options = { research: ['overview', 'basis', 'evidence', 'tracking'], quant: ['analysis', 'validation', 'external'],
    risk: ['stress', 'simulation', 'diagnosis'] }[type];
  if (!options.includes(key)) return;
  if (type === 'research') researchTab = key;
  else if (type === 'quant') quantTab = key;
  else riskTab = key;
  renderContent();
  root.querySelector('#' + type + '-tab-' + key)?.focus({ preventScroll: true });
}

function saveQuantSettings() {
  const form = root.querySelector('#quant-form');
  if (!form || !form.reportValidity()) return;
  const data = new FormData(form);
  const defaults = { fast: 20, slow: 50, breakout: 20, holding: 30, costBps: 10 };
  const values = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, data.has(key) ? Number(data.get(key)) : value]));
  if (!Object.values(values).every(Number.isFinite) || values.fast >= values.slow) {
    announce('检查参数，短均线需小于长均线。');
    return;
  }
  quantSettings = { ...values, optimize: data.has('optimize') };
  state.quantSettings = quantSettings;
  persist('量化设置已保存 · 已重新计算');
  updateResults();
}

function editExternalModel() {
  const previous = modelConfig;
  openDialog('模型接口设置',
    field('url', 'Chat Completions 接口 HTTPS', previous?.url ?? '', 'type="url" placeholder="https://你的服务/v1"') +
    field('model', '模型 ID', previous?.model ?? '', 'maxlength="110"') +
    field('secret', '访问令牌（可选，仅本次会话）', '', 'type="password" autocomplete="off" maxlength="1024"'), (values) => {
    const next = validateModelGateway(values);
    if (values.secret && !/^[!-~]{1,1024}$/.test(values.secret.trim())) throw new Error('检查访问令牌格式。');
    sessionModelToken = next ? values.secret.trim() || (previous?.url === next.url ? sessionModelToken : '') : '';
    externalRequest?.abort();
    modelConfig = next;
    state.modelGateway = next;
    externalQuant = {};
    persist(next ? '模型接口已保存' : '模型接口已清除');
  }, { description: '应用只在你点击分析时发送公开行情的本地计算摘要。接口需接受 Chat Completions 请求并允许应用跨域。服务费由你的提供方计收。' });
}

async function runExternalReview() {
  if (!modelConfig) { editExternalModel(); return; }
  if (externalRequest || !symbol) return;
  const ticker = symbol;
  const history = trendStore.read(ticker, 'day');
  if (!history.bars.length) {
    externalQuant = { symbol: ticker, error: '暂无已取得的公开日线。外部模型仅接收公开行情计算摘要。' };
    updateResults();
    return;
  }
  const benchmark = benchmarkFor(ticker);
  const brief = runQuantLab({ symbol: ticker, bars: history.bars, benchmarkSymbol: benchmark,
    benchmarkBars: ticker === benchmark ? [] : trendStore.read(benchmark, 'day').bars, historySource: '腾讯财经 · 日线', settings: quantSettings,
  });
  if (brief.status !== 'ready') {
    externalQuant = { symbol: ticker, error: '公开行情资料不足，暂无法发起复核。' };
    updateResults();
    return;
  }
  const request = new AbortController();
  const previous = externalQuant.symbol === ticker ? { ...externalQuant } : { symbol: ticker };
  externalRequest = request;
  externalQuant = { ...previous, busy: true, error: null };
  updateResults();
  try {
    const result = await requestModelReview(modelConfig, brief.evidenceBrief, { token: sessionModelToken, signal: request.signal });
    if (!request.signal.aborted) externalQuant = { symbol: ticker, ...result };
  } catch (error) {
    if (!request.signal.aborted) externalQuant = { ...previous, error: error.message };
  } finally {
    if (externalRequest === request) externalRequest = null;
    if (externalQuant.symbol === ticker && externalQuant.busy) externalQuant = previous;
    if (page === 'quant') updateResults();
  }
}

function updateTrade(form) {
  tradeInputs = Object.fromEntries(new FormData(form));
  tradeInputs.fractional = instrumentCurrency(tradeInputs.symbol) === 'USD' && form.elements.fractional.checked;
  updateResults();
}

root.addEventListener('click', (event) => {
  if (menu && event.target.closest('.sidebar a[href], .sidebar [data-action="settings"]')) setMenu(false);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, symbol: ticker, range: selectedRange } = button.dataset;
  const actions = {
    'toggle-menu': () => setMenu(!menu), 'close-menu': () => setMenu(false),
    'show-overview-focus': () => setOverviewFocus(true), 'hide-overview-focus': () => setOverviewFocus(false),
    'open-overview-step': () => openOverviewStep(id),
    'add-holding': () => editHolding(), 'edit-holding': () => editHolding(id), 'delete-holding': () => deleteRecord('holding', id),
    'set-cash': setCash, 'add-watch': addWatch, 'delete-watch': () => deleteRecord('watch', ticker),
    'select-symbol': () => {
      const inMarket = page === 'market';
      const previousStripOffset = root.querySelector('.ws-quick-symbols')?.scrollLeft ?? 0;
      selectInstrument(ticker);
      navigate('market');
      if (inMarket) {
        const strip = root.querySelector('.ws-quick-symbols');
        if (strip) strip.scrollLeft = previousStripOffset;
        restoreFocus(button);
      }
    }, 'research-symbol': () => navigate('research'),
    'trade-symbol': () => { tradeInputs = { ...initialTrade(symbol), entry: quoteFor(state, symbol).source !== 'demo' ? quoteFor(state, symbol).price ?? '' : '' }; navigate('trades'); },
    'market-feed': marketFeedSettings, 'import-history': importHistory, settings,
    'toggle-currency': () => {
      setPortfolioCurrency(portfolioCurrency === 'USD' ? 'CNY' : 'USD');
      persist();
      renderContent();
    },
    'market-filter': () => {
      marketFilter = button.dataset.market;
      if (marketFilter !== 'all' && instrumentMarket(symbol) !== marketFilter) {
        symbol = state.watchlist.find((item) => instrumentMarket(item.symbol) === marketFilter)?.symbol ?? '';
        if (alpacaConfig) alpacaFeed.setSymbols(feedTickers());
      }
      renderContent();
      root.querySelector(`[data-market="${marketFilter}"]`)?.focus({ preventScroll: true });
    },
    'toggle-privacy': () => {
      state.privateAmounts = !state.privateAmounts;
      persist();
      renderShell();
      restoreFocus(button);
    },
    'save-trade': saveTrade, 'delete-trade': () => deleteRecord('trade', id), 'use-strategy': useStrategy,
    'research-data': configureResearch, 'research-refresh': () => { void ensureResearchEvidence(symbol, true); updateResults(); },
    'research-import': importResearchEvidence, 'research-online': resetImportedEvidence,
    'track-strategy': toggleStrategyTracking, 'add-research-alert': addResearchAlert, 'remove-research-alert': () => removeResearchAlert(id),
    'risk-parameters': editRiskProfile, 'risk-tab': () => choosePanel('risk', button.dataset.riskTab),
    'risk-shock-preset': () => setRiskShock(Number(button.dataset.shock)),
    'opportunity-scan': scanOpportunities, 'opportunity-stop': stopOpportunityScan, 'opportunity-edit': editOpportunityPlan,
    'opportunity-mode': () => {
      const mode = button.dataset.mode;
      if (mode === 'custom' && !customOpportunityPlan) return editOpportunityPlan();
      chooseOpportunityPlan(mode === 'custom' ? 'custom' : 'default');
      void scanOpportunities();
    },
    'opportunity-universe': () => {
      chooseOpportunityPlan(opportunityMode, { ...opportunityPlan, market: button.dataset.market });
      void scanOpportunities();
    },
    'opportunity-horizon': () => {
      chooseOpportunityPlan(opportunityMode, { ...opportunityPlan, horizon: button.dataset.horizon });
      void scanOpportunities();
    },
    'opportunity-view': () => { opportunityView = button.dataset.view; opportunityVisibleRows = 14; updateResults(); },
    'opportunity-more': () => { opportunityVisibleRows += 14; updateResults(); },
    'open-research-symbol': () => {
      selectInstrument(ticker);
      if (page === 'opportunities') {
        state.research[ticker] = { ...state.research[ticker], horizon: opportunityPlan.horizon };
        persist();
      }
      discoveredSymbol = ticker;
      publicFeed.setSymbols(publicTickers());
      if (page === 'research') {
        renderContent();
        root.querySelector('#research-symbol')?.focus({ preventScroll: true });
      } else navigate('research');
    },
    'research-tab': () => choosePanel('research', button.dataset.researchTab),
    'quant-tab': () => choosePanel('quant', button.dataset.quantTab),
    'quant-run': saveQuantSettings, 'external-quant-settings': editExternalModel, 'external-quant-run': runExternalReview,
    'external-quant-cancel': () => externalRequest?.abort(),
    range: () => { range = selectedRange; renderContent(); restoreFocus(button); },
    'chart-period': () => selectChartPeriod(button.dataset.period),
    'chart-periods': showChartPeriods,
    'chart-settings': showChartSettings,
    'expand-chart': showExpandedChart,
    'reload-chart': reloadCharts,
  };
  actions[action]?.();
});

root.addEventListener('input', (event) => {
  const { target } = event;
  if (target.id === 'quant-symbol') {
    selectInstrument(target.value);
    renderContent();
    root.querySelector('#quant-symbol')?.focus({ preventScroll: true });
  }
  if (target.closest('#trade-form')) {
    if (target.name === 'symbol') {
      tradeInputs = initialTrade(target.value);
      renderContent();
      root.querySelector('#trade-symbol')?.focus();
    } else updateTrade(target.form);
  }
  if (target.closest('#research-form')) {
    if (target.name === 'symbol') {
      selectInstrument(target.value);
      renderContent();
      root.querySelector('#research-symbol')?.focus();
    } else if (symbol) {
      const { symbol: _, ...inputs } = Object.fromEntries(new FormData(target.form));
      state.research[symbol] = { ...state.research[symbol], ...inputs };
      persist();
      if (target.name === 'assetType') {
        renderContent();
        root.querySelector('#research-assetType')?.focus({ preventScroll: true });
      } else updateResults();
    }
  }
  if (target.id === 'risk-shock') {
    setRiskShock(Number(target.value));
  }
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'trade-form') saveTrade();
  if (event.target.id === 'quant-form') saveQuantSettings();
  if (['risk-scenario-form', 'risk-simulation-form'].includes(event.target.id)) applyRiskForm(event.target);
});

root.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"]');
  const group = tab?.closest('[role="tablist"]');
  if (!group || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...group.querySelectorAll('[role="tab"]')];
  const position = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
    (position + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  if (tabs[next]) { event.preventDefault(); tabs[next].click(); }
});

dialog.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]');
  const action = control?.dataset.action;
  if (action === 'close-dialog' || event.target === dialog) dialog.close();
  if (action === 'set-cash') setCash();
  if (action === 'market-feed') marketFeedSettings();
  if (action === 'alpaca-feed') editAlpaca();
  if (action === 'custom-feed') editFeed();
  if (action === 'refresh-public') { void publicFeed.refresh({ forceExtended: true }); dialog.close(); }
  if (action === 'disconnect-feed') disconnectFeed();
  if (action === 'clear-demo') clearDemo();
  if (action === 'chart-period') {
    if (!chartExpanded) dialog.close();
    selectChartPeriod(control.dataset.period);
  }
  if (action === 'chart-periods') showChartPeriods();
  if (action === 'chart-settings') showChartSettings();
  if (action === 'reload-chart') reloadCharts();
});

dialog.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!dialogSubmit) return;
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  const warning = form.querySelector('.form-error');
  submit.disabled = true;
  warning.hidden = true;
  try {
    await dialogSubmit(Object.fromEntries(new FormData(form)), form);
    dialog.close();
    const opener = document.activeElement;
    renderContent();
    if (opener && !opener.isConnected) restoreFocus(opener);
  } catch (error) {
    warning.textContent = error.message || '处理失败，请重试。';
    warning.hidden = false;
  } finally {
    if (!dialog.open && form.elements.secret) form.elements.secret.value = '';
    submit.disabled = false;
  }
});

dialog.addEventListener('close', () => {
  if (dialog.open) return;
  const expand = reopenExpandedChart && page === 'market';
  reopenExpandedChart = false;
  chartExpanded = false;
  dialogSubmit = null;
  dialog.replaceChildren();
  if (expand) showExpandedChart();
});

const chartPointCache = new WeakMap();

function chartData(hit) {
  const { points: source, cursorScale: scale } = hit.dataset;
  const cached = chartPointCache.get(hit);
  if (cached && cached.source === source && cached.scale === scale) return cached;
  const data = { source, scale, points: JSON.parse(source), priceRange: scale ? JSON.parse(scale) : null };
  chartPointCache.set(hit, data);
  return data;
}

function showChartPoint(hit, clientX, clientY) {
  const { points, priceRange } = chartData(hit);
  const wrapper = hit.parentElement;
  const box = hit.getBoundingClientRect();
  if (box.width === 0 || !points.length) return;
  const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  const index = Math.round(ratio * (points.length - 1));
  hit.dataset.pointIndex = String(index);
  const position = box.left - wrapper.getBoundingClientRect().left + ratio * box.width;
  const tooltip = wrapper.querySelector('.chart-tooltip');
  const cursor = wrapper.querySelector('.chart-cursor');
  const [date, value, change, currencyCode, detail] = points[index];
  const candle = wrapper.parentElement.dataset.chartType === 'candle' && Number.isFinite(detail?.open);
  const picked = Number.isFinite(value) ? `${candle ? '收 ' : ''}${money(value, currencyCode)}` : '';
  const priceDetails = candle ? `开 ${money(detail.open, currencyCode)}  高 ${money(detail.high, currencyCode)}  低 ${money(detail.low, currencyCode)}` : '';
  tooltip.textContent = [detail?.displayDate ?? date, picked, Number.isFinite(change) ? signedPercent(change) : '', priceDetails].filter(Boolean).join(' · ');
  cursor.style.left = `${position}px`;
  tooltip.hidden = cursor.hidden = false;
  const horizontal = wrapper.querySelector('.market-chart-horizontal');
  const priceTag = wrapper.querySelector('.market-chart-cursor-price');
  const svg = wrapper.querySelector('.market-chart-svg').getBoundingClientRect();
  const y = Number.isFinite(clientY) ? (clientY - svg.top) / svg.height : detail?.y / 100;
  const [low, high, top, bottom, scale] = priceRange ?? [];
  const withinPrice = y >= top - .001 && y <= bottom + .001;
  horizontal.hidden = priceTag.hidden = !withinPrice;
  if (withinPrice) {
    const priceY = Math.min(bottom, Math.max(top, y));
    const price = high - (priceY - top) / (bottom - top) * (high - low);
    horizontal.style.top = priceTag.style.top = `${priceY * 100}%`;
    priceTag.textContent = scale === 'percent' ? signedPercent(price) : money(scale === 'log' ? Math.exp(price) : price, currencyCode);
    priceTag.title = `光标参考价 ${priceTag.textContent}`;
  }
  const tooltipWidth = tooltip.offsetWidth;
  const nearRight = position + tooltipWidth + 8 > wrapper.clientWidth;
  tooltip.style.left = `${Math.max(0, nearRight ? position - tooltipWidth - 8 : position + 8)}px`;
}

function hideChartPoint(hit) {
  for (const element of hit.parentElement?.querySelectorAll('.chart-tooltip, .chart-cursor, .market-chart-horizontal, .market-chart-cursor-price') ?? []) {
    element.hidden = true;
  }
}

const chartNavigation = createChartNavigation({ renderChart: renderMarketChart, showPoint: showChartPoint, hidePoint: hideChartPoint,
  onIdle: () => {
    if (trendRefreshPending) {
      trendRefreshPending = false;
      scheduleTrendRefresh();
    }
  },
});

document.addEventListener('keydown', (event) => {
  const hit = event.target.closest('.chart-hit');
  if (!hit || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const { points } = chartData(hit);
  const [first, last] = [0, points.length - 1];
  const previous = Number(hit.dataset.pointIndex ?? last);
  const next = event.key === 'Home' ? first : event.key === 'End' ? last : previous + (event.key === 'ArrowLeft' ? -1 : 1);
  const position = Math.min(last, Math.max(first, next));
  const box = hit.getBoundingClientRect();
  showChartPoint(hit, box.left + box.width * (last === 0 ? 0.5 : position / last));
  event.preventDefault();
});
document.addEventListener('focusout', (event) => {
  if (event.target.matches('.chart-hit')) hideChartPoint(event.target);
  if (page === 'overview' && event.target.closest('.portfolio-plot') && !event.relatedTarget?.closest?.('.portfolio-plot')) scheduleTrendRefresh();
});
window.addEventListener('pagehide', () => trendStore.flush());
window.addEventListener('resize', () => {
  for (const tooltip of document.querySelectorAll('.chart-tooltip:not([hidden])')) {
    hideChartPoint(tooltip.parentElement.querySelector('.chart-hit'));
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  ensurePageHistory();
  if (page === 'research' && !dialog.open) updateResults();
  queueStrategyReview();
});
setInterval(() => {
  if (document.hidden) return;
  ensurePageHistory();
  if (page === 'research' && !dialog.open) updateResults();
  if (page !== 'research' && Object.values(state.strategyJournal).some((item) => !item.paused)) {
    const refresh = Object.values(state.strategyJournal).find((item) => !item.paused && !researchRequests.get(item.symbol)?.loading &&
      Date.now() - (researchRequests.get(item.symbol)?.at ?? 0) >= 30 * 60_000);
    if (refresh) void ensureResearchEvidence(refresh.symbol);
  }
  queueStrategyReview();
}, 60_000);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu && !dialog.open) setMenu(false); });
matchMedia('(max-width: 630px)').addEventListener('change', scheduleTrendRefresh);
desktopWidth.addEventListener('change', (event) => {
  if (menu && event.matches) setMenu(false);
  root.querySelector('.shell').toggleAttribute('data-desktop-workspace', desktopWorkspace());
});
renderShell();
activateFeed();
queueStrategyReview();
