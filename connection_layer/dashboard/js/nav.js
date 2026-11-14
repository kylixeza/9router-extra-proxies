'use strict';

const LEON_VIEWS = ['overview', 'logs', 'config'];
const VIEW_TITLES = {
  overview: 'Connection layer',
  logs: 'Request logs',
  config: 'Gateway configuration'
};
const VIEW_SUBS = {
  logs: 'Filter, inspect, and bookmark proxy requests',
  config: 'Runtime limits, upstream target, and models cache'
};

window.CUR_VIEW = 'overview';

function showView(name) {
  const target = LEON_VIEWS.includes(name) ? name : 'overview';
  window.CUR_VIEW = target;

  const h1 = document.getElementById('titleLine');
  if (h1) h1.textContent = VIEW_TITLES[target] || 'Connection layer';

  const sub = document.getElementById('titleSub');
  if (sub && VIEW_SUBS[target]) sub.textContent = VIEW_SUBS[target];

  LEON_VIEWS.forEach(v => {
    const section = document.getElementById('view-' + v);
    if (section) section.classList.toggle('hidden', v !== target);
    const navBtn = document.getElementById('nav-' + v);
    if (navBtn) navBtn.classList.toggle('active', v === target);
  });

  if (target === 'overview' && typeof renderOverview === 'function') {
    renderOverview();
    if (typeof renderPulse === 'function') renderPulse();
  }

  if (location.hash !== '#/' + target) {
    history.replaceState(null, '', '#/' + target);
  }
}

function handleHash() {
  const h = (location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  showView(h || 'overview');
}

function refreshAll() {
  reload();
  reloadUsage();
  reloadLogs();
  toast('Refreshed');
}

window.addEventListener('hashchange', handleHash);
