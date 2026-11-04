'use strict';

let D = { providers: [], skills: [] };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function q(s) {
  return String(s ?? '').replace(/'/g, "\\'");
}

function toast(msg, isErr = false) {
  const b = document.getElementById('toast');
  if (!b) return;
  const el = document.createElement('div');
  el.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium';
  el.style.background = isErr ? 'var(--negative)' : 'var(--text)';
  el.style.color = '#fff';
  el.textContent = msg;
  b.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function openDlg(id) {
  const dlg = document.getElementById(id);
  if (dlg) dlg.showModal();
}

async function api(p, m = 'GET', body = null) {
  const k = localStorage.getItem('9r-key') || '';
  const h = { 'content-type': 'application/json' };
  if (k) h['authorization'] = 'Bearer ' + k;
  const r = await fetch(p, {
    method: m,
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(p + ' ' + r.status);
  return r.json().catch(() => ({}));
}

function kwPill(k, fn) {
  return `<span class="kw">${esc(k)}<button onclick="${fn}" title="remove">×</button></span>`;
}
