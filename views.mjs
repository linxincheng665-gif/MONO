import { tencentSymbol } from './instruments.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const hasNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const tone = (n) => n > 0 ? 'ws-positive' : n < 0 ? 'ws-negative' : '';
const valueOrDash = (n, format) => hasNumber(n) ? format(n) : '—';
const privateValue = (hidden, n, format) => hidden ? '••••' : valueOrDash(n, format);
const formatRsi = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function action(ctx, label, type, { icon, primary = false, data = '', disabled = false } = {}) {
  return `<button type="button" class="button ws-button${primary ? ' primary ws-button-primary' : ''}" data-action="${type}" ${data}${disabled ? ' disabled' : ''}>${icon ? ctx.icons(icon, 15) : ''}${escape(label)}</button>`;
}

function iconAction(ctx, label, type, icon, data) {
  return `<button type="button" class="icon-button ws-icon-button" data-action="${type}" ${data} title="${escape(label)}" aria-label="${escape(label)}">${ctx.icons(icon, 15)}</button>`;
}

function heading(title, actions = '') {
  return `<header class="ws-heading"><h1>${title}</h1>${actions ? `<div class="ws-actions">${actions}</div>` : ''}</header>`;
}

function metric(label, value, description = '', color = '') {
  return `<div class="ws-metric"><span>${label}</span><strong class="${color}">${value}</strong>${description ? `<small>${description}</small>` : ''}</div>`;
}

function empty(message) {
  return `<div class="ws-empty">${escape(message)}</div>`;
}

function section(title, content, actionMarkup = '', className = '') {
  return `<section class="ws-section ${className}"><header class="ws-section-head"><h2>${title}</h2>${actionMarkup}</header>${content}</section>`;
}

function sourceLabel(quote) {
  return ({ public: '腾讯财经', live: '网关报价', demo: '演示数据', imported: '导入收盘价', manual: '手动记录' })[quote?.source] ?? '暂无价格';
}

function quoteSourceLink(quote, symbol, label = sourceLabel(quote)) {
  const providerCode = quote?.source === 'public' && tencentSymbol(symbol);
  return providerCode ? sourceLink('https://gu.qq.com/' + providerCode, label) : escape(label);
}

function quoteDate(quote) {
  const timestamp = quote?.timestamp ?? quote?.date;
  if (!timestamp) return '';
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return '';
  const timeZone = quote.currency === 'CNY' ? 'Asia/Shanghai' : quote.currency === 'USD' ? 'America/New_York' : undefined;
  const label = String(timestamp).length === 10 ? timestamp : new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(instant) + (timeZone ? ` ${quote.currency === 'CNY' ? '北京时间' : '美东时间'}` : '');
  return `<time datetime="${escape(timestamp)}" title="${escape(timestamp)}">${escape(label)}</time>`;
}

function decimalField(prefix, name, label, value, suffix = '', options = '', masked = false) {
  return `<label class="ws-field" for="${prefix}-${name}"><span>${label}</span><span class="ws-field-control"><input ${masked ? 'type="password" autocomplete="off"' : 'type="number" step="any"'} inputmode="decimal" id="${prefix}-${name}" name="${name}" value="${escape(value)}" ${options}>${suffix ? `<span class="ws-input-suffix">${suffix}</span>` : ''}</span></label>`;
}

function symbolField(id, label, state, symbol) {
  const instruments = new Map([...state.watchlist, ...state.holdings].map(item => [item.symbol, item.name]));
  if (symbol && !instruments.has(symbol)) instruments.set(symbol, '');
  return `<label class="ws-field" for="${id}"><span>${label}</span><select name="symbol" id="${id}">${instruments.size ? [...instruments].map(([ticker, name]) => `<option value="${escape(ticker)}"${ticker === symbol ? ' selected' : ''}>${escape(ticker)}${name ? ` · ${escape(name)}` : ''}</option>`).join('') : '<option value="">请先添加自选或持仓</option>'}</select></label>`;
}

function holdingsPage(ctx) {
  const { state, summary, privateAmounts } = ctx;
  const { rows: holdings, total, pnl: unrealized, invested } = summary;
  const headingActions = action(ctx, '编辑现金', 'set-cash', { icon: 'wallet' }) + action(ctx, '添加持仓', 'add-holding', { icon: 'plus', primary: true });
  const tableMarkup = holdings.length ? `<div class="ws-table-scroll"><table class="ws-table ws-holding-table" role="table"><thead role="rowgroup"><tr role="row"><th scope="col">标的</th><th scope="col">股数</th><th scope="col">平均成本</th><th scope="col">最新价</th><th scope="col">市值</th><th scope="col">浮动盈亏</th><th scope="col">仓位</th><th scope="col"><span class="ws-visually-hidden">操作</span></th></tr></thead><tbody role="rowgroup">${holdings.map(item => {
    const profit = item.pnl;
    return `<tr role="row"><th class="ws-holding-identity" scope="row"><div class="ws-identity"><strong>${escape(item.symbol)}</strong>${item.name ? `<small>${escape(item.name)}</small>` : ''}</div></th>
    <td role="cell" data-label="股数">${privateValue(privateAmounts, item.shares, ctx.number)}</td><td role="cell" data-label="平均成本">${privateValue(privateAmounts, item.cost, ctx.money)}</td><td role="cell" data-label="最新价">${privateValue(privateAmounts, item.price, ctx.money)}</td><td role="cell" class="ws-holding-value" data-label="市值">${privateValue(privateAmounts, item.value, ctx.money)}</td><td role="cell" class="ws-holding-pnl ${privateAmounts ? '' : tone(profit)}" data-label="浮动盈亏">${privateValue(privateAmounts, profit, ctx.signedMoney)}</td><td role="cell" data-label="仓位">${privateValue(privateAmounts, item.weight, ctx.percent)}</td>
    <td role="cell" class="ws-holding-actions"><div class="ws-row-actions">${iconAction(ctx, `编辑 ${item.symbol}`, 'edit-holding', 'edit', `data-id="${escape(item.id)}"`)}${iconAction(ctx, `删除 ${item.symbol}`, 'delete-holding', 'trash', `data-id="${escape(item.id)}"`)}</div></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('添加一笔持仓，开始记录股数和成本。');
  return `${heading('持仓管理', headingActions)}
    <div class="ws-metrics ws-metrics-four">${metric('总资产', privateValue(privateAmounts, total, ctx.money))}${metric('持仓市值', privateValue(privateAmounts, invested, ctx.money))}${metric('浮动盈亏', privateValue(privateAmounts, unrealized, ctx.signedMoney), '', privateAmounts ? '' : tone(unrealized))}${metric('可用现金', privateValue(privateAmounts, state.cash, ctx.money))}</div>
    ${section('持仓明细', tableMarkup, `<span class="ws-section-meta">${holdings.length} 笔持仓 · ${ctx.portfolioCurrency}</span>`, 'ws-holdings')}${summary.incomplete ? '<p class="ws-footnote ws-valuation-note">部分持仓缺少价格，资产总额和仓位仅计入已估值持仓。</p>' : ''}`;
}

function watchRow(ctx, instrument) {
  const { symbol, name } = instrument;
  const active = ctx.symbol === symbol;
  return `<li class="ws-watch-row${active ? ' ws-watch-active' : ''}" data-watch-symbol="${escape(symbol)}"><button type="button" class="ws-watch-select" data-action="select-symbol" data-symbol="${escape(symbol)}" aria-pressed="${active}">
    <span class="ws-identity"><strong>${escape(symbol)}</strong><small>${escape(name)}<span class="watch-demo"${instrument.source === 'demo' ? '' : ' hidden'}>${name ? ' · ' : ''}演示</span></small></span>
    <span class="ws-watch-price">${renderWatchQuote(instrument, ctx)}</span></button>${iconAction(ctx, `移除 ${symbol}`, 'delete-watch', 'trash', `data-symbol="${escape(symbol)}"`)}</li>`;
}

export function renderWatchQuote(quote, ctx) {
  return `<strong>${valueOrDash(quote.price, (value) => ctx.money(value, quote.currency))}</strong><small class="${tone(quote.change)}">${valueOrDash(quote.change, ctx.signedPercent)}</small>`;
}

export function renderMarketQuote({ symbol, quote, orderBook, alpacaFeed, money, signedPercent }) {
  const markSource = quote?.provider?.startsWith('alpaca-') ? `${quote.provider.slice(7).toUpperCase()} 成交价` : sourceLabel(quote);
  const moneyHere = (value) => money(value, quote?.currency);
  const book = alpacaFeed && symbol && quote?.currency === 'USD' ? `<div class="quote-book" aria-label="盘口报价"><div><span>买一</span><strong>${valueOrDash(orderBook?.bid, moneyHere)}</strong></div><div><span>卖一</span><strong>${valueOrDash(orderBook?.ask, moneyHere)}</strong></div><div><span>盘口时间</span><strong>${orderBook?.bookDate ? quoteDate({ date: orderBook.bookDate, currency: 'USD' }) : '—'}</strong></div></div>` : '';
  return `<div class="ws-market-value"><div class="ws-quote-numbers"><strong>${valueOrDash(quote?.price, moneyHere)}</strong><span class="${tone(quote?.change)}">${valueOrDash(quote?.change, signedPercent)}</span></div><small>${quoteSourceLink(quote, symbol, markSource)}${quote?.date ? ` · ${quoteDate(quote)}` : ''}</small></div>${book}`;
}

function marketPage(ctx) {
  const { state, symbol, marketLabel, marketStatus } = ctx;
  const filter = ctx.marketFilter ?? 'all';
  const records = (ctx.watchQuotes ?? state.watchlist).filter((item) => filter === 'all' || ctx.instrumentMarket(item.symbol) === filter);
  const name = [...state.watchlist, ...state.holdings].find(item => item.symbol === symbol)?.name;
  const marketFilters = `<div class="ws-market-filters" role="group" aria-label="筛选市场">${[['all', '全部'], ['CN', 'A 股'], ['US', '美股']].map(([value, label]) => `<button type="button" data-action="market-filter" data-market="${value}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div>`;
  const noRecords = filter === 'all' ? '添加自选标的以跟踪报价。' : '当前市场暂无自选标的。';
  const watch = section('自选列表', marketFilters + (records.length ? `<ul class="ws-watch-list">${records.map(item => watchRow(ctx, item)).join('')}</ul>` : empty(noRecords)), `<span class="ws-section-meta">${records.length} 个标的</span>`, 'ws-watch-section');
  const choices = (ctx.watchQuotes ?? state.watchlist).map((item) => `<button type="button" class="ws-quick-symbol" data-action="select-symbol" data-symbol="${escape(item.symbol)}" aria-pressed="${symbol === item.symbol}"${item.name ? ` title="${escape(item.name)}"` : ''}>${escape(item.symbol)}</button>`).join('');
  const quick = choices ? `<div class="ws-quick-monitor"><span>自选</span><div class="ws-quick-symbols" role="group" aria-label="快速切换自选标的">${choices}</div></div>` : '';
  const utilities = action(ctx, '行情来源', 'market-feed', { icon: 'activity' }) + action(ctx, '导入行情', 'import-history', { icon: 'upload' });
  const panel = `<section class="ws-market-main"><header class="ws-market-heading"><div><h2>${escape(symbol || '选择自选标的')}</h2>${symbol ? `<p>${name && name !== symbol ? `${escape(name)} · ` : ''}${escape(ctx.exchangeLabel(symbol))} · ${ctx.displayedCurrency}</p>` : ''}</div><span class="quote-signal" data-status="${escape(marketStatus)}">${escape(marketLabel)}</span></header>
    <div id="market-mark">${renderMarketQuote(ctx)}</div>
    <div id="market-trend" class="ws-market-chart">${ctx.renderInstrumentTrend(ctx)}</div>
    ${quick}
    <div id="market-indicators" class="ws-chart-metrics">${renderDailyIndicators(ctx)}</div>
    ${symbol ? `<div class="ws-result-actions ws-market-actions">${action(ctx, '研究此标的', 'research-symbol', { icon: 'search' })}${action(ctx, '规划交易', 'trade-symbol', { icon: 'arrow-right', primary: true })}</div>` : ''}
    <div class="ws-market-utilities ws-market-utilities-mobile">${utilities}</div>
    <div id="market-pulse">${renderMarketPulse(ctx)}</div>
  </section>`;
  return `${heading('市场观察', `<div class="ws-market-utilities ws-market-utilities-desktop">${utilities}</div>` + action(ctx, '添加自选', 'add-watch', { icon: 'plus', primary: true }))}<div class="ws-grid ws-grid-market">${panel}${watch}</div>`;
}

export function renderDailyIndicators(ctx) {
  const values = ctx.indicators ?? {};
  return `${metric('MA20', valueOrDash(values.ma20, ctx.money))}${metric('MA50', valueOrDash(values.ma50, ctx.money))}${metric('RSI (14)', valueOrDash(values.rsi ?? values.rsi14, formatRsi.format))}`;
}

export function renderTradeResult(ctx) {
  if (ctx.privateAmounts) return '<p class="private-panel">仓位、投入和盈亏测算已隐藏</p>';
  const result = ctx.trade;
  const ready = result?.valid && hasNumber(result.shares);
  return `<div class="ws-result-lead"><span>可买入数量</span><strong>${ready ? ctx.number(result.shares) : '—'} <small>股</small></strong>${ready ? '' : `<p>${escape(result?.error || '填写入场、目标及止损价格以计算仓位。')}</p>`}</div>
    <dl class="ws-result-list"><div><dt>投入金额</dt><dd>${ready ? valueOrDash(result.investment, ctx.money) : '—'}</dd></div><div><dt>盈亏比</dt><dd>${ready && hasNumber(result.ratio) ? `${ctx.number(result.ratio)} : 1` : '—'}</dd></div><div><dt>目标价潜在盈利</dt><dd class="ws-positive">${ready ? valueOrDash(result.reward, ctx.signedMoney) : '—'}</dd></div><div><dt>止损价潜在亏损</dt><dd class="ws-negative">${ready ? valueOrDash(-Math.abs(result.risk), ctx.signedMoney) : '—'}</dd></div></dl>`;
}

function tradesPage(ctx) {
  const { state, tradeInputs = {}, displayedCurrency: unit, privateAmounts } = ctx;
  const form = `<form id="trade-form" class="ws-form">${symbolField('trade-symbol', '交易标的', state, tradeInputs.symbol ?? ctx.symbol)}
    <div class="ws-fields ws-fields-three">${decimalField('trade', 'entry', '入场价', tradeInputs.entry, unit, 'min="0"')}${decimalField('trade', 'target', '目标价', tradeInputs.target, unit, 'min="0"')}${decimalField('trade', 'stop', '止损价', tradeInputs.stop, unit, 'min="0"')}</div>
    <div class="ws-fields">${decimalField('trade', 'amount', '投入上限', tradeInputs.amount, unit, 'min="0"', privateAmounts)}${decimalField('trade', 'riskPercent', '单笔风险预算', tradeInputs.riskPercent, '%', 'min="0" max="100"')}</div>
    ${unit === 'USD' ? `<label class="ws-toggle"><input type="checkbox" id="trade-fractional" name="fractional"${tradeInputs.fractional === false ? '' : ' checked'}><span>允许碎股</span></label>` : '<p class="ws-footnote">按整股估算，申报数量以券商和交易所规则为准。</p>'}
    <div class="ws-cash-context"><span>可用现金</span><strong>${privateValue(privateAmounts, ctx.tradeCash, ctx.money)}</strong></div>
  </form>`;
  const tradeRows = state.trades?.length ? `<div class="ws-table-scroll"><table class="ws-table ws-plan-table" role="table"><thead role="rowgroup"><tr role="row"><th scope="col">标的</th><th scope="col">入场价</th><th scope="col">目标价</th><th scope="col">止损价</th><th scope="col">买入数量</th><th scope="col"><span class="ws-visually-hidden">操作</span></th></tr></thead><tbody role="rowgroup">${state.trades.map(trade => {
    const planMoney = (value) => ctx.money(value, ctx.instrumentCurrency(trade.symbol));
    return `<tr role="row"><th class="ws-plan-identity" scope="row">${escape(trade.symbol)}</th><td role="cell" data-label="入场价">${privateValue(privateAmounts, trade.entry, planMoney)}</td><td role="cell" data-label="目标价">${privateValue(privateAmounts, trade.target, planMoney)}</td><td role="cell" data-label="止损价">${privateValue(privateAmounts, trade.stop, planMoney)}</td><td role="cell" data-label="买入数量">${privateValue(privateAmounts, trade.shares ?? trade.result?.shares, ctx.number)}</td><td role="cell" class="ws-plan-actions">${iconAction(ctx, `删除 ${trade.symbol} 计划`, 'delete-trade', 'trash', `data-id="${escape(trade.id)}"`)}</td></tr>`;
  }).join('')}</tbody></table></div>` : empty('暂无已保存计划。');
  const results = `<div id="trade-results" class="ws-results" aria-live="polite">${renderTradeResult(ctx)}</div><div class="ws-result-actions">${action(ctx, '保存交易计划', 'save-trade', { icon: 'bookmark', primary: true })}</div>`;
  return `${heading('交易工作台')}<div class="ws-grid ws-grid-trade">${section('交易参数', form)}${section('仓位计算', results, '', 'ws-calculation')}</div>${section('已保存计划', tradeRows, `<span class="ws-section-meta">${state.trades?.length ?? 0} 笔计划</span>`, 'ws-spaced')}`;
}

const riskTabs = [['stress', '压力测试'], ['simulation', '调仓模拟'], ['diagnosis', '组合诊断']];
const riskPresets = [['回调', -10], ['深度调整', -20], ['极端冲击', -35], ['反弹', 10]];

function riskSelect(ctx, id, label, selection, optional = false) {
  const positions = [...new Set((ctx.state.holdings ?? []).filter((item) => item.shares > 0 && item.source !== 'demo').map((item) => item.symbol))];
  return `<label class="ws-field" for="${id}"><span>${label}</span><select id="${id}" name="symbol"${optional ? '' : ' required'}>
    <option value="">${optional ? '全部跟随市场' : '选择持仓'}</option>${positions.map((symbol) =>
    `<option value="${escape(symbol)}"${selection === symbol ? ' selected' : ''}>${escape(symbol)}</option>`).join('')}</select></label>`;
}

function riskScenarioForm(ctx) {
  const shock = ctx.riskLab?.stress?.marketShock ?? ctx.shock ?? -20;
  const scenario = ctx.riskScenario ?? {};
  const { symbol = '', shock: singleShock = -40 } = scenario;
  return `<form id="risk-scenario-form" class="ws-risk-form ws-stress">
    <div class="ws-workspace-row"><h2>市场情景</h2></div>
    <div class="ws-risk-presets" role="group" aria-label="组合冲击预设">${riskPresets.map(([label, value]) =>
      `<button type="button" data-action="risk-shock-preset" data-shock="${value}" aria-pressed="${shock === value}"><span>${label}</span><strong>${ctx.signedPercent(value)}</strong></button>`).join('')}</div>
    <div class="ws-risk-range"><label class="ws-slider-label" for="risk-shock"><span>市场冲击幅度</span><output id="risk-shock-value" for="risk-shock">${ctx.signedPercent(shock)}</output></label>
      <input type="range" id="risk-shock" name="marketShock" min="-100" max="100" step="1" value="${escape(shock)}" style="--risk-progress:${(shock + 100) / 2}%"><div class="ws-slider-ticks"><span>−100%</span><span>0%</span><span>+100%</span></div></div>
    <fieldset class="ws-risk-override"><legend>单一持仓情景</legend><div class="ws-fields">${riskSelect(ctx, 'risk-scenario-symbol', '冲击标的', symbol, true)}
      ${decimalField('risk-scenario', 'holdingShock', '标的涨跌', singleShock, '%', 'min="-100" max="100" required')}</div></fieldset>
    <p class="ws-footnote">选中标的后，以单一涨跌幅替代该标的的市场冲击。现金余额保持平稳。</p>
    <div><button type="submit" class="button ws-button">应用单一情景</button></div>
  </form>`;
}

function riskSimulationForm(ctx) {
  const simulation = ctx.riskSimulation ?? {};
  return `<form id="risk-simulation-form" class="ws-risk-form">
    <div class="ws-workspace-row"><h2>目标仓位</h2></div>
    <div class="ws-fields">${riskSelect(ctx, 'risk-simulation-symbol', '调整标的', simulation.symbol)}
      ${decimalField('risk-simulation', 'targetWeight', '目标占总资产', simulation.targetWeight ?? ctx.state.riskProfile?.cap ?? 25, '%', 'min="0" max="100" required')}</div>
    <p class="ws-footnote">增配使用同币种现金，减仓所得回到现金。试算沿用已应用的市场及单一标的情景。</p>
    <div><button type="submit" class="button ws-button ws-button-primary primary"${ctx.state.holdings.some((item) => item.shares > 0 && item.source !== 'demo') ? '' : ' disabled'}>计算调仓影响</button></div>
  </form>`;
}

function renderRiskStress(ctx) {
  const s = ctx.riskLab?.stress;
  if (!s || ctx.riskLab.status === 'empty') return empty('添加持仓及估值后查看情景影响。');
  const lossRows = (s.contributions ?? []).slice(0, 12);
  const contributions = lossRows.length ? `<table class="ws-risk-table ws-risk-contributions"><thead><tr><th scope="col">标的</th><th scope="col">情景涨跌</th><th scope="col">资产变化</th></tr></thead><tbody>
    ${lossRows.map((item) => `<tr><th scope="row">${escape(item.symbol)}${item.symbol === s.specificSymbol ? '<small>单一情景</small>' : ''}</th><td>${ctx.signedPercent(item.shock)}</td><td class="${tone(item.pnl)}">${ctx.signedMoney(item.pnl)}</td></tr>`).join('')}
  </tbody></table>` : empty('当前币种暂无可估值持仓。');
  return `<div class="ws-risk-results-stack"><div class="ws-workspace-row"><h2>组合受压结果</h2>${s.specificSymbol ? `<span class="ws-section-meta">${escape(s.specificSymbol)} ${ctx.signedPercent(s.specificShock)} · 其余持仓 ${ctx.signedPercent(s.marketShock)}</span>` : ''}</div>
    <div class="ws-risk-pnl" aria-live="polite"><span>资产变化</span><strong class="${tone(s.pnl)}">${valueOrDash(s.pnl, ctx.signedMoney)}</strong></div>
    <dl class="ws-risk-pair"><div><dt>组合变动</dt><dd class="${tone(s.changePercent)}">${valueOrDash(s.changePercent, ctx.signedPercent)}</dd></div><div><dt>情景后资产</dt><dd>${valueOrDash(s.totalAfter, ctx.money)}</dd></div></dl>
    ${ctx.riskLab.incomplete ? `<p class="ws-footnote ws-valuation-note">仅试算有估值的持仓。覆盖 ${s.valuedPositions} / ${s.totalPositions} 个持仓标的。</p>` : ''}
    <div class="ws-risk-ledger"><div class="ws-workspace-row"><h3>持仓损益贡献</h3>${s.contributions?.length > lossRows.length ? `<span class="ws-section-meta">显示 ${lossRows.length} / ${s.contributions.length}</span>` : ''}</div>${contributions}</div>
  </div>`;
}

function renderRiskSimulation(ctx) {
  const simulation = ctx.riskLab?.simulation;
  if (simulation?.status !== 'ready') return empty(simulation?.reason ?? '选择持仓并输入目标占比，即可比较调整前后。');
  const { before, after, order, history } = simulation;
  const line = (label, first, last, format) => [label, valueOrDash(first, format), valueOrDash(last, format)];
  const beta = history?.reference;
  const comparison = [
    line('标的仓位', before.weight, after.weight, ctx.percent),
    line('最大单一仓位', before.maximumWeight, after.maximumWeight, ctx.percent),
    line('现金余额', before.cash, after.cash, ctx.money),
    line('现金占比', before.cashPercent, after.cashPercent, ctx.percent),
    line('当前情景损益', before.stressPnl, after.stressPnl, ctx.signedMoney),
    ...(history ? [
      line('回放区间收益', history.before?.periodReturn, history.after?.periodReturn, ctx.signedPercent),
      line('年化波动', history.before?.volatility, history.after?.volatility, ctx.percent),
      line('最大回撤', history.before?.drawdown, history.after?.drawdown, ctx.percent),
    ] : []),
    ...(hasNumber(beta?.before) && hasNumber(beta?.after) ? [
      line('相对基准 β', beta.before, beta.after, (value) => value.toFixed(2)),
    ] : []),
  ];
  const side = { buy: '增加', sell: '减少', none: '保持' }[order.side];
  const limitNotice = { reserve: '增配受现金储备约束。', lot: '目标与测算仓位的差异来自可用交易单位。' }[simulation.limitedBy];
  return `<div class="ws-risk-results-stack"><div class="ws-workspace-row"><h2>调仓前后</h2><span class="ws-section-meta">${escape(simulation.symbol)} · 目标 ${ctx.percent(simulation.targetWeight)}</span></div>
    <div class="ws-risk-order"><strong>${side} ${ctx.number(order.shares)} 股</strong><span>参考价 ${ctx.money(order.price)} · 变动市值 ${ctx.money(order.amount)}</span></div>
    ${limitNotice ? `<p class="ws-footnote">${limitNotice}</p>` : ''}
    <table class="ws-risk-table ws-risk-compare"><thead><tr><th scope="col">指标</th><th scope="col">调整前</th><th scope="col">调整后</th></tr></thead><tbody>
      ${comparison.map(([label, first, last]) => `<tr><th scope="row">${label}</th><td>${escape(first)}</td><td>${escape(last)}</td></tr>`).join('')}</tbody></table>
    <p class="ws-footnote">${history ? `${escape(history.from)} 至 ${escape(history.through)}，${history.observations} 段共同交易日收益按固定权重回放。` : '共同交易日历史不足，暂缺波动与回撤比较。'}${hasNumber(beta?.before) && hasNumber(beta?.after) ? ` β 使用 ${ctx.portfolioCurrency === 'CNY' ? '沪深 300 ETF' : 'SPY'} 的 ${beta.observations} 段共同交易日收益。` : ''} 股数按估值参考价换算，费用与汇率变动未计入。</p>
  </div>`;
}

function renderRiskDiagnosis(ctx) {
  const concentration = ctx.riskLab?.concentration;
  if (!concentration) return renderPortfolioDiagnosis(ctx);
  const allocation = ctx.riskLab.positions.map(({ symbol, weight }) => ({ label: symbol, weight }));
  if (concentration.cashPercent > 0) allocation.push({ label: '现金', weight: concentration.cashPercent });
  const bars = allocation?.length ? `<ul class="ws-exposure">${allocation.map(({ label, weight }, index) => `<li><span>${escape(label)}</span><div class="ws-bar"><i style="width:${hasNumber(weight) ? Math.max(0, Math.min(100, weight)) : 0}%;opacity:${Math.max(0.3, 1 - index * 0.14)}"></i></div><strong>${valueOrDash(weight, ctx.percent)}</strong></li>`).join('')}</ul>` : empty('添加持仓或现金后查看资产分布。');
  const { top3, effectiveHoldings, overCap } = concentration;
  return `<div class="ws-grid ws-risk-diagnosis"><section class="ws-risk-results-stack"><div class="ws-workspace-row"><h2>风险集中度</h2></div>
    <dl class="ws-risk-pair"><div><dt>前三持仓占比</dt><dd>${valueOrDash(top3, ctx.percent)}</dd></div><div><dt>等效持仓数</dt><dd>${effectiveHoldings > 0 ? effectiveHoldings.toFixed(1) : '—'}</dd></div></dl>
    <p class="ws-footnote">等效持仓数按已投资部分的仓位集中程度计算。</p>
    ${overCap?.length ? `<p class="ws-risk-limit">超过仓位上限 · ${overCap.map(({ symbol, weight }) => escape(symbol) + ' ' + ctx.percent(weight)).join('、')}</p>` : ''}
    ${bars}</section><section class="ws-risk-results-stack"><div class="ws-workspace-row"><h2>敞口与相关性</h2></div>${renderPortfolioDiagnosis(ctx)}</section></div>`;
}

export function renderRiskResult(ctx) {
  if (ctx.privateAmounts) return '<p class="private-panel">组合数据已隐藏</p>';
  const render = { stress: renderRiskStress, simulation: renderRiskSimulation, diagnosis: renderRiskDiagnosis };
  return render[activeTab(riskTabs, ctx.riskTab)](ctx);
}

export function renderRiskKpis(ctx) {
  const { state, summary, privateAmounts } = ctx;
  const concentration = ctx.riskLab?.concentration ?? summary;
  const { cashPercent, largest: top } = concentration;
  const drawdown = ctx.riskLab?.history?.before?.drawdown ?? (!ctx.riskLab ? ctx.stress?.drawdown : null);
  const drawdownLabel = hasNumber(drawdown) ? '按当前仓位回放' : '组合历史不足';
  return `${metric('最大单一仓位', privateValue(privateAmounts, top?.weight, ctx.percent), privateAmounts ? '' : top ? escape(top.symbol) : '暂无持仓')}
    ${metric('现金占比', privateValue(privateAmounts, cashPercent, ctx.percent), privateAmounts ? '' : ctx.money(state.cash))}
    ${metric('最大回撤', privateValue(privateAmounts, drawdown, ctx.percent), privateAmounts ? '' : drawdownLabel)}`;
}

function riskPage(ctx) {
  const { privateAmounts } = ctx;
  const tab = activeTab(riskTabs, ctx.riskTab);
  const panels = tabPanels('risk', riskTabs, tab, (key, selected) => {
    if (!selected) return '';
    const results = `<div id="risk-results" class="ws-risk-result">${renderRiskResult(ctx)}</div>`;
    if (privateAmounts || key === 'diagnosis') return results;
    return `<div class="ws-grid ws-risk-grid">${key === 'stress' ? riskScenarioForm(ctx) : riskSimulationForm(ctx)}${results}</div>`;
  });
  return `${heading('风险实验室', action(ctx, '风险参数', 'risk-parameters', { icon: 'sliders' }))}
    <div id="risk-kpis" class="ws-metrics ws-risk-kpis">${renderRiskKpis(ctx)}</div>
    <div class="ws-risk-workspace">${tabNavigation('risk', riskTabs, tab, '风险视图')}${panels}</div>`;
}

function facts(items) {
  return `<dl class="ws-result-list">${items.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
}

export function renderMarketPulse(ctx) {
  const pulse = ctx.marketPulse;
  if (!pulse) return '';
  const items = Array.isArray(pulse.items) ? pulse.items : [];
  const move = pulse.relativeMove;
  const explanation = pulse.cause?.verified && pulse.cause.source ? pulse.cause : null;
  const news = renderRelatedNews(pulse.related);
  const relative = hasNumber(move) ? `${pulse.latest?.label ?? ctx.symbol} 较${items[0]?.label ?? '基准'} ${move > 0 ? '+' : ''}${move.toFixed(2)} 个百分点` : typeof move === 'string' ? move : '';
  if (!items.length && !relative && !explanation && !news && !pulse.summary) return '';
  return `<section class="ws-market-pulse"><div class="ws-workspace-row"><h2>${escape(pulse.title ?? '市场脉搏')}</h2><a class="link-button" href="#opportunities">投资机会 ${ctx.icons('arrow', 14)}</a></div>
    ${pulse.summary ? `<p class="ws-footnote">${escape(pulse.summary)}</p>` : ''}
    ${relative ? `<p class="ws-pulse-move"><span>相对走势</span> ${escape(relative)}</p>` : ''}
    ${items.length ? `<dl class="ws-pulse-items">${items.slice(0, 4).map((item) => `<div><dt>${escape(item.label)}</dt><dd class="${tone(item.value)}">${escape(hasNumber(item.value) ? ctx.signedPercent(item.value) : item.value ?? '—')}</dd>${item.detail || item.source ? `<small>${escape(item.detail ?? '')}${item.source ? `${item.detail ? ' · ' : ''}${sourceLink(item.url, item.source)}` : ''}</small>` : ''}</div>`).join('')}</dl>` : ''}
    ${explanation ? `<p class="ws-footnote">${escape(explanation.text ?? explanation.detail)} · ${sourceLink(explanation.url, explanation.source)}</p>` : ''}${news}</section>`;
}

export function renderPortfolioDiagnosis(ctx) {
  if (ctx.privateAmounts) return '<p class="private-panel">组合诊断已隐藏</p>';
  const result = ctx.diagnostics;
  if (!result || result.empty) return empty('需要真实持仓及有效估值才能进行组合诊断。');
  const { pairs, rebalance, scenario, history } = result;
  const pairRows = pairs.map(({ left, right, coefficient, observations, exposure }) =>
    [left + ' / ' + right, `相关 ${coefficient.toFixed(2)} · ${observations} 期 · 合计 ${ctx.percent(exposure)}`]);
  const comparison = history ? `<p class="ws-footnote">${escape(history.from)} 至 ${escape(history.through)}，${history.observations} 段共同交易日收益，按当前固定权重重放，现金收益取 0。</p>
    ${facts([['区间收益', ctx.signedPercent(history.before.periodReturn) + (history.after ? ' → ' + ctx.signedPercent(history.after.periodReturn) : '')],
      ['年化观察波动', ctx.percent(history.before.volatility) + (history.after ? ' → ' + ctx.percent(history.after.volatility) : '')],
      ['最大回撤', ctx.percent(history.before.drawdown) + (history.after ? ' → ' + ctx.percent(history.after.drawdown) : '')]])}` : empty('同币种持仓共同日线不足，未比较历史风险。');
  return `<p class="ws-analysis-summary">${result.incomplete ? '部分持仓待估值，暂不计算调仓数量及可配置资金。' : rebalance ? `${rebalance.symbol} 超过你设定的单标的上限。可试算降低至 ${ctx.percent(result.cap)} 后的风险。` : '已估值持仓在设定的单标的上限内。'}</p>
    ${facts([['目标储备后可配置现金', valueOrDash(result.deployable, ctx.money)],
      ...(rebalance ? [['降至上限的减仓情景', `${ctx.money(rebalance.value)} · 约 ${ctx.number(rebalance.shares)} 股`]] : [])])}
    <details class="ws-analysis-details"><summary>相关敞口与历史比较</summary>
      ${pairs.length ? facts(pairRows) : empty('有效样本内暂无相关系数达到 0.75 的持仓对，或共同样本不足。')}
      <p class="ws-footnote">按共同交易日日收益估计，覆盖最大 ${result.pairedCoverage} 个标的。ETF 成分重叠需查看基金实际披露。</p>${comparison}
    </details>
    <details class="ws-analysis-details"><summary>组合情景速查</summary>
      ${facts([[`全部持仓 ${ctx.signedPercent(ctx.shock)}`, ctx.signedMoney(scenario.all) + (rebalance ? ' → ' + ctx.signedMoney(scenario.after) : '')],
      ['最大持仓单独受冲击', ctx.signedMoney(scenario.largest)], ...(scenario.paired === null ? [] : [['高相关持仓同时受冲击', ctx.signedMoney(scenario.paired)]]),
      ['全部持仓反弹 10%', ctx.signedMoney(scenario.recovery) + (rebalance ? ' → ' + ctx.signedMoney(scenario.recoveryAfter) : '')]])}</details>
    ${ctx.alternative ? `<section class="ws-analysis-details"><h3>${escape(ctx.alternative.kind)} · ${escape(ctx.alternative.ticker)}</h3>
      <p class="ws-footnote">待入场条件满足后复核。比较使用 ${ctx.alternative.observations} 段共同交易日及 1% 单笔风险预算。
      ${ctx.alternative.from ? '需要先从 ' + escape(ctx.alternative.from) + ' 释放资金。' : ''}</p>
      ${facts([['新增资金与数量', ctx.money(ctx.alternative.amount) + ' · ' + ctx.number(ctx.alternative.shares) + ' 股'],
        ['增配后仓位', ctx.percent(ctx.alternative.nextWeight)], ['年化波动', ctx.percent(ctx.alternative.beforeVol) + ' → ' + ctx.percent(ctx.alternative.afterVol)],
        ['历史回撤', ctx.percent(ctx.alternative.beforeDrawdown) + ' → ' + ctx.percent(ctx.alternative.afterDrawdown)]])}</section>`
      : '<p class="ws-footnote">增配和替换使用同币种候选的共同日线。<a class="link-button" href="#opportunities">筛查投资机会</a></p>'}`;
}

const localAlertLabels = { above: '价格达到', below: '价格跌至', event: '事件时间', invalidate: '策略失效', opportunity: '机会触发' };
const readableDate = (value) => !value ? '时间未披露' : String(value).length === 10 ? String(value) : new Date(value).toLocaleString('zh-CN', { hour12: false });
function sourceLink(url, source) {
  try {
    const address = new URL(url);
    if (address.protocol === 'https:' && !address.username && !address.password) {
      const target = globalThis.location?.hostname === 'mono.android.local' ? '' : ' target="_blank"';
      return `<a href="${escape(address.href)}"${target} rel="noopener noreferrer">${escape(source)}</a>`;
    }
  } catch { /* show the available attribution text */ }
  return escape(source ?? '');
}

const researchTabs = [['overview', '概览'], ['basis', '依据'], ['evidence', '数据'], ['tracking', '跟踪']];
const quantTabs = [['analysis', '量化分析'], ['validation', '样本验证'], ['external', '外部模型']];
const activeTab = (tabs, value) => tabs.find(([key]) => key === value)?.[0] ?? tabs[0][0];

function tabNavigation(workspace, tabs, active, label) {
  return `<div class="ws-subview-tabs" role="tablist" aria-label="${label}">${tabs.map(([key, title]) =>
    `<button type="button" role="tab" id="${workspace}-tab-${key}" data-action="${workspace}-tab" data-${workspace}-tab="${key}" aria-selected="${key === active}" aria-controls="${workspace}-panel-${key}" tabindex="${key === active ? '0' : '-1'}">${title}</button>`).join('')}</div>`;
}

function tabPanels(workspace, tabs, active, render) {
  return tabs.map(([key]) => `<section role="tabpanel" class="ws-subview-panel" data-subview="${key}" id="${workspace}-panel-${key}" aria-labelledby="${workspace}-tab-${key}"${key === active ? '' : ' hidden'}>${render(key, key === active)}</section>`).join('');
}

function renderRelatedNews(news) {
  const related = Array.isArray(news) ? news : news?.related ?? news?.items ?? [];
  if (!related.length) return '';
  return `<section class="ws-evidence-group"><h3>相关报道与公告</h3><ul class="ws-rule-list">${related.slice(0, 5).map((item) => `<li><span><b>${escape(item.title ?? item.label)}</b><span>${sourceLink(item.url, item.source)}${item.asOf || item.publishedAt ? ' · ' + escape(readableDate(item.publishedAt ?? item.asOf)) : ''}</span>${item.detail ? `<span>${escape(item.detail)}</span>` : ''}</span></li>`).join('')}</ul></section>`;
}

function renderEvidence(ctx) {
  const source = ctx.evidence ?? {};
  const liveRatios = (ctx.strategy?.evidence?.valuation ?? []).filter((item) => /腾讯财经/.test(item.source ?? '') && ['peTtm', 'priceToBook'].includes(item.metric));
  const groups = [['财报与基金披露', source.fundamentals], ['估值', [...liveRatios, ...(source.valuation ?? [])]], ['宏观', source.macro], ['公告与申报', source.events?.filter((item) => item.kind !== 'news')], ['市场情绪', source.sentiment]];
  const rows = groups.map(([label, records]) => `<section class="ws-evidence-group"><h3>${label}</h3>${records?.length ? `<ul class="ws-rule-list">${records.slice(0, 8).map((item) => `<li><span><b>${escape(item.label)}${item.value == null || item.value === '' ? '' : ' · ' + escape(item.value) + escape(item.unit ?? '')}</b><span>${item.imported ? '导入 · ' : ''}${sourceLink(item.url, item.source)} · ${escape(readableDate(item.asOf))}${item.publishedAt ? ' · 发布 ' + escape(readableDate(item.publishedAt)) : ''}</span>${item.detail ? `<span>${escape(item.detail)}</span>` : ''}</span></li>`).join('')}</ul>` : '<p class="ws-footnote">暂无可核验数据</p>'}</section>`).join('');
  const status = ctx.evidenceState ? '正在获取数据…' : source.imported ? '含手动导入快照' : '';
  const controls = action(ctx, '更新研究数据', 'research-refresh', { icon: 'activity' })
    + action(ctx, '导入研究数据', 'research-import', { icon: 'import' }) + action(ctx, '数据设置', 'research-data', { icon: 'settings' })
    + (source.imported ? action(ctx, '移除导入快照', 'research-online') : '');
  const coverage = (source.coverage ?? []).map((row) => [row.source, [({ available: '已取得', cached: '缓存', stale: '上次记录', unavailable: '暂缺' })[row.status] ?? '待核验', row.records ? row.records + ' 条' : ''].filter(Boolean).join(' · ')]);
  return `<div class="ws-research-evidence"><div class="ws-workspace-row"><h2>数据来源与时效</h2><div class="ws-actions">${controls}</div></div>
    ${status ? `<p class="ws-footnote ws-data-status" role="status">${status}</p>` : ''}
    <div class="ws-source-summary"><div><span>行情</span><strong>${quoteSourceLink(ctx.quote, ctx.symbol)} ${quoteDate(ctx.quote)}</strong>${hasNumber(ctx.strategy?.data?.quoteAgeSeconds) ? `<small>距数据源时间约 ${Math.max(0, Math.round(ctx.strategy.data.quoteAgeSeconds / 60))} 分钟</small>` : ''}</div>
    ${ctx.strategy?.data?.historySource ? `<div><span>日线</span><strong>${escape(ctx.strategy.data.historySource)}</strong><small>${escape(ctx.strategy.data.lastBarDate ?? ctx.strategy.data.lastDate ?? '')}</small></div>` : ''}</div>
    ${source.archive ? `<p class="ws-footnote">查找历史原文 · ${sourceLink(source.archive.url, source.archive.label)}</p>` : ''}
    <div class="ws-evidence-grid">${rows}</div>${renderRelatedNews(ctx.newsContext)}
    ${coverage.length ? `<details class="ws-analysis-details"><summary>覆盖与可用性</summary>${facts(coverage)}</details>` : ''}
    ${source.errors?.length ? `<details class="ws-analysis-details"><summary>数据获取记录</summary><ul class="ws-rule-list">${source.errors.slice(0, 5).map(({ source, message }) => `<li>${escape([source, message].filter(Boolean).join(' · '))}</li>`).join('')}</ul></details>` : ''}</div>`;
}

function renderTracking(ctx) {
  const newest = ctx.journal?.versions?.[0];
  const previous = ctx.journal?.versions?.[1];
  const tracking = ctx.journal && !ctx.journal.paused;
  const log = newest ? `<div class="ws-tracking-state"><p>最近记录 <strong>${escape(newest.action)}</strong><small>${escape(readableDate(newest.at))}</small></p>
    ${previous ? `<p>上一判断 <strong>${escape(previous.action)}</strong><small>${escape(readableDate(previous.at))}</small></p>` : ''}
    <p>${escape(newest.change)} · ${escape(newest.reason)}</p>
    ${newest.next ? `<p>下一条件 · ${escape(newest.next)}</p>` : ''}
    ${ctx.journal.versions.length > 1 ? `<details class="ws-analysis-details"><summary>策略历史 · ${ctx.journal.versions.length} 版</summary>${ctx.journal.versions.slice(1).map((version) =>
      `<p>${escape(readableDate(version.at))} · ${escape(version.action)} · ${escape(version.reason)}${!ctx.privateAmounts && hasNumber(version.entry) ? ` · 入场 ${ctx.money(version.entry)} / 失效 ${ctx.money(version.stop)}` : ''}</p>`).join('')}</details>` : ''}
    </div>` : '';
  const alerts = (ctx.alerts ?? []).map((alert) => `<li><span><b>${escape(localAlertLabels[alert.type])}${!ctx.privateAmounts && hasNumber(alert.price) ? ' · ' + ctx.money(alert.price) : ''}</b>
    <span>${alert.firedAt ? '已触发 · ' + escape(readableDate(alert.firedAt)) : alert.date ? escape(readableDate(alert.date)) : '等待条件'}</span></span>
    ${iconAction(ctx, '移除提醒', 'remove-research-alert', 'trash', `data-id="${escape(alert.id)}"`)}</li>`).join('');
  return `<div class="ws-grid ws-research-tracking"><section class="ws-research-section"><div class="ws-workspace-row"><h2>策略跟踪</h2>${action(ctx, tracking ? '暂停跟踪' : '跟踪当前策略', 'track-strategy', { icon: 'bookmark' })}</div>${log || empty('跟踪后可查看判断变化与最近触发条件。')}</section>
    <section class="ws-research-section"><div class="ws-workspace-row"><h2>条件提醒</h2>${action(ctx, '新建提醒', 'add-research-alert', { icon: 'plus', primary: true })}</div>
    ${alerts ? `<ul class="ws-rule-list">${alerts}</ul>` : empty('暂无提醒。')}
    <p class="ws-footnote ws-monitor-note">在应用打开并收到数据时检查。已触发的提醒保存在本机。</p></section></div>`;
}

function renderResearchSizing(ctx) {
  const { plan, levelSource } = ctx.strategy;
  const size = plan?.size;
  const levels = plan?.levels;
  return `<details class="ws-analysis-details"><summary>仓位与退出情景</summary>
    ${levels ? `<p class="ws-footnote">${escape(levels.basis)}${levels.supportDate ? ' · 支撑 ' + escape(levels.supportDate) : ''}${levels.resistanceDate ? ' · 阻力 ' + escape(levels.resistanceDate) : ''}${levelSource === 'manual' ? ' · 用户输入' : ''}</p>` : ''}
    ${ctx.privateAmounts ? '<p class="private-panel">仓位与金额已隐藏</p>' : size?.valid && size.shares > 0 ? facts([
      ['预算内投入', ctx.money(size.investment)], ['数量', ctx.number(size.shares) + ' 股'],
      ['新增后仓位', valueOrDash(size.postWeight, ctx.percent)], ['到失效价的情景损失', ctx.money(size.risk)],
      ['到目标价的情景收益', ctx.money(size.reward)],
    ]) : empty(size?.note ?? size?.error ?? '可用资金、有效价位与风险预算齐备后才能估算仓位。')}
    ${size?.valid && size.note ? `<p class="ws-footnote">${escape(size.note)}</p>` : ''}
    ${ctx.strategy.scenarios?.length ? `<ul class="ws-rule-list">${ctx.strategy.scenarios.map((item) => `<li><span><b>${escape(item.label)} · ${escape(item.action)}</b><span>${escape(item.condition)}</span></span></li>`).join('')}</ul>` : ''}
  </details>`;
}

function renderConditions(ctx) {
  const conditions = ctx.strategy?.conditions ?? [];
  return `<section class="ws-research-basis-list"><div class="ws-workspace-row"><h2>判断依据</h2></div>${conditions.length ? `<ul class="ws-rule-list">${conditions.map(({ label, detail, status, sources, url, asOf, sourceLabel }) => `<li><span><b>${escape(label)}</b><span>${escape(detail)}</span>${url ? `<span>${sourceLink(url, sourceLabel ?? '核验出处')} · ${escape(readableDate(asOf))}</span>` : ''}
    ${sources?.map((item) => `<span>${sourceLink(item.url, item.source)} · ${escape(readableDate(item.asOf))}</span>`).join('') ?? ''}</span><small data-status="${escape(status)}">${({ pass: '满足', watch: '观察', fail: '未满足', pending: '待核验' })[status] ?? '待核验'}</small></li>`).join('')}</ul>` : empty('暂无可核验的判断依据。')}
    ${ctx.strategy.uncertainty?.length ? `<p class="ws-footnote">${ctx.strategy.uncertainty.map(escape).join('；')}</p>` : ''}</section>`;
}

function renderResearchOverview(ctx) {
  const { strategy } = ctx;
  const { entry, target, stop, ratio, decision, horizons } = strategy;
  const horizon = horizons?.find(({ key }) => key === (strategy.horizon ?? ctx.researchInputs?.horizon ?? 'mid'));
  const zone = strategy.plan?.entryZone ?? horizon?.entryZone;
  const event = strategy.conditions?.find(({ key }) => key === 'events');
  const leadNews = ctx.newsContext?.[0];
  const size = strategy.plan?.size;
  const manual = strategy.plan?.source === 'manual';
  const levels = [[manual ? '手填入场' : '入场区间', zone && zone.low !== zone.high ? `${ctx.money(zone.low)} – ${ctx.money(zone.high)}` : valueOrDash(entry, ctx.money)],
    [manual ? '手填目标' : '目标情景', valueOrDash(target, ctx.money)], [manual ? '手填失效' : '失效价', valueOrDash(stop, ctx.money)]];
  const blocked = decision?.status === 'blocked';
  const transferIsPrimary = strategy.canTransfer && (!manual || decision?.status === 'opportunity');
  const button = transferIsPrimary
    ? action(ctx, manual ? '带入手填情景' : '带入交易工作台', 'use-strategy', { icon: 'arrow-up-right', primary: true })
    : action(ctx, blocked ? '查看数据' : '编辑假设', 'research-tab', { icon: blocked ? 'activity' : 'edit', data: `data-research-tab="${blocked ? 'evidence' : 'basis'}"` });
  const briefSize = size?.valid && size.shares > 0 && !ctx.privateAmounts ? `预算内 ${ctx.number(size.shares)} 股 · ${ctx.money(size.investment)}` : '';
  const transferManual = manual && strategy.canTransfer && !transferIsPrimary;
  return `<section class="ws-research-thesis" data-status="${escape(decision?.status)}"><div class="ws-research-thesis-copy"><p>普通决策${horizon?.label ? ' · ' + escape(horizon.label) : ''}</p><h2>${escape(decision?.action ?? '继续观察')}</h2><p>${escape(decision?.reason ?? strategy.summary)}</p></div><div class="ws-actions">${button}</div></section>
    ${strategy.manualScenario?.valid === false ? `<p class="ws-footnote ws-research-input-note">${escape(strategy.manualScenario.reason)}</p>` : ''}
    <dl class="ws-research-levels">${levels.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    ${(hasNumber(ratio) || briefSize || transferManual) ? `<div class="ws-workspace-row ws-brief-size"><span>${hasNumber(ratio) ? `情景盈亏比 ${ratio.toFixed(2)} : 1` : ''}${briefSize ? `${hasNumber(ratio) ? ' · ' : ''}${escape(briefSize)}` : ''}</span>${transferManual ? `<button type="button" class="link-button" data-action="use-strategy">带入手填情景 ${ctx.icons('arrow', 13)}</button>` : ''}</div>` : ''}
    ${horizon?.trigger ? `<p class="ws-research-trigger"><strong>下一触发</strong><span>${escape(horizon.trigger)}</span></p>` : ''}
    <div class="ws-research-signals">${event?.detail || leadNews ? `<div><span>近期事件</span>${event?.detail ? `<p>${escape(event.detail)}</p>` : ''}${leadNews ? `<p>${sourceLink(leadNews.url, leadNews.label)} <small class="ws-footnote">${escape(readableDate(leadNews.publishedAt ?? leadNews.asOf))}</small></p>` : ''}</div>` : ''}${horizon?.invalidation ? `<div><span>${manual ? '行情失效条件' : '主要风险'}</span><p>${escape(horizon.invalidation)}</p></div>` : ''}</div>
    <div class="ws-research-deep">${renderResearchSizing(ctx)}
    ${(horizons ?? []).length ? `<details class="ws-analysis-details"><summary>各周期判断</summary><ul class="ws-rule-list">${horizons.map((item) => `<li><span><b>${escape(item.label)} · ${escape(item.action)}</b><span>${escape(item.trigger)}</span><span>${escape(item.invalidation)}</span></span></li>`).join('')}</ul></details>` : ''}</div>`;
}

export function renderResearchResult(ctx) {
  const tab = activeTab(researchTabs, ctx.researchTab);
  if (tab === 'evidence') return renderEvidence(ctx);
  if (!ctx.strategy?.symbol) return empty('从自选或持仓选择一个标的开始研究。');
  return ({ overview: renderResearchOverview, basis: renderConditions, tracking: renderTracking })[tab](ctx);
}

function researchPage(ctx) {
  const { state, researchInputs = {}, displayedCurrency: unit } = ctx;
  const selectInput = (name, label, options) => `<label class="ws-field" for="research-${name}"><span>${label}</span><select id="research-${name}" name="${name}">${options.map(([value, title]) =>
    `<option value="${value}"${researchInputs[name] === value ? ' selected' : ''}>${title}</option>`).join('')}</select></label>`;
  const context = `<div class="ws-research-context">${symbolField('research-symbol', '研究标的', state, ctx.symbol)}${selectInput('horizon', '研究周期', [['mid', '中期'], ['short', '短期'], ['long', '长期']])}</div>`;
  const core = `${selectInput('assetType', '资产类型', [['', '自动识别'], ['equity', '股票'], ['etf', 'ETF']])}
    <div class="ws-fields">${decimalField('research', 'riskPercent', '单笔风险预算', researchInputs.riskPercent ?? 1, '%', 'min="0" max="100"')}${decimalField('research', 'amount', '投入上限（可选）', researchInputs.amount, unit, 'min="0"', ctx.privateAmounts)}</div>
    <details class="ws-analysis-details"><summary>填入自己的计划价位</summary><div class="ws-fields ws-fields-three">${decimalField('research', 'entry', '入场观察价', researchInputs.entry, unit, 'min="0"')}${decimalField('research', 'target', '目标价', researchInputs.target, unit, 'min="0"')}${decimalField('research', 'stop', '失效 / 止损价', researchInputs.stop, unit, 'min="0"')}</div></details>`;
  const fundamentals = `
    ${ctx.strategy?.instrumentType === 'etf' ? `<div class="ws-fields">${decimalField('research', 'nav', '每份净值', researchInputs.nav, unit, 'min="0"')}${decimalField('research', 'expenseRatio', '基金年费率', researchInputs.expenseRatio, '%', 'min="0"')}</div>`
      : `<div class="ws-fields ws-fields-three">${decimalField('research', 'pe', '市盈率', researchInputs.pe, '倍')}${decimalField('research', 'fairValue', '估值基准', researchInputs.fairValue, unit, 'min="0"')}${decimalField('research', 'revenueGrowth', '营收同比', researchInputs.revenueGrowth, '%')}</div>`}
    <div class="ws-fields"><label class="ws-field" for="research-macro"><span>宏观环境</span><select id="research-macro" name="macro"><option value="">未判断</option>${[['headwind', '逆风'], ['neutral', '中性'], ['tailwind', '顺风']].map(([value, label]) => `<option value="${value}"${value === researchInputs.macro ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="ws-field" for="research-eventsStatus"><span>事件核验</span><select id="research-eventsStatus" name="eventsStatus"><option value="">待核验</option>${[['pass', '已核验，无阻碍'], ['watch', '继续观察'], ['fail', '存在阻碍']].map(([value, label]) => `<option value="${value}"${value === researchInputs.eventsStatus ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
    <label class="ws-field" for="research-event"><span>重大事件</span><input id="research-event" name="event" maxlength="160" value="${escape(researchInputs.event)}" placeholder="例如，待发布的财报"></label>
    ${selectInput('sentiment', '市场情绪判断', [['', '待核验'], ['risk-on', '偏好风险'], ['neutral', '中性'], ['risk-off', '规避风险']])}
    <details class="ws-analysis-details"><summary>记录出处</summary><div class="ws-form">
    ${[['fundamental','基本面'],['valuation','估值'],['macro','宏观'],['event','事件'],['sentiment','情绪']].map(([key, label]) =>
      `<div class="ws-fields"><label class="ws-field"><span>${label}来源链接</span><input name="${key}Source" type="url" value="${escape(researchInputs[key + 'Source'])}" placeholder="https://"></label><label class="ws-field"><span>${label}发布日期</span><input name="${key}Date" type="date" value="${escape(researchInputs[key + 'Date'])}"></label></div>`).join('')}
    </div></details>
    <p class="ws-footnote">手工输入由你核验。跨市场财报、情绪、公告可通过研究网关或 JSON 导入。</p>`;
  const tab = activeTab(researchTabs, ctx.researchTab);
  const panels = tabPanels('research', researchTabs, tab, (panel, selected) => {
    const results = selected ? `<div id="research-results" class="ws-results">${renderResearchResult(ctx)}</div>` : '';
    if (panel !== 'basis') return results;
    return `<div class="ws-grid ws-research-edit"><section class="ws-research-inputs"><div class="ws-workspace-row"><h2>研究假设</h2></div><div class="ws-form">${core}${fundamentals}</div></section>${results}</div>`;
  });
  return `${heading('股票研究', `<a class="link-button ws-desktop-workspace-action" href="#quant">量化实验室 ${ctx.icons('arrow', 14)}</a>`)}<form id="research-form" class="ws-research-workspace">${context}${tabNavigation('research', researchTabs, tab, '研究视图')}${panels}</form>`;
}

function renderQuantAnalysis(ctx) {
  const quant = ctx.quant;
  if (!quant) return empty('选择标的以查看量化分析。');
  const comparison = quant.comparison;
  const windows = quant.riskWindows ?? [];
  const findings = quant.findings ?? [];
  return `<div class="ws-workspace-row"><div><p class="ws-source-tag">MONO · 本机计算</p><h2>${escape(quant.headline ?? '量化分析')}</h2></div><span class="ws-section-meta">${escape(quant.symbol)}</span></div>
    ${findings.length ? `<ul class="ws-rule-list ws-quant-findings">${findings.map(({ label, detail, status }) => `<li><span><b>${escape(label)}</b><span>${escape(detail)}</span></span><small data-status="${status === 'observed' ? 'pass' : 'pending'}">${status === 'observed' ? '已观测' : '待核验'}</small></li>`).join('')}</ul>` : ''}
    ${windows.length ? `<section class="ws-quant-section"><h3>风险窗口</h3><div class="ws-quant-windows">${windows.map((row) => `<div><h4>${escape(row.label)}</h4>${row.status === 'unavailable' ? `<p class="ws-footnote">${escape(row.reason)}</p>` : facts([['价格收益', valueOrDash(row.totalReturn, ctx.signedPercent)], ['观测回撤', valueOrDash(row.maxDrawdown, ctx.percent)], ['年化波动', valueOrDash(row.volatility, ctx.percent)]])}${row.status === 'limited' ? `<p class="ws-footnote">${escape(row.reason)}</p>` : ''}</div>`).join('')}</div></section>` : ''}
    ${comparison ? `<section class="ws-quant-section"><div class="ws-workspace-row"><h3>基准比较</h3><span class="ws-section-meta">${escape(comparison.benchmark ?? '未选基准')}</span></div><p class="ws-footnote">${escape(comparison.reason)}</p>${comparison.asset ? facts([
      ['共同交易日', `${comparison.pairs} 日 · ${comparison.firstDate} 至 ${comparison.lastDate}`], ['收益差', valueOrDash(comparison.returnGap, (n) => `${n.toFixed(2)} 个百分点`)],
      ['回撤差', valueOrDash(comparison.drawdownGap, (n) => `${n.toFixed(2)} 个百分点`)], ['波动差', valueOrDash(comparison.volatilityGap, (n) => `${n.toFixed(2)} 个百分点`)]]) : ''}</section>` : ''}
    ${quant.limitations?.length ? `<details class="ws-analysis-details"><summary>数据与方法限制</summary><ul class="ws-plain-list">${quant.limitations.map((note) => `<li>${escape(note)}</li>`).join('')}</ul></details>` : ''}`;
}

function renderQuantValidation(ctx) {
  const report = ctx.quant?.validation;
  if (!report) return empty('等待策略参数与历史日线。');
  const summary = (test) => test ? facts([['交易次数', test.trades], ['净收益', valueOrDash(test.totalReturn, ctx.signedPercent)], ['最大回撤', valueOrDash(test.maxDrawdown, ctx.percent)], ['胜率', valueOrDash(test.winRate, ctx.percent)]]) : empty('样本不足。');
  const { sample, coverage, audit, selection, checks = [], tradeSamples = [], assumptions = [] } = report;
  return `<div class="ws-workspace-row"><div><p class="ws-source-tag">MONO · 本机计算</p><h2>样本外验证</h2></div></div>
    ${report.reason ? `<p class="ws-footnote">${escape(report.reason)}</p>` : ''}
    ${sample ? `<p class="ws-footnote">前段 ${sample.training} 根 · 留出 ${sample.holdout} 根${sample.holdoutStart ? ` · ${escape(sample.holdoutStart)} 至 ${escape(sample.holdoutEnd)}` : ''}</p><div class="ws-grid ws-quant-pair"><section><h3>前段样本</h3>${summary(report.train)}</section><section><h3>留出样本</h3>${summary(report.holdout)}</section></div>` : ''}
    <section class="ws-quant-section"><h3>样本与复算核对</h3>${coverage ? facts([['完整日线 / OHLC', `${coverage.completedRows ?? 0} 根 / ${coverage.ohlcRows ?? 0} 根`], ['成交复算', audit ? `${audit.passed} / ${audit.checked} 笔` : '—'], ['样本校验标识', coverage.fingerprint ?? '—']]) : ''}
    ${checks.length ? `<ul class="ws-rule-list">${checks.map(({ label, status, detail }) => `<li><span><b>${escape(label)}</b><span>${escape(detail)}</span></span><small data-status="${escape(status)}">${({ pass: '通过', watch: '需复核', pending: '待核验', fail: '未通过' })[status] ?? '待核验'}</small></li>`).join('')}</ul>` : ''}</section>
    ${selection?.reason ? `<details class="ws-analysis-details"><summary>参数筛选${selection.candidates?.length ? ' · ' + selection.candidates.length + ' 组' : ''}</summary><p class="ws-footnote">${escape(selection.reason)}</p>${selection.candidates?.length ? `<ul class="ws-rule-list">${selection.candidates.map((item) => `<li><span><b>${escape([item.rule?.fast, item.rule?.slow, item.rule?.breakout, item.rule?.holding].filter(hasNumber).join(' / '))}</b><span>${item.trades} 笔 · ${valueOrDash(item.totalReturn, ctx.signedPercent)} · 回撤 ${valueOrDash(item.maxDrawdown, ctx.percent)}</span></span><small>${item.eligible ? '满足筛选条件' : '样本或校验不足'}</small></li>`).join('')}</ul>` : ''}</details>` : ''}
    ${tradeSamples.length ? `<details class="ws-analysis-details"><summary>逐笔样本 · ${tradeSamples.length} 笔</summary><ul class="ws-rule-list">${tradeSamples.map((item) => `<li><span><b>${item.segment === 'holdout' ? '留出' : '前段'} · ${escape(item.signalDate)} 信号</b><span>${escape(item.entryDate)} 开盘 ${valueOrDash(item.entryOpen, ctx.money)} → ${escape(item.exitDate)} 开盘 ${valueOrDash(item.exitOpen, ctx.money)} · ${valueOrDash(item.returnPercent, ctx.signedPercent)}</span></span><small data-status="${item.reproduced && item.chronological ? 'pass' : 'watch'}">${item.reproduced && item.chronological ? '已复算' : '需复核'}</small></li>`).join('')}</ul></details>` : ''}
    ${assumptions.length ? `<details class="ws-analysis-details"><summary>成交与成本假设</summary><ul class="ws-plain-list">${assumptions.map((note) => `<li>${escape(note)}</li>`).join('')}</ul></details>` : ''}`;
}

function renderExternalQuant(ctx) {
  const model = ctx.externalQuant ?? {};
  const provider = [model.provider, model.model].filter(Boolean).join(' · ');
  return `<div class="ws-workspace-row"><div><p class="ws-source-tag">自连模型接口</p><h2>外部模型分析</h2></div>${action(ctx, '模型接口设置', 'external-quant-settings', { icon: 'settings' })}</div>
    <p class="ws-footnote">发送内容限于当前标的和量化摘要。</p>
    <div class="ws-result-actions ws-external-actions">${action(ctx, model.busy ? '生成中…' : '生成外部分析', 'external-quant-run', { icon: 'activity', primary: true, disabled: model.busy || !model.configured })}${model.busy ? action(ctx, '取消', 'external-quant-cancel') : ''}</div>
    ${model.error ? `<p class="ws-data-status ws-error-line" role="alert">${escape(model.error)}</p>` : ''}
    ${model.text ? `<article class="ws-external-report"><header><h3>${model.busy || model.error ? '上次分析' : '模型返回'}</h3><span class="ws-section-meta">${escape(provider)}${model.completedAt ? ` · ${escape(readableDate(model.completedAt))}` : ''}</span></header><div>${escape(model.text)}</div></article>` : empty(model.configured ? '生成后在此查看分析。' : '配置自己的模型接口后即可生成分析。')}`;
}

export function renderQuantResult(ctx) {
  return ({ analysis: renderQuantAnalysis, validation: renderQuantValidation, external: renderExternalQuant })[activeTab(quantTabs, ctx.quantTab)](ctx);
}

function quantPage(ctx) {
  const settings = ctx.quantSettings ?? {};
  const tab = activeTab(quantTabs, ctx.quantTab);
  const input = (name, label, fallback, unit) => decimalField('quant', name, label, settings[name] ?? fallback, unit, 'min="0"');
  const options = `<div class="ws-quant-inputs"><div class="ws-workspace-row"><h2>规则参数</h2></div><div class="ws-form"><div class="ws-fields ws-fields-three">${input('fast', '快均线', 20, '日')}${input('slow', '慢均线', 50, '日')}${input('breakout', '突破窗口', 20, '日')}${input('holding', '持有期', 30, '日')}${input('costBps', '单边成本', 10, 'bp')}</div><label class="ws-toggle"><input type="checkbox" name="optimize" id="quant-optimize"${settings.optimize ? ' checked' : ''}><span>用前段样本筛选参数</span></label><div>${action(ctx, '运行验证', 'quant-run', { icon: 'activity', primary: true })}</div></div></div>`;
  const panel = tabPanels('quant', quantTabs, tab, (key, selected) => {
    const results = selected ? `<div id="quant-results" class="ws-results">${renderQuantResult(ctx)}</div>` : '';
    return key === 'validation' ? `<div class="ws-grid ws-quant-validate">${options}${results}</div>` : results;
  });
  return `${heading('量化实验室', `<a class="link-button ws-desktop-workspace-action" href="#research">普通决策 ${ctx.icons('arrow', 14)}</a>`)}<form id="quant-form" class="ws-quant-workspace"><div class="ws-research-context">${symbolField('quant-symbol', '量化标的', ctx.state, ctx.symbol)}</div>${tabNavigation('quant', quantTabs, tab, '量化视图')}${panel}</form>`;
}

const opportunityMarkets = [['all', '全部'], ['cn', 'A 股'], ['us', '美股'], ['etf', 'ETF']];
const opportunityGroups = { match: '符合筛选计划', waiting: '等待数据', other: '未达条件' };
const scopeLabels = { catalog: '内置市场名单', watch: '自选与持仓', custom: '自定义名单' };

function opportunityRow(ctx, item) {
  const unit = ctx.instrumentCurrency(item.ticker);
  const money = (value) => ctx.money(value, unit);
  const prices = [['入场', item.entry], ['目标', item.target], ['失效', item.stop]].filter(([, value]) => hasNumber(value)).map(([label, value]) => [label, money(value)]);
  if (prices[0]?.[0] === '入场' && hasNumber(item.zone?.low) && hasNumber(item.zone?.high) && item.zone.low !== item.zone.high) prices[0] = ['入场区间', `${money(item.zone.low)} – ${money(item.zone.high)}`];
  return `<li class="ws-opportunity-row"><header><div><strong>${escape(item.ticker)}</strong>${item.name && item.name !== item.ticker ? `<span>${escape(item.name)}</span>` : ''}</div>${action(ctx, '查看研究', 'open-research-symbol', { icon: 'arrow-up-right', data: `data-symbol="${escape(item.ticker)}"` })}</header>
    <p class="ws-opportunity-reason"><b>${escape(item.action)}</b><span>${escape(item.reason)}</span></p>
    ${prices.length ? `<dl class="ws-opportunity-prices">${prices.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : ''}
    <p class="ws-footnote">${[item.market === 'CN' ? 'A 股' : item.market === 'US' ? '美股' : item.market, item.type === 'etf' ? 'ETF' : '', item.source, item.quoteDate ? readableDate(item.quoteDate) : '',
      item.screenReason, hasNumber(item.ratio) ? '盈亏比 ' + item.ratio.toFixed(2) : ''].filter(Boolean).map(escape).join(' · ')}</p></li>`;
}

export function renderOpportunities(ctx) {
  const scan = ctx.opportunityScan ?? {};
  const plan = ctx.opportunityPlan ?? {};
  const { market = 'all', horizon = 'mid', scope = 'catalog' } = plan;
  const results = scan.results ?? [];
  const view = ctx.opportunityView ?? 'all';
  const groups = { match: [], other: [], waiting: [] };
  for (const item of results) groups[item.match === true ? 'match' : item.match === false ? 'other' : 'waiting'].push(item);
  groups.match.sort((a, b) => Number(b.status === 'opportunity') - Number(a.status === 'opportunity') ||
    (b.ratio ?? 0) - (a.ratio ?? 0) || a.ticker.localeCompare(b.ticker));
  const conditions = [
    ({ up: '趋势上行', down: '趋势下行', mixed: '趋势分化' })[plan.trend],
    hasNumber(plan.minRatio) && '盈亏比 ≥ ' + plan.minRatio,
    hasNumber(plan.minReturn) && '近 20 日 ≥ ' + ctx.percent(plan.minReturn), hasNumber(plan.maxVolatility) && '波动 ≤ ' + ctx.percent(plan.maxVolatility),
    hasNumber(plan.minVolume) && '相对量 ≥ ' + plan.minVolume + ' 倍',
  ].filter(Boolean);
  const buttons = (options, label, verb, field, current) => `<div class="ws-opportunity-filters" role="group" aria-label="${label}"><span>${label}</span>${options.map(([key, text]) =>
    `<button type="button" data-action="${verb}" data-${field}="${key}" aria-pressed="${current === key}">${text}</button>`).join('')}</div>`;
  const modes = buttons([['default', '默认计划'], ['custom', '自定义计划']], '计划', 'opportunity-mode', 'mode', ctx.opportunityMode);
  const markets = buttons(opportunityMarkets, '市场', 'opportunity-universe', 'market', market);
  const periods = buttons([['short', '短期'], ['mid', '中期'], ['long', '长期']], '周期', 'opportunity-horizon', 'horizon', horizon);
  const headline = scan.stage === 'review' && scan.running
    ? `报价与日线已筛查 ${results.length} 个 · 复核公开资料 ${scan.reviewed}/${scan.reviewTotal}`
    : scan.running ? `正在筛查 ${results.length}/${scan.total} 个标的`
      : scan.stage === 'stopped' ? `已停止 · 保留 ${results.length}/${scan.total} 个结果`
        : scan.stage === 'complete' ? `已筛查 ${results.length} 个标的${scan.reviewed ? ' · 补充复核 ' + scan.reviewed + ' 个' : ''}`
          : '可按市场或计划开始筛查。';
  const filters = buttons([['all', '全部结果'], ['match', '符合 ' + groups.match.length], ['other', '未达 ' + groups.other.length], ['waiting', '待核验 ' + groups.waiting.length]],
    '结果', 'opportunity-view', 'view', view);
  let remaining = ctx.opportunityVisibleRows ?? 14, shown = 0, available = 0;
  const sections = ['match', 'other', 'waiting'].filter((name) => view === 'all' || view === name).map((name) => {
    const items = groups[name];
    available += items.length;
    if (!items.length || !remaining) return '';
    const visible = items.slice(0, remaining);
    remaining -= visible.length;
    shown += visible.length;
    return `<section class="ws-opportunity-group"><div class="ws-workspace-row"><h2>${opportunityGroups[name]}</h2><span class="ws-section-meta">${items.length} 个标的</span></div><ul>${visible.map((item) => opportunityRow(ctx, item)).join('')}</ul></section>`;
  }).join('');
  return `<section class="ws-opportunity-controls"><div class="ws-workspace-row ws-opportunity-plan">${modes}${action(ctx, '编辑计划', 'opportunity-edit', { icon: 'sliders' })}</div>
    <div class="ws-workspace-row ws-opportunity-options"><div class="ws-opportunity-filter-stack">${markets}${periods}</div>
    ${scan.running ? action(ctx, '停止', 'opportunity-stop') : action(ctx, '开始筛查', 'opportunity-scan', { icon: 'search', primary: true })}</div>
    <p class="ws-footnote">${escape(scopeLabels[scope])} · ${ctx.opportunityCount ?? 0} 个标的${conditions.length ? ' · ' + escape(conditions.join(' / ')) : ' · 数值不限'}</p></section>
    <p class="ws-opportunity-headline" role="status">${escape(headline)}</p>${results.length ? filters : ''}
    ${sections || (scan.running ? '' : empty(results.length ? '当前结果分类暂无标的。' : '当前范围没有结果。'))}
    ${shown < available ? `<div class="ws-opportunity-more"><span>显示 ${shown} / ${available}</span>${action(ctx, '显示更多', 'opportunity-more')}</div>` : ''}`;
}

function opportunitiesPage(ctx) {
  return `${heading('投资机会')}<div id="opportunities-results" class="ws-opportunities">${renderOpportunities(ctx)}</div>`;
}

const workspacePages = {
  portfolio: holdingsPage, holdings: holdingsPage,
  market: marketPage, watchlist: marketPage,
  trades: tradesPage, trade: tradesPage,
  risk: riskPage, research: researchPage, intelligence: researchPage,
  quant: quantPage, opportunities: opportunitiesPage,
};

export function renderWorkspace(page, ctx) {
  return workspacePages[page] ? `<div class="ws-page" data-workspace="${page}">${workspacePages[page](ctx)}</div>` : '';
}
