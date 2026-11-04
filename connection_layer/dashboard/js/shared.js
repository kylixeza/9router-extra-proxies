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
  d.className = 'px-3 py-2 rounded-lg text-xs font-medium ' +
    (isErr ? 'text-white' : 'text-white border');
  d.style.background = isErr ? 'var(--negative)' : 'var(--raised)';
  d.style.borderColor = isErr ? 'transparent' : 'var(--border)';
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
  const p = n => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function card(l, v, sub = '', isLead = false) {
  return `<div class="kpi-cell${isLead ? ' lead' : ''}"><div class="kpi-l">${esc(l)}</div><div class="kpi-v num">${v}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

// one hue on data (accent blue), rest ink/grey
const PROVIDER_COLORS = {
  ms: '#f2f2f3', muse: '#f2f2f3',
  kr: '#b4b4b4', claude: '#b4b4b4',
  ag: '#4a8ad6', gemini: '#4a8ad6',
  direct: '#949494'
};

function provColor(p) {
  return PROVIDER_COLORS[(p || '').toLowerCase()] || '#b4b4b4';
}
