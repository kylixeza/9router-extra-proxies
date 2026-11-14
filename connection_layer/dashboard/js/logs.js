'use strict';

let LOGS = [];
let page = 1;
let total = 0;
let debT = null;
let showBookmarked = false;
let curBmId = null;
let curBmState = false;
let lastGoodLogsAt = null;

function debouncedLogs() {
  clearTimeout(debT);
  debT = setTimeout(() => reloadLogs(), 300);
}

async function reloadLogs() {
  const errBox = document.getElementById('logsError');
  try {
    const ps = document.getElementById('ps')?.value || '50';
    const q = document.getElementById('q')?.value || '';
    const proj = document.getElementById('proj')?.value || '';
    const from = document.getElementById('dfrom')?.value || '';
    const to = document.getElementById('dto')?.value || '';
    const r = await fetch(`/api/conn/logs?page=${page}&pageSize=${ps}&q=${encodeURIComponent(q)}&project=${encodeURIComponent(proj)}&from=${from}&to=${to}${showBookmarked ? '&bookmarked=1' : ''}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    LOGS = j.logs || [];
    total = j.total || 0;
    page = j.page || page;
    lastGoodLogsAt = new Date();
    if (errBox) { errBox.className = 'hidden'; errBox.innerHTML = ''; }
    const lsrc = document.getElementById('lsrc');
    if (lsrc) lsrc.textContent = `${j.source} · ${num(total)} total`;
    renderLogs();
    renderRecentLogs();
  } catch (e) {
    if (errBox) {
      const last = lastGoodLogsAt ? ` Last updated ${fmtDate(lastGoodLogsAt.toISOString()).slice(11)}.` : '';
      errBox.className = 'error-inline';
      errBox.innerHTML = `<span>Could not load logs (${esc(e.message)}).${esc(last)}</span><button type="button" onclick="reloadLogs()" class="btn-pill btn-sm">Retry</button>`;
    }
  }
}

function fmtTokCell(l) {
  if (l.prompt_tokens || l.completion_tokens) {
    return `<span style="font-weight:500" class="num">${fmtTok(l.prompt_tokens)}</span><span style="color:var(--muted)">/${fmtTok(l.completion_tokens)}</span>`;
  }
  if (l.est_prompt_tokens) {
    return `<span class="cell-muted num" title="Estimated">~${fmtTok(l.est_prompt_tokens)}</span>`;
  }
  return '<span style="color:var(--muted)">-</span>';
}

function renderRecentLogs() {
  const tb = document.getElementById('recentLogs');
  const mob = document.getElementById('recentLogsMobile');
  const meta = document.getElementById('recentMeta');
  const rows = LOGS.slice(0, 6);
  if (meta) meta.textContent = total ? `latest ${rows.length} of ${num(total)}` : '0 requests';

  if (tb) {
    tb.innerHTML = rows.length ? rows.map(l => {
      const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
      return `<tr class="row-link" onclick="inspect('${esc(l.id)}')">
        <td class="cell-id">${esc(l.id || '').slice(0, 8)}</td>
        <td class="num" style="white-space:nowrap;color:var(--muted)">${esc(fmtDate(l.created_at).slice(11))}</td>
        <td class="cell-trunc" style="max-width:140px">${esc(l.project_name || '-')}</td>
        <td class="cell-trunc" style="max-width:240px"><span>${esc(l.model || '-')}</span> <span class="cell-muted">${esc(prov)}</span></td>
        <td class="num">${statusPill(l.status)}</td>
        <td class="num" style="color:var(--muted)">${l.ms != null ? num(l.ms) : '-'}</td>
        <td class="num">${fmtTokCell(l)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" style="padding:20px 0;text-align:center;color:var(--muted)">No requests logged yet.</td></tr>';
  }

  if (mob) {
    mob.innerHTML = rows.length ? rows.map(l => {
      const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
      return `<div class="m-row" onclick="inspect('${esc(l.id)}')">
        <div class="m-main">
          <div class="m-title">${esc(l.model || '-')}</div>
          <div class="m-sub num">${esc(l.id || '').slice(0, 8)} · ${esc(fmtDate(l.created_at).slice(11))} · ${esc(prov)}</div>
        </div>
        <div class="m-right">
          <div>${statusPill(l.status)}</div>
          <div class="m-sub num">${l.ms != null ? num(l.ms) + ' ms' : '-'}</div>
        </div>
      </div>`;
    }).join('') : '<div class="empty-box">No requests logged yet.</div>';
  }
}

function renderLogs() {
  const rows = LOGS;
  const tbody = document.getElementById('logs');
  const mob = document.getElementById('logsMobile');

  if (tbody) {
    tbody.innerHTML = rows.length ? rows.map(l => {
      const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
      return `<tr class="row-link" onclick="inspect('${esc(l.id)}')">
        <td><button type="button" onclick="toggleBookmark(event,'${esc(l.id)}',${!!l.bookmarked})" title="${l.bookmarked ? 'Remove saved mark' : 'Save request'}${esc(l.bookmark_note ? ' · ' + l.bookmark_note : '')}" class="btn-pill btn-sm${l.bookmarked ? ' on' : ''}">${l.bookmarked ? 'Saved' : 'Save'}</button></td>
        <td class="cell-id">${esc(l.id || '').slice(0, 8)}</td>
        <td class="num" style="white-space:nowrap;color:var(--muted)">${esc(fmtDate(l.created_at))}</td>
        <td class="cell-trunc" style="max-width:140px">${esc(l.project_name || '-')}</td>
        <td class="cell-trunc" style="max-width:200px;color:var(--muted)">${esc(l.method || '')} ${esc(l.path || '')}</td>
        <td class="cell-trunc" style="max-width:220px"><span>${esc(l.model || '-')}</span> <span class="cell-muted">${esc(prov)}</span></td>
        <td class="num">${statusPill(l.status)}</td>
        <td class="num" style="color:var(--muted)">${l.ms != null ? num(l.ms) : '-'}</td>
        <td class="num">${fmtTokCell(l)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="9" style="padding:20px 0;text-align:center;color:var(--muted)">No matching logs in this range.</td></tr>';
  }

  if (mob) {
    mob.innerHTML = rows.length ? rows.map(l => {
      const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
      return `<div class="m-row" onclick="inspect('${esc(l.id)}')">
        <div class="m-main">
          <div class="m-title">${esc(l.model || '-')}</div>
          <div class="m-sub num">${esc(l.id || '').slice(0, 8)} · ${esc(fmtDate(l.created_at))} · ${esc(l.method || '')} ${esc(l.path || '')} · ${esc(prov)}</div>
        </div>
        <div class="m-right">
          <div>${statusPill(l.status)}</div>
          <div class="m-sub num">${l.ms != null ? num(l.ms) + ' ms' : '-'}</div>
        </div>
      </div>`;
    }).join('') : '<div class="empty-box">No matching logs in this range.</div>';
  }

  const ps = parseInt(document.getElementById('ps')?.value || '50', 10);
  const pages = Math.max(1, Math.ceil(total / ps));
  const pginfo = document.getElementById('pginfo');
  if (pginfo) pginfo.textContent = `page ${page} of ${pages} · ${LOGS.length} rows`;
}

function toggleBookmarkFilter() {
  showBookmarked = !showBookmarked;
  const b = document.getElementById('bmToggle');
  if (b) b.classList.toggle('on', showBookmarked);
  page = 1;
  reloadLogs();
}

function clearFilters() {
  const qEl = document.getElementById('q'); if (qEl) qEl.value = '';
  const projEl = document.getElementById('proj'); if (projEl) projEl.value = '';
  const fromEl = document.getElementById('dfrom'); if (fromEl) fromEl.value = '';
  const toEl = document.getElementById('dto'); if (toEl) toEl.value = '';
  showBookmarked = false;
  const b = document.getElementById('bmToggle');
  if (b) b.classList.remove('on');
  page = 1;
  reloadLogs();
  reloadUsage();
}

async function reloadProjects() {
  try {
    const r = await fetch('/api/conn/projects');
    const j = await r.json();
    const sel = document.getElementById('proj');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All projects</option>' + (j.projects || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    if (cur) sel.value = cur;
  } catch (_) {}
}

function prevPage() {
  if (page > 1) { page--; reloadLogs(); }
}

function nextPage() {
  const ps = parseInt(document.getElementById('ps')?.value || '50', 10);
  if (page * ps < total) { page++; reloadLogs(); }
}

async function inspect(id) {
  try {
    const r = await fetch('/api/conn/logs/' + encodeURIComponent(id));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const log = j.log || {};
    const bm = log.bookmarked ?? log.meta?.bookmarked ?? false;
    const note = log.bookmark_note ?? log.bookmarkNote ?? log.note ?? '';
    curBmId = id;
    curBmState = !!bm;
    const btn = document.getElementById('dlgBmBtn');
    if (btn) {
      btn.textContent = curBmState ? 'Saved' : 'Save';
      btn.classList.toggle('on', curBmState);
    }
    const ni = document.getElementById('bmNote');
    if (ni) ni.value = note || '';
    const t = JSON.stringify(log, null, 2);
    const dt = document.getElementById('dt');
    if (dt) dt.textContent = `req ${id} · ${j.source} · ${num(t.length)} chars`;
    const db = document.getElementById('db');
    if (db) db.textContent = t;
    const dlg = document.getElementById('dlg');
    if (dlg) dlg.showModal();
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleBookmark(ev, id, cur) {
  ev.stopPropagation();
  try {
    const r = await fetch('/api/conn/logs/' + encodeURIComponent(id) + '/bookmark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmarked: !cur })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    toast(j.bookmarked ? 'Saved' : 'Removed');
    reloadLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function toggleDlgBookmark() {
  if (!curBmId) return;
  try {
    const noteVal = document.getElementById('bmNote')?.value || '';
    const r = await fetch('/api/conn/logs/' + encodeURIComponent(curBmId) + '/bookmark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmarked: !curBmState, note: noteVal })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    curBmState = !!j.bookmarked;
    const btn = document.getElementById('dlgBmBtn');
    if (btn) {
      btn.textContent = curBmState ? 'Saved' : 'Save';
      btn.classList.toggle('on', curBmState);
    }
    toast(curBmState ? 'Saved' : 'Removed');
    reloadLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function saveBookmarkNote() {
  if (!curBmId) return toast('Open a log first', true);
  try {
    const noteVal = document.getElementById('bmNote')?.value || '';
    const r = await fetch('/api/conn/logs/' + encodeURIComponent(curBmId) + '/bookmark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookmarked: true, note: noteVal })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    curBmState = true;
    const btn = document.getElementById('dlgBmBtn');
    if (btn) {
      btn.textContent = 'Saved';
      btn.classList.add('on');
    }
    toast('Note saved');
    reloadLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function copyLog() {
  const t = document.getElementById('db')?.textContent || '';
  if (!t) return toast('Nothing to copy', true);
  try {
    await navigator.clipboard.writeText(t);
    toast('Copied JSON');
  } catch (e) {
    toast('Copy failed: ' + e.message, true);
  }
}
