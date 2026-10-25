'use strict';

function renderModels() {
  const modelsTbody = document.getElementById('models');
  if (!modelsTbody) return;
  const list = (S && S.models) || [];
  if (!list.length) {
    modelsTbody.innerHTML = '<tr><td colspan="5" class="py-4 text-[#856E52] text-center">no model stats yet</td></tr>';
    return;
  }
  modelsTbody.innerHTML = list.map(m => `
    <tr class="border-b hair last:border-0 hover:bg-[#F3ECE0]">
      <td class="py-2 pr-3 truncate max-w-[260px] font-semibold text-[#2A1A08]">${esc(m.name)}</td>
      <td class="py-2 pr-3 text-right font-mono text-[#451A03]">${num(m.requests)}</td>
      <td class="py-2 pr-3 text-right font-mono text-[#856E52]">${num(m.promptTokens)}</td>
      <td class="py-2 pr-3 text-right font-mono text-[#856E52]">${num(m.completionTokens)}</td>
      <td class="py-2 text-right font-mono text-[#2A1A08]">${num(m.avgMs)}</td>
    </tr>
  `).join('');
}
