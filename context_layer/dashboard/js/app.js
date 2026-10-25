'use strict';

async function reload() {
  try {
    D = await api('/api/index');
    render();
  } catch (e) {
    toast(e.message, true);
  }
}

function render() {
  const f = (document.getElementById('q')?.value || '').toLowerCase().trim();
  const P = (D.providers || []).filter(p =>
    !f ||
    p.name.toLowerCase().includes(f) ||
    p.keywords.some(k => k.toLowerCase().includes(f)) ||
    p.toolNames.some(t => t.toLowerCase().includes(f))
  );
  const S = (D.skills || []).filter(s =>
    !f ||
    s.name.toLowerCase().includes(f) ||
    (s.path || '').toLowerCase().includes(f) ||
    (s.description || '').toLowerCase().includes(f) ||
    s.keywords.some(k => k.toLowerCase().includes(f))
  );

  const stP = document.getElementById('stP'); if (stP) stP.textContent = (D.providers || []).length;
  const stS = document.getElementById('stS'); if (stS) stS.textContent = (D.skills || []).length;
  const stT = document.getElementById('stT'); if (stT) stT.textContent = (D.providers || []).reduce((a, p) => a + p.tools, 0);
  const stK = document.getElementById('stK'); if (stK) {
    stK.textContent = (D.providers || []).reduce((a, p) => a + p.keywords.length, 0) +
      (D.skills || []).reduce((a, s) => a + s.keywords.length, 0);
  }

  const cp = document.getElementById('tabCountP'); if (cp) cp.textContent = P.length;
  const cs = document.getElementById('tabCountS'); if (cs) cs.textContent = S.length;

  renderProviders(P);
  renderSkills(S);

  if (window.lucide) lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
  handleHash();
  reload();

  window.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      document.getElementById('q')?.focus();
    }
    if (e.key === 'Escape') {
      const qEl = document.getElementById('q');
      if (qEl) { qEl.value = ''; render(); }
    }
  });
});
