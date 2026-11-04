'use strict';

const LEON_VIEWS = ['overview', 'logs', 'config'];
const VIEW_TITLES = {
  overview: 'Connection layer',
  logs: 'Request logs',
  config: 'Gateway configuration'
};

window.CUR_VIEW = 'overview';

function showView(name) {
  const target = LEON_VIEWS.includes(name) ? name : 'overview';
  window.CUR_VIEW = target;

  const h1 = document.getElementById('titleLine');
  if (h1) h1.textContent = VIEW_TITLES[target] || 'Connection layer';

  LEON_VIEWS.forEach(v => {
    const section = document.getElementById('view-' + v);
    if (section) section.classList.toggle('hidden', v !== target);
    const navBtn = document.getElementById('nav-' + v);
    if (navBtn) navBtn.classList.toggle('active', v === target);
  });

  if (location.hash !== '#/' + target) {
    history.replaceState(null, '', '#/' + target);
  }
}

function handleHash() {
  const h = (location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  showView(h || 'overview');
}

window.addEventListener('hashchange', handleHash);
