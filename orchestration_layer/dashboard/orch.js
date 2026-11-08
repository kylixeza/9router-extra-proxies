'use strict';

// ponytail: single-file vanilla controller; upgrade to ES modules only if tabs grow >1500 LOC.
const ALL_ROLES = ['orchestrator', 'worker', 'fixer', 'reviewer', 'summarizer'];
const TOOL_ROLES = new Set(['orchestrator', 'worker', 'fixer']);
const ROLE_ABBR = {
  orchestrator: 'orch',
  worker: 'work',
  fixer: 'fix',
  reviewer: 'rev',
  summarizer: 'sum',
};

const STATE = {
  tab: 'models',
  health: null,
  models: [],
  filteredModels: [],
  lastSync: null,
  selectedIds: new Set(),
  filters: {
    q: '',
    role: 'all',
    status: 'all',
    caps: new Set(),
  },
  detailModelId: null,
  settings: {
    enabled: true,
    trigger_command: '/orch-plan',
    off_command: '/orch-off',
    orchestrator_model: '',
    orchestrator_chain: [],
    worker_fallback_chain: [],
    fixer_chain: [],
    max_attempts: 3,
    max_parallel: 3,
    inject_roster: true,
    rewrite_mode: 'body',
    spread_load: true,
  },
  settingsDirty: false,
  warnings: [],
  mismatches24h: 0,
  roster: { text: '', hash: '000000', tokensEst: 0 },
  plans: [],
  selectedPlanId: null,
  planCalls: [],
  autoPollMonitor: true,
  monitorTimer: null,
  dragChainKey: null,
  dragFromIdx: -1,
};

function escHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, kind = 'info') {
  const box = document.getElementById('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'px-3.5 py-2.5 rounded-lg text-xs font-medium shadow-sm border';
  if (kind === 'error') {
    el.style.background = 'var(--negative)';
    el.style.borderColor = 'var(--negative)';
    el.style.color = '#fff';
  } else if (kind === 'warn') {
    el.style.background = 'var(--pill-warning-bg)';
    el.style.borderColor = '#f59e0b';
    el.style.color = 'var(--pill-warning-ink)';
  } else {
    el.style.background = 'var(--text)';
    el.style.borderColor = 'var(--text)';
    el.style.color = '#fff';
  }
  el.textContent = String(msg ?? '');
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 4800 : 3000);
}

function showErrorBanner(title, message) {
  const wrap = document.getElementById('errBanner');
  const tEl = document.getElementById('errBannerTitle');
  const mEl = document.getElementById('errBannerMsg');
  if (!wrap || !tEl || !mEl) return;
  tEl.textContent = String(title || 'Error');
  mEl.textContent = String(message || '');
  wrap.classList.remove('hidden');
}

function hideErrorBanner() {
  const wrap = document.getElementById('errBanner');
  if (wrap) wrap.classList.add('hidden');
}

async function apiJson(path, method = 'GET', body = undefined) {
  const headers = { accept: 'application/json' };
  const savedKey = localStorage.getItem('9r-key') || '';
  if (savedKey) headers.authorization = 'Bearer ' + savedKey;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `${method} ${path} failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtTimeShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtUptime(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtCtx(model) {
  const raw = model.contextWindow ?? model.contextLength ?? null;
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return '?';
  const n = Number(raw);
  if (n >= 1000000) {
    const m = n / 1000000;
    return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function fmtInt(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString('en-US');
}

/* ========================================================================== */
/* Navigation & Shell Status                                                  */
/* ========================================================================== */

function toggleSidebar() {
  const sb = document.getElementById('orchSidebar');
  if (sb) sb.classList.toggle('open');
}

function switchTab(tabName) {
  STATE.tab = tabName;
  for (const name of ['models', 'orchestrator', 'monitor', 'tester']) {
    const sec = document.getElementById(`tab-${name}`);
    const nav = document.getElementById(`nav-${name}`);
    const isTarget = name === tabName;
    if (sec) sec.classList.toggle('hidden', !isTarget);
    if (nav) {
      nav.classList.toggle('active', isTarget);
      nav.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    }
  }
  const sb = document.getElementById('orchSidebar');
  if (sb) sb.classList.remove('open');

  syncMonitorTimer();
  if (tabName === 'monitor') loadMonitor(false);
  if (tabName === 'orchestrator') renderOrchestratorTab();
}

function renderShellStatus() {
  const enabled = Boolean(STATE.settings && STATE.settings.enabled);
  const pillIds = ['hdrEnabledPill', 'sheetStatusPill', 'mobileEnabledPill'];
  for (const id of pillIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.className = enabled
      ? 'pill pill-positive text-xs font-medium'
      : 'pill pill-neutral text-xs font-medium';
    el.textContent = enabled ? '● enabled' : '○ disabled';
  }

  const r9 = STATE.health && STATE.health.router9;
  const hdrR9 = document.getElementById('hdrR9Pill');
  const sheetR9 = document.getElementById('sheetR9Text');
  if (r9) {
    if (hdrR9) {
      hdrR9.className = r9.reachable ? 'pill pill-positive text-xs num' : 'pill pill-negative text-xs num';
      hdrR9.textContent = r9.reachable ? `9router · OK` : `9router · DOWN`;
    }
    if (sheetR9) {
      sheetR9.textContent = r9.reachable
        ? `9router reachable (HTTP ${r9.status ?? 200})`
        : `9router unreachable${r9.status ? ` (HTTP ${r9.status})` : ''}`;
      sheetR9.style.color = r9.reachable ? 'var(--positive)' : 'var(--negative)';
    }
  }

  const total = STATE.models.length;
  const active = STATE.models.filter(m => m.isActive).length;
  const navCount = document.getElementById('navCountModels');
  if (navCount) navCount.textContent = `${active}/${total}`;

  const warnBadge = document.getElementById('navWarnBadge');
  if (warnBadge) {
    const wc = (STATE.warnings || []).length;
    warnBadge.textContent = String(wc);
    warnBadge.classList.toggle('hidden', wc === 0);
  }

  const mm = Number(STATE.mismatches24h || 0);
  const mmBadge = document.getElementById('navMismatchBadge');
  if (mmBadge) {
    mmBadge.textContent = String(mm);
    mmBadge.classList.toggle('hidden', mm <= 0);
  }
  const sheetMm = document.getElementById('sheetMismatchPill');
  if (sheetMm) {
    sheetMm.textContent = `⚠ ${mm} mismatch (24h)`;
    sheetMm.classList.toggle('hidden', mm <= 0);
  }

  const stDb = document.getElementById('stDb');
  if (stDb && STATE.health) {
    stDb.textContent = STATE.health.dbConnected ? 'pg' : 'mem';
  }
  const stUp = document.getElementById('stUptime');
  if (stUp && STATE.health) {
    stUp.textContent = fmtUptime(STATE.health.uptimeSec);
  }
  const stHash = document.getElementById('stRosterHash');
  if (stHash && STATE.roster) {
    stHash.textContent = STATE.roster.hash || '—';
  }
  const stTok = document.getElementById('stRosterTok');
  if (stTok && STATE.roster) {
    const est = STATE.roster.tokensEst ?? Math.ceil((STATE.roster.text || '').length / 4);
    stTok.textContent = `~${est} tok`;
  }
}

/* ========================================================================== */
/* Data Loading                                                               */
/* ========================================================================== */

async function loadHealthAndSettings(opts = {}) {
  const preserveDirty = Boolean(opts.preserveDirty && STATE.settingsDirty);
  const [health, settingsData] = await Promise.all([
    apiJson('/orch/api/health'),
    apiJson('/orch/api/settings'),
  ]);
  STATE.health = health;
  if (health.lastSync) STATE.lastSync = health.lastSync;
  if (settingsData.settings && !preserveDirty) {
    STATE.settings = settingsData.settings;
    STATE.settingsDirty = false;
  }
  STATE.warnings = settingsData.warnings || health.warnings || [];
  STATE.mismatches24h = settingsData.mismatches24h ?? health.mismatches24h ?? 0;
  STATE.roster = settingsData.roster || health.roster || STATE.roster;
}

async function loadModels() {
  const data = await apiJson('/orch/api/models');
  STATE.models = Array.isArray(data.models) ? data.models : [];
  if (data.lastSync) STATE.lastSync = data.lastSync;
  const validIds = new Set(STATE.models.map(m => m.id));
  for (const id of [...STATE.selectedIds]) {
    if (!validIds.has(id)) STATE.selectedIds.delete(id);
  }
  applyModelFilters();
}

async function refreshAll() {
  hideErrorBanner();
  try {
    await Promise.all([loadHealthAndSettings(), loadModels()]);
    renderSyncSummary();
    renderShellStatus();
    renderModelsTable();
    renderOrchestratorTab();
    if (STATE.tab === 'monitor') await loadMonitor(false);
  } catch (err) {
    showErrorBanner('Gagal memuat data dashboard', err.message);
    toast(err.message, 'error');
  }
}

/* ========================================================================== */
/* Tab 1: Models                                                              */
/* ========================================================================== */

function renderSyncSummary(customSummary) {
  const el = document.getElementById('syncSummaryText');
  if (!el) return;
  const s = customSummary || STATE.lastSync;
  if (!s) {
    el.textContent = `total ${STATE.models.length} model cached`;
    return;
  }
  const timeStr = fmtTimeShort(s.syncedAt);
  el.textContent = `terakhir ${timeStr} · +${s.added ?? 0} baru · ${s.updated ?? 0} diperbarui · ${s.unavailable ?? 0} hilang · total ${s.total ?? STATE.models.length}`;
}

async function syncModels() {
  const btn = document.getElementById('btnSyncModels');
  const icon = document.getElementById('syncSpinIcon');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('spin');
  hideErrorBanner();
  try {
    const summary = await apiJson('/orch/api/models/sync', 'POST');
    STATE.lastSync = summary;
    await Promise.all([loadModels(), loadHealthAndSettings()]);
    renderSyncSummary(summary);
    renderShellStatus();
    renderModelsTable();
    renderOrchestratorTab();
    toast(`Sync selesai: +${summary.added} baru, ${summary.updated} diperbarui, ${summary.unavailable} hilang`);
  } catch (err) {
    const title = err.status === 502 ? '9router tidak terjangkau (502)' : 'Sync gagal';
    showErrorBanner(title, err.message);
    toast(err.message, 'error');
    loadHealthAndSettings().then(renderShellStatus).catch(() => {});
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('spin');
  }
}

function onFilterChange() {
  const qEl = document.getElementById('fSearch');
  const rEl = document.getElementById('fRole');
  const sEl = document.getElementById('fStatus');
  STATE.filters.q = qEl ? qEl.value.trim().toLowerCase() : '';
  STATE.filters.role = rEl ? rEl.value : 'all';
  STATE.filters.status = sEl ? sEl.value : 'all';
  applyModelFilters();
  renderModelsTable();
}

function toggleCapFilter(cap) {
  if (STATE.filters.caps.has(cap)) STATE.filters.caps.delete(cap);
  else STATE.filters.caps.add(cap);
  document.querySelectorAll('.cap-filter-pill').forEach(btn => {
    const c = btn.getAttribute('data-cap');
    btn.classList.toggle('on', STATE.filters.caps.has(c));
  });
  applyModelFilters();
  renderModelsTable();
}

function resetFilters() {
  STATE.filters.q = '';
  STATE.filters.role = 'all';
  STATE.filters.status = 'all';
  STATE.filters.caps.clear();
  const qEl = document.getElementById('fSearch');
  const rEl = document.getElementById('fRole');
  const sEl = document.getElementById('fStatus');
  if (qEl) qEl.value = '';
  if (rEl) rEl.value = 'all';
  if (sEl) sEl.value = 'all';
  document.querySelectorAll('.cap-filter-pill').forEach(b => b.classList.remove('on'));
  applyModelFilters();
  renderModelsTable();
}

function applyModelFilters() {
  const { q, role, status, caps } = STATE.filters;
  const capField = {
    tools: 'capTools',
    vision: 'capVision',
    pdf: 'capPdf',
    reasoning: 'capReasoning',
    search: 'capSearch',
  };
  STATE.filteredModels = STATE.models.filter(m => {
    if (role !== 'all' && !(m.roles || []).includes(role)) return false;
    if (status === 'active' && !m.isActive) return false;
    if (status === 'inactive' && m.isActive) return false;
    if (status === 'unavailable' && m.available !== false) return false;
    if (q) {
      const hay = `${m.id} ${m.family || ''} ${m.ownedBy || ''} ${m.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const c of caps) {
      const k = capField[c];
      if (k && m[k] !== true) return false;
    }
    return true;
  });
}

function renderCapBadge(letter, val, label) {
  if (val === true) {
    return `<span class="cap-badge cap-on" title="${escHtml(label)}: true">${escHtml(letter)}</span>`;
  }
  if (val === false) {
    return `<span class="cap-badge cap-off" title="${escHtml(label)}: false">·</span>`;
  }
  return `<span class="cap-badge cap-null" title="${escHtml(label)}: NULL (unknown)">?</span>`;
}

function renderBulkBar() {
  const bar = document.getElementById('bulkBar');
  const cnt = document.getElementById('bulkSelectedCount');
  const chkAll = document.getElementById('chkSelectAllModels');
  const n = STATE.selectedIds.size;
  if (bar) bar.classList.toggle('hidden', n === 0);
  if (cnt) cnt.textContent = `${n} dipilih`;
  if (chkAll) {
    const filteredIds = STATE.filteredModels.map(m => m.id);
    chkAll.checked = filteredIds.length > 0 && filteredIds.every(id => STATE.selectedIds.has(id));
    chkAll.indeterminate = filteredIds.some(id => STATE.selectedIds.has(id)) && !chkAll.checked;
  }
}

function renderModelsTable() {
  const tbody = document.getElementById('modelsTbody');
  const foot = document.getElementById('modelsFootCount');
  if (!tbody) return;

  renderBulkBar();
  if (foot) {
    foot.textContent = `${STATE.filteredModels.length} dari ${STATE.models.length} model ditampilkan`;
  }

  if (!STATE.filteredModels.length) {
    const emptyMsg = STATE.models.length === 0
      ? 'Belum ada model di katalog. Klik "⟳ Sync dari 9router" untuk memuat daftar model.'
      : 'Tidak ada model yang cocok dengan filter saat ini.';
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-xs" style="color:var(--muted)">${escHtml(emptyMsg)}</td></tr>`;
    return;
  }

  const rowsHtml = STATE.filteredModels.map(m => {
    const checked = STATE.selectedIds.has(m.id) ? 'checked' : '';
    const activeChecked = m.isActive ? 'checked' : '';
    const rowCls = m.available === false
      ? (m.isActive ? 'row-active-unavailable' : 'row-unavailable')
      : '';

    const badges = [];
    if (m.isDefaultWorker && STATE.settings.spread_load === false) {
      badges.push(`<span class="pill pill-positive text-[10px]">default worker</span>`);
    }
    if (m.available === false) {
      badges.push(`<span class="pill ${m.isActive ? 'pill-negative' : 'pill-warning'} text-[10px]">⚠ tidak tersedia</span>`);
    }
    if (m.family) {
      badges.push(`<span class="pill pill-neutral text-[10px] mono">${escHtml(m.family)}</span>`);
    }

    const rolePills = ALL_ROLES.map(r => {
      const on = (m.roles || []).includes(r);
      return `<button type="button" data-action="toggle-role" data-role="${escHtml(r)}" class="role-chip ${on ? 'on' : ''}" title="Toggle role ${escHtml(r)}">${escHtml(ROLE_ABBR[r] || r)}</button>`;
    }).join('');

    const tierVal = m.tier || '';
    const capsHtml = [
      renderCapBadge('T', m.capTools, 'Tools'),
      renderCapBadge('V', m.capVision, 'Vision'),
      renderCapBadge('R', m.capReasoning, 'Reasoning'),
      renderCapBadge('S', m.capSearch, 'Search'),
      renderCapBadge('P', m.capPdf, 'PDF'),
    ].join('');

    const notesSub = m.notes
      ? `<div class="text-[11px] truncate max-w-md mt-0.5" style="color:var(--muted)" title="${escHtml(m.notes)}">${escHtml(m.notes)}</div>`
      : '';

    return `<tr class="${rowCls}" data-model-id="${escHtml(m.id)}">
      <td class="text-center">
        <input type="checkbox" data-action="select-row" ${checked} aria-label="Pilih ${escHtml(m.id)}">
      </td>
      <td>
        <label class="switch" title="Aktifkan/nonaktifkan model">
          <input type="checkbox" data-action="toggle-active" ${activeChecked}>
          <span class="switch-slider"></span>
        </label>
      </td>
      <td>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button type="button" data-action="open-detail" class="mono text-xs font-medium text-left hover:underline break-all" style="color:var(--text)">${escHtml(m.id)}</button>
          ${badges.join('')}
        </div>
        ${notesSub}
      </td>
      <td>
        <div class="flex flex-wrap gap-1">${rolePills}</div>
      </td>
      <td>
        <select data-action="change-tier" class="h-7 px-1.5 rounded border hair bg-white text-xs w-full" aria-label="Tier ${escHtml(m.id)}">
          <option value="" ${tierVal === '' ? 'selected' : ''}>—</option>
          <option value="fast" ${tierVal === 'fast' ? 'selected' : ''}>fast</option>
          <option value="balanced" ${tierVal === 'balanced' ? 'selected' : ''}>balanced</option>
          <option value="strong" ${tierVal === 'strong' ? 'selected' : ''}>strong</option>
        </select>
      </td>
      <td class="num text-right mono text-xs">${escHtml(fmtCtx(m))}</td>
      <td>
        <div class="flex items-center gap-1">${capsHtml}</div>
      </td>
      <td class="text-right">
        <button type="button" data-action="open-detail" class="h-7 px-2 rounded bg-white border hair text-xs hover:bg-gray-50">Detail</button>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rowsHtml;
}

function getModelById(id) {
  return STATE.models.find(m => m.id === id) || null;
}

function checkClientSideActivationGuard(model, nextActive, nextRoles) {
  const hasToolRole = nextRoles.some(r => TOOL_ROLES.has(r));
  if (nextActive && hasToolRole && model.capTools === false) {
    const blockedRoles = nextRoles.filter(r => TOOL_ROLES.has(r)).join('/');
    const reason = `Ditolak: Model "${model.id}" memiliki cap_tools=false sehingga tidak dapat diaktifkan untuk role ${blockedRoles}.`;
    showErrorBanner('Validasi kapabilitas gagal (cap_tools=false)', reason);
    toast(reason, 'error');
    return false;
  }
  return true;
}

async function patchSingleModel(modelId, patch) {
  hideErrorBanner();
  const url = `/orch/api/models?id=${encodeURIComponent(modelId)}`;
  const res = await apiJson(url, 'PATCH', patch);
  if (res.model) {
    if (res.model.isDefaultWorker) {
      for (const m of STATE.models) {
        if (m.id !== modelId && m.isDefaultWorker) m.isDefaultWorker = false;
      }
    }
    const idx = STATE.models.findIndex(m => m.id === modelId);
    if (idx >= 0) STATE.models[idx] = res.model;
  }
  if (Array.isArray(res.warnings) && res.warnings.length > 0) {
    toast(`Peringatan (${modelId}): ${res.warnings.join('; ')}`, 'warn');
  }
  await loadHealthAndSettings({ preserveDirty: true });
  applyModelFilters();
  renderShellStatus();
  renderModelsTable();
  renderOrchestratorTab();
  return res;
}

function toggleSelectAllFiltered(checked) {
  for (const m of STATE.filteredModels) {
    if (checked) STATE.selectedIds.add(m.id);
    else STATE.selectedIds.delete(m.id);
  }
  renderModelsTable();
}

function clearModelSelection() {
  STATE.selectedIds.clear();
  renderModelsTable();
}

async function runBulk(op) {
  const ids = [...STATE.selectedIds];
  if (!ids.length) return;
  hideErrorBanner();
  try {
    const res = await apiJson('/orch/api/models/bulk', 'POST', { ids, ...op });
    await Promise.all([loadModels(), loadHealthAndSettings()]);
    renderShellStatus();
    renderModelsTable();
    renderOrchestratorTab();

    const skipped = Array.isArray(res.skipped) ? res.skipped : [];
    const notice = document.getElementById('bulkResultNotice');
    const noticeText = document.getElementById('bulkResultText');
    if (skipped.length > 0 && notice && noticeText) {
      const reasons = skipped.map(s => `${s.id}: ${s.reason}`).join(' · ');
      noticeText.textContent = `Diperbarui: ${res.updated} model · Dilewati (${skipped.length}): ${reasons}`;
      notice.classList.remove('hidden');
      toast(`Bulk selesai: ${res.updated} diperbarui, ${skipped.length} dilewati`, 'warn');
    } else {
      if (notice) notice.classList.add('hidden');
      toast(`Bulk selesai: ${res.updated} model diperbarui`);
    }
  } catch (err) {
    showErrorBanner('Bulk update gagal', err.message);
    toast(err.message, 'error');
  }
}

/* Detail Modal */

function openModelDetail(modelId) {
  const m = getModelById(modelId);
  if (!m) return;
  STATE.detailModelId = m.id;

  document.getElementById('detModelId').textContent = m.id;
  document.getElementById('detFamily').value = m.family || '';
  document.getElementById('detPriority').value = Number.isFinite(m.priority) ? m.priority : 100;
  document.getElementById('detDefaultWorker').checked = Boolean(m.isDefaultWorker);
  document.getElementById('detNotes').value = m.notes || '';
  document.getElementById('detSyncTimestamps').textContent =
    `owned_by: ${m.ownedBy || '—'} · synced: ${fmtDateTime(m.lastSyncedAt)}`;
  document.getElementById('detRawJson').textContent = JSON.stringify(m.rawJson || {}, null, 2);

  const badgesEl = document.getElementById('detBadgesRow');
  if (badgesEl) {
    badgesEl.innerHTML = [
      `<span class="pill ${m.isActive ? 'pill-positive' : 'pill-neutral'}">${m.isActive ? 'Active' : 'Inactive'}</span>`,
      `<span class="pill ${m.available ? 'pill-positive' : 'pill-warning'}">${m.available ? 'Available' : 'Unavailable'}</span>`,
      `<span class="pill pill-neutral mono">ctx ${escHtml(fmtCtx(m))}</span>`,
      `<span class="pill pill-neutral mono">maxOut ${escHtml(m.maxOutput ?? m.maxCompletionTokens ?? '?')}</span>`,
      m.thinkingFormat ? `<span class="pill pill-neutral mono">thinking: ${escHtml(m.thinkingFormat)}</span>` : '',
    ].join('');
  }

  const dlg = document.getElementById('dlgModelDetail');
  if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
}

function closeModelDetail() {
  const dlg = document.getElementById('dlgModelDetail');
  if (dlg && dlg.open) dlg.close();
  STATE.detailModelId = null;
}

async function saveModelDetail() {
  const id = STATE.detailModelId;
  if (!id) return;
  const familyRaw = document.getElementById('detFamily').value.trim();
  const prioRaw = Number(document.getElementById('detPriority').value);
  const isDefaultWorker = document.getElementById('detDefaultWorker').checked;
  const notesRaw = document.getElementById('detNotes').value.trim();

  try {
    await patchSingleModel(id, {
      family: familyRaw || null,
      priority: Number.isFinite(prioRaw) ? Math.trunc(prioRaw) : 100,
      isDefaultWorker,
      notes: notesRaw || null,
    });
    closeModelDetail();
    toast(`Detail ${id} disimpan`);
  } catch (err) {
    showErrorBanner(`Gagal menyimpan ${id}`, err.message);
    toast(err.message, 'error');
  }
}

/* ========================================================================== */
/* Tab 2: Orchestrator                                                        */
/* ========================================================================== */

function markSettingsDirty() {
  STATE.settingsDirty = true;
  const el = document.getElementById('settingsDirtyState');
  if (el) {
    el.textContent = '● Belum disimpan';
    el.style.color = 'var(--warning)';
  }
}

function setRewriteMode(mode) {
  STATE.settings.rewrite_mode = mode === 'header' ? 'header' : 'body';
  document.querySelectorAll('input[name="rewrite_mode"]').forEach(r => {
    r.checked = r.value === STATE.settings.rewrite_mode;
  });
  const bodyCard = document.getElementById('rwCardBody');
  const hdrCard = document.getElementById('rwCardHeader');
  if (bodyCard) bodyCard.classList.toggle('active', STATE.settings.rewrite_mode === 'body');
  if (hdrCard) hdrCard.classList.toggle('active', STATE.settings.rewrite_mode === 'header');
  markSettingsDirty();
}

function renderOrchestratorWarnings() {
  const box = document.getElementById('orchWarningsBox');
  if (!box) return;
  const items = [];
  if (STATE.mismatches24h > 0) {
    items.push({
      severe: true,
      code: 'mismatch_24h',
      message: `Terdeteksi ${STATE.mismatches24h} model mismatch dalam 24 jam terakhir (routed_model !== applied_model). Periksa tab Monitor!`,
    });
  }
  for (const w of (STATE.warnings || [])) {
    items.push({ severe: false, code: w.code || 'warn', message: w.message || String(w) });
  }
  if (!items.length) {
    box.innerHTML = `<div class="px-3.5 py-2 rounded-lg border text-xs flex items-center gap-2" style="background:var(--pill-positive-bg);color:var(--pill-positive-ink);border-color:#a7f3d0">
      <span>✓</span><span>Semua pemeriksaan konfigurasi orchestrator sehat.</span>
    </div>`;
    return;
  }
  box.innerHTML = items.map(it => {
    const style = it.severe
      ? 'background:var(--pill-negative-bg);color:var(--pill-negative-ink);border-color:#fecaca'
      : 'background:var(--pill-warning-bg);color:var(--pill-warning-ink);border-color:#fde68a';
    return `<div class="px-3.5 py-2 rounded-lg border text-xs flex items-start justify-between gap-2" style="${style}">
      <div><span class="font-semibold mono">[${escHtml(it.code)}]</span> ${escHtml(it.message)}</div>
    </div>`;
  }).join('');
}

function onSpreadLoadToggle() {
  const el = document.getElementById('setSpreadLoad');
  STATE.settings.spread_load = el ? Boolean(el.checked) : true;
  const wrap = document.getElementById('defaultWorkerWrap');
  if (wrap) wrap.classList.toggle('hidden', STATE.settings.spread_load !== false);
  markSettingsDirty();
  renderModelsTable();
}

function renderEqualRolePool(role, ulId, badgeId) {
  const ul = document.getElementById(ulId);
  const cnt = document.getElementById(badgeId);
  const peers = STATE.models.filter(m => m.isActive && m.available && (m.roles || []).includes(role) && m.capTools !== false);
  if (cnt) cnt.textContent = `${peers.length} available`;
  if (!ul) return;

  if (!peers.length) {
    const minHint = role === 'worker' ? 'minimal 2 model worker' : `minimal 1 model ${role}`;
    ul.innerHTML = `<li class="text-xs py-3 px-3 rounded border border-dashed hair text-center" style="color:var(--muted)">Belum ada ${escHtml(role)} aktif — aktifkan ${escHtml(minHint)} di tab Models.</li>`;
    return;
  }

  ul.innerHTML = peers.map(m => {
    const badges = [
      `<span class="pill pill-positive text-[10px]">AVAILABLE</span>`,
      m.family ? `<span class="pill pill-neutral text-[10px] mono">${escHtml(m.family)}</span>` : '',
      m.tier ? `<span class="pill pill-neutral text-[10px]">${escHtml(m.tier)}</span>` : '',
      `<span class="pill pill-neutral text-[10px] mono">ctx ${escHtml(fmtCtx(m))}</span>`,
    ].filter(Boolean).join('');
    const noteLine = m.notes
      ? `<div class="text-[11px] mt-1 truncate" style="color:var(--muted)" title="${escHtml(m.notes)}">${escHtml(m.notes)}</div>`
      : '';
    return `<li class="chain-item" style="cursor:default">
      <div class="min-w-0 flex-1">
        <div class="mono text-xs font-medium break-all">${escHtml(m.id)}</div>
        <div class="flex flex-wrap gap-1 mt-1">${badges}</div>
        ${noteLine}
      </div>
    </li>`;
  }).join('');
}

function renderDefaultWorkerSelector() {
  const wrap = document.getElementById('defaultWorkerWrap');
  const spreadEl = document.getElementById('setSpreadLoad');
  const spread = STATE.settings.spread_load !== false;
  if (spreadEl && !STATE.settingsDirty) spreadEl.checked = spread;
  if (wrap) wrap.classList.toggle('hidden', spread);

  const sel = document.getElementById('quickDefaultWorker');
  if (!sel) return;
  const workers = STATE.models.filter(m => m.isActive && (m.roles || []).includes('worker'));
  const currentDefault = STATE.models.find(m => m.isDefaultWorker);
  const opts = [`<option value="">— tanpa default worker —</option>`];
  for (const w of workers) {
    const selected = currentDefault && currentDefault.id === w.id ? 'selected' : '';
    const suffix = !w.available ? ' [tidak tersedia]' : '';
    opts.push(`<option value="${escHtml(w.id)}" ${selected}>${escHtml(w.id + suffix)}</option>`);
  }
  if (currentDefault && !workers.some(w => w.id === currentDefault.id)) {
    opts.push(`<option value="${escHtml(currentDefault.id)}" selected>${escHtml(currentDefault.id)} (inactive/non-worker)</option>`);
  }
  sel.innerHTML = opts.join('');
}

function renderRosterPreview() {
  const pre = document.getElementById('rosterPreviewPre');
  const vBadge = document.getElementById('rosterVersionBadge');
  const tBadge = document.getElementById('rosterTokensBadge');
  const text = (STATE.roster && STATE.roster.text) || '';
  const hash = (STATE.roster && STATE.roster.hash) || '000000';
  const tok = (STATE.roster && STATE.roster.tokensEst) ?? Math.ceil(text.length / 4);
  if (pre) pre.textContent = text || '<orch-roster empty>';
  if (vBadge) vBadge.textContent = `v=${hash}`;
  if (tBadge) tBadge.textContent = `~${tok} tokens`;
}

function renderOrchestratorTab() {
  renderOrchestratorWarnings();

  const s = STATE.settings;
  if (!STATE.settingsDirty) {
    const enEl = document.getElementById('setEnabled');
    const irEl = document.getElementById('setInjectRoster');
    const slEl = document.getElementById('setSpreadLoad');
    const tcEl = document.getElementById('setTriggerCmd');
    const ocEl = document.getElementById('setOffCmd');
    const maEl = document.getElementById('setMaxAttempts');
    const mpEl = document.getElementById('setMaxParallel');
    if (enEl) enEl.checked = Boolean(s.enabled);
    if (irEl) irEl.checked = Boolean(s.inject_roster);
    if (slEl) slEl.checked = s.spread_load !== false;
    if (tcEl) tcEl.value = s.trigger_command || '/orch-plan';
    if (ocEl) ocEl.value = s.off_command || '/orch-off';
    if (maEl) maEl.value = s.max_attempts ?? 3;
    if (mpEl) mpEl.value = s.max_parallel ?? 3;

    const rw = s.rewrite_mode === 'header' ? 'header' : 'body';
    document.querySelectorAll('input[name="rewrite_mode"]').forEach(r => { r.checked = r.value === rw; });
    const bodyCard = document.getElementById('rwCardBody');
    const hdrCard = document.getElementById('rwCardHeader');
    if (bodyCard) bodyCard.classList.toggle('active', rw === 'body');
    if (hdrCard) hdrCard.classList.toggle('active', rw === 'header');

    const dirtyEl = document.getElementById('settingsDirtyState');
    if (dirtyEl) {
      dirtyEl.textContent = 'Tersimpan';
      dirtyEl.style.color = 'var(--muted)';
    }
  }

  const mmBadge = document.getElementById('orchMismatch24hBadge');
  if (mmBadge) {
    const mm = Number(STATE.mismatches24h || 0);
    mmBadge.className = mm > 0 ? 'pill pill-negative text-xs num font-semibold' : 'pill pill-neutral text-xs num';
    mmBadge.textContent = `24h mismatch: ${mm}`;
  }

  renderDefaultWorkerSelector();
  renderEqualRolePool('orchestrator', 'pool-orchestrators', 'cntActiveOrchestrators');
  renderEqualRolePool('worker', 'pool-workers', 'cntActiveWorkers');
  renderEqualRolePool('fixer', 'pool-fixers', 'cntActiveFixers');
  renderRosterPreview();
}

async function saveSettings() {
  hideErrorBanner();
  const spreadEl = document.getElementById('setSpreadLoad');
  const payload = {
    enabled: document.getElementById('setEnabled').checked,
    inject_roster: document.getElementById('setInjectRoster').checked,
    spread_load: spreadEl ? spreadEl.checked : true,
    trigger_command: document.getElementById('setTriggerCmd').value.trim(),
    off_command: document.getElementById('setOffCmd').value.trim(),
    max_attempts: Number(document.getElementById('setMaxAttempts').value),
    max_parallel: Number(document.getElementById('setMaxParallel').value),
    rewrite_mode: STATE.settings.rewrite_mode,
    orchestrator_model: '',
    orchestrator_chain: [],
    worker_fallback_chain: [],
    fixer_chain: [],
  };

  const btn = document.getElementById('btnSaveSettings');
  if (btn) btn.disabled = true;
  try {
    const res = await apiJson('/orch/api/settings', 'PUT', payload);
    STATE.settings = res.settings;
    STATE.warnings = res.warnings || [];
    if (res.roster) STATE.roster = res.roster;
    STATE.settingsDirty = false;
    renderShellStatus();
    renderOrchestratorTab();
    toast('Settings berhasil disimpan');
  } catch (err) {
    showErrorBanner('Gagal menyimpan settings', err.message);
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function changeDefaultWorker(modelId) {
  if (!modelId) {
    const cur = STATE.models.find(m => m.isDefaultWorker);
    if (!cur) return;
    try {
      await patchSingleModel(cur.id, { isDefaultWorker: false });
      toast('Default worker dihapus');
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  try {
    await patchSingleModel(modelId, { isDefaultWorker: true });
    toast(`Default worker diset ke ${modelId}`);
  } catch (err) {
    showErrorBanner('Gagal mengubah default worker', err.message);
    toast(err.message, 'error');
  }
}

async function refreshRosterPreview() {
  try {
    const res = await fetch('/orch/roster');
    const text = await res.text();
    const m = /v="([^"]+)"/.exec(text);
    STATE.roster = {
      text,
      hash: m ? m[1] : (STATE.roster.hash || '000000'),
      tokensEst: Math.ceil(text.length / 4),
    };
    renderRosterPreview();
    renderShellStatus();
    toast('Roster preview diperbarui');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function copyRosterText() {
  const text = (STATE.roster && STATE.roster.text) || '';
  try {
    await navigator.clipboard.writeText(text);
    toast('Teks <orch-roster> disalin ke clipboard');
  } catch (_) {
    toast('Gagal menyalin ke clipboard', 'error');
  }
}

/* ========================================================================== */
/* Tab 3: Monitor                                                             */
/* ========================================================================== */

function syncMonitorTimer() {
  if (STATE.monitorTimer) {
    clearInterval(STATE.monitorTimer);
    STATE.monitorTimer = null;
  }
  if (STATE.tab === 'monitor' && STATE.autoPollMonitor && !document.hidden) {
    STATE.monitorTimer = setInterval(() => {
      if (STATE.tab === 'monitor' && !document.hidden) {
        loadMonitor(false);
      }
    }, 3000);
  }
}

function toggleMonitorAutoPoll(checked) {
  STATE.autoPollMonitor = Boolean(checked);
  syncMonitorTimer();
}

async function loadMonitor(manual = false) {
  try {
    const res = await apiJson('/orch/api/plans?limit=50');
    STATE.plans = Array.isArray(res.plans) ? res.plans : [];
    const updEl = document.getElementById('monitorLastUpd');
    if (updEl) updEl.textContent = `updated ${fmtTimeShort(new Date().toISOString())}`;

    if (!STATE.selectedPlanId && STATE.plans.length > 0) {
      STATE.selectedPlanId = STATE.plans[0].plan_id;
    }
    renderPlansTable();

    if (STATE.selectedPlanId) {
      await loadPlanCalls(STATE.selectedPlanId);
    }
    if (manual) toast('Monitor diperbarui');
  } catch (err) {
    if (manual) toast(err.message, 'error');
  }
}

function renderPlansTable() {
  const tbody = document.getElementById('plansTbody');
  const countLbl = document.getElementById('plansCountLabel');
  if (!tbody) return;
  if (countLbl) countLbl.textContent = `${STATE.plans.length} plans`;

  if (!STATE.plans.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-xs" style="color:var(--muted)">Belum ada panggilan orchestration tercatat</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.plans.map(p => {
    const pid = String(p.plan_id || '__orchestrator__');
    const displayPid = pid === '__orchestrator__' ? '(orchestrator session)' : pid;
    const isSel = STATE.selectedPlanId === pid;
    const fb = Number(p.fallback_count || 0);
    const er = Number(p.error_count || 0);
    const mm = Number(p.mismatch_count || 0);

    return `<tr class="plan-row ${isSel ? 'selected' : ''}" data-plan-id="${escHtml(pid)}">
      <td class="mono text-xs font-medium">${escHtml(displayPid)}</td>
      <td class="num text-xs" style="color:var(--muted)">${escHtml(fmtDateTime(p.last_at))}</td>
      <td class="num text-right">${escHtml(fmtInt(p.task_count))}</td>
      <td class="num text-right font-medium">${escHtml(fmtInt(p.call_count))}</td>
      <td class="num text-right">${escHtml(fmtInt(p.total_tokens))}</td>
      <td class="num text-right">${fb > 0 ? `<span class="pill pill-warning num">${fb}</span>` : '0'}</td>
      <td class="num text-right">${er > 0 ? `<span class="pill pill-negative num">${er}</span>` : '0'}</td>
      <td class="num text-right">${mm > 0 ? `<span class="pill pill-negative num font-semibold">${mm}</span>` : '0'}</td>
    </tr>`;
  }).join('');
}

async function selectPlanRow(planId) {
  STATE.selectedPlanId = planId;
  renderPlansTable();
  await loadPlanCalls(planId);
}

async function loadPlanCalls(planId) {
  const badge = document.getElementById('selectedPlanBadge');
  if (badge) {
    badge.textContent = planId === '__orchestrator__' ? '(orchestrator session)' : planId;
  }
  const res = await apiJson(`/orch/api/plans/${encodeURIComponent(planId)}/calls`);
  STATE.planCalls = Array.isArray(res.calls) ? res.calls : [];
  renderCallsTable();
}

function renderCallsTable() {
  const tbody = document.getElementById('callsTbody');
  if (!tbody) return;
  if (!STATE.planCalls.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="py-6 text-center text-xs" style="color:var(--muted)">Tidak ada call untuk plan ini</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.planCalls.map(c => {
    const isMismatch = Boolean(c.mismatch) || Boolean(c.routed_model && c.applied_model && c.routed_model !== c.applied_model);
    const isErr = Boolean(c.error) || (c.status !== null && c.status !== undefined && Number(c.status) >= 400);
    const isFallback = Boolean(c.fallback_reason);

    let rowCls = '';
    if (isMismatch) rowCls = 'call-mismatch';
    else if (isErr) rowCls = 'call-error';
    else if (isFallback) rowCls = 'call-fallback';

    const taskAtt = c.task_key
      ? `${c.task_key}${c.attempt != null ? ` #${c.attempt}` : ''}`
      : '—';

    const reqM = c.requested_model || '—';
    const rtdM = c.routed_model || '—';
    const appM = c.applied_model || '—';

    const statusBadge = c.status != null
      ? `<span class="pill ${Number(c.status) >= 400 ? 'pill-negative' : 'pill-positive'} num">${escHtml(c.status)}</span>`
      : '—';

    const ttfbStr = c.ttfb_ms != null ? `${c.ttfb_ms}ms` : '—';
    const latStr = c.latency_ms != null ? `${c.latency_ms}ms` : '—';
    const inTok = c.input_tokens != null ? fmtInt(c.input_tokens) : '—';
    const outTok = c.output_tokens != null ? fmtInt(c.output_tokens) : '—';

    return `<tr class="${rowCls}">
      <td class="num text-xs" style="color:var(--muted)">${escHtml(fmtTimeShort(c.ts))}</td>
      <td><span class="pill pill-neutral mono text-[10px]">${escHtml(c.kind || '—')}</span></td>
      <td class="mono text-xs">${escHtml(taskAtt)}</td>
      <td class="mono text-xs">${escHtml(c.role || '—')}</td>
      <td class="mono text-xs">
        <span style="color:var(--muted)">${escHtml(reqM)}</span>
        <span> → </span>
        <span class="font-semibold">${escHtml(rtdM)}</span>
        <span> → </span>
        <span class="${isMismatch ? 'font-bold' : ''}" style="${isMismatch ? 'color:var(--negative)' : ''}">${escHtml(appM)}</span>
        ${isMismatch ? ` <span class="pill pill-negative text-[10px]">MISMATCH</span>` : ''}
      </td>
      <td class="mono text-xs">${escHtml(c.rewritten_by || '—')}</td>
      <td>${isFallback ? `<span class="pill pill-warning mono text-[10px]">${escHtml(c.fallback_reason)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="num text-right">${statusBadge}</td>
      <td class="num text-right text-xs">${escHtml(ttfbStr)} / ${escHtml(latStr)}</td>
      <td class="num text-right text-xs">${escHtml(inTok)} / ${escHtml(outTok)}</td>
      <td class="mono text-xs break-all" style="color:var(--negative)">${escHtml(c.error || '')}</td>
    </tr>`;
  }).join('');
}

/* ========================================================================== */
/* Tab 4: Route Tester                                                        */
/* ========================================================================== */

function loadTesterSample(kind) {
  const ta = document.getElementById('dryRunInput');
  if (!ta) return;
  const firstWorker = STATE.models.find(m => m.isActive && (m.roles || []).includes('worker'));
  const workerId = firstWorker ? firstWorker.id : 'ag/gemini-4-argon-high';
  const trig = (STATE.settings && STATE.settings.trigger_command) || '/orch-plan';

  const samples = {
    orch: JSON.stringify({
      model: 'gpt-4o',
      stream: true,
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: `<ide-context>\nActive module: demo\n</ide-context>\n\n${trig} Refactor authentication service into clean modules` }],
        },
      ],
    }, null, 2),
    worker: `[[ORCH v=1 plan=2026-11-07-demo task=T1 role=worker agent=${workerId} attempt=1]]\nImplement unit tests for the auth service.`,
    unknown: `[[ORCH v=1 plan=2026-11-07-demo task=T2 role=worker agent=unknown/non-existent-model attempt=1]]\nUpdate API client error handling.`,
    normal: JSON.stringify({
      model: 'gpt-4o-mini',
      stream: true,
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'Explain how Array.prototype.reduce works in JavaScript.' }] },
      ],
    }, null, 2),
  };

  ta.value = samples[kind] || '';
}

function buildDryRunPayload(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) return { __rawText: '' };
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_) {
      // fall through to raw marker / prompt envelope
    }
  }
  return {
    __rawText: rawInput,
    model: 'default-client-model',
    tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
    input: [
      { role: 'user', content: [{ type: 'input_text', text: rawInput }] },
    ],
  };
}

async function runDryRun() {
  const ta = document.getElementById('dryRunInput');
  const raw = ta ? ta.value : '';
  if (!raw.trim()) {
    toast('Masukkan teks marker, prompt, atau JSON terlebih dahulu', 'warn');
    return;
  }
  hideErrorBanner();
  try {
    const payload = buildDryRunPayload(raw);
    const out = await apiJson('/orch/api/route/dry-run', 'POST', payload);
    renderDryRunResult(out);
  } catch (err) {
    showErrorBanner('Dry-run gagal', err.message);
    toast(err.message, 'error');
  }
}

function renderDryRunResult(out) {
  document.getElementById('dryRunEmpty').classList.add('hidden');
  const box = document.getElementById('dryRunResultBox');
  box.classList.remove('hidden');

  const kind = String(out.kind || 'PASSTHROUGH').toUpperCase();
  const kindBadge = document.getElementById('dryRunKindBadge');
  if (kindBadge) {
    const cls = kind === 'ORCH'
      ? 'pill pill-positive mono text-xs font-semibold'
      : (kind === 'SUBAGENT' ? 'pill pill-warning mono text-xs font-semibold' : 'pill pill-neutral mono text-xs font-semibold');
    kindBadge.className = cls;
    kindBadge.textContent = kind;
  }

  const reqModel = out.requestedModel ?? out.originalModel ?? '—';
  const routedModel = out.routedModel ?? out.finalModel ?? '(unchanged / passthrough)';
  document.getElementById('drModelFlow').textContent = `${reqModel} → ${routedModel}`;

  const fbReason = out.fallbackReason || (out.failOpen ? 'fail-open' : 'none');
  const fbEl = document.getElementById('drFallbackInfo');
  fbEl.textContent = `${fbReason}${out.failOpen ? ' (failOpen=true)' : ''}`;
  fbEl.style.color = out.fallbackReason || out.failOpen ? 'var(--warning)' : 'var(--positive)';

  const markerWrap = document.getElementById('drMarkerWrap');
  const markerText = document.getElementById('drMarkerText');
  const markerData = out.marker || (out.planId || out.taskKey || out.role
    ? { planId: out.planId, taskKey: out.taskKey, role: out.role, attempt: out.attempt, agent: out.agent }
    : null);
  if (markerData && markerWrap && markerText) {
    markerWrap.classList.remove('hidden');
    markerText.textContent = JSON.stringify(markerData);
  } else if (markerWrap) {
    markerWrap.classList.add('hidden');
  }

  const warnings = Array.isArray(out.warnings) ? out.warnings : [];
  const warnEl = document.getElementById('drWarningsList');
  warnEl.innerHTML = warnings.length
    ? warnings.map(w => `<div class="px-2.5 py-1.5 rounded border text-xs" style="background:var(--pill-warning-bg);color:var(--pill-warning-ink);border-color:#fde68a">${escHtml(typeof w === 'string' ? w : JSON.stringify(w))}</div>`).join('')
    : `<div style="color:var(--muted)">Tidak ada warning</div>`;

  const changes = Array.isArray(out.adapterChanges)
    ? out.adapterChanges
    : (Array.isArray(out.changes) ? out.changes : []);
  const adEl = document.getElementById('drAdapterList');
  adEl.innerHTML = changes.length
    ? changes.map(c => `<div class="mono text-[11px] px-2 py-1 rounded bg-white border hair">${escHtml(typeof c === 'string' ? c : JSON.stringify(c))}</div>`).join('')
    : `<div style="color:var(--muted)">Tidak ada perubahan parameter body</div>`;

  const hdrs = out.headers || out.outHeaders || {};
  document.getElementById('drHeadersPre').textContent = Object.keys(hdrs).length
    ? JSON.stringify(hdrs, null, 2)
    : '(no x-orch-* headers)';

  const rosterText = out.injectedRoster || out.rosterText || (out.roster && out.roster.text) || '';
  const rWrap = document.getElementById('drRosterWrap');
  if (rosterText && rWrap) {
    rWrap.classList.remove('hidden');
    document.getElementById('drRosterPre').textContent = rosterText;
  } else if (rWrap) {
    rWrap.classList.add('hidden');
  }

  document.getElementById('drRawJsonPre').textContent = JSON.stringify(out, null, 2);
}

/* ========================================================================== */
/* Event Delegation & Initialization                                          */
/* ========================================================================== */

function bindDelegatedEvents() {
  const modelsTbody = document.getElementById('modelsTbody');
  if (modelsTbody) {
    modelsTbody.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-model-id]');
      if (!tr) return;
      const modelId = tr.getAttribute('data-model-id');
      const action = btn.getAttribute('data-action');

      if (action === 'open-detail') {
        openModelDetail(modelId);
      } else if (action === 'toggle-role') {
        const role = btn.getAttribute('data-role');
        const m = getModelById(modelId);
        if (!m || !role) return;
        const has = (m.roles || []).includes(role);
        const nextRoles = has ? m.roles.filter(r => r !== role) : [...(m.roles || []), role];
        if (!checkClientSideActivationGuard(m, m.isActive, nextRoles)) return;
        try {
          await patchSingleModel(modelId, { roles: nextRoles });
        } catch (err) {
          showErrorBanner(`Gagal mengubah role ${modelId}`, err.message);
          toast(err.message, 'error');
        }
      }
    });

    modelsTbody.addEventListener('change', async e => {
      const el = e.target;
      const action = el.getAttribute('data-action');
      if (!action) return;
      const tr = el.closest('tr[data-model-id]');
      if (!tr) return;
      const modelId = tr.getAttribute('data-model-id');
      const m = getModelById(modelId);
      if (!m) return;

      if (action === 'select-row') {
        if (el.checked) STATE.selectedIds.add(modelId);
        else STATE.selectedIds.delete(modelId);
        renderBulkBar();
      } else if (action === 'toggle-active') {
        const nextActive = Boolean(el.checked);
        if (!checkClientSideActivationGuard(m, nextActive, m.roles || [])) {
          el.checked = m.isActive;
          return;
        }
        try {
          await patchSingleModel(modelId, { isActive: nextActive });
        } catch (err) {
          el.checked = m.isActive;
          showErrorBanner(`Gagal mengubah status aktif ${modelId}`, err.message);
          toast(err.message, 'error');
        }
      } else if (action === 'change-tier') {
        const nextTier = el.value || null;
        try {
          await patchSingleModel(modelId, { tier: nextTier });
        } catch (err) {
          el.value = m.tier || '';
          showErrorBanner(`Gagal mengubah tier ${modelId}`, err.message);
          toast(err.message, 'error');
        }
      }
    });
  }

  // Plans row click
  const plansTbody = document.getElementById('plansTbody');
  if (plansTbody) {
    plansTbody.addEventListener('click', e => {
      const tr = e.target.closest('tr.plan-row[data-plan-id]');
      if (!tr) return;
      selectPlanRow(tr.getAttribute('data-plan-id'));
    });
  }

  // '/' shortcut to focus model search when on Models tab
  document.addEventListener('keydown', e => {
    if (e.key === '/' && STATE.tab === 'models') {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        const s = document.getElementById('fSearch');
        if (s) {
          e.preventDefault();
          s.focus();
        }
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    syncMonitorTimer();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindDelegatedEvents();
  refreshAll();
});
