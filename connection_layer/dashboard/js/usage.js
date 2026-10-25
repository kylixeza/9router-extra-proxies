'use strict';

let USAGE = null;
let currentTimeframe = 'all';

function setTimeframe(tf) {
  currentTimeframe = tf;
  ['today', '7d', '30d', 'all'].forEach(k => {
    const b = document.getElementById('tf-' + k);
    if (b) {
      if (k === tf) {
        b.className = 'px-2.5 py-1 rounded-md bg-[#451A03] text-amber-200 font-semibold shadow-sm';
      } else {
        b.className = 'px-2.5 py-1 rounded-md text-[#856E52] hover:text-[#2A1A08]';
      }
    }
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
  const projects = USAGE.projects || [];
  const runaway = USAGE.runaway24h || [];

  const totalTok = provs.reduce((acc, p) => acc + Number(p.est_total_tokens || 0), 0);
  const provTotEl = document.getElementById('u-prov-total');
  if (provTotEl) provTotEl.textContent = fmtTok(totalTok) + ' tok';

  const provBar = document.getElementById('u-prov-bar');
  if (provBar) {
    if (totalTok > 0 && provs.length) {
      provBar.innerHTML = provs.map(p => {
        const pct = Math.max(1, Math.round((Number(p.est_total_tokens || 0) / totalTok) * 100));
        return `<div style="width:${pct}%; background:${provColor(p.provider)}" title="${esc(p.provider)}: ${pct}% (${fmtTok(p.est_total_tokens)})"></div>`;
      }).join('');
    } else {
      provBar.innerHTML = '<div class="w-full bg-[#E8D9C0]"></div>';
    }
  }

  const provList = document.getElementById('u-prov-list');
  if (provList) {
    provList.innerHTML = provs.length ? provs.map(p => {
      const pct = totalTok ? ((Number(p.est_total_tokens || 0) / totalTok) * 100).toFixed(1) : 0;
      const speed = p.tokens_per_sec > 0 ? `· <span class="text-emerald-700 font-medium">${p.tokens_per_sec} tok/s</span>` : '';
      return `<div class="flex items-center justify-between py-0.5">
        <div class="flex items-center gap-1.5 truncate">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${provColor(p.provider)}"></span>
          <span class="font-semibold text-[#2A1A08]">${esc(p.provider)}</span>
          <span class="text-[11px] text-[#856E52]">(${num(p.requests)} req ${speed})</span>
        </div>
        <div class="text-right whitespace-nowrap"><span class="font-semibold text-[#2A1A08]">${fmtTok(p.est_total_tokens)}</span> <span class="text-[11px] text-[#856E52]">${pct}%</span></div>
      </div>`;
    }).join('') : '<div class="text-[#856E52]">no provider data</div>';
  }

  const maxModelTok = models.reduce((m, x) => Math.max(m, Number(x.est_total_tokens || 0)), 1);
  const modTotEl = document.getElementById('u-model-total');
  if (modTotEl) modTotEl.textContent = `${models.length} active`;
  const modList = document.getElementById('u-model-list');
  if (modList) {
    modList.innerHTML = models.length ? models.slice(0, 5).map(m => {
      const t = Number(m.est_total_tokens || 0);
      const pct = Math.min(100, Math.round((t / maxModelTok) * 100));
      return `<div>
        <div class="flex items-center justify-between text-[11px] mb-0.5">
          <span class="truncate font-semibold text-[#2A1A08] max-w-[160px]" title="${esc(m.model)}">${esc(m.model)}</span>
          <span class="text-[#2A1A08]">${fmtTok(t)}</span>
        </div>
        <div class="h-1.5 w-full bg-[#E8D9C0] rounded-full overflow-hidden">
          <div class="h-full rounded-full" style="width:${pct}%; background:${provColor(m.provider)}"></div>
        </div>
      </div>`;
    }).join('') : '<div class="text-[#856E52]">no model data</div>';
  }

  const maxProjTok = projects.reduce((m, x) => Math.max(m, Number(x.est_total_tokens || 0)), 1);
  const projTotEl = document.getElementById('u-proj-total');
  if (projTotEl) projTotEl.textContent = `${projects.length} projects`;
  const projList = document.getElementById('u-proj-list');
  if (projList) {
    projList.innerHTML = projects.length ? projects.slice(0, 4).map(pr => {
      const t = Number(pr.est_total_tokens || 0);
      const pct = Math.min(100, Math.round((t / maxProjTok) * 100));
      return `<div>
        <div class="flex items-center justify-between text-[11px] mb-0.5">
          <span class="truncate font-semibold text-[#2A1A08] max-w-[150px]">${esc(pr.project_name)}</span>
          <span class="text-[#2A1A08]">${fmtTok(t)}</span>
        </div>
        <div class="h-1.5 w-full bg-[#E8D9C0] rounded-full overflow-hidden">
          <div class="h-full bg-[#451A03] rounded-full" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('') : '<div class="text-[#856E52]">no project data</div>';
  }

  const runawayList = document.getElementById('u-runaway-list');
  if (runawayList) {
    runawayList.innerHTML = runaway.length ? runaway.slice(0, 3).map(r => {
      const t = Number(r.tokens_24h || 0);
      const runawayAlert = t > 5000000 ? '<span class="px-1.5 py-0.2 rounded bg-red-100 text-red-800 text-[10px] font-bold border border-red-300">⚠️ RUNAWAY</span>' : '';
      return `<div class="flex items-center justify-between py-0.5">
        <span class="truncate max-w-[140px] text-[#451A03]">${esc(r.project_name)} ${runawayAlert}</span>
        <span class="font-medium text-[#2A1A08]">${fmtTok(t)} / 24h</span>
      </div>`;
    }).join('') : '<div class="text-[#856E52]">no 24h traffic</div>';
  }
}
