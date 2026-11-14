'use strict';

function renderModels() {
  const modelsTbody = document.getElementById('models');
  const mobileEl = document.getElementById('modelsMobile');
  const list = (S && S.models) || [];
  const rows = list.slice(0, 6);

  if (modelsTbody) {
    if (!rows.length) {
      modelsTbody.innerHTML = '<tr><td colspan="4" style="padding:20px 0;text-align:center;color:var(--muted)">No model traffic recorded yet.</td></tr>';
    } else {
      modelsTbody.innerHTML = rows.map(m => {
        const totTok = (Number(m.promptTokens) || 0) + (Number(m.completionTokens) || 0);
        return `<tr>
          <td class="cell-trunc" style="max-width:170px;font-weight:500" title="${esc(m.name)}">${esc(m.name)}</td>
          <td class="num">${num(m.requests)}</td>
          <td class="num" style="color:var(--muted)">${fmtTok(totTok)}</td>
          <td class="num">${num(m.avgMs)} <span class="cell-muted">ms</span></td>
        </tr>`;
      }).join('');
    }
  }

  if (mobileEl) {
    if (!rows.length) {
      mobileEl.innerHTML = '<div class="empty-box">No model traffic recorded yet.</div>';
    } else {
      mobileEl.innerHTML = rows.map(m => {
        const totTok = (Number(m.promptTokens) || 0) + (Number(m.completionTokens) || 0);
        return `<div class="m-row" style="cursor:default">
          <div class="m-main">
            <div class="m-title">${esc(m.name)}</div>
            <div class="m-sub num">${num(m.requests)} req · ${fmtTok(totTok)} tok</div>
          </div>
          <div class="m-right num"><strong>${num(m.avgMs)}</strong> <span class="cell-muted">ms</span></div>
        </div>`;
      }).join('');
    }
  }
}
