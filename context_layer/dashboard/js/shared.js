'use strict';

let D = { providers: [], skills: [] };
let lastLoadedAt = null;
let lastLoadErr = null;
let activeMetric = 'tools';
let activeSubTab = 'providers';
let selectedItem = null; // { kind: 'provider'|'skill', name: string }
let matchedState = null; // { text, providers: Set, skills: Set } | null

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function q(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function fmtStamp(d) {
  if (!d) return '-';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function toast(msg, isErr = false) {
  const b = document.getElementById('toast');
  if (!b) return;
  const el = document.createElement('div');
  el.className = 'toast-item' + (isErr ? ' err' : '');
  el.textContent = msg;
  b.appendChild(el);
  setTimeout(() => el.remove(), 2600);
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

function kwPill(k, fn, matched = false) {
  return `<span class="kw${matched ? ' matched' : ''}">${esc(k)}<button type="button" onclick="${fn}" aria-label="Remove keyword ${esc(k)}" title="Remove">×</button></span>`;
}
