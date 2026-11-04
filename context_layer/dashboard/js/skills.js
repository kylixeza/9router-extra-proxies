'use strict';

function renderSkills(S) {
  const skillsEl = document.getElementById('skills');
  if (!skillsEl) return;
  skillsEl.innerHTML = S.length ? S.map(s => `
    <div class="card p-4 flex flex-col">
      <div class="flex items-start justify-between mb-2">
        <div class="flex items-center gap-2">
          <div>
            <div class="font-semibold text-sm leading-tight">${esc(s.name)}</div>
            <div class="text-xs num" style="color:var(--muted)">${s.keywords.length} keys</div>
          </div>
        </div>
        <button onclick="delS('${esc(s.name)}')" class="text-[12px] px-1" style="color:var(--muted)" title="Delete skill">del</button>
      </div>
      <div class="text-[12px] leading-snug mb-1" style="color:var(--muted)" title="${esc(s.description || '')}">${esc((s.description || '').slice(0, 160))}${(s.description || '').length > 160 ? '…' : ''}</div>
      <textarea id="sd-${esc(s.name)}" rows="2" placeholder="description" class="w-full px-2 py-1.5 rounded-md border hair text-[12px] resize-y" style="background:var(--raised)">${esc(s.description || '')}</textarea>
      <div class="flex gap-1.5 my-2">
        <input id="sp-${esc(s.name)}" value="${esc(s.path || '')}" placeholder="/path/SKILL.md" class="flex-1 h-8 px-2 rounded-md border hair text-[11px] font-mono" style="background:var(--raised)">
        <button onclick="setDescPath('${esc(s.name)}')" class="h-8 px-2 rounded-md border hair text-[12px] bg-white">Save</button>
      </div>
      <div class="flex flex-wrap gap-1 my-1 max-h-24 overflow-y-auto custom-scroll">
        ${s.keywords.map(k => kwPill(k, `delSK('${q(s.name)}','${q(k)}')`)).join('') || '<span class="text-[12px] italic" style="color:var(--muted)">no keywords</span>'}
      </div>
      <div class="flex gap-1.5 mt-2">
        <input id="sk-${esc(s.name)}" placeholder="add keyword ⏎" onkeydown="if(event.key==='Enter')addSK('${esc(s.name)}')" class="flex-1 h-8 px-2 rounded-md border hair text-xs" style="background:var(--raised)">
        <button onclick="addSK('${esc(s.name)}')" class="h-8 px-2.5 rounded-md border hair text-xs bg-white">Add</button>
      </div>
    </div>
  `).join('') : '<div class="col-span-full card p-10 text-center text-xs" style="color:var(--muted)">No skills match.</div>';
}

async function addSkill() {
  const n = document.getElementById('ns')?.value.trim().toLowerCase();
  const path = (document.getElementById('nsp')?.value || '').trim();
  const description = (document.getElementById('nsdesc')?.value || '').trim();
  const kw = (document.getElementById('nskw')?.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!n) return toast('name required', true);
  await api('/api/skills', 'POST', { name: n, path, description, keywords: kw });
  const dlg = document.getElementById('dlgS');
  if (dlg) dlg.close();
  reload();
}

async function delS(n) {
  if (!confirm(`delete skill ${n}?`)) return;
  await api('/api/skills/' + encodeURIComponent(n), 'DELETE');
  reload();
}

async function addSK(s) {
  const i = document.getElementById('sk-' + s);
  const kw = (i?.value || '').trim();
  if (!kw) return;
  await api(`/api/skills/${encodeURIComponent(s)}/keywords`, 'POST', { keyword: kw });
  reload();
}

async function delSK(s, k) {
  await api(`/api/skills/${encodeURIComponent(s)}/keywords/${encodeURIComponent(k)}`, 'DELETE');
  reload();
}

async function setPath(s) {
  const path = document.getElementById('sp-' + s)?.value.trim() || '';
  await api('/api/skills/' + encodeURIComponent(s), 'PUT', { path });
  toast('path saved');
}

async function setDescPath(s) {
  const path = document.getElementById('sp-' + s)?.value.trim() || '';
  const description = document.getElementById('sd-' + s)?.value ?? '';
  await api('/api/skills/' + encodeURIComponent(s), 'PUT', { path, description });
  toast('skill saved');
  reload();
}
