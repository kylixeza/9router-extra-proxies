'use strict';

const VALIANT_VIEWS = {
  O: 'overview',
  R: 'rules',
  I: 'instructions'
};

const HASH_TO_TAB = {
  overview: 'O',
  rules: 'R',
  providers: 'R',
  skills: 'R',
  instructions: 'I',
  preview: 'I'
};

let curTab = 'O';

function updateHeaderCopy() {
  const titleEl = document.getElementById('valiantTitle');
  const subEl = document.getElementById('valiantSub');
  const secBtn = document.getElementById('titleSecondaryBtn');
  const priBtn = document.getElementById('titlePrimaryBtn');
  if (!titleEl || !subEl) return;

  const provCount = (D.providers || []).length;
  const toolCount = (D.providers || []).reduce((a, p) => a + p.tools, 0);
  const skillCount = (D.skills || []).length;
  const kwCount = (D.providers || []).reduce((a, p) => a + p.keywords.length, 0) +
    (D.skills || []).reduce((a, s) => a + s.keywords.length, 0);

  if (curTab === 'O') {
    titleEl.textContent = 'Context routing';
    subEl.textContent = provCount || skillCount
      ? `${toolCount} gated MCP tools across ${provCount} providers and ${skillCount} skills (${kwCount} keywords)`
      : 'No providers or skills indexed yet';
    if (secBtn) { secBtn.textContent = 'All rules'; secBtn.onclick = () => tab('R'); }
    if (priBtn) { priBtn.textContent = 'Test prompt'; priBtn.onclick = focusSimulator; }
  } else if (curTab === 'R') {
    titleEl.textContent = 'Routing rules';
    subEl.textContent = `${provCount} MCP providers and ${skillCount} agent skills matched by prompt keywords`;
    if (secBtn) { secBtn.textContent = 'Overview'; secBtn.onclick = () => tab('O'); }
    if (priBtn) { priBtn.textContent = activeSubTab === 'providers' ? '+ Add provider' : '+ Add skill'; priBtn.onclick = openActiveAddDlg; }
  } else {
    titleEl.textContent = 'Base instructions';
    subEl.textContent = 'Active Markdown tree overrides incoming system prompts on :20130';
    if (secBtn) { secBtn.textContent = 'Download .md'; secBtn.onclick = downloadInstr; }
    if (priBtn) { priBtn.textContent = 'Save changes'; priBtn.onclick = saveInstr; }
  }
}

function tab(t, subTab = null) {
  curTab = t;
  ['O', 'R', 'I'].forEach(x => {
    const b = document.getElementById('tab' + x);
    const v = document.getElementById('view' + x);
    if (b) b.className = x === t ? 'valiant-nav-link active' : 'valiant-nav-link';
    if (v) v.classList.toggle('hidden', x !== t);
  });

  if (subTab && t === 'R') setRulesSubTab(subTab, false);

  const slug = VALIANT_VIEWS[t] || 'overview';
  if (location.hash !== '#/' + slug) {
    history.replaceState(null, '', '#/' + slug);
  }

  updateHeaderCopy();

  if (t === 'O') renderOverviewChart();
  if (t === 'R') renderRulesView();
  if (t === 'I') { loadInstr(); loadPreview(); }
}

function handleHash() {
  const h = (location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
  const t = HASH_TO_TAB[h] || 'O';
  if (h === 'skills') activeSubTab = 'skills';
  else if (h === 'providers') activeSubTab = 'providers';
  tab(t);
}

window.addEventListener('hashchange', handleHash);
