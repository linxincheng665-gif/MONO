const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const finite = Number.isFinite;
const coordinate = (value) => Number(value.toFixed(2));
const clock = {
  CNY: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  USD: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
};

function barsFor(rows) {
  return (rows ?? []).flatMap((row) => {
    const close = row?.close ?? row?.value;
    const date = typeof row?.date === 'string' ? row.date : '';
    const time = Date.parse(date);
    if (!finite(close) || !finite(time)) return [];
    const { open, high, low, volume } = row;
    const candle = [open, high, low].every(finite) && low >= 0 && low <= Math.min(open, close) && high >= Math.max(open, close);
    return [{ date, time, close, open, high, low, candle, volume: finite(volume) && volume >= 0 ? volume : null }];
  }).sort((left, right) => left.time - right.time);
}

function plotGeometry(bars, hasVolume, kind) {
  const width = 720;
  const height = kind === 'portfolio' ? (hasVolume ? 276 : 224) : (hasVolume ? 348 : 258);
  const left = 4;
  const right = width - 8;
  const top = 11;
  const volumeTop = height - 78;
  const volumeBottom = height - 26;
  const bottom = hasVolume ? volumeTop - 10 : height - 26;
  const x = (index) => left + (bars.length === 1 ? .5 : index / (bars.length - 1)) * (right - left);
  return { width, height, left, right, top, bottom, volumeTop, volumeBottom, x };
}

function rangeFor(priced, scale, base) {
  const mode = scale === 'percent' && base > 0 ? 'percent'
    : scale === 'log' && priced.every((value) => value > 0) ? 'log' : 'price';
  const transform = mode === 'log' ? Math.log : mode === 'percent' ? (value) => (value / base - 1) * 100 : (value) => value;
  const prices = priced.map(transform);
  const low = prices.reduce((min, value) => Math.min(min, value), Infinity);
  const high = prices.reduce((max, value) => Math.max(max, value), -Infinity);
  const spread = Math.max(high - low, mode === 'price' ? Math.abs(high) * .012 : .016, .00001);
  const bottom = low - spread * .12;
  const upper = high + spread * .12;
  return { mode, transform, low: mode === 'price' && low >= 0 ? Math.max(0, bottom) : bottom, high: upper };
}

function decimalPlaces(step) {
  for (let places = 0; places < 4; places += 1) {
    const scaled = step * 10 ** places;
    if (Math.abs(scaled - Math.round(scaled)) < 0.000001) return places;
  }
  return 4;
}

function labelPrice(value, currency, scale, step, precise = false) {
  if (scale === 'percent') {
    const places = precise ? 2 : decimalPlaces(step);
    const rounded = Number(value.toFixed(places));
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(places)}%`;
  }
  const amount = scale === 'log' ? Math.exp(value) : value;
  const priceStep = scale === 'log' ? Math.abs(Math.exp(value + step) - amount) : Math.abs(step);
  const absolute = Math.abs(amount);
  const prefix = currency === 'CNY' ? '¥' : '$';
  const unit = absolute >= 1e6 && (precise || priceStep >= 1e4) ? 1e6
    : absolute >= 1e4 && (precise || priceStep >= 10) ? 1e3 : 1;
  const digits = precise ? 2 : scale === 'log' ? (priceStep / unit >= 2 ? 0 : 2) : decimalPlaces(priceStep / unit);
  const text = (amount / unit).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${prefix}${text}${unit === 1e6 ? 'm' : unit === 1e3 ? 'k' : ''}`;
}

function tickValues(low, high, logarithmic) {
  const span = high - low;
  if (logarithmic) return Array.from({ length: 4 }, (_, i) => low + span * i / 3);
  const target = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = magnitude * [1, 2, 2.5, 5, 10].find((part) => part * magnitude >= target);
  const first = Math.ceil(low / step);
  const last = Math.floor(high / step);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => (first + i) * step);
}

function pathFor(values, x, y) {
  let open = false;
  return values.map((value, index) => {
    if (!finite(value)) { open = false; return ''; }
    const command = open ? 'L' : 'M';
    open = true;
    return `${command}${coordinate(x(index))},${coordinate(y(value))}`;
  }).filter(Boolean).join(' ');
}

function referenceValues(options) {
  if (options.privateValues) return [];
  return [
    { key: 'latest', label: '最新', price: options.latest, visible: options.showLatest !== false },
    { key: 'cost', label: '成本', price: options.cost, visible: options.showCost !== false },
  ].filter(({ price, visible }) => finite(price) && price >= 0 && visible);
}

function marketTime(bar, currency) {
  if (!bar.date.includes('T')) return { day: bar.date, time: '', label: bar.date };
  const parts = Object.fromEntries(clock[currency].formatToParts(bar.time).map(({ type, value }) => [type, value]));
  const time = `${parts.hour}:${parts.minute}`;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, time, label: `${parts.month}/${parts.day} ${time}` };
}

function referencePositions(references, y, top, bottom, height) {
  const gap = height * 0.104;
  const inset = height * 0.025;
  let next = top + inset;
  const marks = references.map((reference) => ({ ...reference, exactPosition: y(reference.price) }))
    .sort((a, b) => a.exactPosition - b.exactPosition);
  for (const mark of marks) {
    mark.position = Math.max(next, mark.exactPosition);
    next = mark.position + gap;
  }
  next = bottom - inset;
  for (const mark of [...marks].reverse()) {
    mark.position = Math.min(next, mark.position);
    next = mark.position - gap;
  }
  return marks;
}

function legend(markers) {
  if (!markers.length) return '';
  return `<div class="market-chart-legend">${markers.map(({ key, label }) => `<span><i class="market-chart-swatch is-${key}" aria-hidden="true"></i>${label}</span>`).join('')}</div>`;
}

export function renderMarketChart(rows, options = {}) {
  const bars = barsFor(rows);
  const kind = options.kind === 'portfolio' ? 'portfolio' : 'market';
  if (!bars.length) {
    return `<div class="chart-empty market-chart-empty">${kind === 'portfolio' ? '导入持仓标的在共同交易日的历史收盘价以回算走势。' : '导入历史行情以绘制价格走势。'}</div>`;
  }

  const currency = options.currencyCode === 'CNY' ? 'CNY' : 'USD';
  const hideAmounts = options.privateValues === true;
  const hasCandles = options.type === 'candle' && bars.some(({ candle }) => candle);
  const hasVolume = options.showVolume === true && !hideAmounts && bars.some(({ volume }) => volume !== null);
  const mode = hasCandles ? 'candle' : 'line';
  const references = referenceValues(options);
  const { width, height, left, right, top, bottom, volumeTop, volumeBottom, x } = plotGeometry(bars, hasVolume, kind);
  const lastIndex = bars.length - 1;
  const mainValues = bars.map(({ close }) => close);
  const overlays = [{ key: 'ma20', label: 'MA20', rows: options.ma20 }, { key: 'ma50', label: 'MA50', rows: options.ma50 }].flatMap((overlay) => {
    const valuesByDate = new Map((overlay.rows ?? []).map(({ date, value }) => [date, value]));
    const values = bars.map(({ date }) => valuesByDate.get(date));
    return values.some(finite) ? [{ ...overlay, values }] : [];
  });

  const priced = [...mainValues, ...references.map(({ price }) => price), ...overlays.flatMap(({ values }) => values.filter(finite))];
  if (hasCandles) {
    for (const { candle, high, low } of bars) {
      if (candle) priced.push(high, low);
    }
  }
  const { mode: scale, transform, low, high } = rangeFor(priced, options.scale, mainValues[0]);
  const plotY = (value) => top + (high - value) / (high - low) * (bottom - top);
  const y = (value) => plotY(transform(value));
  const candleWidth = Math.min(10, Math.max(.6, (right - left) / Math.max(1, lastIndex) * .58));
  const rising = (bar, index) => bar.candle ? bar.close >= bar.open : index ? bar.close >= bars[index - 1].close : true;

  const prices = hasCandles
    ? bars.map((bar, i) => {
      if (!bar.candle) return `<circle class="market-chart-unpaired" cx="${coordinate(x(i))}" cy="${coordinate(y(bar.close))}" r="1.7"/>`;
      const center = coordinate(x(i));
      return `<g class="market-chart-candle ${rising(bar, i) ? 'is-up' : 'is-down'}"><line x1="${center}" x2="${center}" y1="${coordinate(y(bar.high))}" y2="${coordinate(y(bar.low))}"/><rect x="${coordinate(center - candleWidth / 2)}" y="${coordinate(Math.min(y(bar.open), y(bar.close)))}" width="${coordinate(candleWidth)}" height="${coordinate(Math.max(1.2, Math.abs(y(bar.open) - y(bar.close))))}"/></g>`;
    }).join('')
    : (() => {
      const path = pathFor(mainValues, x, y);
      const area = lastIndex > 0 && options.showArea !== false
        ? `<path class="market-chart-area" d="${path} L${coordinate(x(lastIndex))},${bottom} L${coordinate(x(0))},${bottom} Z"/>` : '';
      return `${area}<path class="market-chart-line" d="${path}"/>`;
    })();

  const peakVolume = hasVolume ? bars.reduce((max, { volume }) => Math.max(max, volume ?? 0), 0) : 0;
  const volumeBars = hasVolume ? bars.map((bar, i) => {
    if (!bar.volume || peakVolume === 0) return '';
    const size = bar.volume / peakVolume * (volumeBottom - volumeTop - 5);
    return `<rect class="market-chart-volume ${rising(bar, i) ? 'is-up' : 'is-down'}" x="${coordinate(x(i) - candleWidth / 2)}" y="${coordinate(volumeBottom - size)}" width="${coordinate(candleWidth)}" height="${coordinate(Math.max(.65, size))}"/>`;
  }).join('') : '';

  const pricesOnAxis = tickValues(low, high, scale === 'log');
  const tickStep = pricesOnAxis.length > 1 ? pricesOnAxis[1] - pricesOnAxis[0] : high - low;
  const plotPercent = (position) => coordinate(position / height * 100);
  const dateIndices = [...new Set([0, .25, .5, .75, 1].map((fraction) => Math.round(fraction * lastIndex)))];
  const times = bars.map((bar) => marketTime(bar, currency));
  const sameSession = times[0].day === times[lastIndex].day;
  const broad = bars[lastIndex].time - bars[0].time > 360 * 86400000;
  const refMarks = referencePositions(references, y, top, bottom, height);

  const yLabels = hideAmounts ? '' : pricesOnAxis.flatMap((tick) => {
    const position = plotPercent(plotY(tick));
    if (refMarks.some((mark) => Math.abs(plotPercent(mark.position) - position) < 7)) return [];
    return [`<span class="market-chart-axis-y" style="top:${position}%">${labelPrice(tick, currency, scale, tickStep)}</span>`];
  }).join('');
  const referenceLabels = refMarks.map(({ key, label, price, position }) => {
    const value = labelPrice(transform(price), currency, scale, tickStep, true);
    const fullValue = options.money ? options.money(price, currency) : value;
    return `<span class="market-chart-axis-y market-chart-reference-label is-${key}" style="top:${plotPercent(position)}%" title="${escape(`${label} ${fullValue}`)}">${value}</span>`;
  }).join('');
  const dateLabels = dateIndices.map((index, i) => {
    const minor = dateIndices.length === 5 && (i === 1 || i === 3);
    const { day, time, label: dateTime } = times[index];
    const label = broad ? `${day.slice(2, 4)}/${day.slice(5, 7)}`
      : time ? (sameSession ? time : dateTime) : day.slice(5).replace('-', '/');
    const edge = dateIndices.length === 1 ? '' : i === 0 ? ' is-first' : i === dateIndices.length - 1 ? ' is-last' : '';
    return `<span class="market-chart-axis-x${minor ? ' is-minor' : ''}${edge}" style="--axis-ratio:${(x(index) / width).toFixed(5)}">${escape(label)}</span>`;
  }).join('');

  const grid = options.showGrid === false ? '' : pricesOnAxis.map((tick) => `<line class="market-chart-gridline" x1="${left}" x2="${right}" y1="${coordinate(plotY(tick))}" y2="${coordinate(plotY(tick))}"/>`).join('');
  const refLines = refMarks.map(({ key, exactPosition }) => `<line class="market-chart-reference is-${key}" x1="${left}" x2="${right}" y1="${coordinate(exactPosition)}" y2="${coordinate(exactPosition)}"/>`).join('');
  const referenceLeaders = refMarks.map(({ key, exactPosition, position }) =>
    `<path class="market-chart-reference-leader is-${key}" d="M${right},${coordinate(exactPosition)} L${width},${coordinate(position)}"/>`).join('');
  const maLines = overlays.map(({ key, values }) => `<path class="market-chart-ma is-${key}" d="${pathFor(values, x, y)}"/>`).join('');
  const points = bars.map((bar, i) => [bar.date, hideAmounts ? null : bar.close, !hideAmounts && mainValues[0] > 0 ? (bar.close / mainValues[0] - 1) * 100 : null, currency, {
    y: plotPercent(y(bar.close)),
    displayDate: times[i].label,
    ...(!hideAmounts && bar.candle ? { open: bar.open, high: bar.high, low: bar.low } : {}),
    ...(!hideAmounts && finite(bar.volume) ? { volume: bar.volume } : {}),
  }]);
  const lastPrice = !hideAmounts && options.money ? `，末值 ${options.money(bars[lastIndex].close, currency)}` : '';
  const description = `${kind === 'portfolio' ? '组合价值走势' : '历史行情走势'}${hasCandles ? '，蜡烛图' : ''}${lastPrice}`;
  const cursorScale = hideAmounts ? '' : JSON.stringify([low, high, top / height, bottom / height, scale]);

  return `<section class="market-chart" data-chart-kind="${kind}" data-chart-type="${mode}" data-chart-scale="${scale}">${legend([...overlays, ...references])}
    <div class="mono-chart mono-market-chart" data-volume="${hasVolume}" style="--plot-start:${(left / width).toFixed(5)};--plot-end:${((width - right) / width).toFixed(5)};--plot-top:${plotPercent(top)}%;--plot-bottom:${plotPercent(height - (hasVolume ? volumeBottom : bottom))}%">
      <svg class="market-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escape(description)}">${grid}<line class="market-chart-baseline" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>${prices}${refLines}${referenceLeaders}${maLines}
      ${!hasCandles ? `<circle class="market-chart-end" cx="${coordinate(x(lastIndex))}" cy="${coordinate(y(mainValues[lastIndex]))}" r="3"/>` : ''}
      ${hasVolume ? `<line class="market-chart-baseline" x1="${left}" x2="${right}" y1="${volumeBottom}" y2="${volumeBottom}"/>${volumeBars}` : ''}</svg>
      <div class="market-chart-axis" aria-hidden="true">${yLabels}${referenceLabels}${dateLabels}${hasVolume ? `<span class="market-chart-volume-label" style="top:${plotPercent(volumeTop)}%">成交量</span>` : ''}</div>
      <div class="chart-hit" data-points="${escape(JSON.stringify(points))}" data-cursor-scale="${escape(cursorScale)}" tabindex="0" role="group" aria-label="${escape(`${description}，查看图表数据`)}"></div><div class="chart-cursor" hidden></div><div class="market-chart-horizontal" hidden></div><div class="market-chart-cursor-price" aria-hidden="true" hidden></div><div class="chart-tooltip" hidden></div>
    </div></section>`;
}
