'use strict';
// Lightweight SVG bar chart helper reading --chart-1, --grid, --axis-ink, --ink from CSS tokens.
const ValiantChart = (() => {
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
  const fmtInt = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

  function niceTicks(maxVal, count = 4) {
    const top = Math.max(1, maxVal);
    const raw = top / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    let hi = Math.ceil(top / step) * step;
    if (hi <= top) hi += step;
    const out = [];
    for (let v = 0; v <= hi + step * 0.1; v += step) out.push(Math.round(v));
    return out;
  }

  function bars(el, { labels = [], values = [], highlight = 0, onSelect = null, unit = '' }) {
    el.innerHTML = '';
    if (!labels.length) {
      el.innerHTML = '<div class="empty-box">No routing items match the current filter.</div>';
      return;
    }
    const w = Math.max(260, el.clientWidth || 540);
    const h = 192;
    const padL = 38;
    const padR = 12;
    const padT = 16;
    const padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal = Math.max(0, ...values);
    const yt = niceTicks(maxVal, 4);
    const yMax = yt[yt.length - 1] || 1;
    const y = v => padT + plotH - (v / yMax) * plotH;

    const grid = css(el, '--grid', '#ebeff2');
    const axisInk = css(el, '--axis-ink', '#565b61');
    const accent = css(el, '--chart-1', '#1b6c80');
    const mutedBar = css(el, '--chart-muted', '#cfd6dc');
    const ink = css(el, '--ink', '#131416');

    const s = svg('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      height: h,
      role: 'img',
      'aria-label': `Bar chart of ${labels.length} items`,
      style: 'display:block;overflow:visible;font-variant-numeric:tabular-nums'
    }, el);

    for (const v of yt) {
      const yy = y(v);
      svg('line', {
        x1: padL, x2: w - padR, y1: yy, y2: yy,
        stroke: v === 0 ? css(el, '--control', '#c7ced5') : grid,
        'stroke-width': 1,
        'shape-rendering': 'crispEdges'
      }, s);
      text(s, fmtInt.format(v), {
        x: padL - 8, y: yy + 4,
        'text-anchor': 'end', 'font-size': 12, fill: axisInk
      });
    }

    const n = labels.length;
    const slot = plotW / n;
    const barW = Math.min(48, Math.max(16, slot * 0.54));

    let tip = el.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      el.appendChild(tip);
    }

    labels.forEach((lab, i) => {
      const val = values[i] || 0;
      const cx = padL + slot * (i + 0.5);
      const bx = cx - barW / 2;
      const by = y(val);
      const bh = Math.max(val > 0 ? 2 : 0, y(0) - by);
      const isHi = Array.isArray(highlight) ? highlight.includes(i) : highlight === i;

      const rect = svg('rect', {
        x: bx, y: by, width: barW, height: bh,
        fill: isHi ? accent : mutedBar,
        style: onSelect ? 'cursor:pointer;transition:opacity 140ms ease' : ''
      }, s);

      if (bh > 0) {
        text(s, fmtInt.format(val), {
          x: cx, y: Math.max(11, by - 5),
          'text-anchor': 'middle', 'font-size': 12,
          'font-weight': isHi ? 600 : 400,
          fill: isHi ? ink : axisInk
        });
      }

      const shortLab = lab.length > 12 ? lab.slice(0, 11) + '…' : lab;
      text(s, shortLab, {
        x: cx, y: h - 6,
        'text-anchor': 'middle', 'font-size': 12,
        'font-weight': isHi ? 500 : 400,
        fill: isHi ? ink : axisInk
      });

      const hit = svg('rect', {
        x: padL + slot * i, y: padT, width: slot, height: plotH,
        fill: 'transparent',
        style: onSelect ? 'cursor:pointer' : ''
      }, s);

      hit.addEventListener('mouseenter', () => {
        rect.setAttribute('opacity', '0.85');
        tip.textContent = `${lab}: ${fmtInt.format(val)}${unit ? ' ' + unit : ''}`;
        tip.style.opacity = '1';
        tip.style.left = Math.min(w - 140, Math.max(4, cx - 40)) + 'px';
        tip.style.top = Math.max(0, by - 32) + 'px';
      });
      hit.addEventListener('mouseleave', () => {
        rect.removeAttribute('opacity');
        tip.style.opacity = '0';
      });
      if (onSelect) hit.addEventListener('click', () => onSelect(lab, i));
    });
  }

  return { bars };
})();
