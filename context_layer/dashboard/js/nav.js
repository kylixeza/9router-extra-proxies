'use strict';

const VALIANT_VIEWS = {
  P: 'providers',
  S: 'skills',
  M: 'match',
  I: 'instructions'
};

const HASH_TO_TAB = {
  providers: 'P',
  skills: 'S',
  match: 'M',
  instructions: 'I'
};

let curTab = 'P';

function tab(t) {
  curTab = t;
  ['P', 'S', 'M', 'I'].forEach(x => {
    const b = document.getElementById('tab' + x);
    const bm = document.getElementById('tab' + x + '-m');
    const v = document.getElementById('view' + x);
    if (x === t) {
      if (b) b.className = 'valiant-nav-link active';
      if (bm) bm.className = 'valiant-nav-link active';
      if (v) v.classList.remove('hidden');
    } else {
      if (b) b.className = 'valiant-nav-link';
      if (bm) bm.className = 'valiant-nav-link';
      if (v) v.classList.add('hidden');
    }
  });

  const slug = VALIANT_VIEWS[t] || 'providers';
  if (location.hash !== '#/' + slug) {
    history.replaceState(null, '', '#/' + slug);
  }

  if (t === 'I') loadInstr();
}

function handleHash() {
  const h = (location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  const t = HASH_TO_TAB[h] || 'P';
  tab(t);
}

window.addEventListener('hashchange', handleHash);
