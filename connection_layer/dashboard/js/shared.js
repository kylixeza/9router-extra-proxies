'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(m, isErr = false) {
  const b = document.getElementById('toast');
  if (!b) return;
  const d = document.createElement('div');
  d.className = 'px-3 py-2 rounded-lg text-xs font-medium shadow-lg ' +
    (isErr ? 'bg-red-700 text-white' : 'bg-[#451A03] text-amber-200 border border-amber-800');
  d.textContent = m;
  b.appendChild(d);
  setTimeout(() => d.remove(), 2400);
}

function num(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtTok(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 16).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function card(l, v) {
  return `<div class="card p-3 bg-[#FFFEFA] border border-[#E8D9C0]">
    <div class="text-[11px] font-mono text-[#856E52]">${esc(l)}</div>
    <div class="text-lg font-semibold tracking-tight font-mono text-[#2A1A08]">${esc(v)}</div>
  </div>`;
}

const PROVIDER_COLORS = {
  ms: '#3b82f6', muse: '#3b82f6',
  kr: '#a855f7', claude: '#a855f7',
  ag: '#d97706', gemini: '#d97706',
  direct: '#856E52'
};

function provColor(p) {
  return PROVIDER_COLORS[(p || '').toLowerCase()] || '#10b981';
}
