import { buyQuantityRules, instrumentCurrency, instrumentMarket } from './instruments.mjs';
import { researchQuoteStatus } from './investment-engine.mjs';
import { tradePlan } from './model.mjs';

const finite = Number.isFinite;
export const STRATEGY_LIMIT = 12;
const MAX_HISTORY = 24;
const MAX_ALERTS = 40;
const maxHistoryGap = 14 * 86_400_000;
const historyClocks = {
  CN: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }),
  US: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }),
};

function historyCutoff(symbol, now) {
  const market = instrumentMarket(symbol);
  const date = new Date(now);
  const fields = Object.fromEntries(historyClocks[market].formatToParts(finite(date.getTime()) ? date : Date.now())
    .map(({ type, value }) => [type, value]));
  return { day: `${fields.year}-${fields.month}-${fields.day}`, closed: Number(fields.hour) >= (market === 'CN' ? 15 : 16) };
}

function dateCloses(history, { day, closed }) {
  return new Map((history ?? []).filter(({ date, close, complete }) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && (date < day || date === day && closed) && complete !== false && finite(close) && close > 0)
    .map(({ date, close }) => [date, close]));
}

function aligned(maps, reference = new Map()) {
  if (!maps.length || maps.some((map) => !map.size)) return [];
  const dates = [...new Set([...maps, reference].flatMap((map) => [...map.keys()]))].sort();
  const days = [];
  for (let i = dates.length - 1; i >= 0 && days.length < 121; i--) {
    const date = dates[i];
    if (days.length && Date.parse(days.at(-1)) - Date.parse(date) > maxHistoryGap) break;
    if (maps.every((map) => map.has(date))) days.push(date);
    else if (days.length) break;
  }
  return days.reverse();
}

function returns(closes, days) {
  return days.slice(1).map((day, index) => closes.get(day) / closes.get(days[index]) - 1);
}

function covariance(left, right) {
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const a = mean(left);
  const b = mean(right);
  return left.reduce((sum, value, index) => sum + (value - a) * (right[index] - b), 0) / (left.length - 1);
}

function historicalStats(returnsByHolding, weights) {
  const moves = returnsByHolding[0].map((_, i) => weights.reduce((sum, weight, j) => sum + weight * returnsByHolding[j][i], 0));
  let value = 1;
  let high = 1;
  let drawdown = 0;
  for (const move of moves) {
    value *= 1 + move;
    high = Math.max(high, value);
    drawdown = Math.max(drawdown, 1 - value / high);
  }
  return { periodReturn: 100 * (value - 1), drawdown: 100 * drawdown, volatility: 100 * Math.sqrt(Math.max(0, covariance(moves, moves)) * 252) };
}

function groupPositions(rows, total) {
  const grouped = new Map();
  for (const row of rows) {
    if (!finite(row.value) || row.value <= 0 || !finite(row.shares) || row.shares <= 0) continue;
    const item = grouped.get(row.symbol) ?? { symbol: row.symbol, value: 0, shares: 0, source: row.source ?? null };
    item.value += row.value;
    item.shares += row.shares;
    grouped.set(row.symbol, item);
  }
  return [...grouped.values()].sort((left, right) => right.value - left.value).map((item) => ({
    ...item, weight: item.value / total * 100, price: item.value / item.shares,
  }));
}

export function diagnosePortfolio(summary, histories, { cap = 25, shock = -20, maxCashTarget = 20, now = Date.now() } = {}) {
  const { total, cash, positions: exposures, incomplete } = portfolioValuation(summary);
  if (total <= 0) return { empty: true };
  const cutoff = historyCutoff(exposures[0]?.symbol, now);
  for (const item of exposures) item.closes = dateCloses(histories[item.symbol], cutoff);
  const capPercent = finite(cap) && cap >= 1 && cap <= 100 ? cap : 25;
  const reservePercent = finite(maxCashTarget) && maxCashTarget >= 0 && maxCashTarget <= 100 ? maxCashTarget : 20;
  const largest = exposures[0];
  const over = exposures.filter(({ weight }) => weight > capPercent);
  const riskPairs = [];
  let usablePairs = 0;
  // Coverage is deliberately bounded to the 16 largest exposures.
  const reviewed = exposures.slice(0, 16);
  for (const [i, left] of reviewed.entries()) {
    for (const right of reviewed.slice(i + 1)) {
      const days = aligned([left.closes, right.closes]);
      if (days.length < 41) continue;
      const a = returns(left.closes, days);
      const b = returns(right.closes, days);
      const denom = Math.sqrt(covariance(a, a) * covariance(b, b));
      if (!(denom > 0)) continue;
      usablePairs++;
      const coefficient = Math.max(-1, Math.min(1, covariance(a, b) / denom));
      if (coefficient >= .75) riskPairs.push({ left: left.symbol, right: right.symbol, coefficient, observations: a.length, exposure: left.weight + right.weight });
    }
  }
  riskPairs.sort((a, b) => b.exposure - a.exposure);
  const exposureValue = exposures.reduce((sum, item) => sum + item.value, 0);
  const cashPct = cash / total * 100;
  const rebalance = !incomplete && largest && largest.weight > capPercent
    ? { symbol: largest.symbol, value: largest.value - total * capPercent / 100, from: largest.weight, to: capPercent }
    : null;
  if (rebalance) rebalance.shares = rebalance.value / largest.price;
  const scenario = { all: exposureValue * shock / 100, largest: (largest?.value ?? 0) * shock / 100,
    paired: riskPairs[0] ? total * riskPairs[0].exposure / 100 * shock / 100 : null,
    after: rebalance ? (exposureValue - rebalance.value) * shock / 100 : null,
    recovery: exposureValue * .10, recoveryAfter: rebalance ? (exposureValue - rebalance.value) * .10 : null };
  const days = !incomplete && exposures.length <= 16 ? aligned(exposures.map(({ closes }) => closes)) : [];
  let history = null;
  if (days.length >= 41) {
    const series = exposures.map(({ closes }) => returns(closes, days));
    const weights = exposures.map(({ weight }) => weight / 100);
    const next = [...weights];
    if (rebalance) next[0] = capPercent / 100;
    history = { from: days[0], through: days.at(-1), observations: days.length - 1,
      before: historicalStats(series, weights), after: rebalance ? historicalStats(series, next) : null };
  }
  return { incomplete, cap: capPercent, cashPct, reserve: reservePercent, deployable: incomplete ? null : Math.max(0, cash - total * reservePercent / 100),
    largest: largest?.symbol, over: over.length, pairs: riskPairs.slice(0, 3), pairedCoverage: reviewed.length,
    usablePairs, possiblePairs: reviewed.length * (reviewed.length - 1) / 2, holdings: exposures.length, rebalance, scenario, history };
}

function pct(value, total) {
  return total > 0 ? value / total * 100 : null;
}

function bounded(value, low, high, fallback) {
  return finite(value) && value >= low && value <= high ? value : fallback;
}

function portfolioValuation(summary) {
  const cash = bounded(summary.cash, 0, Number.MAX_VALUE, 0);
  const symbols = new Set();
  const missing = new Set();
  const valued = [];
  for (const row of summary.rows ?? []) {
    if (!finite(row.shares) || row.shares <= 0) continue;
    symbols.add(row.symbol);
    if (finite(row.value) && row.value > 0 && row.source !== 'demo') valued.push(row);
    else missing.add(row.symbol);
  }
  const total = cash + valued.reduce((sum, { value }) => sum + value, 0);
  const positions = groupPositions(valued, total).map((position) => ({
    ...position, partial: missing.has(position.symbol),
  }));
  const totalPositions = symbols.size;
  return {
    cash, total, positions, totalPositions, fullyValuedPositions: totalPositions - missing.size,
    incomplete: Boolean(summary.incomplete || missing.size),
  };
}

function concentrationFor(positions, cash, total, cap, reserve) {
  const ordered = positions.filter(({ value }) => value > 0).sort((left, right) => right.value - left.value);
  const invested = ordered.reduce((sum, { value }) => sum + value, 0);
  const hhi = invested ? ordered.reduce((sum, { value }) => sum + (value / invested) ** 2, 0) : null;
  return {
    largest: ordered[0] ?? null, top3: pct(ordered.slice(0, 3).reduce((sum, { value }) => sum + value, 0), total),
    hhi, effectiveHoldings: hhi ? 1 / hhi : 0, cashPercent: pct(cash, total), cap, reserve,
    overCap: ordered.filter(({ weight }) => weight > cap).map(({ symbol, weight }) => ({ symbol, weight })),
  };
}

function stressFor(positions, total, marketShock, specificSymbol, specificShock) {
  const contributions = positions.filter(({ value }) => value > 0).map(({ symbol, value, weight, partial }) => {
    const shock = symbol === specificSymbol ? specificShock : marketShock;
    return { symbol, value, weight, shock, partial, pnl: value * shock / 100 };
  });
  const pnl = contributions.reduce((sum, item) => sum + item.pnl, 0);
  const grossLoss = contributions.reduce((sum, item) => sum + Math.max(0, -item.pnl), 0);
  const invested = positions.reduce((sum, item) => sum + item.value, 0);
  const presets = [-10, -20, -35].map((shock) => {
    const pnl = invested * shock / 100;
    return { shock, pnl, changePercent: pct(pnl, total) };
  });
  return {
    marketShock, specificSymbol, specificShock, pnl, totalAfter: total + pnl, changePercent: pct(pnl, total),
    presets, grossLoss, grossGain: contributions.reduce((sum, item) => sum + Math.max(0, item.pnl), 0),
    contributions: contributions.sort((left, right) => left.pnl - right.pnl).map((item) => ({
      ...item, lossShare: grossLoss > 0 ? pct(Math.max(0, -item.pnl), grossLoss) : 0,
    })),
  };
}

function replayHistory(positions, histories, cutoff, total, updated, benchmarkBars) {
  if (!positions.length || positions.length > 16) return null;
  const closes = positions.map(({ symbol }) => dateCloses(histories[symbol], cutoff));
  const benchmark = dateCloses(benchmarkBars, cutoff);
  const days = aligned(closes, benchmark);
  if (days.length < 41) return null;
  const series = closes.map((map) => returns(map, days));
  const weights = positions.map(({ value }) => value / total);
  const before = historicalStats(series, weights);
  const after = updated ? historicalStats(series, updated.map(({ value }) => value / total)) : null;
  const matched = aligned([...closes, benchmark]);
  let reference = null;
  if (matched.length >= 41) {
    const index = returns(benchmark, matched);
    const indexVariance = covariance(index, index);
    const moves = closes.map((map) => returns(map, matched));
    const beta = (allocations) => indexVariance > 0 ? allocations.reduce((sum, weight, i) => sum + weight * covariance(moves[i], index), 0) / indexVariance : null;
    reference = { observations: matched.length - 1, before: beta(weights), after: updated ? beta(updated.map(({ value }) => value / total)) : null };
  }
  return { from: days[0], through: days.at(-1), observations: days.length - 1, before, after, reference };
}

function simulateWeight(positions, histories, benchmarkBars, cutoff, { total, cash, incomplete }, options) {
  const { cap, reserve, stress, draft } = options;
  if (!draft?.symbol) return { status: 'unset' };
  const { symbol, targetWeight } = draft;
  const base = { symbol, targetWeight };
  const blocked = (reason) => ({ ...base, status: 'blocked', reason });
  const position = positions.find((item) => item.symbol === symbol);
  if (incomplete) return blocked('补齐持仓报价后，可比较调仓前后的风险。');
  if (!position || position.source === 'demo') return blocked('请选择已有有效估值的持仓标的。');
  if (bounded(targetWeight, 0, 100, null) === null) return blocked('目标仓位须在 0% 至 100% 之间。');
  const difference = total * targetWeight / 100 - position.value;
  const direction = Math.sign(difference);
  const request = Math.abs(difference);
  const available = Math.max(0, cash - total * reserve / 100);
  const capRoom = Math.max(0, total * cap / 100 - position.value);
  const changing = direction > 0 ? Math.min(request, available, capRoom) : request;
  const quantity = direction > 0 ? buyQuantityRules(symbol, true) : null;
  const increment = quantity?.increment ?? (instrumentMarket(symbol) === 'CN' ? 100 : .0001);
  const units = changing / position.price / increment;
  const rounded = Number((Math.floor(units + Number.EPSILON * Math.max(1, units) * 4) * increment).toFixed(4));
  const closing = direction < 0 && targetWeight === 0;
  const shares = closing ? position.shares : direction < 0 ? Math.min(position.shares, rounded)
    : rounded >= quantity?.minimum ? rounded : 0;
  const amount = shares * position.price;
  const delta = direction * amount;
  const nextCash = Math.max(0, cash - delta);
  const limits = [
    ...(direction > 0 && request > capRoom + 1e-8 ? ['cap'] : []),
    ...(direction > 0 && request > available + 1e-8 ? ['reserve'] : []),
    ...(changing > amount + 1e-8 ? ['lot'] : []),
  ];
  const limitedBy = request > changing + 1e-8 ? (capRoom < available ? 'cap' : 'reserve')
    : limits.includes('lot') ? 'lot' : null;
  const order = { side: shares === 0 ? 'none' : direction > 0 ? 'buy' : 'sell', shares, price: position.price, amount };
  const updated = positions.map((item) => item !== position ? item : {
    ...item, shares: Math.max(0, item.shares + direction * shares), value: Math.max(0, item.value + delta),
    weight: Math.max(0, item.value + delta) / total * 100,
  });
  const snapshot = (items, balance) => {
    const { hhi, effectiveHoldings, largest, cashPercent } = concentrationFor(items, balance, total, cap, reserve);
    const { pnl } = stressFor(items, total, stress.marketShock, stress.specificSymbol, stress.specificShock);
    return { cash: balance, cashPercent, weight: items.find((item) => item.symbol === symbol).weight,
      maximumWeight: largest?.weight ?? 0, stressPnl: pnl, hhi, effectiveHoldings };
  };
  const history = replayHistory(positions, histories, cutoff, total, updated, benchmarkBars);
  return { ...base, status: 'ready', order, limits, limitedBy, cap, reserve, minimum: quantity?.minimum ?? null,
    before: snapshot(positions, cash), after: snapshot(updated, nextCash), history };
}

export function buildRiskLab(summary, histories = {}, {
  cap = 25, maxCashTarget = 20, shock = -20, scenario, simulation, benchmarkBars, now = Date.now(),
} = {}) {
  const capPercent = bounded(cap, 1, 100, 25);
  const reserve = bounded(maxCashTarget, 0, 100, 20);
  const { total, cash, positions, totalPositions, fullyValuedPositions, incomplete } = portfolioValuation(summary);
  const concentration = concentrationFor(positions, cash, total, capPercent, reserve);
  const marketShock = bounded(shock, -100, 100, -20);
  const specificShock = bounded(scenario?.shock, -100, 100, null);
  const specificSymbol = specificShock !== null && positions.some((item) => item.symbol === scenario.symbol) ? scenario.symbol : '';
  const stress = { ...stressFor(positions, total, marketShock, specificSymbol, specificSymbol ? specificShock : null),
    totalPositions, fullyValuedPositions, valuedPositions: positions.length,
    coveragePercent: pct(fullyValuedPositions, totalPositions) };
  const cutoff = historyCutoff(positions[0]?.symbol, now);
  const trial = simulateWeight(positions, histories, benchmarkBars, cutoff, { total, cash, incomplete },
    { cap: capPercent, reserve, stress, draft: simulation });
  const history = !incomplete ? trial.history ?? replayHistory(positions, histories, cutoff, total, null, benchmarkBars) : null;
  return { status: incomplete ? 'partial' : total > 0 ? 'ready' : 'empty', incomplete, positions, concentration, stress, simulation: trial, history };
}

export function evaluateAllocation(summary, histories, candidates, { cap = 25, maxCashTarget = 20, now = Date.now() } = {}) {
  const { total, cash, positions: eligible, incomplete } = portfolioValuation(summary);
  if (incomplete || !(total > 0)) return null;
  if (!eligible.length || eligible.length > 16) return null;
  const largest = eligible[0];
  const cutoff = historyCutoff(eligible[0].symbol, now);
  const capValue = total * cap / 100;
  const reserve = total * maxCashTarget / 100;
  const trims = Math.max(0, largest.value - capValue);
  const currentMaps = eligible.map(({ symbol }) => dateCloses(histories[symbol], cutoff));
  const fresh = candidates.filter((item) => item.market && finite(item.entry) && finite(item.stop) && item.entry > item.stop &&
    ['opportunity', 'watch'].includes(item.status)).sort((a, b) => Number(b.status === 'opportunity') - Number(a.status === 'opportunity'));
  const views = [];
  for (const item of fresh) {
    const current = eligible.find(({ symbol }) => symbol === item.ticker);
    if (largest.symbol === item.ticker && trims > 0) continue;
    const maps = current ? currentMaps : [...currentMaps, dateCloses(histories[item.ticker], cutoff)];
    const days = aligned(maps);
    if (days.length < 41) continue;
    const plan = tradePlan({ symbol: item.ticker, entry: item.entry, target: item.target, stop: item.stop, riskPercent: 1,
      cash: cash + trims, equity: total, positionValue: current?.value ?? 0, capPercent: cap, reservePercent: maxCashTarget,
      fractional: item.market === 'US' });
    if (!plan.valid || plan.shares <= 0) continue;
    const { investment: amount, shares } = plan;
    const trimUsed = Math.min(trims, Math.max(0, amount + reserve - cash));
    const beforeWeights = eligible.map(({ value }) => value / total);
    if (!current) beforeWeights.push(0);
    const afterWeights = [...beforeWeights];
    const addedIndex = current ? eligible.indexOf(current) : eligible.length;
    afterWeights[addedIndex] += amount / total;
    if (trimUsed > 0) afterWeights[eligible.findIndex(({ symbol }) => symbol === largest.symbol)] -= trimUsed / total;
    const series = maps.map((map) => returns(map, days));
    const before = historicalStats(series, beforeWeights);
    const after = historicalStats(series, afterWeights);
    views.push({ ticker: item.ticker, from: trimUsed > 0 ? largest.symbol : null, trimAmount: trimUsed,
      kind: trimUsed > 0 ? '部分替换' : '可用现金增配', amount, shares, nextWeight: afterWeights[addedIndex] * 100,
      beforeVol: before.volatility, afterVol: after.volatility, beforeDrawdown: before.drawdown, afterDrawdown: after.drawdown,
      observations: days.length - 1, entry: item.entry, stop: item.stop, decision: item.status });
  }
  // Prefer comparisons that lower both historical risk measures. Otherwise show no automatic alternative.
  return views.filter((item) => item.afterVol <= item.beforeVol && item.afterDrawdown <= item.beforeDrawdown)
    .sort((left, right) => (left.afterVol - left.beforeVol) - (right.afterVol - right.beforeVol))[0] ?? null;
}

export function strategyKey(symbol, horizon) {
  return [symbol, ['short', 'mid', 'long'].includes(horizon) ? horizon : 'mid'].join('|');
}

export function recordStrategy(record, analysis, now = Date.now()) {
  const action = analysis.decision?.action ?? '继续观察';
  const status = analysis.decision?.status ?? 'watch';
  const prior = record.versions?.[0];
  const level = (value) => finite(value) ? value : null;
  const horizon = analysis.horizons?.find(({ key }) => key === record.horizon);
  const marketLevels = horizon ?? (analysis.plan?.source === 'manual' ? {} : analysis);
  const next = {
    at: new Date(now).toISOString(), action, status, reason: analysis.decision?.reason ?? analysis.summary,
    entry: level(marketLevels.entry), target: level(marketLevels.target), stop: level(marketLevels.stop),
    next: horizon?.trigger ?? analysis.decision?.next ?? analysis.decision?.reason,
    assessedOn: analysis.data?.lastBarDate ?? null,
  };
  const sameLevel = (key) => next[key] === prior?.[key] ||
    (finite(next[key]) && finite(prior?.[key]) && Math.abs(next[key] - prior[key]) <= Math.abs(prior[key]) * .005);
  if (prior && ['action', 'status', 'next'].every((key) => next[key] === prior[key]) && ['entry', 'target', 'stop'].every(sameLevel)) return record;
  next.change = prior ? [
    ...(action === prior.action ? [] : [prior.action + ' → ' + action]),
    ...(['entry', 'target', 'stop'].some((key) => !sameLevel(key)) ? ['计划价位变化'] : []),
    ...(status !== prior.status || next.next !== prior.next ? ['触发条件变化'] : []),
  ].join(' · ') || '更新判断依据' : '首次记录';
  return { ...record, versions: [next, ...(record.versions ?? [])].slice(0, MAX_HISTORY) };
}

export function evaluateResearchAlerts(alerts, { analysisFor, quoteFor, strategies, now = Date.now() }) {
  const fired = [];
  const result = (alerts ?? []).slice(0, MAX_ALERTS).map((alert) => {
    if (alert.firedAt) return alert;
    const quote = quoteFor(alert.symbol);
    const ts = Date.parse(quote?.date);
    const onFeed = ['public', 'live'].includes(quote?.source) && finite(quote?.price) && ts <= now + 300_000 && now - ts < 86_400_000;
    let trigger = false;
    if (alert.type === 'event') trigger = now >= Date.parse(alert.date);
    else if (alert.type === 'above') trigger = onFeed && quote.price >= alert.price;
    else if (alert.type === 'below') trigger = onFeed && quote.price <= alert.price;
    else if (alert.type === 'invalidate') {
      const fresh = researchQuoteStatus(quote, instrumentCurrency(alert.symbol), now).quoteStatus === 'fresh';
      trigger = fresh && quote.price <= alert.price;
    }
    else if (alert.type === 'opportunity') {
      const versions = strategies[alert.key]?.versions;
      const status = analysisFor(alert.key)?.decision?.status;
      trigger = onFeed && alert.baseline !== status && status === 'opportunity' &&
        Date.parse(versions?.[0]?.at) >= Date.parse(alert.createdAt);
    }
    if (!trigger) return alert;
    const updated = { ...alert, firedAt: new Date(now).toISOString(), observedPrice: alert.type === 'event' ? null : quote.price };
    fired.push(updated);
    return updated;
  });
  return { alerts: result, fired };
}
