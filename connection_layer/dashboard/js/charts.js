// Minimal SVG chart primitives for Leon (derived from design-taste-frontend charts.js)
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;
  const svg = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const text = (parent, str, attrs) => {
    const t = svg('text', attrs, parent);
    t.textContent = str;
    return t;
  };
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = o => new Intl.NumberFormat(document.documentElement.lang || 'en', o);
  const fmt = {
    int: v => nf({ maximumFractionDigits: 0 }).format(v),
    compact: v => nf({ notation: 'compact', maximumFractionDigits: 1 }).format(v),
    ms: v => `${nf({ maximumFractionDigits: 0 }).format(v)} ms`
  };

  function ticks(min, max, count = 4) {
    if (max <= min) max = min + 1;
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    let hi = Math.ceil(max / step) * step;
    if (hi <= max) hi += step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function measure(s, str, size = 12) {
    const t = text(s, str, { x: -999, y: -999, 'font-size': size, visibility: 'hidden' });
    let wd = 0;
    try { wd = t.getComputedTextLength(); } catch {}
    t.remove();
    return wd > 0 ? wd : String(str).length * size * 0.56;
  }

  function xPicks(labels, span) {
    const n = labels.length;
    if (n <= 1) return n ? [0] : [];
    const longest = Math.max(...labels.map(l => String(l).length));
    const cap = Math.max(2, Math.min(7, Math.floor(span / (longest * 7 + 20))));
    if (n <= cap) return [...Array(n).keys()];
    const step = Math.ceil((n - 1) / (cap - 1));
    const out = [];
    for (let i = 0; i < n; i += step) out.push(i);
    return out;
  }

  function frame(el, h) {
    el.innerHTML = '';
    const w = Math.max(240, el.clientWidth || 560);
    const s = svg('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      height: h,
      role: 'img',
      style: 'display:block;overflow:visible;font-variant-numeric:tabular-nums'
    }, el);
    return { s, w, h };
  }

  function tooltip(el) {
    let t = el.querySelector('.chart-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'chart-tip';
      t.style.cssText = 'position:absolute;pointer-events:none;padding:6px 10px;font:inherit;font-size:12px;line-height:1.35;border-radius:6px;white-space:nowrap;opacity:0;transition:opacity 120ms ease;background:var(--raised,#212023);color:var(--text,#fff);border:1px solid var(--border,#222224);z-index:10';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.appendChild(t);
    }
    return t;
  }

  function line(el, { labels, series, format = fmt.int, height = 190, reference = null, annotations = [] }) {
    const colourOf = (sr, k) => sr.colour || (k === 0 ? css(el, '--chart-1', '#4a8ad6') : css(el, '--chart-2', '#e5566f'));
    const draw = () => {
      if (!labels.length) {
        el.innerHTML = '<div class="empty-box">No hourly requests recorded in the last 24 hours.</div>';
        return;
      }
      const { s, w, h } = frame(el, height);
      const vals = series.flatMap(sr => sr.values.filter(v => v != null));
      const refVals = reference ? [reference.value] : [];
      const top = Math.max(1, ...vals, ...refVals);
      const yt = ticks(0, top, 4);
      const padL = 10 + Math.max(...yt.map(v => measure(s, format(v), 12)));
      const padT = annotations.length ? 22 : 10;
      const padB = 26;
      const x = i => padL + (i * (w - padL)) / Math.max(1, labels.length - 1);
      const y = v => padT + (h - padT - padB) * (1 - (v - yt[0]) / Math.max(1e-6, yt[yt.length - 1] - yt[0]));

      const g = svg('g', {}, s);
      const grid = css(el, '--grid', '#222224');
      const ink = css(el, '--axis-ink', '#8a8c92');

      for (const v of yt) {
        const yy = y(v);
        svg('line', { x1: padL, x2: w, y1: yy, y2: yy, stroke: grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
        text(g, format(v), { x: padL - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 12, fill: ink });
      }

      const n = labels.length;
      for (const i of xPicks(labels, w - padL)) {
        const lab = String(labels[i]);
        const tw = measure(s, lab, 12);
        const xx = x(i);
        const left = Math.max(padL, Math.min(w - tw, i === 0 ? xx : i === n - 1 ? xx - tw : xx - tw / 2));
        text(g, lab, { x: left, y: h - padB + 18, 'font-size': 12, fill: ink });
      }

      if (reference) {
        const ry = y(reference.value);
        svg('line', { x1: padL, x2: w, y1: ry, y2: ry, stroke: ink, 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.7 }, g);
        if (reference.label) {
          const tw = measure(s, reference.label, 11);
          text(g, reference.label, { x: w - tw, y: ry - 5, 'font-size': 11, fill: ink });
        }
      }

      series.forEach((sr, k) => {
        const col = colourOf(sr, k);
        const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
        const d = pts.reduce((acc, p, i) => (p ? acc + (acc && pts[i - 1] ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) : acc), '');
        if (k === 0 && pts.filter(Boolean).length > 1) {
          const first = pts.find(Boolean);
          const last = [...pts].reverse().find(Boolean);
          svg('path', { d: `${d}L${last[0]} ${y(yt[0])}L${first[0]} ${y(yt[0])}Z`, fill: col, opacity: 0.1 }, g);
        }
        if (d) svg('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
        if (pts.filter(Boolean).length === 1) {
          const p = pts.find(Boolean);
          svg('circle', { cx: p[0], cy: p[1], r: 3.5, fill: col }, g);
        }
      });

      for (const a of annotations) {
        if (a.at == null || a.at < 0 || a.at >= labels.length) continue;
        const ax = x(a.at);
        svg('line', { x1: ax, x2: ax, y1: padT, y2: h - padB, stroke: a.colour || ink, 'stroke-width': 1, opacity: 0.55 }, g);
        const tw = measure(s, a.label, 11);
        const lx = ax + 4 + tw <= w ? ax + 4 : Math.max(padL, ax - 4 - tw);
        text(g, a.label, { x: lx, y: padT - 6, 'font-size': 11, fill: a.colour || ink });
      }

      const tip = tooltip(el);
      const rule = svg('line', { y1: padT, y2: h - padB, stroke: ink, 'stroke-width': 1, opacity: 0 }, g);
      const dots = series.map((sr, k) => svg('circle', { r: 3.5, fill: css(el, '--surface', '#131217'), stroke: colourOf(sr, k), 'stroke-width': 2, opacity: 0 }, g));
      const hit = svg('rect', { x: padL, y: padT, width: Math.max(1, w - padL), height: Math.max(1, h - padT - padB), fill: 'transparent' }, s);

      hit.addEventListener('pointermove', ev => {
        const r = s.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * w;
        const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - padL) / Math.max(1, w - padL)) * (labels.length - 1))));
        rule.setAttribute('x1', x(i));
        rule.setAttribute('x2', x(i));
        rule.setAttribute('opacity', 0.45);
        series.forEach((sr, k) => {
          const v = sr.values[i];
          dots[k].setAttribute('cx', x(i));
          dots[k].setAttribute('cy', v == null ? -99 : y(v));
          dots[k].setAttribute('opacity', v == null ? 0 : 1);
        });
        tip.innerHTML = `<div style="color:var(--muted)">${esc(labels[i])}</div>` +
          series.map(sr => `<div><strong>${sr.values[i] == null ? '-' : esc(format(sr.values[i]))}</strong> ${esc(sr.name)}</div>`).join('');
        const left = Math.min((x(i) / w) * r.width + 12, r.width - tip.offsetWidth - 4);
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = '0px';
        tip.style.opacity = 1;
      });
      hit.addEventListener('pointerleave', () => {
        tip.style.opacity = 0;
        rule.setAttribute('opacity', 0);
        dots.forEach(d => d.setAttribute('opacity', 0));
      });
      s.setAttribute('aria-label', `${series.map(x => x.name).join(', ')}, ${labels[0]} to ${labels[labels.length - 1]}`);
    };
    draw();
    if ('ResizeObserver' in window) {
      let lastW = el.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(el.clientWidth - lastW) > 4) { lastW = el.clientWidth; draw(); }
      }).observe(el);
    }
  }

  function barList(el, rows, { format = fmt.compact } = {}) {
    el.innerHTML = '';
    if (!rows.length) {
      el.innerHTML = '<div class="empty-box">No active models in selected window.</div>';
      return;
    }
    const max = Math.max(...rows.map(r => r.value)) || 1;
    const list = document.createElement('ol');
    list.style.cssText = 'list-style:none;margin:0;padding:0;display:grid;gap:12px;font-variant-numeric:tabular-nums';
    rows.forEach((r, k) => {
      const li = document.createElement('li');
      li.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;column-gap:12px';
      const a = document.createElement('span');
      a.textContent = r.label;
      a.title = r.label;
      a.style.cssText = 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500';
      const b = document.createElement('span');
      b.textContent = format(r.value);
      b.style.cssText = 'font-weight:500;text-align:right;color:var(--text)';
      const track = document.createElement('span');
      track.style.cssText = 'grid-column:1 / -1;height:2px;margin-top:6px;width:100%;background:var(--raised);position:relative;display:block';
      const fill = document.createElement('span');
      fill.style.cssText = `position:absolute;inset:0 auto 0 0;width:${Math.max(2, Math.round((r.value / max) * 100))}%;background:${k === 0 ? 'var(--accent)' : 'var(--muted)'}`;
      track.appendChild(fill);
      li.append(a, b, track);
      list.appendChild(li);
    });
    el.appendChild(list);
  }

  window.LeonCharts = { line, barList, fmt };
})();
