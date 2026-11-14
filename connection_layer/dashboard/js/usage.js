'use strict';

let USAGE = null;
let currentTimeframe = 'all';
let pulseMetric = 'requests';

function setTimeframe(tf) {
  currentTimeframe = tf;
  ['today', '7d', '30d', 'all'].forEach(k => {
    const b = document.getElementById('tf-' + k);
    if (b) {
      b.classList.toggle('on', k === tf);
      b.setAttribute('aria-selected', k === tf ? 'true' : 'false');
    }
  });
  reloadUsage();
}

function setPulseMetric(m) {
  pulseMetric = m;
  ['requests', 'tokens', 'ms'].forEach(k => {
    const b = document.getElementById('pm-' + k);
    if (b) {
      b.classList.toggle('on', k === m);
      b.setAttribute('aria-selected', k === m ? 'true' : 'false');
    }
  });
  renderPulse();
}

async function reloadUsage() {
  try {
    const proj = document.getElementById('proj')?.value || '';
    const r = await fetch(`/api/conn/usage?timeframe=${currentTimeframe}&project=${encodeURIComponent(proj)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    USAGE = await r.json();
    renderUsage();
    renderPulse();
  } catch (e) {
    console.error(e);
  }
}

function renderPulse() {
  const chartEl = document.getElementById('pulseChart');
  const sumEl = document.getElementById('pulseSummary');
  const subEl = document.getElementById('pulseSub');
  if (!chartEl || !USAGE || typeof LeonCharts === 'undefined') return;

  const rows = USAGE.hourly24h || [];
  if (!rows.length) {
    chartEl.innerHTML = '<div class="empty-box">No hourly requests recorded in the last 24 hours.</div>';
    if (sumEl) sumEl.textContent = '0 requests in last 24h';
    return;
  }

  const labels = rows.map(r => {
    const d = new Date(r.bucket);
    const hh = String(d.getHours()).padStart(2, '0');
    return `${hh}:00`;
  });

  const vals = rows.map(r => {
    if (pulseMetric === 'tokens') return Number(r.tokens || 0);
    if (pulseMetric === 'ms') return Number(r.avg_ms || 0);
    return Number(r.requests || 0);
  });

  const errs = rows.map(r => Number(r.errors || 0));
  const totalReq = rows.reduce((a, r) => a + Number(r.requests || 0), 0);
  const totalErr = rows.reduce((a, r) => a + Number(r.errors || 0), 0);
  const totalTok = rows.reduce((a, r) => a + Number(r.tokens || 0), 0);

  let peakIdx = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] > vals[peakIdx]) peakIdx = i;

  const fmt = pulseMetric === 'tokens'
    ? LeonCharts.fmt.compact
    : pulseMetric === 'ms'
      ? LeonCharts.fmt.ms
      : LeonCharts.fmt.int;

  const annotations = vals[peakIdx] > 0
    ? [{ at: peakIdx, label: `Peak ${fmt(vals[peakIdx])} at ${labels[peakIdx]}` }]
    : [];

  const series = [{ name: pulseMetric === 'tokens' ? 'tokens' : pulseMetric === 'ms' ? 'avg ms' : 'req', values: vals }];
  if (pulseMetric === 'requests' && errs.some(e => e > 0)) {
    series.push({ name: 'errors', values: errs, colour: 'var(--negative)' });
  }

  const reference = pulseMetric === 'ms' ? { value: 15000, label: '15s slow line' } : null;

  LeonCharts.line(chartEl, {
    labels,
    series,
    format: fmt,
    height: 192,
    annotations,
    reference
  });

  if (subEl) subEl.textContent = `last 24 hours · ${rows.length} active hour${rows.length === 1 ? '' : 's'}`;
  if (sumEl) {
    sumEl.textContent = `${num(totalReq)} req · ${fmtTok(totalTok)} tok · ${num(totalErr)} error${totalErr === 1 ? '' : 's'}`;
  }
}

function renderUsage() {
  if (!USAGE) return;
  const provs = USAGE.providers || [];
  const models = USAGE.models || [];
  const runaway = USAGE.runaway24h || [];

  const totalTok = provs.reduce((acc, p) => acc + Number(p.est_total_tokens || 0), 0);
  const totalReq = provs.reduce((acc, p) => acc + Number(p.requests || 0), 0);
  const provTotEl = document.getElementById('u-prov-total');
  if (provTotEl) provTotEl.textContent = `${fmtTok(totalTok)} tok across ${num(totalReq)} req`;

  const provBar = document.getElementById('u-prov-bar');
  if (provBar) {
    if (totalTok > 0 && provs.length) {
      provBar.innerHTML = provs.map((p, idx) => {
        const pct = Math.max(2, Math.round((Number(p.est_total_tokens || 0) / totalTok) * 100));
        const bg = idx === 0 ? 'var(--accent)' : idx === 1 ? 'var(--chart-3)' : 'var(--control)';
        return `<div style="width:${pct}%;background:${bg};margin-right:${idx < provs.length - 1 ? '2px' : '0'}" title="${esc(p.provider)}: ${pct}% (${fmtTok(p.est_total_tokens)})"></div>`;
      }).join('');
    } else {
      provBar.innerHTML = '<div style="width:100%;background:var(--raised)"></div>';
    }
  }

  const provList = document.getElementById('u-prov-list');
  if (provList) {
    provList.innerHTML = provs.length ? `<div class="kv-list" style="border-top:0">${provs.slice(0, 5).map((p, idx) => {
      const pct = totalTok ? ((Number(p.est_total_tokens || 0) / totalTok) * 100).toFixed(1) : '0.0';
      const speed = p.tokens_per_sec > 0 ? ` · ${p.tokens_per_sec} tok/s` : '';
      const dot = idx === 0 ? 'var(--accent)' : idx === 1 ? 'var(--chart-3)' : 'var(--control)';
      return `<div class="kv-row">
        <span style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex:none"></span>
          <span style="font-weight:500;color:var(--text)">${esc(p.provider)}</span>
          <span class="cell-muted num">${num(p.requests)} req${speed}</span>
        </span>
        <span class="num" style="white-space:nowrap"><strong>${fmtTok(p.est_total_tokens)}</strong> <span class="cell-muted">${pct}%</span></span>
      </div>`;
    }).join('')}</div>` : '<div class="empty-box">0 tokens in selected range.</div>';
  }

  const modTotEl = document.getElementById('u-model-total');
  if (modTotEl) modTotEl.textContent = `${models.length} active`;
  const modList = document.getElementById('u-model-list');
  if (modList && typeof LeonCharts !== 'undefined') {
    LeonCharts.barList(
      modList,
      models.slice(0, 5).map(m => ({ label: m.model, value: Number(m.est_total_tokens || 0) })),
      { format: LeonCharts.fmt.compact }
    );
  }

  const runawayList = document.getElementById('u-runaway-list');
  if (runawayList) {
    runawayList.innerHTML = runaway.length ? runaway.slice(0, 4).map(r => {
      const t = Number(r.tokens_24h || 0);
      const hot = t > 5000000;
      return `<span style="display:inline-flex;align-items:center;gap:6px">
        <span style="color:${hot ? 'var(--negative)' : 'var(--text)'}">${esc(r.project_name)}</span>
        <span style="color:var(--muted)">${fmtTok(t)}</span>
      </span>`;
    }).join('') : '<span style="color:var(--muted)">0 tok in last 24h</span>';
  }
}
