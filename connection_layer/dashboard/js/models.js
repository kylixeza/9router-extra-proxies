'use strict';

function renderModels() {
  const modelsTbody = document.getElementById('models');
  if (!modelsTbody) return;
  const list = (S && S.models) || [];
  if (!list.length) {
    modelsTbody.innerHTML = '<tr><td colspan="4" class="py-4 text-center" style="color:var(--muted)">No model traffic recorded yet.</td></tr>';
    return;
  }
  modelsTbody.innerHTML = list.slice(0, 6).map(m => {
    const totTok = (Number(m.promptTokens) || 0) + (Number(m.completionTokens) || 0);
    return `<tr>
      <td class="py-1.5 pr-2 truncate max-w-[180px] font-medium" title="${esc(m.name)}">${esc(m.name)}</td>
      <td class="py-1.5 pr-2 num">${num(m.requests)}</td>
      <td class="py-1.5 pr-2 num" style="color:var(--muted)">${fmtTok(totTok)}</td>
      <td class="py-1.5 num">${num(m.avgMs)} <span class="text-xs" style="color:var(--muted)">ms</span></td>
    </tr>`;
  }).join('');
}
