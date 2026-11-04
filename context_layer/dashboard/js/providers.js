'use strict';

function renderProviders(P) {
  const provsEl = document.getElementById('provs');
  if (!provsEl) return;
  provsEl.innerHTML = P.length ? P.map(p => `
    <div class="card p-4 flex flex-col">
      <div class="flex items-start justify-between mb-2">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-semibold uppercase" style="background:var(--pill-neutral-bg);border:1px solid var(--border)">${esc(p.name.slice(0, 2))}</div>
          <div>
            <div class="font-semibold text-[13px] leading-tight">${esc(p.name)}</div>
            <div class="text-[12px] num" style="color:var(--muted)">${p.tools} tools · ${p.keywords.length} keys</div>
          </div>
        </div>
        <button onclick="delP('${esc(p.name)}')" class="text-[12px] px-1" style="color:var(--muted)" title="Delete provider">del</button>
      </div>
      <div class="flex flex-wrap gap-1 my-2 max-h-24 overflow-y-auto custom-scroll">
        ${p.keywords.map(k => kwPill(k, `delPK('${q(p.name)}','${q(k)}')`)).join('') || '<span class="text-[12px] italic" style="color:var(--muted)">no keywords</span>'}
      </div>
      <div class="flex gap-1.5 mt-1">
        <input id="pk-${esc(p.name)}" placeholder="add keyword ⏎" onkeydown="if(event.key==='Enter')addPK('${esc(p.name)}')" class="flex-1 h-8 px-2 rounded-md border hair text-xs" style="background:var(--raised)">
        <button onclick="addPK('${esc(p.name)}')" class="h-8 px-2.5 rounded-md border hair text-xs bg-white">Add</button>
      </div>
      <details class="mt-2 pt-2 border-t hair">
        <summary class="text-[12px] cursor-pointer" style="color:var(--muted)">tools (${p.tools}) +</summary>
        <div class="mt-1 max-h-40 overflow-y-auto custom-scroll">
          ${p.toolNames.map(t => `
            <div class="flex items-center justify-between py-1 text-[12px] font-mono border-b hair last:border-0">
              <span class="truncate">${esc(t)}</span>
              <span class="flex gap-1">
                <button onclick="moveTool('${q(t)}')" style="color:var(--muted)" title="Move tool">⇄</button>
                <button onclick="delTool('${q(t)}')" style="color:var(--muted)" title="Delete tool">×</button>
              </span>
            </div>
          `).join('')}
        </div>
      </details>
    </div>
  `).join('') : '<div class="col-span-full card p-10 text-center text-xs" style="color:var(--muted)">No providers match.</div>';
}

async function addProvider() {
  const n = document.getElementById('np')?.value.trim().toLowerCase();
  const kw = (document.getElementById('npkw')?.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!n) return toast('name required', true);
  await api('/api/providers', 'POST', { name: n, keywords: kw });
  const dlg = document.getElementById('dlgP');
  if (dlg) dlg.close();
  reload();
}

async function delP(n) {
  if (!confirm(`delete provider ${n}?`)) return;
  await api('/api/providers/' + encodeURIComponent(n), 'DELETE');
  reload();
}

async function addPK(p) {
  const i = document.getElementById('pk-' + p);
  const kw = (i?.value || '').trim();
  if (!kw) return;
  await api(`/api/providers/${encodeURIComponent(p)}/keywords`, 'POST', { keyword: kw });
  reload();
}

async function delPK(p, k) {
  await api(`/api/providers/${encodeURIComponent(p)}/keywords/${encodeURIComponent(k)}`, 'DELETE');
  reload();
}

async function delTool(t) {
  if (!confirm(`delete tool ${t}?`)) return;
  await api('/api/tools/' + encodeURIComponent(t), 'DELETE');
  reload();
}

async function moveTool(t) {
  const to = prompt(`move tool ${t} to which provider?`, D.providers[0]?.name || '');
  if (!to) return;
  await api('/api/tools/move', 'POST', { tool: t, to: to.trim().toLowerCase() });
  reload();
}
