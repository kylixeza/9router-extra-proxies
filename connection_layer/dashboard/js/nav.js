'use strict';

const LEON_VIEWS = ['overview', 'usage', 'models', 'logs', 'config'];

function showView(name) {
  const target = LEON_VIEWS.includes(name) ? name : 'overview';

  LEON_VIEWS.forEach(v => {
    const section = document.getElementById('view-' + v);
    if (section) {
      if (v === target) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
    const navBtn = document.getElementById('nav-' + v);
    if (navBtn) {
      if (v === target) {
        navBtn.classList.add('active');
      } else {
        navBtn.classList.remove('active');
      }
    }
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
