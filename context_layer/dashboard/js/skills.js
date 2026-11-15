'use strict';

function filteredSkills() {
  const f = (document.getElementById('q')?.value || '').toLowerCase().trim();
  return (D.skills || []).filter(s =>
    !f ||
    s.name.toLowerCase().includes(f) ||
    (s.path || '').toLowerCase().includes(f) ||
    (s.description || '').toLowerCase().includes(f) ||
    s.keywords.some(k => k.toLowerCase().includes(f))
  );
}

function renderSkillTable(targetBody, list, { cap = null } = {}) {
  if (!targetBody) return;
  const rows = cap ? list.slice(0, cap) : list;
  if (!rows.length) {
    targetBody.innerHTML = `<tr><td colspan="3"><div class="empty-box">No agent skills match this filter.</div></td></tr>`;
    return;
  }
  targetBody.innerHTML = rows.map(s => {
    const isMatched = matchedState && matchedState.skills.has(s.name);
    const isSelected = selectedItem && selectedItem.kind === 'skill' && selectedItem.name === s.name;
    const kwPreview = s.keywords.slice(0, 4).map(esc).join(', ') + (s.keywords.length > 4 ? ` +${s.keywords.length - 4}` : '');
    const sub = s.description ? s.description.slice(0, 76) + (s.description.length > 76 ? '…' : '') : (kwPreview || 'No description');
    return `
      <tr class="${isMatched ? 'is-matched' : ''}${isSelected ? ' is-selected' : ''}">
        <td>
          <div class="row-title">
            <button type="button" class="row-link" onclick="inspectRule('skill','${q(s.name)}')">${esc(s.name)}</button>
            ${isMatched ? '<span class="pill pos">matched</span>' : ''}
          </div>
          <div class="row-sub">${esc(sub)}</div>
        </td>
        <td class="n num">${s.keywords.length}</td>
        <td class="n">
          <button type="button" class="btn-text btn-sm" onclick="inspectRule('skill','${q(s.name)}')">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSkillDetail(s) {
  if (!s) return '<div class="empty-box">Skill not found.</div>';
  return `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:600">${esc(s.name)}</h3>
          <div class="row-sub num">${s.keywords.length} trigger keywords</div>
        </div>
        <button type="button" onclick="delS('${q(s.name)}')" class="btn btn-sm btn-danger">Delete</button>
      </div>

      <div class="field">
        <label for="sd-${esc(s.name)}">Description</label>
        <textarea id="sd-${esc(s.name)}" rows="3" class="textarea" placeholder="When to activate this skill">${esc(s.description || '')}</textarea>
      </div>

      <div class="field">
        <label for="sp-${esc(s.name)}">SKILL.md path</label>
        <div style="display:flex;gap:6px">
          <input id="sp-${esc(s.name)}" value="${esc(s.path || '')}" class="input mono" style="flex:1;min-width:0;font-size:12px" placeholder="/path/to/SKILL.md">
          <button type="button" onclick="setDescPath('${q(s.name)}')" class="btn btn-primary btn-sm">Save</button>
        </div>
      </div>

      <div class="field">
        <label>Trigger keywords</label>
        <div class="kw-wrap custom-scroll" style="max-height:140px;overflow-y:auto">
          ${s.keywords.map(k => kwPill(k, `delSK('${q(s.name)}','${q(k)}')`)).join('') || '<span class="row-sub">No keywords configured</span>'}
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input id="sk-${esc(s.name)}" class="input" style="flex:1;min-width:0" placeholder="Add keyword and press Enter" onkeydown="if(event.key==='Enter')addSK('${q(s.name)}')">
          <button type="button" onclick="addSK('${q(s.name)}')" class="btn btn-sm">Add</button>
        </div>
      </div>
    </div>
  `;
}

async function addSkill() {
  const n = document.getElementById('ns')?.value.trim().toLowerCase();
  const path = (document.getElementById('nsp')?.value || '').trim();
  const description = (document.getElementById('nsdesc')?.value || '').trim();
  const kw = (document.getElementById('nskw')?.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!n) return toast('Skill name required', true);
  await api('/api/skills', 'POST', { name: n, path, description, keywords: kw });
  document.getElementById('dlgS')?.close();
  document.getElementById('ns').value = '';
  document.getElementById('nsp').value = '';
  document.getElementById('nsdesc').value = '';
  document.getElementById('nskw').value = '';
  selectedItem = { kind: 'skill', name: n };
  await reload();
  toast(`Saved skill ${n}`);
}

async function delS(n) {
  if (!confirm(`Delete skill "${n}"?`)) return;
  await api('/api/skills/' + encodeURIComponent(n), 'DELETE');
  if (selectedItem?.kind === 'skill' && selectedItem.name === n) selectedItem = null;
  await reload();
  toast(`Deleted skill ${n}`);
}

async function addSK(s) {
  const i = document.getElementById('sk-' + s);
  const kw = (i?.value || '').trim();
  if (!kw) return;
  await api(`/api/skills/${encodeURIComponent(s)}/keywords`, 'POST', { keyword: kw });
  await reload();
}

async function delSK(s, k) {
  await api(`/api/skills/${encodeURIComponent(s)}/keywords/${encodeURIComponent(k)}`, 'DELETE');
  await reload();
}

async function setDescPath(s) {
  const path = document.getElementById('sp-' + s)?.value.trim() || '';
  const description = document.getElementById('sd-' + s)?.value ?? '';
  await api('/api/skills/' + encodeURIComponent(s), 'PUT', { path, description });
  toast('Skill saved');
  await reload();
}
