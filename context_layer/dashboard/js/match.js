'use strict';

function runPreset(text) {
  const mt = document.getElementById('mtext');
  if (mt) mt.value = text;
  doMatch();
}

function focusSimulator() {
  if (curTab !== 'O') tab('O');
  const mt = document.getElementById('mtext');
  if (mt) {
    mt.focus();
    mt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function doMatch() {
  const t = document.getElementById('mtext')?.value.trim();
  if (!t) return toast('Enter a prompt to test routing', true);
  try {
    const r = await api('/api/match', 'POST', { text: t });
    const provs = r.providers || [];
    const sks = r.skills || [];
    matchedState = { text: t, providers: new Set(provs), skills: new Set(sks) };
    renderSimOutput(t, provs, sks);
    const clr = document.getElementById('clearMatchBtn');
    if (clr) clr.classList.remove('hidden');
    renderOverviewTables();
    if (curTab === 'R') renderRulesView();
    if (curTab === 'O') renderOverviewChart();
    toast(`Matched ${provs.length} provider${provs.length === 1 ? '' : 's'} · ${sks.length} skill${sks.length === 1 ? '' : 's'}`);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderSimOutput(promptText, provs, sks) {
  const box = document.getElementById('simOutput');
  if (!box) return;
  const totalTools = (D.providers || [])
    .filter(p => provs.includes(p.name))
    .reduce((a, p) => a + p.tools, 0);

  if (!provs.length && !sks.length) {
    box.innerHTML = `<div style="color:var(--muted)">No provider or skill matched <strong style="color:var(--text)">"${esc(promptText)}"</strong>. All gated MCP tools remain unloaded.</div>`;
    return;
  }

  const chips = [
    ...provs.map(p => `<button type="button" class="pill accent" onclick="inspectRule('provider','${q(p)}')">mcp:${esc(p)}</button>`),
    ...sks.map(s => `<button type="button" class="pill pos" onclick="inspectRule('skill','${q(s)}')">skill:${esc(s)}</button>`)
  ].join('');

  box.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <span>Admitted <strong class="num">${provs.length}</strong> provider${provs.length === 1 ? '' : 's'} (<span class="num">${totalTools}</span> tools) and <strong class="num">${sks.length}</strong> skill${sks.length === 1 ? '' : 's'}</span>
      <span style="font-size:12px;color:var(--muted)">click chip to inspect</span>
    </div>
    <div class="sim-chips">${chips}</div>
  `;
}

function clearMatch() {
  matchedState = null;
  const mt = document.getElementById('mtext');
  if (mt) mt.value = '';
  const clr = document.getElementById('clearMatchBtn');
  if (clr) clr.classList.add('hidden');
  const box = document.getElementById('simOutput');
  if (box) {
    box.innerHTML = '<span style="color:var(--muted)">Enter a prompt to preview which MCP tool groups and skills pass the gate.</span>';
  }
  renderOverviewTables();
  if (curTab === 'R') renderRulesView();
  if (curTab === 'O') renderOverviewChart();
}
