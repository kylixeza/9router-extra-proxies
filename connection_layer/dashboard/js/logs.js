'use strict';

let LOGS = [];
let page = 1;
let total = 0;
let debT = null;
let showBookmarked = false;
let curBmId = null;
let curBmState = false;

function debouncedLogs() {
  clearTimeout(debT);
  debT = setTimeout(() => reloadLogs(), 300);
}

async function reloadLogs() {
  try {
    const ps = document.getElementById('ps')?.value || '50';
    const q = document.getElementById('q')?.value || '';
    const proj = document.getElementById('proj')?.value || '';
    const from = document.getElementById('dfrom')?.value || '';
    const to = document.getElementById('dto')?.value || '';
    const r = await fetch(`/api/conn/logs?page=${page}&pageSize=${ps}&q=${encodeURIComponent(q)}&project=${encodeURIComponent(proj)}&from=${from}&to=${to}${showBookmarked ? '&bookmarked=1' : ''}`);
    const j = await r.json();
    LOGS = j.logs || [];
    total = j.total || 0;
    page = j.page || page;
    const lsrc = document.getElementById('lsrc');
    if (lsrc) lsrc.textContent = `${j.source} · ${num(total)} total`;
    renderLogs();
    renderRecentLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

function fmtTokCell(l) {
  if (l.prompt_tokens || l.completion_tokens) {
    return `<span class="font-medium num">${fmtTok(l.prompt_tokens)}</span><span style="color:var(--muted)">/${fmtTok(l.completion_tokens)}</span>`;
  }
  if (l.est_prompt_tokens) {
    return `<span class="text-xs num" style="color:var(--muted)" title="Estimated">~${fmtTok(l.est_prompt_tokens)}</span>`;
  }
  return '<span style="color:var(--muted)">-</span>';
}

function renderRecentLogs() {
  const tb = document.getElementById('recentLogs');
  if (!tb) return;
  const rows = LOGS.slice(0, 6);
  tb.innerHTML = rows.length ? rows.map(l => {
    const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
    const bad = Number(l.status) >= 400;
    return `<tr class="cursor-pointer hover:opacity-90" onclick="inspect('${esc(l.id)}')">
      <td class="py-1.5 pr-3 font-medium">${esc(l.id || '').slice(0, 8)}</td>
      <td class="py-1.5 pr-3 whitespace-nowrap num" style="color:var(--muted)">${esc(fmtDate(l.created_at).slice(11))}</td>
      <td class="py-1.5 pr-3 truncate max-w-[120px]">${esc(l.project_name || '-')}</td>
      <td class="py-1.5 pr-3 truncate max-w-[200px]"><span>${esc(l.model || '-')}</span> <span class="text-xs" style="color:var(--muted)">${esc(prov)}</span></td>
      <td class="py-1.5 pr-3 num" style="color:${bad ? 'var(--negative)' : 'var(--text)'}">${l.status ?? '-'}</td>
      <td class="py-1.5 pr-3 num" style="color:var(--muted)">${l.ms != null ? num(l.ms) : '-'}</td>
      <td class="py-1.5 num">${fmtTokCell(l)}</td>
    </tr>`;
  }).join('') : '<tr><td class="py-4 text-center" style="color:var(--muted)" colspan="7">No requests logged yet.</td></tr>';
}

function renderLogs() {
  const rows = LOGS;
  const tbody = document.getElementById('logs');
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(l => {
    const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
    const bad = Number(l.status) >= 400;
    return `<tr class="cursor-pointer" onclick="inspect('${esc(l.id)}')">
      <td class="py-2 pr-2"><button onclick="toggleBookmark(event,'${esc(l.id)}',${!!l.bookmarked})" title="${l.bookmarked ? 'Remove saved mark' : 'Save request'}${esc(l.bookmark_note ? ' · ' + l.bookmark_note : '')}" class="text-xs px-1.5 py-0.5 rounded border" style="border-color:${l.bookmarked ? 'var(--accent)' : 'var(--control)'};color:${l.bookmarked ? 'var(--text)' : 'var(--muted)'}">${l.bookmarked ? 'saved' : 'save'}</button></td>
      <td class="py-2 pr-3 font-medium">${esc(l.id || '').slice(0, 8)}</td>
      <td class="py-2 pr-3 whitespace-nowrap num" style="color:var(--muted)">${esc(fmtDate(l.created_at))}</td>
      <td class="py-2 pr-3 truncate max-w-[140px]">${esc(l.project_name || '-')}</td>
      <td class="py-2 pr-3 truncate max-w-[220px]" style="color:var(--muted)">${esc(l.method || '')} ${esc(l.path || '')}</td>
      <td class="py-2 pr-3 truncate max-w-[200px]"><span class="truncate">${esc(l.model || '-')}</span> <span class="text-xs" style="color:var(--muted)">${esc(prov)}</span></td>
      <td class="py-2 pr-3 num" style="color:${bad ? 'var(--negative)' : 'var(--text)'}">${l.status ?? '-'}</td>
      <td class="py-2 pr-3 num" style="color:var(--muted)">${l.ms != null ? num(l.ms) : '-'}</td>
      <td class="py-2 num">${fmtTokCell(l)}</td>
    </tr>`;
  }).join('') : '<tr><td class="py-4" style="color:var(--muted)" colspan="9">No matching logs in this range.</td></tr>';

  const ps = parseInt(document.getElementById('ps')?.value || '50', 10);
  const pages = Math.max(1, Math.ceil(total / ps));
  const pginfo = document.getElementById('pginfo');
  if (pginfo) pginfo.textContent = `page ${page} of ${pages} · ${LOGS.length} rows`;
}

function toggleBookmarkFilter() {
  showBookmarked = !showBookmarked;
  const b = document.getElementById('bmToggle');
  if (b) b.style.borderColor = showBookmarked ? 'var(--accent)' : 'var(--control)';
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
  if (b) b.style.borderColor = 'var(--control)';
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
    const j = await r.json();
    const log = j.log || {};
    const bm = log.bookmarked ?? log.meta?.bookmarked ?? false;
    const note = log.bookmark_note ?? log.bookmarkNote ?? log.note ?? '';
    curBmId = id;
    curBmState = !!bm;
    const btn = document.getElementById('dlgBmBtn');
    if (btn) btn.textContent = curBmState ? 'Saved' : 'Save';
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
    toast(j.bookmarked ? 'saved' : 'removed');
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
    if (btn) btn.textContent = curBmState ? 'Saved' : 'Save';
    toast(curBmState ? 'saved' : 'removed');
    reloadLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function saveBookmarkNote() {
  if (!curBmId) return toast('open a log first', true);
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
    if (btn) btn.textContent = 'Saved';
    toast('note saved');
    reloadLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

async function copyLog() {
  const t = document.getElementById('db')?.textContent || '';
  if (!t) return toast('nothing to copy', true);
  try {
    await navigator.clipboard.writeText(t);
    toast('copied');
  } catch (e) {
    toast('copy failed: ' + e.message, true);
  }
}
