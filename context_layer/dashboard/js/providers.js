'use strict';

function filteredProviders() {
  const f = (document.getElementById('q')?.value || '').toLowerCase().trim();
  return (D.providers || []).filter(p =>
    !f ||
    p.name.toLowerCase().includes(f) ||
    p.keywords.some(k => k.toLowerCase().includes(f)) ||
    p.toolNames.some(t => t.toLowerCase().includes(f))
  );
}

function renderProviderTable(targetBody, list, { cap = null } = {}) {
  if (!targetBody) return;
  const rows = cap ? list.slice(0, cap) : list;
  if (!rows.length) {
    targetBody.innerHTML = `<tr><td colspan="4"><div class="empty-box">No MCP tool providers match this filter.</div></td></tr>`;
    return;
  }
  targetBody.innerHTML = rows.map(p => {
    const isMatched = matchedState && matchedState.providers.has(p.name);
    const isSelected = selectedItem && selectedItem.kind === 'provider' && selectedItem.name === p.name;
    const kwPreview = p.keywords.slice(0, 4).map(esc).join(', ') + (p.keywords.length > 4 ? ` +${p.keywords.length - 4}` : '');
    return `
      <tr class="${isMatched ? 'is-matched' : ''}${isSelected ? ' is-selected' : ''}">
        <td>
          <div class="row-title">
            <button type="button" class="row-link" onclick="inspectRule('provider','${q(p.name)}')">${esc(p.name)}</button>
            ${isMatched ? '<span class="pill accent">matched</span>' : ''}
          </div>
          <div class="row-sub">${kwPreview || 'No trigger keywords'}</div>
        </td>
        <td class="n num">${p.tools}</td>
        <td class="n num">${p.keywords.length}</td>
        <td class="n">
          <button type="button" class="btn-text btn-sm" onclick="inspectRule('provider','${q(p.name)}')">Inspect</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProviderDetail(p) {
  if (!p) return '<div class="empty-box">Provider not found.</div>';
  return `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <h3 style="margin:0;font-size:16px;font-weight:600">${esc(p.name)}</h3>
          <div class="row-sub num">${p.tools} gated tools · ${p.keywords.length} trigger keywords</div>
        </div>
        <button type="button" onclick="delP('${q(p.name)}')" class="btn btn-sm btn-danger">Delete</button>
      </div>

      <div class="field">
        <label>Trigger keywords</label>
        <div class="kw-wrap custom-scroll" style="max-height:132px;overflow-y:auto">
          ${p.keywords.map(k => kwPill(k, `delPK('${q(p.name)}','${q(k)}')`)).join('') || '<span class="row-sub">No keywords configured</span>'}
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input id="pk-${esc(p.name)}" class="input" style="flex:1;min-width:0" placeholder="Add keyword and press Enter" onkeydown="if(event.key==='Enter')addPK('${q(p.name)}')">
          <button type="button" onclick="addPK('${q(p.name)}')" class="btn btn-sm">Add</button>
        </div>
      </div>

      <div class="field">
        <label>Gated tools (<span class="num">${p.tools}</span>)</label>
        <div class="custom-scroll" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
          ${p.toolNames.length ? p.toolNames.map(t => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:1px solid var(--rule);font-size:12px">
              <span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t)}">${esc(t)}</span>
              <span style="display:flex;gap:6px;flex-shrink:0">
                <button type="button" onclick="moveTool('${q(t)}')" class="btn-text btn-sm" style="height:22px;padding:0 6px" title="Move to another provider">Move</button>
                <button type="button" onclick="delTool('${q(t)}')" class="btn-text btn-sm btn-danger" style="height:22px;padding:0 6px" title="Delete tool">Remove</button>
              </span>
            </div>
          `).join('') : '<div class="empty-box" style="border:0">No tools recorded for this provider.</div>'}
        </div>
      </div>
    </div>
  `;
}

async function addProvider() {
  const n = document.getElementById('np')?.value.trim().toLowerCase();
  const kw = (document.getElementById('npkw')?.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!n) return toast('Provider name required', true);
  await api('/api/providers', 'POST', { name: n, keywords: kw });
  document.getElementById('dlgP')?.close();
  document.getElementById('np').value = '';
  document.getElementById('npkw').value = '';
  selectedItem = { kind: 'provider', name: n };
  await reload();
  toast(`Created provider ${n}`);
}

async function delP(n) {
  if (!confirm(`Delete provider "${n}"?`)) return;
  await api('/api/providers/' + encodeURIComponent(n), 'DELETE');
  if (selectedItem?.kind === 'provider' && selectedItem.name === n) selectedItem = null;
  await reload();
  toast(`Deleted provider ${n}`);
}

async function addPK(p) {
  const i = document.getElementById('pk-' + p);
  const kw = (i?.value || '').trim();
  if (!kw) return;
  await api(`/api/providers/${encodeURIComponent(p)}/keywords`, 'POST', { keyword: kw });
  await reload();
}

async function delPK(p, k) {
  await api(`/api/providers/${encodeURIComponent(p)}/keywords/${encodeURIComponent(k)}`, 'DELETE');
  await reload();
}

async function delTool(t) {
  if (!confirm(`Remove tool "${t}"?`)) return;
  await api('/api/tools/' + encodeURIComponent(t), 'DELETE');
  await reload();
}

async function moveTool(t) {
  const to = prompt(`Move tool "${t}" to which provider?`, D.providers[0]?.name || '');
  if (!to) return;
  await api('/api/tools/move', 'POST', { tool: t, to: to.trim().toLowerCase() });
  await reload();
}
