'use strict';

let USAGE = null;
let currentTimeframe = 'all';

function setTimeframe(tf) {
  currentTimeframe = tf;
  ['today', '7d', '30d', 'all'].forEach(k => {
    const b = document.getElementById('tf-' + k);
    if (b) b.classList.toggle('on', k === tf);
  });
  reloadUsage();
}

async function reloadUsage() {
  try {
    const proj = document.getElementById('proj')?.value || '';
    const r = await fetch(`/api/conn/usage?timeframe=${currentTimeframe}&project=${encodeURIComponent(proj)}`);
    USAGE = await r.json();
    renderUsage();
  } catch (e) {
    console.error(e);
  }
}

function renderUsage() {
  if (!USAGE) return;
  const provs = USAGE.providers || [];
  const models = USAGE.models || [];
  const runaway = USAGE.runaway24h || [];

  const totalTok = provs.reduce((acc, p) => acc + Number(p.est_total_tokens || 0), 0);
  const provTotEl = document.getElementById('u-prov-total');
  if (provTotEl) provTotEl.textContent = fmtTok(totalTok) + ' tok';

  const provBar = document.getElementById('u-prov-bar');
  if (provBar) {
    if (totalTok > 0 && provs.length) {
      provBar.innerHTML = provs.map((p, idx) => {
        const pct = Math.max(2, Math.round((Number(p.est_total_tokens || 0) / totalTok) * 100));
        const bg = idx === 0 ? 'var(--chart-3)' : idx === 1 ? 'var(--chart-1)' : 'var(--control)';
        return `<div style="width:${pct}%;background:${bg};margin-right:${idx < provs.length - 1 ? '2px' : '0'}" title="${esc(p.provider)}: ${pct}% (${fmtTok(p.est_total_tokens)})"></div>`;
      }).join('');
    } else {
      provBar.innerHTML = '<div class="w-full" style="background:var(--chart-3);opacity:0.25"></div>';
    }
  }

  const provList = document.getElementById('u-prov-list');
  if (provList) {
    provList.innerHTML = provs.length ? provs.slice(0, 5).map((p, idx) => {
      const pct = totalTok ? ((Number(p.est_total_tokens || 0) / totalTok) * 100).toFixed(1) : '0.0';
      const speed = p.tokens_per_sec > 0 ? ` · ${p.tokens_per_sec} tok/s` : '';
      const dot = idx === 0 ? 'var(--chart-3)' : idx === 1 ? 'var(--chart-1)' : 'var(--control)';
      return `<div class="flex items-center justify-between py-0.5">
        <div class="flex items-center gap-2 truncate">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${dot}"></span>
          <span class="font-medium">${esc(p.provider)}</span>
          <span class="text-xs" style="color:var(--muted)">${num(p.requests)} req${speed}</span>
        </div>
        <div class="text-right whitespace-nowrap num"><span class="font-medium">${fmtTok(p.est_total_tokens)}</span> <span class="text-xs" style="color:var(--muted)">${pct}%</span></div>
      </div>`;
    }).join('') : '<div class="text-xs" style="color:var(--muted)">0 tokens in selected range</div>';
  }

  const maxModelTok = models.reduce((m, x) => Math.max(m, Number(x.est_total_tokens || 0)), 1);
  const modTotEl = document.getElementById('u-model-total');
  if (modTotEl) modTotEl.textContent = `${models.length} active`;
  const modList = document.getElementById('u-model-list');
  if (modList) {
    modList.innerHTML = models.length ? models.slice(0, 4).map((m, i) => {
      const t = Number(m.est_total_tokens || 0);
      const pct = Math.min(100, Math.round((t / maxModelTok) * 100));
      return `<div>
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="truncate font-medium max-w-[200px]" title="${esc(m.model)}">${esc(m.model)}</span>
          <span class="num">${fmtTok(t)}</span>
        </div>
        <div class="h-1.5 w-full rounded-sm overflow-hidden" style="background:var(--raised)">
          <div class="h-full" style="width:${pct}%;background:${i === 0 ? 'var(--chart-3)' : 'var(--control)'}"></div>
        </div>
      </div>`;
    }).join('') : '<div class="text-xs" style="color:var(--muted)">0 models active</div>';
  }

  const runawayList = document.getElementById('u-runaway-list');
  if (runawayList) {
    runawayList.innerHTML = runaway.length ? runaway.slice(0, 4).map(r => {
      const t = Number(r.tokens_24h || 0);
      const hot = t > 5000000;
      return `<span class="inline-flex items-center gap-1.5">
        <span style="color:${hot ? 'var(--negative)' : 'var(--text)'}">${esc(r.project_name)}</span>
        <span style="color:var(--muted)">${fmtTok(t)}</span>
      </span>`;
    }).join('') : '<span style="color:var(--muted)">0 tok in last 24h</span>';
  }
}
