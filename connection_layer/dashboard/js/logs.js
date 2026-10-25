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
    if (lsrc) lsrc.textContent = `· ${j.source} · ${num(total)} total · all-time latest first`;
    renderLogs();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderLogs() {
  const rows = LOGS;
  const tbody = document.getElementById('logs');
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(l => {
    const prov = l.provider || (l.model && l.model.includes('/') ? l.model.split('/')[0] : 'direct');
    const provBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white mr-1" style="background:${provColor(prov)}">${esc(prov)}</span>`;
    let tokHtml = '-';
    if (l.prompt_tokens || l.completion_tokens) {
      tokHtml = `<span class="text-[#2A1A08] font-medium">${fmtTok(l.prompt_tokens)}</span>/<span class="text-[#856E52]">${fmtTok(l.completion_tokens)}</span>`;
    } else if (l.est_prompt_tokens) {
      tokHtml = `<span class="px-1.5 py-0.5 rounded bg-[#F3ECE0] text-[#451A03] text-[10px] font-medium border hair" title="Estimated">~${fmtTok(l.est_prompt_tokens)} est</span>`;
    }
    return `<tr class="border-b hair last:border-0 hover:bg-[#F3ECE0] cursor-pointer" onclick="inspect('${esc(l.id)}')">
      <td class="py-1.5 pl-4 pr-1"><button onclick="toggleBookmark(event,'${esc(l.id)}',${!!l.bookmarked})" title="${l.bookmarked ? 'unbookmark' : 'bookmark'}${esc(l.bookmark_note ? ' · ' + l.bookmark_note : '')}" class="text-sm leading-none ${l.bookmarked ? 'text-amber-500 font-bold' : 'text-[#D6BD96] hover:text-amber-500'}">${l.bookmarked ? '★' : '☆'}</button></td>
      <td class="py-1.5 px-1 font-semibold text-[#2A1A08]">${esc(l.id || '').slice(0, 10)}</td>
      <td class="py-1.5 pr-3 text-[#856E52] whitespace-nowrap">${esc(fmtDate(l.created_at))}</td>
      <td class="py-1.5 pr-3 truncate max-w-[140px] text-[#2A1A08]">${esc(l.project_name || '-')}</td>
      <td class="py-1.5 pr-3 truncate max-w-[220px] text-[#451A03]">${esc(l.method || '')} ${esc(l.path || '')}</td>
      <td class="py-1.5 pr-3 truncate max-w-[200px] flex items-center">${provBadge}<span class="truncate font-medium">${esc(l.model || '-')}</span></td>
      <td class="py-1.5 pr-3 text-right font-mono">${l.status ?? '-'}</td>
      <td class="py-1.5 pr-3 text-right font-mono">${l.ms ?? '-'}</td>
      <td class="py-1.5 px-4 text-right">${tokHtml}</td>
    </tr>`;
  }).join('') : '<tr><td class="py-4 px-4 text-[#856E52]" colspan="9">no logs</td></tr>';

  const ps = parseInt(document.getElementById('ps')?.value || '50', 10);
  const pages = Math.max(1, Math.ceil(total / ps));
  const pginfo = document.getElementById('pginfo');
  if (pginfo) pginfo.textContent = `page ${page}/${pages} · ${LOGS.length} rows`;
}

function toggleBookmarkFilter() {
  showBookmarked = !showBookmarked;
  page = 1;
  const b = document.getElementById('bmToggle');
  if (b) {
    b.textContent = showBookmarked ? '★' : '☆';
    b.className = 'h-8 px-2.5 rounded-lg border hair text-xs hover:border-[#D6BD96]' +
      (showBookmarked ? ' bg-amber-100 border-amber-400 font-bold text-amber-900' : '');
  }
  reloadLogs();
}

function clearFilters() {
  const qEl = document.getElementById('q'); if (qEl) qEl.value = '';
  const projEl = document.getElementById('proj'); if (projEl) projEl.value = '';
  const fromEl = document.getElementById('dfrom'); if (fromEl) fromEl.value = '';
  const toEl = document.getElementById('dto'); if (toEl) toEl.value = '';
  if (showBookmarked) toggleBookmarkFilterSilent();
  page = 1;
  reloadLogs();
  reloadUsage();
}

function toggleBookmarkFilterSilent() {
  showBookmarked = false;
  const b = document.getElementById('bmToggle');
  if (b) {
    b.textContent = '☆';
    b.className = 'h-8 px-2.5 rounded-lg border hair text-xs hover:border-[#D6BD96]';
  }
}

async function reloadProjects() {
  try {
    const r = await fetch('/api/conn/projects');
    const j = await r.json();
    const sel = document.getElementById('proj');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">all projects</option>' + (j.projects || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
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
    if (btn) btn.textContent = curBmState ? '★ Bookmarked' : '☆ Bookmark';
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
    toast(j.bookmarked ? 'bookmarked' : 'unbookmarked');
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
    if (btn) btn.textContent = curBmState ? '★ Bookmarked' : '☆ Bookmark';
    toast(curBmState ? 'bookmarked' : 'unbookmarked');
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
    if (btn) btn.textContent = '★ Bookmarked';
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
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('copied'); } catch (_) { toast('copy failed', true); }
    ta.remove();
  }
}
