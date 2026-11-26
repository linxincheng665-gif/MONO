const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const html = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function createChartNavigation({ renderChart, showPoint, hidePoint, onIdle }) {
  const series = new Map();
  let drag = null;
  let touch = null;
  let reading = null;

  function defaultWidth(entry) {
    const small = matchMedia('(max-width: 630px)').matches;
    return Math.min(entry.rows.length, entry.options.type === 'candle' ? (small ? 62 : 100) : (small ? 96 : 144));
  }

  function windowFor(entry) {
    const total = entry.rows.length;
    const count = clamp(entry.count ?? defaultWidth(entry), Math.min(5, total), total);
    return { count, start: clamp(entry.start ?? total - count, 0, total - count), total };
  }

  function plot(entry) {
    const view = windowFor(entry);
    const atLatest = view.start + view.count === view.total;
    return renderChart(entry.rows.slice(view.start, view.start + view.count), { ...entry.options, showLatest: atLatest });
  }

  function render(rows, options, key) {
    let entry = series.get(key);
    if (!entry) {
      entry = { rows, options };
      if (series.size >= 45) series.delete(series.keys().next().value);
      series.set(key, entry);
    }
    if (entry.start != null) {
      const date = entry.rows[entry.start]?.date;
      const next = rows.findIndex((row) => row.date >= date);
      entry.start = next >= 0 ? next : null;
    }
    entry.rows = rows;
    entry.options = options;
    const view = windowFor(entry);
    const controls = rows.length < 2 ? '' : `<div class="chart-window-controls"><span class="chart-touch-hint">拖动读价 · 双指缩放</span><div class="chart-zoom-actions" role="group" aria-label="图表缩放"><button type="button" data-chart-zoom="out" aria-label="缩小图表" title="缩小图表"${view.count >= view.total ? ' disabled' : ''}>−</button><button type="button" data-chart-zoom="in" aria-label="放大图表" title="放大图表"${view.count <= Math.min(5, view.total) ? ' disabled' : ''}>+</button><button type="button" data-chart-zoom="reset" aria-label="重置图表视图" title="回到最新并重置缩放">重置</button></div></div>`;
    return `<div class="chart-window" data-chart-key="${html(key)}">${plot(entry)}${controls}</div>`;
  }

  function interaction(target) {
    const hit = target?.closest?.('.chart-hit');
    return hit ? { hit, host: hit.closest('[data-chart-key]') } : {};
  }

  function updatePlot(host, entry) {
    const template = document.createElement('template');
    template.innerHTML = plot(entry);
    const previous = host.querySelector('.mono-market-chart');
    const next = template.content.querySelector('.mono-market-chart');
    if (!previous || !next) return;
    // Retain the hit surface so a captured drag, touch target, and keyboard focus survive the redraw.
    const hit = previous.querySelector('.chart-hit');
    const nextHit = next.querySelector('.chart-hit');
    hidePoint(hit);
    previous.style.cssText = next.style.cssText;
    previous.dataset.volume = next.dataset.volume;
    hit.dataset.points = nextHit.dataset.points;
    hit.dataset.cursorScale = nextHit.dataset.cursorScale;
    delete hit.dataset.pointIndex;
    hit.setAttribute('aria-label', nextHit.getAttribute('aria-label'));
    previous.replaceChild(next.querySelector('svg'), previous.querySelector('svg'));
    previous.replaceChild(next.querySelector('.market-chart-axis'), previous.querySelector('.market-chart-axis'));
    const section = previous.parentElement;
    section.dataset.chartScale = next.parentElement.dataset.chartScale;
    const legend = section.querySelector('.market-chart-legend');
    const nextLegend = next.parentElement.querySelector('.market-chart-legend');
    // Keep the plot's vertical position stable when the latest-price guide moves offscreen.
    if (legend) legend.innerHTML = nextLegend?.innerHTML ?? '';
    else if (nextLegend) section.prepend(nextLegend);
    const view = windowFor(entry);
    host.querySelector('[data-chart-zoom="in"]').disabled = view.count <= Math.min(5, view.total);
    host.querySelector('[data-chart-zoom="out"]').disabled = view.count >= view.total;
  }

  function apply(host, start, count, reset = false) {
    const key = host?.dataset.chartKey;
    const entry = series.get(key);
    if (!entry || entry.rows.length < 2) return;
    const before = windowFor(entry);
    const total = before.total;
    const visible = reset ? defaultWidth(entry) : clamp(Math.round(count), Math.min(5, total), total);
    const from = reset ? total - visible : clamp(Math.round(start), 0, total - visible);
    if (from === before.start && visible === before.count && !reset) return;
    entry.count = reset ? undefined : visible;
    entry.start = from + visible === total ? null : from;
    for (const candidate of document.querySelectorAll('[data-chart-key]')) {
      if (candidate.dataset.chartKey === key) updatePlot(candidate, entry);
    }
  }

  function grab(hit, host, x) {
    const entry = series.get(host?.dataset.chartKey);
    const box = hit.getBoundingClientRect();
    if (!entry || entry.rows.length < 2 || box.width <= 0) return null;
    return { host, hit, x, box, ...windowFor(entry) };
  }

  function pan(grabbed, x) {
    apply(grabbed.host, grabbed.start - (x - grabbed.x) / grabbed.box.width * (grabbed.count - 1), grabbed.count);
  }

  function panAndRead(grabbed, x, y) {
    pan(grabbed, x);
    const entry = series.get(grabbed.host.dataset.chartKey);
    if (!entry) return;
    // The guide reads the candles or line as they move beneath the point where the drag started.
    const shift = windowFor(entry).start - grabbed.start;
    const guide = x + shift * grabbed.box.width / (grabbed.count - 1);
    showPoint(grabbed.hit, guide, y);
  }

  function zoom(grabbed, count, x = grabbed.x) {
    const ratio = (position) => clamp((position - grabbed.box.left) / grabbed.box.width, 0, 1);
    const visible = clamp(Math.round(count), Math.min(5, grabbed.total), grabbed.total);
    const anchor = grabbed.start + ratio(grabbed.x) * (grabbed.count - 1);
    apply(grabbed.host, anchor - ratio(x) * (visible - 1), visible);
  }

  function clearReading() {
    if (!reading) return;
    clearTimeout(reading.timer);
    hidePoint(reading.hit);
    reading = null;
    onIdle();
  }

  function holdReading(hit) {
    reading = { hit, timer: setTimeout(clearReading, 3500) };
  }

  function stopDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const completed = drag;
    const { hit, id } = completed;
    drag = null;
    if (hit.hasPointerCapture?.(id)) hit.releasePointerCapture(id);
    hit.classList.remove('chart-grabbing');
    if (event.type === 'pointerup') {
      const box = hit.getBoundingClientRect();
      if (event.clientX >= box.left - 6 && event.clientX <= box.right + 6 && event.clientY >= box.top && event.clientY <= box.bottom) {
        if (completed.moved && !completed.inspect) panAndRead(completed, event.clientX, event.clientY);
        else showPoint(hit, event.clientX, event.clientY);
      } else hidePoint(hit);
    }
    onIdle();
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') { startTouch(event); return; }
    clearReading();
    if (event.button !== 0) return;
    const { hit, host } = interaction(event.target);
    if (!hit) return;
    const grabbed = grab(hit, host, event.clientX);
    if (!grabbed) return;
    drag = { ...grabbed, id: event.pointerId, moved: false, inspect: event.shiftKey };
    hit.setPointerCapture?.(event.pointerId);
    if (drag.inspect) showPoint(hit, event.clientX, event.clientY);
  });

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') { moveTouch(event); return; }
    if (drag?.id === event.pointerId) {
      if (drag.inspect) {
        showPoint(drag.hit, event.clientX, event.clientY);
        return;
      }
      if (!drag.moved && Math.abs(event.clientX - drag.x) >= 4) {
        drag.moved = true;
        drag.hit.classList.add('chart-grabbing');
      }
      if (drag.moved) { panAndRead(drag, event.clientX, event.clientY); return; }
    }
    const { hit } = interaction(event.target);
    if (hit) showPoint(hit, event.clientX, event.clientY);
  });

  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    document.addEventListener(name, (event) => {
      if (event.pointerType === 'touch') stopTouch(event);
      else stopDrag(event);
    });
  }
  document.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'touch' && !drag) {
      const { hit } = interaction(event.target);
      if (hit) hidePoint(hit);
    }
  });

  function touchPoint(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function pinchGeometry(points) {
    const [first, second] = points.values();
    return { x: (first.x + second.x) / 2, distance: Math.hypot(first.x - second.x, first.y - second.y) };
  }

  function startTouch(event) {
    const { hit, host } = interaction(event.target);
    clearReading();
    if (!hit || !host || (touch && (touch.hit !== hit || touch.points.size >= 2))) return;
    if (event.cancelable) event.preventDefault();
    hit.setPointerCapture(event.pointerId);
    const point = touchPoint(event);
    if (!touch) {
      touch = { hit, host, origin: point, began: performance.now(), mode: null,
        points: new Map(), panStart: grab(hit, host, point.x), pinched: false };
    }
    touch.points.set(event.pointerId, point);
    if (touch.points.size === 2) {
      touch.pinched = true;
      hidePoint(hit);
      const pinch = pinchGeometry(touch.points);
      touch.pinchStart = pinch.distance >= 8 ? grab(hit, host, pinch.x) : null;
      touch.pinchDistance = pinch.distance;
      return;
    }
    showPoint(hit, point.x, point.y);
  }

  function renderTouch(gesture) {
    gesture.frame = null;
    if (touch !== gesture || !gesture.hit.isConnected) return;
    if (gesture.points.size === 2) {
      const pinch = pinchGeometry(gesture.points);
      if (pinch.distance < 8) return;
      if (!gesture.pinchStart) {
        gesture.pinchStart = grab(gesture.hit, gesture.host, pinch.x);
        gesture.pinchDistance = pinch.distance;
      } else zoom(gesture.pinchStart, gesture.pinchStart.count * gesture.pinchDistance / pinch.distance, pinch.x);
    } else {
      const [point] = gesture.points.values();
      if (!gesture.mode) {
        const dx = Math.abs(point.x - gesture.origin.x), dy = Math.abs(point.y - gesture.origin.y);
        if (dx >= 6 || dy >= 6) gesture.mode = dx >= dy && performance.now() - gesture.began <= 310 ? 'pan' : 'inspect';
      }
      if (gesture.mode === 'pan' && gesture.panStart) panAndRead(gesture.panStart, point.x, point.y);
      else showPoint(gesture.hit, point.x, point.y);
    }
  }

  function moveTouch(event) {
    const gesture = touch;
    if (!gesture?.points.has(event.pointerId)) return;
    gesture.points.set(event.pointerId, touchPoint(event));
    gesture.frame ??= requestAnimationFrame(() => renderTouch(gesture));
  }

  function stopTouch(event) {
    const gesture = touch;
    if (!gesture?.points.has(event.pointerId)) return;
    if (gesture.frame != null) {
      cancelAnimationFrame(gesture.frame);
      gesture.frame = null;
    }
    if (event.type === 'pointerup' && gesture.hit.isConnected) {
      gesture.points.set(event.pointerId, touchPoint(event));
      renderTouch(gesture);
    }
    gesture.points.delete(event.pointerId);
    if (gesture.points.size) {
      const [remaining] = gesture.points.values();
      gesture.pinchStart = null;
      gesture.origin = remaining;
      gesture.began = performance.now();
      gesture.mode = null;
      gesture.panStart = grab(gesture.hit, gesture.host, remaining.x);
      hidePoint(gesture.hit);
      return;
    }
    touch = null;
    if (event.type === 'pointerup' && !gesture.pinched && gesture.hit.isConnected) {
      holdReading(gesture.hit);
    } else {
      hidePoint(gesture.hit);
      onIdle();
    }
  }

  document.addEventListener('contextmenu', (event) => {
    if (interaction(event.target).hit) event.preventDefault();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') clearReading(); });

  document.addEventListener('wheel', (event) => {
    const { hit, host } = interaction(event.target);
    if (!hit) return;
    const grabbed = grab(hit, host, event.clientX);
    if (!grabbed) return;
    clearReading();
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey) {
      pan(grabbed, grabbed.x - event.deltaX);
    } else {
      const delta = event.deltaY * (event.deltaMode ? 16 : 1);
      zoom(grabbed, grabbed.count * Math.exp(clamp(delta / 520, -.7, .7)));
    }
  }, { passive: false });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-chart-zoom]');
    const host = button?.closest('[data-chart-key]');
    const hit = host?.querySelector('.chart-hit');
    if (!hit) return;
    const box = hit.getBoundingClientRect();
    const grabbed = grab(hit, host, box.left + box.width / 2);
    if (!grabbed) return;
    clearReading();
    if (button.dataset.chartZoom === 'reset') apply(host, 0, 0, true);
    else zoom(grabbed, grabbed.count * (button.dataset.chartZoom === 'in' ? .72 : 1.38));
  });

  return { render, busy: () => Boolean(drag || touch || reading?.hit.isConnected) };
}
