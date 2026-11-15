'use strict';

function setLoadingSkeleton() {
  const ovProv = document.getElementById('ovProvBody');
  const ovSkill = document.getElementById('ovSkillBody');
  const rowSkel = `<tr><td colspan="4"><span class="skeleton-bar" style="width:68%"></span></td></tr>`.repeat(4);
  if (ovProv) ovProv.innerHTML = rowSkel;
  if (ovSkill) ovSkill.innerHTML = rowSkel;
}

async function reload() {
  const errBox = document.getElementById('loadErrBox');
  const dot = document.getElementById('hDot');
  const stamp = document.getElementById('hStamp');
  if (stamp) stamp.textContent = 'Syncing…';
  if (!(D.providers || []).length && !(D.skills || []).length) setLoadingSkeleton();

  try {
    D = await api('/api/index');
    lastLoadedAt = new Date();
    lastLoadErr = null;
    if (errBox) errBox.classList.add('hidden');
    if (dot) dot.className = 'status-dot';
    if (stamp) stamp.textContent = `Updated ${fmtStamp(lastLoadedAt)}`;
    render();
  } catch (e) {
    lastLoadErr = e.message;
    if (dot) dot.className = 'status-dot err';
    if (stamp) stamp.textContent = lastLoadedAt ? `Stale · ${fmtStamp(lastLoadedAt)}` : 'Offline';
    if (errBox) {
      document.getElementById('loadErrText').textContent =
        `Couldn't load routing index (${e.message}).${lastLoadedAt ? ` Last updated ${fmtStamp(lastLoadedAt)}.` : ''}`;
      errBox.classList.remove('hidden');
    }
    toast(e.message, true);
  }
}

function selectMetric(metric) {
  activeMetric = metric;
  ['tools', 'providers', 'skills', 'keywords'].forEach(m => {
    const btn = document.getElementById('kpiBtn-' + m);
    if (btn) btn.setAttribute('aria-selected', m === metric ? 'true' : 'false');
  });
  renderOverviewChart();
}

function renderOverviewChart() {
  const el = document.getElementById('overviewChart');
  const titleEl = document.getElementById('chartTitle');
  const noteEl = document.getElementById('chartNote');
  if (!el) return;

  const P = filteredProviders();
  const S = filteredSkills();

  if (activeMetric === 'tools' || activeMetric === 'providers') {
    const sorted = [...P].sort((a, b) => b.tools - a.tools);
    const labels = sorted.map(p => p.name);
    const values = sorted.map(p => p.tools);
    const hi = matchedState
      ? sorted.map((p, i) => matchedState.providers.has(p.name) ? i : -1).filter(i => i >= 0)
      : [0];
    if (titleEl) titleEl.textContent = activeMetric === 'tools' ? 'Gated tools per MCP provider' : 'Provider tool footprint';
    if (noteEl) noteEl.textContent = matchedState ? 'highlighted = matched prompt' : 'click a bar to inspect';
    ValiantChart.bars(el, {
      labels,
      values,
      highlight: hi.length ? hi : [0],
      unit: 'tools',
      onSelect: name => inspectRule('provider', name)
    });
  } else if (activeMetric === 'skills') {
    const top = [...S].sort((a, b) => b.keywords.length - a.keywords.length).slice(0, 8);
    const labels = top.map(s => s.name);
    const values = top.map(s => s.keywords.length);
    const hi = matchedState
      ? top.map((s, i) => matchedState.skills.has(s.name) ? i : -1).filter(i => i >= 0)
      : [0];
    if (titleEl) titleEl.textContent = 'Top skills by trigger keywords';
    if (noteEl) noteEl.textContent = `showing top ${top.length} of ${S.length}`;
    ValiantChart.bars(el, {
      labels,
      values,
      highlight: hi.length ? hi : [0],
      unit: 'keywords',
      onSelect: name => inspectRule('skill', name)
    });
  } else {
    const provKw = P.reduce((a, p) => a + p.keywords.length, 0);
    const skillKw = S.reduce((a, s) => a + s.keywords.length, 0);
    const topP = [...P].sort((a, b) => b.keywords.length - a.keywords.length).slice(0, 4);
    const labels = [...topP.map(p => `mcp:${p.name}`), 'all skills'];
    const values = [...topP.map(p => p.keywords.length), skillKw];
    if (titleEl) titleEl.textContent = `Keyword distribution (${provKw} provider · ${skillKw} skill)`;
    if (noteEl) noteEl.textContent = 'click a provider bar to inspect';
    ValiantChart.bars(el, {
      labels,
      values,
      highlight: [0],
      unit: 'keywords',
      onSelect: label => {
        if (label.startsWith('mcp:')) inspectRule('provider', label.slice(4));
        else tab('R', 'skills');
      }
    });
  }
}

function renderOverviewTables() {
  const P = filteredProviders();
  const S = filteredSkills();
  const sortedSkills = [...S].sort((a, b) => b.keywords.length - a.keywords.length || a.name.localeCompare(b.name));

  const ovProvMeta = document.getElementById('ovProvMeta');
  if (ovProvMeta) ovProvMeta.textContent = `${P.length} provider${P.length === 1 ? '' : 's'}`;
  const ovSkillMeta = document.getElementById('ovSkillMeta');
  if (ovSkillMeta) ovSkillMeta.textContent = `${Math.min(4, sortedSkills.length)} of ${S.length} skills`;

  renderProviderTable(document.getElementById('ovProvBody'), P, { cap: 4 });
  renderSkillTable(document.getElementById('ovSkillBody'), sortedSkills, { cap: 4 });
}

function setRulesSubTab(kind, rerender = true) {
  activeSubTab = kind === 'skills' ? 'skills' : 'providers';
  const pBtn = document.getElementById('subTab-providers');
  const sBtn = document.getElementById('subTab-skills');
  const addBtn = document.getElementById('rulesAddBtn');
  if (pBtn) pBtn.setAttribute('aria-selected', activeSubTab === 'providers' ? 'true' : 'false');
  if (sBtn) sBtn.setAttribute('aria-selected', activeSubTab === 'skills' ? 'true' : 'false');
  if (addBtn) addBtn.textContent = activeSubTab === 'providers' ? '+ Add provider' : '+ Add skill';
  if (rerender) {
    updateHeaderCopy();
    renderRulesView();
  }
}

function openActiveAddDlg() {
  openDlg(activeSubTab === 'skills' ? 'dlgS' : 'dlgP');
}

function inspectRule(kind, name) {
  selectedItem = { kind, name };
  if (curTab !== 'R') {
    tab('R', kind === 'skill' ? 'skills' : 'providers');
  } else {
    setRulesSubTab(kind === 'skill' ? 'skills' : 'providers', false);
    renderRulesView();
  }
  document.getElementById('ruleDetailPane')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderRulesView() {
  const P = filteredProviders();
  const S = filteredSkills();
  const wrap = document.getElementById('rulesTableWrap');
  const detail = document.getElementById('ruleDetailPane');
  const sum = document.getElementById('rulesSummaryCount');

  const cp = document.getElementById('countProvTab'); if (cp) cp.textContent = P.length;
  const cs = document.getElementById('countSkillTab'); if (cs) cs.textContent = S.length;

  if (activeSubTab === 'providers') {
    if (sum) sum.textContent = `${P.length} provider${P.length === 1 ? '' : 's'}`;
    if (wrap) {
      wrap.innerHTML = `<table class="valiant-table"><thead><tr><th>Provider</th><th class="n">Tools</th><th class="n">Keywords</th><th class="n">Action</th></tr></thead><tbody id="rulesProvBody"></tbody></table>`;
      renderProviderTable(document.getElementById('rulesProvBody'), P);
    }
    if (!selectedItem || selectedItem.kind !== 'provider' || !P.some(p => p.name === selectedItem.name)) {
      selectedItem = P.length ? { kind: 'provider', name: P[0].name } : null;
      if (wrap && selectedItem) renderProviderTable(document.getElementById('rulesProvBody'), P);
    }
    if (detail) {
      const p = selectedItem ? (D.providers || []).find(x => x.name === selectedItem.name) : null;
      detail.innerHTML = p ? renderProviderDetail(p) : '<div class="empty-box">No providers match the current filter.</div>';
    }
  } else {
    if (sum) sum.textContent = `${S.length} skill${S.length === 1 ? '' : 's'}`;
    if (wrap) {
      wrap.innerHTML = `<table class="valiant-table"><thead><tr><th>Skill</th><th class="n">Keywords</th><th class="n">Action</th></tr></thead><tbody id="rulesSkillBody"></tbody></table>`;
      renderSkillTable(document.getElementById('rulesSkillBody'), S);
    }
    if (!selectedItem || selectedItem.kind !== 'skill' || !S.some(s => s.name === selectedItem.name)) {
      selectedItem = S.length ? { kind: 'skill', name: S[0].name } : null;
      if (wrap && selectedItem) renderSkillTable(document.getElementById('rulesSkillBody'), S);
    }
    if (detail) {
      const s = selectedItem ? (D.skills || []).find(x => x.name === selectedItem.name) : null;
      detail.innerHTML = s ? renderSkillDetail(s) : '<div class="empty-box">No skills match the current filter.</div>';
    }
  }
}

function onSearchInput() {
  render();
  const f = (document.getElementById('q')?.value || '').trim();
  if (f && curTab === 'O') {
    // Keep overview responsive when filtering
    renderOverviewTables();
    renderOverviewChart();
  }
}

function render() {
  const allP = D.providers || [];
  const allS = D.skills || [];
  const totalTools = allP.reduce((a, p) => a + p.tools, 0);
  const provKw = allP.reduce((a, p) => a + p.keywords.length, 0);
  const skillKw = allS.reduce((a, s) => a + s.keywords.length, 0);
  const totalKw = provKw + skillKw;

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('kpiTools', totalTools);
  setText('kpiProvs', allP.length);
  setText('kpiSkills', allS.length);
  setText('kpiKeys', totalKw);

  updateHeaderCopy();
  renderOverviewTables();
  if (curTab === 'O') renderOverviewChart();
  if (curTab === 'R') renderRulesView();
}

document.addEventListener('DOMContentLoaded', () => {
  handleHash();
  reload();

  window.addEventListener('resize', () => {
    if (curTab === 'O') renderOverviewChart();
  });

  window.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      document.getElementById('q')?.focus();
    }
    if (e.key === 'Escape') {
      const qEl = document.getElementById('q');
      if (qEl && document.activeElement === qEl && qEl.value) {
        qEl.value = '';
        render();
      }
    }
  });
});
