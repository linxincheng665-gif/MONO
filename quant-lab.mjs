import { instrumentCurrency, normalizeTicker } from './instruments.mjs';
import { runInvestmentResearch, walkForwardTradeRule } from './investment-engine.mjs';

const ONE_DAY = 86_400_000;
const WINDOWS = [20, 60, 252];
const DEFAULT_SETTINGS = Object.freeze({ fast: 20, slow: 50, breakout: 20, holding: 30, costBps: 10, optimize: false });

function number(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : null;
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function numberAboveZero(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function mean(numbers) {
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function snapshot(rows, lastBarDate) {
  const input = Array.isArray(rows) ? rows : [];
  const days = new Map();
  let skippedRows = 0, duplicateDates = 0, outOfOrderDates = 0, previous = '';
  for (const row of input) {
    const session = date(row?.date);
    const close = numberAboveZero(row?.close ?? row?.value);
    if (!session || close === null || !lastBarDate || session > lastBarDate || row.complete === false) {
      skippedRows += 1;
      continue;
    }
    if (session < previous) outOfOrderDates += 1;
    if (days.has(session)) duplicateDates += 1;
    previous = session;
    const open = numberAboveZero(row.open), high = numberAboveZero(row.high), low = numberAboveZero(row.low);
    const ohlc = [open, high, low].every(Number.isFinite) && low <= Math.min(open, close) && high >= Math.max(open, close);
    const volume = number(row.volume);
    days.set(session, {
      date: session, close, open: ohlc ? open : null, high: ohlc ? high : null,
      low: ohlc ? low : null, volume: volume !== null && volume >= 0 ? volume : null, ohlc,
    });
  }
  const bars = [...days.values()].sort((first, second) => first.date.localeCompare(second.date));
  const ohlcRows = bars.filter((bar) => bar.ohlc).length;
  let longestCalendarGapDays = 0;
  const discontinuityDates = [];
  for (let index = 1; index < bars.length; index += 1) {
    const left = bars[index - 1], right = bars[index];
    longestCalendarGapDays = Math.max(longestCalendarGapDays, (Date.parse(right.date) - Date.parse(left.date)) / ONE_DAY);
    const overnight = (right.open ?? right.close) / left.close;
    if (overnight < .55 || overnight > 1.65) discontinuityDates.push(right.date);
  }
  return {
    bars, discontinuityDates,
    coverage: { rowsProvided: input.length, completedRows: bars.length, ohlcRows,
      closeOnlyRows: bars.length - ohlcRows, skippedRows, duplicateDates, outOfOrderDates, longestCalendarGapDays,
      firstDate: bars[0]?.date ?? null, lastDate: bars.at(-1)?.date ?? null },
  };
}

function fingerprint(bars) {
  if (!bars.length) return null;
  let state = 2166136261;
  for (const { date, open, high, low, close, volume } of bars) {
    const canonical = `${date}|${open ?? ''}|${high ?? ''}|${low ?? ''}|${close}|${volume ?? ''}\n`;
    for (let index = 0; index < canonical.length; index += 1) {
      state = Math.imul(state ^ canonical.charCodeAt(index), 16777619);
    }
  }
  return (state >>> 0).toString(16).padStart(8, '0');
}

function priceMetrics(rows, annualizable = true) {
  const logReturns = rows.slice(1).map((row, index) => Math.log(row.close / rows[index].close));
  const center = mean(logReturns);
  const variance = logReturns.length > 1
    ? logReturns.reduce((total, value) => total + (value - center) ** 2, 0) / (logReturns.length - 1) : null;
  let peak = rows[0].close;
  let maxDrawdown = 0;
  for (const { close } of rows) {
    peak = Math.max(peak, close);
    maxDrawdown = Math.max(maxDrawdown, 1 - close / peak);
  }
  return {
    firstDate: rows[0].date, lastDate: rows.at(-1).date, sessions: logReturns.length,
    totalReturn: (rows.at(-1).close / rows[0].close - 1) * 100, maxDrawdown: maxDrawdown * 100,
    volatility: annualizable && variance !== null ? Math.sqrt(variance * 252) * 100 : null,
  };
}

function riskWindow(data, sessions, available) {
  const rows = data.bars.slice(-(sessions + 1));
  const base = { key: String(sessions), label: `${sessions} 日`, sessions, observations: rows.length };
  if (!available || rows.length <= sessions) return { ...base, status: 'unavailable', reason: '完整观测不足。' };
  if (data.discontinuityDates.some((day) => day > rows[0].date)) {
    return { ...base, status: 'unavailable', reason: '窗口内存在异常价格跳变，需核对原始价格与复权口径。' };
  }
  const gap = rows.some((row, index) => index && Date.parse(row.date) - Date.parse(rows[index - 1].date) > 14 * ONE_DAY);
  return { ...base, status: gap ? 'limited' : 'ready', ...priceMetrics(rows, !gap),
    reason: gap ? '日期间隔超过 14 天，展示区间收益及观测回撤，省略年化波动。' : '' };
}

function benchmarkComparison(data, benchmark, symbol, benchmarkSymbol, available) {
  const blank = { benchmark: benchmarkSymbol || null, pairs: 0, horizon: 20, asset: null, reference: null,
    returnGap: null, volatilityGap: null, drawdownGap: null };
  if (!available || !benchmarkSymbol || benchmarkSymbol === symbol || instrumentCurrency(symbol) !== instrumentCurrency(benchmarkSymbol)) {
    return { ...blank, status: 'unavailable', reason: '需选用同币种的独立基准，并取得同日行情。' };
  }
  const right = new Map(benchmark.bars.map((bar) => [bar.date, bar]));
  const left = data.bars.filter((bar) => right.has(bar.date)).slice(-21);
  if (left.length < 21) return { ...blank, status: 'unavailable', pairs: left.length, reason: '少于 21 个共同交易日。' };
  const first = left[0].date, last = left.at(-1).date;
  if (data.discontinuityDates.some((day) => day > first && day <= last)
      || benchmark.discontinuityDates.some((day) => day > first && day <= last)) {
    return { ...blank, status: 'unavailable', pairs: left.length, reason: '共同区间存在异常跳变，暂不比较。' };
  }
  const inScope = (bar) => bar.date >= first && bar.date <= last;
  const leftCount = data.bars.filter(inScope).length, rightCount = benchmark.bars.filter(inScope).length;
  const stale = Date.parse(data.bars.at(-1).date) - Date.parse(last) > 7 * ONE_DAY;
  const annualizable = left.length / Math.max(leftCount, rightCount) >= .9 && !stale
    && !left.some((bar, i) => i > 0 && Date.parse(bar.date) - Date.parse(left[i - 1].date) > 14 * ONE_DAY);
  const asset = priceMetrics(left, annualizable), reference = priceMetrics(left.map((bar) => right.get(bar.date)), annualizable);
  return { ...blank, status: annualizable ? 'ready' : 'limited', pairs: left.length, asset, reference,
    firstDate: first, lastDate: last, returnGap: asset.totalReturn - reference.totalReturn,
    volatilityGap: annualizable ? asset.volatility - reference.volatility : null,
    drawdownGap: asset.maxDrawdown - reference.maxDrawdown,
    reason: annualizable ? '按共同交易日配对，比较价格收益、观测回撤和年化实现波动。'
      : '共同样本间隔或最近日期不够一致，保留明确区间的比较，省略年化波动。',
  };
}

function normalizedSettings(input = {}) {
  const specs = [['fast', 3, 100], ['slow', 5, 200], ['breakout', 5, 120], ['holding', 1, 90], ['costBps', 0, 1000]];
  const result = { ...DEFAULT_SETTINGS, optimize: input.optimize === true || input.optimize === 'true' || input.optimize === 'on' };
  for (const [field, minimum, maximum] of specs) {
    if (input[field] == null || input[field] === '') continue;
    const value = number(input[field]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return { values: result, error: `${{ fast: '快均线', slow: '慢均线', breakout: '突破窗口', holding: '持有期', costBps: '单边成本' }[field]}须为 ${minimum}–${maximum} 的整数。` };
    }
    result[field] = value;
  }
  return { values: result, error: result.fast >= result.slow ? '快均线窗口必须小于慢均线窗口。' : null };
}

function parameterVariants(rule) {
  const entries = [rule];
  for (const [key, minimum, maximum] of [['fast', 3, rule.slow - 1], ['breakout', 5, 120], ['holding', 1, 90]]) {
    for (const multiplier of [.75, 1.25]) {
      const value = Math.max(minimum, Math.min(maximum, Math.round(rule[key] * multiplier)));
      if (value !== rule[key]) entries.push({ ...rule, [key]: value });
    }
  }
  return entries;
}

function strategyStudy(bars, available, input) {
  const settings = normalizedSettings(input);
  const options = { costBps: settings.values.costBps };
  if (settings.error) return {
    study: { status: 'unavailable', reason: settings.error, sample: null, assumptions: [], train: null, holdout: null },
    settings: settings.values, selection: { mode: 'invalid', candidates: [], reason: settings.error },
  };
  if (!available) return {
    study: { status: 'unavailable', reason: '需要有明确来源的非演示日线样本。', sample: null, assumptions: [], train: null, holdout: null },
    settings: settings.values, selection: { mode: 'unavailable', candidates: [], reason: '等待可核对的样本。' },
  };

  let chosen = settings.values;
  let selection = { mode: 'preset', candidates: [], reason: '固定参数直接留出检验。' };
  if (chosen.optimize) {
    const candidates = parameterVariants(chosen).map((rule) => {
      const result = walkForwardTradeRule(bars, rule, { ...options, trainingOnly: true });
      const { trades = 0, totalReturn = null, maxDrawdown = null } = result.train ?? {};
      return { rule, trades, totalReturn, maxDrawdown, eligible: result.status === 'ready' && trades >= 5 };
    });
    const ranked = candidates.filter(({ eligible }) => eligible)
      .sort((left, right) => right.totalReturn - left.totalReturn || left.maxDrawdown - right.maxDrawdown);
    if (ranked.length) chosen = ranked[0].rule;
    selection = { mode: ranked.length ? 'training-selection' : 'preset-fallback', candidates,
      reason: ranked.length ? '仅比较训练区。完成交易达到 5 笔后按训练净收益排序，同收益时优先较低回撤，冻结首选后检验一次留出区。'
        : '训练区合格交易样本不足，保留预设参数。' };
  }
  return { settings: chosen, selection, study: walkForwardTradeRule(bars, chosen, options) };
}

function auditTrades(bars, study, settings) {
  const dateIndex = new Map(bars.map((bar, index) => [bar.date, index]));
  const cost = (study.costBps ?? 10) / 10_000;
  const trainingEnd = study.sample?.trainingEnd;
  const holdoutStart = study.sample?.holdoutStart;
  const holdoutEnd = study.sample?.holdoutEnd;
  const makeSamples = (part, segment) => (part?.recent ?? []).map((trade) => {
    const signal = dateIndex.get(trade.signalDate), entry = dateIndex.get(trade.entryDate), exit = dateIndex.get(trade.exitDate);
    const entryOpen = bars[entry]?.open ?? null, exitOpen = bars[exit]?.open ?? null;
    const recalculated = entryOpen && exitOpen ? (exitOpen * (1 - cost) / (entryOpen * (1 + cost)) - 1) * 100 : null;
    let signalValidated = false;
    if (signal >= Math.max(settings.slow - 1, settings.breakout) && entryOpen !== null) {
      const close = bars[signal].close;
      const average = (window) => mean(bars.slice(signal - window + 1, signal + 1).map((bar) => bar.close));
      const threshold = Math.max(...bars.slice(signal - settings.breakout, signal).map((bar) => bar.high));
      const fast = average(settings.fast), slow = average(settings.slow);
      signalValidated = close > threshold && fast > slow && close >= fast && entryOpen >= threshold;
    }
    const sameSegment = segment === 'train' ? trade.exitDate <= trainingEnd
      : trade.entryDate >= holdoutStart && trade.exitDate <= holdoutEnd;
    return { ...trade, segment, entryOpen, exitOpen,
      chronological: Number.isInteger(signal) && entry === signal + 1 && exit === entry + settings.holding && sameSegment,
      signalValidated,
      reproduced: recalculated !== null && Math.abs(recalculated - trade.returnPercent) < 1e-8 };
  });
  const tradeSamples = [...makeSamples(study.holdout, 'holdout'), ...makeSamples(study.train, 'train')];
  return { tradeSamples, validSamples: tradeSamples.filter((trade) => trade.chronological && trade.signalValidated && trade.reproduced).length };
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
}

function evidenceText(symbol, data, analysis, comparison, validation, risk) {
  const lines = [
    `MONO 本地量化依据｜${symbol || '未选标的'}`,
    `日线来源：${analysis.data?.historySource || '待确认'}。完整样本 ${data.coverage.completedRows} 根，OHLC ${data.coverage.ohlcRows} 根，最近完整日期 ${data.coverage.lastDate ?? '—'}。`,
  ];
  if (risk.status === 'ready' || risk.status === 'limited') {
    lines.push(`最近 ${risk.sessions} 个观测收益 ${formatPercent(risk.totalReturn)}，收盘回撤 ${formatPercent(risk.maxDrawdown)}，年化实现波动 ${formatPercent(risk.volatility)}。`);
  }
  if (comparison.asset) {
    lines.push(`基准 ${comparison.benchmark}，${comparison.firstDate} 至 ${comparison.lastDate} 配对 ${comparison.pairs} 日，标的与基准收益差 ${comparison.returnGap.toFixed(2)} 个百分点。`);
  }
  if (validation.status === 'ready') {
    const { fast, slow, breakout, holding, costBps } = validation.settings;
    lines.push(`规则：MA${fast}/MA${slow}，突破前 ${breakout} 日最高价，下一记录交易日开盘执行，持有 ${holding} 个交易日，单边 ${costBps} 基点。`);
    lines.push(`留出区 ${validation.sample.holdoutStart} 至 ${validation.sample.holdoutEnd}，${validation.holdout.trades} 笔完整交易，纸面净收益 ${formatPercent(validation.holdout.totalReturn)}。`);
  } else {
    lines.push(`留出检验：${validation.reason || '暂不可用'}`);
  }
  return lines.join('\n');
}

export function runQuantLab({
  symbol, bars = [], benchmarkBars = [], benchmarkSymbol = '', strategy, historySource = '', quote, inputs,
  portfolio, metadata, now, demo = false, settings = {},
} = {}) {
  const ticker = normalizeTicker(symbol ?? strategy?.symbol);
  const analysis = strategy ?? runInvestmentResearch({
    symbol: ticker, bars, benchmarkBars, historySource, quote, inputs, portfolio, metadata, now, demo, includeBacktest: false,
  });
  const last = analysis.data?.lastBarDate ?? analysis.data?.lastDate ?? null;
  const normalized = snapshot(bars, last);
  const mark = snapshot(benchmarkBars, last);
  const usable = Boolean(ticker && analysis.data?.historySource && last && !demo && analysis.data?.historyStatus !== 'demo');
  const riskWindows = WINDOWS.map((window) => riskWindow(normalized, window, usable));
  const comparison = benchmarkComparison(normalized, mark, ticker, normalizeTicker(benchmarkSymbol), usable);
  const { study, settings: configured, selection } = strategyStudy(normalized.bars, usable, settings);
  const audit = auditTrades(normalized.bars, study, configured);
  const coverage = { ...normalized.coverage, fingerprint: usable ? fingerprint(normalized.bars) : null };
  const checks = [
    { label: '数据口径', status: usable ? 'pass' : 'pending', detail: usable ? '仅采用可追溯的完整日线。' : '等待非演示日线及可核对来源。' },
    { label: '日期顺序', status: !coverage.completedRows ? 'pending' : coverage.duplicateDates || coverage.outOfOrderDates ? 'watch' : 'pass',
      detail: `已按交易日排序。原始重复日期 ${coverage.duplicateDates} 条，逆序日期 ${coverage.outOfOrderDates} 条。` },
    { label: '条件和成交核对', status: !audit.tradeSamples.length ? 'pending'
      : audit.validSamples === audit.tradeSamples.length ? 'pass' : 'fail',
    detail: audit.tradeSamples.length ? `复算 ${audit.validSamples}／${audit.tradeSamples.length} 笔近期样本的突破条件、时间顺序、实际开盘价与成本。` : '暂无可复算的成交样本。' },
  ];
  const validation = { status: study.status, reason: study.reason, coverage,
    audit: { checked: audit.tradeSamples.length, passed: audit.validSamples,
      total: (study.train?.trades ?? 0) + (study.holdout?.trades ?? 0) },
    checks, tradeSamples: audit.tradeSamples, assumptions: study.assumptions,
    sample: study.sample, train: study.train, holdout: study.holdout,
    settings: configured, selection, discontinuityDates: normalized.discontinuityDates,
  };
  const shortRisk = riskWindows[0], mediumRisk = riskWindows[1];
  const quiet = shortRisk.volatility != null && mediumRisk.volatility > 0;
  const regime = quiet ? shortRisk.volatility / mediumRisk.volatility : null;
  const findings = [
    { key: 'trend', label: '趋势结构', status: usable && Number.isFinite(analysis.technical?.ma50) ? 'observed' : 'pending',
      detail: usable ? `MA20 ${analysis.technical?.ma20?.toFixed(2) ?? '—'}，MA50 ${analysis.technical?.ma50?.toFixed(2) ?? '—'}，RSI(14) ${analysis.technical?.rsi14?.toFixed(1) ?? '—'}。` : '等待可核验日线。' },
    { key: 'volume', label: '成交量', status: usable && Number.isFinite(analysis.technical?.volumeRatio) ? 'observed' : 'pending',
      detail: usable && Number.isFinite(analysis.technical?.volumeRatio) ? `最新完整日成交量为前 20 日均量的 ${analysis.technical.volumeRatio.toFixed(2)} 倍。` : '需要完整的最新成交量和前 20 日样本。' },
    { key: 'volatility', label: '波动结构', status: regime === null ? 'pending' : 'observed',
      detail: regime === null ? '需同时具备 20 日和 60 日可靠波动样本。'
        : `20 日波动为 60 日的 ${regime.toFixed(2)} 倍。${regime >= 1.3 ? '短期波动高于较长窗口。' : regime <= .7 ? '短期波动低于较长窗口。' : '两个窗口的波动接近。'}` },
    { key: 'benchmark', label: '相对基准', status: comparison.asset ? 'observed' : 'pending',
      detail: comparison.asset ? `${comparison.benchmark} 同日配对 ${comparison.pairs} 根，区间收益相差 ${comparison.returnGap.toFixed(2)} 个百分点。` : comparison.reason },
    { key: 'validation', label: '规则留出检验', status: study.status === 'ready' ? 'observed' : 'pending',
      detail: study.status === 'ready' ? `未参与参数选择的留出区完成 ${study.holdout.trades} 笔交易。当作规则检验样本阅读。` : study.reason },
  ];
  const limitations = [
    '各期收益基于输入价格序列。分红及复权口径仍需核对，观测回撤按收盘标记。',
    '交易时点为下一条完整日线的开盘，缺失交易日与未记录的停牌无法单靠行情文件核对。',
    '旧数据、样本少、集中持仓及未计入的成交成本，会影响历史结果的可用性。',
    ...(study.holdout && study.holdout.trades < 10 ? ['留出区完整交易少于 10 笔，收益和胜率容易受单笔交易影响。'] : []),
  ];
  return { status: usable ? 'ready' : 'unavailable', symbol: ticker, horizon: analysis.horizon,
    headline: usable ? '本地规则与历史验证' : '等待可核验的历史数据',
    findings, validation, riskWindows, comparison, limitations,
    evidenceBrief: evidenceText(ticker, normalized, analysis, comparison, validation, shortRisk) };
}
