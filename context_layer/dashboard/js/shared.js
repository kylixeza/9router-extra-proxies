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
  el.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium shadow-lg ' +
    (isErr ? 'bg-red-700 text-white' : 'bg-[#3B1C32] text-pink-100 border border-pink-900/40');
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
  return `<span class="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] bg-[#FAF0F5] border hair text-[#3B1C32]">
    ${esc(k)}
    <button onclick="${fn}" class="w-4 h-4 rounded flex items-center justify-center text-[#8E5A7A] hover:text-red-600 hover:bg-white">×</button>
  </span>`;
}
