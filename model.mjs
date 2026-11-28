import { buyQuantityRules, instrumentCurrency, normalizeTicker } from './instruments.mjs';

const storageKey = "mono-investment-workspace-v2";

const macroAssessments = new Map([
  ["tailwind", { status: "pass", detail: "研究记录为顺风" }],
  ["neutral", { status: "watch", detail: "研究记录为中性，纳入复核" }],
  ["headwind", { status: "fail", detail: "研究记录为逆风" }],
]);

const demoHoldings = [
  { id: "demo-aapl", symbol: "AAPL", name: "Apple Inc.", shares: 120, cost: 171.22, price: 189.84 },
  { id: "demo-msft", symbol: "MSFT", name: "Microsoft Corp.", shares: 67, cost: 386.5, price: 421.9 },
  { id: "demo-nvda", symbol: "NVDA", name: "NVIDIA Corp.", shares: 110, cost: 106.74, price: 131.28 },
  { id: "demo-voo", symbol: "VOO", name: "Vanguard S&P 500 ETF", shares: 65, cost: 495.18, price: 513.66 },
];

const demoWatchlist = [
  ...demoHoldings.map(({ symbol, name, price }, index) => ({
    symbol, name, price, change: [0.84, 1.24, -0.62, 0.37][index],
  })),
  { symbol: "TSLA", name: "Tesla, Inc.", price: 257.24, change: -1.26 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", price: 565.41, change: 0.42 },
];

// These points are a visibly labeled onboarding example, independent of market data.
const demoHistoryOffsets = [
  -9450, -9140, -9610, -8980, -8530, -8910, -8020, -7540, -7850, -7020,
  -6690, -7270, -6320, -5990, -6550, -7010, -6220, -5320, -5010, -5400,
  -4460, -4070, -4570, -4960, -4020, -3110, -3650, -2760, -2280, -2680,
  -1980, -1420, -1900, -1160, -835, -1100, -390, 0,
];

export function seedState() {
  return {
    cash: 25000,
    holdings: demoHoldings.map((holding) => ({ ...holding, source: "demo" })),
    watchlist: demoWatchlist.map((item) => ({ ...item, source: "demo" })),
    histories: {},
    research: {},
    trades: [],
    liveQuotes: {},
    demo: true,
  };
}

function emptyWorkspace() {
  const watchlist = [
    { symbol: '600519.SH', name: '贵州茅台' },
    { symbol: '000001.SZ', name: '平安银行' },
    { symbol: '300750.SZ', name: '宁德时代' },
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.' },
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  ];
  return { cash: 0, cashCny: 0, holdings: [], watchlist, histories: {}, research: {}, trades: [], liveQuotes: {}, publicQuotes: {}, demo: false };
}

function normalizeRecord(record) {
  return { ...record, symbol: normalizeTicker(record.symbol) || record.symbol };
}

function normalizeKeys(input, merge) {
  const output = new Map();
  for (const [key, value] of Object.entries(isRecord(input) ? input : {})) {
    const symbol = normalizeTicker(key) || key;
    output.set(symbol, output.has(symbol) ? merge(output.get(symbol), value) : value);
  }
  return Object.fromEntries(output);
}

function mergeHistory(previous, next) {
  const rows = [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(next) ? next : [])];
  return [...new Map(rows.map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function loadState(storage) {
  try {
    const data = JSON.parse((storage ?? globalThis.localStorage)?.getItem(storageKey));
    if (!data || !Array.isArray(data.holdings) || !Array.isArray(data.watchlist)) return emptyWorkspace();
    return {
      ...data,
      cash: nonnegative(data.cash) ?? 0,
      cashCny: nonnegative(data.cashCny) ?? 0,
      holdings: data.holdings.map(normalizeRecord),
      watchlist: [...new Map(data.watchlist.map(normalizeRecord).map((row) => [row.symbol, row])).values()],
      histories: normalizeKeys(data.histories, mergeHistory),
      research: normalizeKeys(data.research, (first, second) => ({ ...first, ...second })),
      trades: Array.isArray(data.trades) ? data.trades.map(normalizeRecord) : [],
      liveQuotes: {},
      publicQuotes: {},
      demo: data.demo === true,
    };
  } catch {
    return emptyWorkspace();
  }
}

export function saveState(storage, state) {
  try {
    const { liveQuotes, publicQuotes, ...saved } = state;
    (storage ?? globalThis.localStorage).setItem(storageKey, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function number(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function nonnegative(value) {
  const numeric = number(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
}

function positive(value) {
  const numeric = number(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function supplied(value) {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "");
}

function percentage(part, whole) {
  return whole > 0 ? part / whole * 100 : null;
}

function ticker(value) {
  return normalizeTicker(value) || (typeof value === "string" ? value.trim().toUpperCase() : "");
}

function historyFor(state, symbol) {
  const history = Object.hasOwn(state.histories ?? {}, symbol) ? state.histories[symbol] : null;
  return Array.isArray(history) ? history : [];
}

function timestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const milliseconds = typeof value === "number" && Math.abs(value) < 1e11 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function quoteFor(state, symbol) {
  const normalized = ticker(symbol);
  const currency = instrumentCurrency(normalized);
  const stream = Object.hasOwn(state.liveQuotes ?? {}, normalized) ? state.liveQuotes[normalized] : null;
  const livePrice = positive(stream?.price);
  const liveDate = timestamp(stream?.date);
  const publicQuote = Object.hasOwn(state.publicQuotes ?? {}, normalized) ? state.publicQuotes[normalized] : null;
  const publicPrice = positive(publicQuote?.price);
  const publicDate = timestamp(publicQuote?.date);
  const hasPublic = publicPrice !== null && publicDate !== null && publicQuote.currency === currency;
  if (livePrice !== null && liveDate !== null && (!stream.currency || stream.currency === currency) &&
      (!hasPublic || Date.parse(publicDate) - Date.parse(liveDate) <= 90_000)) {
    return { price: livePrice, change: number(stream.change), date: liveDate, source: "live", currency, provider: stream.provider };
  }

  const history = historyFor(state, normalized);
  const recent = history.at(-1);
  const prior = history.at(-2);
  const entries = [...state.holdings, ...state.watchlist].filter((item) => (
    ticker(item.symbol) === normalized && positive(item.price) !== null
  ));
  const manual = entries.filter((entry) => entry.source !== "demo").sort((left, right) => (
    (timestamp(right.date) ?? "").localeCompare(timestamp(left.date) ?? "")
  ))[0];
  const manualDate = timestamp(manual?.date);
  const historyDate = timestamp(recent?.date);
  if (hasPublic && publicDate >= (manualDate ?? '') && publicDate >= (historyDate ?? '')) {
    return { price: publicPrice, change: number(publicQuote.change), date: publicDate, source: 'public', currency };
  }
  if (positive(recent?.close) !== null && (manualDate === null || (historyDate !== null && manualDate <= historyDate))) {
    return {
      price: Number(recent.close),
      change: positive(prior?.close) === null ? null : percentage(recent.close - prior.close, prior.close),
      date: recent.date,
      source: "imported",
      currency,
    };
  }

  const entry = manual ?? entries.find((item) => number(item.change) !== null) ?? entries[0];
  return {
    price: positive(entry?.price),
    change: number(entry?.change),
    date: entry?.date ?? null,
    source: entry ? (entry.source === "demo" ? "demo" : "manual") : null,
    currency,
  };
}

export function portfolioSummary(state) {
  const cash = nonnegative(state.cash) ?? 0;
  const positions = state.holdings.map((holding) => {
    const { price, source } = quoteFor(state, holding.symbol);
    const shares = nonnegative(holding.shares) ?? 0;
    const cost = nonnegative(holding.cost);
    const value = price === null ? null : shares * price;
    const basis = cost === null ? null : shares * cost;
    const pnl = value === null || basis === null ? null : value - basis;
    return { ...holding, shares, cost, price, value, basis, pnl, pnlPercent: pnl === null ? null : percentage(pnl, basis), source };
  });
  const invested = positions.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const total = invested + cash;
  const rows = positions.map((row) => ({
    ...row,
    weight: row.value === null ? null : percentage(row.value, total),
  }));
  const holdingsByTicker = new Map();
  for (const row of rows) {
    if (row.value === null) continue;
    const symbol = ticker(row.symbol);
    holdingsByTicker.set(symbol, (holdingsByTicker.get(symbol) ?? 0) + row.value);
  }
  const allocation = [...holdingsByTicker].map(([symbol, value]) => ({
    label: symbol, symbol, value, weight: percentage(value, total),
  })).sort((left, right) => right.value - left.value);
  const largest = allocation[0] ?? null;
  const cashPercent = total > 0 ? percentage(cash, total) : 0;
  if (cash > 0) allocation.push({ label: "现金", symbol: "CASH", value: cash, weight: cashPercent });

  const pricedWithCost = rows.filter((row) => row.pnl !== null);
  const pnl = pricedWithCost.reduce((sum, row) => sum + row.pnl, 0);
  const pnlBasis = pricedWithCost.reduce((sum, row) => sum + row.basis, 0);
  const incomplete = rows.some((row) => row.shares > 0 && row.price === null);
  return {
    total, invested, cash, pnl, pnlPercent: percentage(pnl, pnlBasis) ?? 0, cashPercent,
    rows, allocation, largest, incomplete,
  };
}

function readFields(line, delimiter) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) return null;
  fields.push(field.trim());
  return fields;
}

function dailyDate(value) {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const instant = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseHistory(csv) {
  const lines = String(csv ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).map((line, index) => ({
    line: line.trim(), row: index + 1,
  })).filter(({ line }) => line);
  if (lines.length < 2) throw new Error("CSV 至少需要表头和一条行情记录。");

  const columns = [",", "\t", ";"].map((delimiter) => ({
    delimiter,
    headers: readFields(lines[0].line, delimiter) ?? [],
  })).sort((left, right) => right.headers.length - left.headers.length)[0];
  const headers = columns.headers.map((field) => field.toLowerCase().replace(/[\s_-]+/g, ""));
  const dateIndex = headers.findIndex((header) => ["date", "datetime", "timestamp", "日期", "交易日期"].includes(header));
  let closeIndex = headers.findIndex((header) => ["close", "收盘", "收盘价"].includes(header));
  const adjustedOnly = closeIndex === -1;
  if (closeIndex === -1) {
    closeIndex = headers.findIndex((header) => ["adjclose", "adjustedclose", "复权收盘价"].includes(header));
  }
  if (dateIndex === -1 || closeIndex === -1) throw new Error("CSV 表头需含 Date 和 Close，或「日期」和「收盘价」。");
  const openIndex = headers.findIndex((header) => ["open", "开盘", "开盘价"].includes(header));
  const highIndex = headers.findIndex((header) => ["high", "最高", "最高价"].includes(header));
  const lowIndex = headers.findIndex((header) => ["low", "最低", "最低价"].includes(header));
  const volumeIndex = headers.findIndex((header) => ["volume", "vol", "成交量"].includes(header));
  const ungroup = (value) => value?.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");

  const byDate = new Map();
  for (const { line, row } of lines.slice(1)) {
    const fields = readFields(line, columns.delimiter);
    const date = dailyDate(fields?.[dateIndex] ?? "");
    const close = positive(ungroup(fields?.[closeIndex]));
    if (date === null || close === null) throw new Error(`第 ${row} 行的日期或收盘价无效。`);
    const item = { date, close };
    if (!adjustedOnly && [openIndex, highIndex, lowIndex].every((index) => index >= 0)) {
      const [open, high, low] = [openIndex, highIndex, lowIndex].map((index) => positive(ungroup(fields[index])));
      if ([open, high, low].every(Number.isFinite) && low <= Math.min(open, close) && high >= Math.max(open, close)) Object.assign(item, { open, high, low });
    }
    const volume = nonnegative(ungroup(fields?.[volumeIndex]));
    if (volume !== null) item.volume = volume;
    byDate.set(date, item);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function indicators(history) {
  let sum20 = 0;
  let sum50 = 0;
  let averageGain = 0;
  let averageLoss = 0;
  const series = history.map(({ date, close }, index) => {
    sum20 += close - (history[index - 20]?.close ?? 0);
    sum50 += close - (history[index - 50]?.close ?? 0);
    if (index > 0) {
      const change = close - history[index - 1].close;
      const gain = Math.max(0, change);
      const loss = Math.max(0, -change);
      if (index <= 14) {
        averageGain += gain / 14;
        averageLoss += loss / 14;
      } else {
        averageGain = (averageGain * 13 + gain) / 14;
        averageLoss = (averageLoss * 13 + loss) / 14;
      }
    }
    let rsi = null;
    if (index >= 14) {
      rsi = averageLoss > 0 ? 100 - 100 / (1 + averageGain / averageLoss) : (averageGain > 0 ? 100 : 50);
    }
    return {
      date, close, rsi,
      ma20: index >= 19 ? sum20 / 20 : null,
      ma50: index >= 49 ? sum50 / 50 : null,
    };
  });
  const { close = null, ma20 = null, ma50 = null, rsi = null } = series.at(-1) ?? {};
  return { close, ma20, ma50, rsi, rsi14: rsi, series };
}

function roundShares(limit, precision) {
  const units = limit * precision;
  return Math.floor(units + Math.min(1e-7, Number.EPSILON * Math.abs(units) * 2)) / precision;
}

export function tradeExecution({ entry, target, stop, costBps, gapPercent }) {
  const entryPrice = positive(entry);
  const targetPrice = positive(target);
  const stopPrice = positive(stop);
  if ([entryPrice, targetPrice, stopPrice].includes(null)) return { valid: false, error: "请填写入场、止损与目标价。" };
  if (stopPrice >= entryPrice || targetPrice <= entryPrice) return { valid: false, error: "做多计划须满足止损价 < 入场价 < 目标价。" };
  const assumedNumber = (value) => value == null || (typeof value === "string" && !value.trim()) ? 0 : nonnegative(value);
  const cost = assumedNumber(costBps);
  const gap = assumedNumber(gapPercent);
  if (cost === null || cost > 1000 || gap === null || gap > 100) {
    return { valid: false, error: "单边成本须为 0–1000 个基点，止损下方偏离须为 0%–100%。" };
  }
  const friction = cost / 10_000;
  const unitSpend = entryPrice * (1 + friction);
  const budgetExit = stopPrice * (1 - gap / 100);
  const riskPerShare = unitSpend - stopPrice * (1 - friction);
  const budgetRiskPerShare = unitSpend - budgetExit * (1 - friction);
  const rewardPerShare = targetPrice * (1 - friction) - unitSpend;
  const ratio = rewardPerShare / budgetRiskPerShare;
  if (![unitSpend, riskPerShare, budgetRiskPerShare, rewardPerShare, ratio].every(Number.isFinite) || budgetRiskPerShare <= 0) {
    return { valid: false, error: "输入超出可计算范围。" };
  }
  return { valid: true, entryPrice, costBps: cost, gapPercent: gap, friction, unitSpend,
    budgetExit, budgetRiskPerShare, riskPerShare, rewardPerShare, ratio };
}

export function tradePlan({
  symbol, entry, target, stop, amount, riskPercent, cash, equity, fractional, incomplete,
  positionValue, capPercent, reservePercent, lotSize, costBps, gapPercent,
}) {
  const execution = tradeExecution({ entry, target, stop, costBps, gapPercent });
  if (!execution.valid) return execution;
  const { entryPrice, unitSpend, friction, riskPerShare, budgetRiskPerShare, rewardPerShare, ratio } = execution;
  const amountEntered = amount != null && String(amount).trim() !== "";
  const requestedAmount = nonnegative(amount);
  const requestedRisk = nonnegative(riskPercent);
  const availableCash = nonnegative(cash);
  const portfolioEquity = positive(equity);
  if (requestedRisk === null || (amountEntered && requestedAmount === null)) {
    return { valid: false, error: "请填写有效的单笔风险预算。投入上限可留空。" };
  }
  if (requestedRisk > 100) return { valid: false, error: "风险预算必须在 0% 与 100% 之间。" };
  if (incomplete || availableCash === null || portfolioEquity === null) {
    return { valid: false, error: "补齐同币种持仓估值和现金后，即可计算仓位。" };
  }
  const heldValue = nonnegative(positionValue);
  const cap = nonnegative(capPercent);
  const reserve = nonnegative(reservePercent);
  if ((capPercent != null && (cap === null || cap > 100 || heldValue === null))
    || (reservePercent != null && (reserve === null || reserve > 100))) {
    return { valid: false, error: "核对当前持仓、单标的上限与现金储备比例。" };
  }

  const budget = portfolioEquity * (requestedRisk / 100);
  const cashReserved = portfolioEquity * ((reserve ?? 0) / 100);
  const cashAfterReserve = Math.max(0, availableCash - cashReserved);
  const allocationCapacity = cap === null ? null : Math.max(0, portfolioEquity * (cap / 100) - heldValue);
  const cashLimit = Math.min(requestedAmount ?? Infinity, cashAfterReserve) / unitSpend;
  const riskLimit = budget / budgetRiskPerShare;
  // Entry costs reduce cash and equity, while the position increases by the trade notional.
  const capLimit = allocationCapacity === null ? Infinity : allocationCapacity / (entryPrice * (1 + cap / 100 * friction));
  const limits = [
    ["cap", capLimit],
    [cashReserved > 0 ? "reserve" : "cash", cashAfterReserve / unitSpend],
    ["amount", requestedAmount === null ? Infinity : requestedAmount / unitSpend],
    ["risk", riskLimit],
  ];
  const shareLimit = Math.min(...limits.map(([, limit]) => limit));
  if (!Number.isFinite(shareLimit)) {
    return { valid: false, error: "输入超出可计算范围。" };
  }
  const quantity = Number.isInteger(lotSize) && lotSize > 0 ? { minimum: lotSize, increment: lotSize }
    : buyQuantityRules(symbol, fractional);
  const rounded = quantity.increment < 1 ? roundShares(shareLimit, 1 / quantity.increment)
    : roundShares(shareLimit / quantity.increment, 1) * quantity.increment;
  const shares = rounded >= quantity.minimum ? rounded : 0;
  const investment = shares * unitSpend;
  const notional = shares * entryPrice;
  const entryCost = Math.max(0, investment - notional);
  const postEquity = portfolioEquity - entryCost;
  const risk = shares * riskPerShare;
  const budgetRisk = shares * budgetRiskPerShare;
  const reward = shares * rewardPerShare;
  if (![investment, risk, budgetRisk, reward].every(Number.isFinite)) {
    return { valid: false, error: "输入超出可计算范围。" };
  }
  return {
    valid: true,
    error: null,
    shares,
    investment,
    entryCost,
    risk,
    budgetRisk,
    budgetExit: execution.budgetExit,
    gapPercent: execution.gapPercent,
    costBps: execution.costBps,
    reward,
    ratio,
    budget,
    riskPerShare,
    rewardPerShare,
    cashLimit,
    riskLimit,
    quantity,
    binding: limits.filter(([, limit]) => limit === shareLimit).map(([key]) => key),
    cashReserved,
    cashAfterReserve,
    allocationCapacity,
    remainingCash: Math.max(0, availableCash - investment),
    postWeight: heldValue === null || postEquity <= 0 ? null : (heldValue + notional) / postEquity * 100,
    riskUsedPercent: budgetRisk / portfolioEquity * 100,
  };
}

function hasDemoPortfolio(state) {
  return state.demo && state.cash === 25000 && state.holdings.length === demoHoldings.length
    && demoHoldings.every((demo) => state.holdings.some((holding) => (
      holding.id === demo.id && holding.shares === demo.shares && holding.price === demo.price
      && holding.source === "demo" && historyFor(state, demo.symbol).length === 0
      && quoteFor(state, demo.symbol).source === "demo"
    )));
}

export function portfolioHistory(state) {
  const positions = state.holdings.filter((holding) => positive(holding.shares) !== null);
  if (!positions.length) return [];

  if (hasDemoPortfolio(state)) {
    const { total } = portfolioSummary(state);
    const end = Date.UTC(2025, 5, 30);
    return demoHistoryOffsets.map((offset, index) => {
      const date = new Date(end - (demoHistoryOffsets.length - 1 - index) * 86400000).toISOString().slice(0, 10);
      return { date, value: total + offset };
    });
  }

  const cash = nonnegative(state.cash) ?? 0;
  const series = positions.map((position) => ({
    shares: Number(position.shares),
    history: new Map(historyFor(state, ticker(position.symbol)).map(({ date, close }) => [date, close])),
  }));
  if (series.some(({ history }) => history.size === 0)) return [];
  const observations = [...series[0].history.keys()].filter((date) => (
    series.every(({ history }) => positive(history.get(date)) !== null)
  ));
  return observations.sort().map((date) => ({
    date,
    value: series.reduce((value, { shares, history }) => value + shares * history.get(date), cash),
  }));
}

export function stressTest(state, shockPercent) {
  const summary = portfolioSummary(state);
  const decline = Math.min(100, Math.abs(number(shockPercent) ?? 0));
  const loss = summary.invested * decline / 100;
  const history = portfolioHistory(state);
  let peak = 0;
  let drawdown = null;
  if (history.length > 1) {
    drawdown = 0;
    for (const { value } of history) {
      peak = Math.max(value, peak);
      drawdown = Math.max(drawdown, percentage(peak - value, peak) ?? 0);
    }
  }
  return {
    shockPercent: decline,
    loss,
    totalAfter: summary.total - loss,
    portfolioChange: percentage(-loss, summary.total) ?? 0,
    drawdown,
    drawdownSource: drawdown === null ? null : (hasDemoPortfolio(state) ? "demo" : "modeled"),
    rows: summary.rows.map((row) => ({
      ...row,
      loss: row.value === null ? null : row.value * decline / 100,
      after: row.value === null ? null : row.value * (1 - decline / 100),
    })),
  };
}

function condition(label, detail, status) {
  return { label, detail, status };
}

function reviewStatus(value) {
  return ["pass", "watch", "fail", "pending"].includes(value) ? value : (String(value ?? "").trim() ? "watch" : "pending");
}

export function researchPlan(state, symbol, inputs = {}) {
  const normalized = ticker(symbol);
  const quote = quoteFor(state, normalized);
  const technical = indicators(historyFor(state, normalized));
  const { close, ma20, ma50, rsi } = technical;
  const technicalReady = ma50 !== null && rsi !== null;
  const inTrend = technicalReady && close >= ma20 && ma20 > ma50;
  const acceptableRsi = technicalReady && rsi >= 45 && rsi <= 70;
  const growth = number(inputs.revenueGrowth);
  const pe = number(inputs.pe);
  const fairValue = positive(inputs.fairValue);
  const targetUpside = fairValue === null || quote.price === null || quote.source === "demo"
    ? null : percentage(fairValue - quote.price, quote.price);
  const macro = macroAssessments.get(inputs.macro);
  const event = inputs.events ?? inputs.event;
  const valuationMessage = targetUpside === null
    ? (quote.source === "demo" && fairValue !== null ? "估值核验需要导入、手动录入或接收真实价格" : pe === null ? "待录入合理价格与估值依据" : `录入市盈率 ${pe.toFixed(1)} 倍，待取得合理价格与参考报价`)
    : `相对录入的合理价格有 ${targetUpside.toFixed(1)}% 空间，规则要求至少 10%`;

  const conditions = [
    condition("趋势结构", technicalReady ? "收盘价 ≥ MA20 且 MA20 > MA50" : "导入至少 50 根日线后可检验", technicalReady ? (inTrend ? "pass" : "fail") : "pending"),
    condition("价格动能", rsi !== null ? "RSI(14) 须处于 45–70 区间" : "导入至少 15 根日线后可检验", rsi === null ? "pending" : (rsi >= 45 && rsi <= 70 ? "pass" : "watch")),
    condition("基本面", growth === null ? "待录入营收增长及基本面判断" : `录入营收增长 ${growth.toFixed(1)}%，规则要求增长大于零`, growth === null ? reviewStatus(inputs.fundamentals) : (growth > 0 ? "pass" : "fail")),
    condition("估值", valuationMessage, targetUpside === null ? reviewStatus(inputs.valuation) : (targetUpside >= 10 ? "pass" : "fail")),
    condition("宏观环境", macro?.detail ?? "待核验利率、行业周期及外部环境", macro?.status ?? reviewStatus(inputs.macro)),
    condition("重大事件", typeof event === "string" && event.trim() ? (event === "pass" ? "已标记完成核验" : event) : "待核验财报及已知催化事件", reviewStatus(inputs.eventsStatus ?? event)),
  ];

  const inputEntry = positive(inputs.entry);
  const inputStop = positive(inputs.stop);
  const inputTarget = positive(inputs.target);
  const hasCustomLevels = [inputs.entry, inputs.stop, inputs.target].some(supplied);
  let entry = inputEntry;
  let stop = inputStop;
  let target = inputTarget;
  if (!hasCustomLevels && inTrend && acceptableRsi) {
    entry = Number(close.toFixed(2));
    stop = Number(ma50.toFixed(2));
    if (stop > 0 && stop < entry) target = Number((entry + (entry - stop) * 2).toFixed(2));
  }
  const validLevels = entry !== null && target !== null && stop !== null && stop > 0 && entry > stop && target > entry;
  const ratio = validLevels ? (target - entry) / (entry - stop) : null;
  let summary = "导入行情并补充研究依据，以逐项核验预设条件。";
  if (hasCustomLevels && !validLevels) {
    summary = "补全价格并核对顺序。做多计划须满足止损价 < 入场价 < 目标价。";
  } else if (validLevels && conditions.every(({ status }) => status === "pass")) {
    summary = "按录入信息核验后，各项条件达到预设门槛。按计划价格核对入场与退出情景。";
  } else if (validLevels) {
    summary = "价格情景已生成。使用前需复核未满足或待补充的条件。";
  } else if (technicalReady) {
    summary = "当前行情未触发技术条件。可继续观察趋势和动能，或录入自己的价格情景。";
  }
  return {
    symbol: normalized, quote, indicators: technical, conditions,
    entry, target, stop, ratio, summary,
    levelSource: validLevels ? (hasCustomLevels ? "manual" : "rules") : null,
  };
}
