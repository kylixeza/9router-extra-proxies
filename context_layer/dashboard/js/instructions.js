'use strict';

// ponytail: header-tree editor. # = top accordion, deeper # nest. Mixed text/header children keep order.
function mdParse(text) {
  const root = { t: 'root', children: [] };
  const stack = [{ level: 0, node: root }];
  let curTxt = null;
  const lines = String(text || '').split('\n');
  const pushTxt = (parent, txt) => {
    if (!txt) return;
    const last = parent.children[parent.children.length - 1];
    if (last && last.t === 'x') last.text += txt;
    else parent.children.push({ t: 'x', text: txt });
  };
  for (const ln of lines) {
    const m = ln.match(/^(#{1,9})\s+(.*)$/);
    if (m) {
      curTxt = null;
      const level = m[1].length;
      const title = m[2].trim() || 'Untitled';
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const h = { t: 'h', level, title, children: [] };
      stack[stack.length - 1].node.children.push(h);
      stack.push({ level, node: h });
    } else {
      const top = stack[stack.length - 1].node;
      pushTxt(top, ln + '\n');
      curTxt = top;
    }
  }
  const trim = (a) => {
    for (const n of a) {
      if (n.t === 'x') n.text = n.text.replace(/^\n+|\s+$/g, '');
      else trim(n.children);
    }
  };
  trim(root.children);
  return root.children.filter(n => n.t === 'h' ? true : n.text.trim() !== '');
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(600, Math.max(56, ta.scrollHeight)) + 'px';
}

function accBadge(lv) {
  return '#'.repeat(Math.min(3, lv)) + (lv > 3 ? '·' + lv : '');
}

function mkBtn(t, fn, title) {
  const b = document.createElement('button');
  b.textContent = t;
  b.title = title || t;
  b.className = 'h-6 min-w-6 px-1 rounded-md border hair bg-white text-[11px] font-mono';
  b.style.color = 'var(--muted)';
  b.onclick = (e) => { e.preventDefault(); fn(); };
  return b;
}

function textNodeEl(text) {
  const w = document.createElement('div');
  w.dataset.ntype = 'x';
  w.className = 'rounded-lg border hair p-2';
  w.style.background = 'var(--raised)';
  const bar = document.createElement('div');
  bar.className = 'flex items-center gap-1 mb-1';
  const tag = document.createElement('span');
  tag.className = 'text-[10px] font-mono';
  tag.style.color = 'var(--muted)';
  tag.textContent = 'text';
  bar.appendChild(tag);
  bar.appendChild(Object.assign(document.createElement('span'), { className: 'flex-1' }));
  bar.appendChild(mkBtn('↑', () => { w.previousElementSibling ? w.parentNode.insertBefore(w, w.previousElementSibling) : 0; }, 'move up'));
  bar.appendChild(mkBtn('↓', () => { w.nextElementSibling ? w.parentNode.insertBefore(w.nextElementSibling, w) : 0; }, 'move down'));
  bar.appendChild(mkBtn('×', () => w.remove(), 'delete'));
  w.appendChild(bar);
  const ta = document.createElement('textarea');
  ta.dataset.body = '1';
  ta.value = text || '';
  ta.rows = 2;
  ta.className = 'w-full px-2 py-1.5 rounded-md bg-white border hair text-xs font-mono resize-y';
  ta.oninput = () => autoGrow(ta);
  w.appendChild(ta);
  requestAnimationFrame(() => autoGrow(ta));
  return w;
}

function titleFont(lv) {
  return [(lv <= 1 ? '16px' : lv === 2 ? '14px' : lv === 3 ? '13px' : '12px'), lv <= 2 ? '700' : '600'];
}

function headerNodeEl(level, title) {
  level = Math.min(9, Math.max(1, level || 1));
  const w = document.createElement('div');
  w.dataset.ntype = 'h';
  w.dataset.level = level;
  w.className = 'rounded-lg border hair bg-white overflow-hidden';
  const hd = document.createElement('div');
  hd.className = 'flex items-center gap-1.5 px-2.5 py-2 border-b hair';
  hd.style.background = 'var(--raised)';
  const tg = mkBtn('▾', () => {
    const b = w.querySelector('[data-kids]');
    const hid = b.classList.toggle('hidden');
    tg.textContent = hid ? '▸' : '▾';
  }, 'collapse');
  hd.appendChild(tg);
  const badge = document.createElement('span');
  badge.dataset.badge = '1';
  badge.className = 'px-1.5 py-0.5 rounded text-white text-[10px] font-mono whitespace-nowrap font-bold';
  badge.style.background = 'var(--text)';
  badge.textContent = accBadge(level);
  hd.appendChild(badge);
  const inp = document.createElement('input');
  inp.dataset.title = '1';
  inp.value = title || 'Untitled';
  inp.className = 'flex-1 h-7 px-2 rounded-md bg-white border hair';
  const _tf0 = titleFont(level);
  inp.style.fontSize = _tf0[0];
  inp.style.fontWeight = _tf0[1];
  inp.onkeydown = (e) => e.stopPropagation();
  hd.appendChild(inp);
  hd.appendChild(mkBtn('−#', () => {
    const l = Math.max(1, (+w.dataset.level || 1) - 1);
    w.dataset.level = l;
    badge.textContent = accBadge(l);
    const _t = titleFont(l);
    inp.style.fontSize = _t[0];
    inp.style.fontWeight = _t[1];
  }, 'demote (fewer #)'));
  hd.appendChild(mkBtn('+#', () => {
    const l = Math.min(9, (+w.dataset.level || 1) + 1);
    w.dataset.level = l;
    badge.textContent = accBadge(l);
    const _t2 = titleFont(l);
    inp.style.fontSize = _t2[0];
    inp.style.fontWeight = _t2[1];
  }, 'promote (more #)'));
  hd.appendChild(mkBtn('↑', () => { w.previousElementSibling ? w.parentNode.insertBefore(w, w.previousElementSibling) : 0; }, 'move up'));
  hd.appendChild(mkBtn('↓', () => { w.nextElementSibling ? w.parentNode.insertBefore(w.nextElementSibling, w) : 0; }, 'move down'));
  hd.appendChild(mkBtn('×', () => { if (confirm('Delete section "' + inp.value.slice(0, 40) + '"?')) w.remove(); }, 'delete section'));
  w.appendChild(hd);

  const kids = document.createElement('div');
  kids.dataset.kids = '1';
  kids.className = 'p-2 flex flex-col gap-2';
  w.appendChild(kids);

  const bar = document.createElement('div');
  bar.className = 'flex items-center gap-1.5 px-2.5 pt-2 pb-2.5';
  const addH = mkBtn('+ Header', () => {
    kids.appendChild(headerNodeEl((+w.dataset.level || 1) + 1, 'New section'));
    kids.lastChild.scrollIntoView({ block: 'nearest' });
  });
  addH.className = 'h-7 px-2.5 rounded-md border hair bg-white text-[11px] font-medium';
  const addT = mkBtn('+ Text', () => {
    kids.appendChild(textNodeEl(''));
    kids.lastChild.scrollIntoView({ block: 'nearest' });
  });
  addT.className = 'h-7 px-2.5 rounded-md border hair bg-white text-[11px] font-medium';
  bar.appendChild(addH);
  bar.appendChild(addT);
  w.appendChild(bar);
  return w;
}

function buildNode(n) {
  if (n.t === 'x') return textNodeEl(n.text || '');
  const e = headerNodeEl(n.level || 1, n.title || 'Untitled');
  const kids = e.querySelector('[data-kids]');
  for (const c of (n.children || [])) kids.appendChild(buildNode(c));
  return e;
}

function renderInstrAcc(md) {
  const box = document.getElementById('instrAcc');
  if (!box) return;
  box.innerHTML = '';
  for (const n of mdParse(md)) box.appendChild(buildNode(n));
  if (!box.children.length) box.appendChild(headerNodeEl(1, 'Role & Persona'));
}

function serKids(box) {
  let out = '';
  for (const w of box.children) {
    if (w.dataset.ntype === 'x') {
      const t = w.querySelector('[data-body]').value.replace(/\s+$/, '');
      if (t.trim()) out += t + '\n\n';
    } else if (w.dataset.ntype === 'h') {
      const lv = +w.dataset.level || 1;
      const ti = (w.querySelector('[data-title]').value || 'Untitled').trim();
      out += '#'.repeat(lv) + ' ' + ti + '\n\n';
      out += serKids(w.querySelector('[data-kids]'));
    }
  }
  return out;
}

function instrMarkdown() {
  const box = document.getElementById('instrAcc');
  return box ? serKids(box).replace(/\s+$/, '') + '\n' : '';
}

function addRootHeader() {
  document.getElementById('instrAcc')?.appendChild(headerNodeEl(1, 'New section'));
}

function addRootText() {
  document.getElementById('instrAcc')?.appendChild(textNodeEl(''));
}

async function loadInstr() {
  try {
    const r = await api('/api/instructions');
    renderInstrAcc(r.content || '');
    const n = (r.content || '').length;
    const metaEl = document.getElementById('instrMeta');
    if (metaEl) {
      metaEl.textContent = (r.active ? 'active' : 'empty (fallback)') +
        ` · ${n} chars` + (r.hasTemplate ? ` · template ${r.templateLen || 0}c` : '');
    }
  } catch (e) {
    toast(e.message, true);
  }
}

async function saveInstr() {
  const c = instrMarkdown();
  try {
    const r = await api('/api/instructions', 'POST', { content: c });
    const metaEl = document.getElementById('instrMeta');
    if (metaEl) {
      metaEl.textContent = (r.active ? 'active' : 'empty · fallback incoming') +
        ` · ${(r.content || '').length} chars` + (r.updatedAt ? ` · ${r.updatedAt}` : '');
    }
    toast('instruction saved');
  } catch (e) {
    toast(e.message, true);
  }
}

async function clearInstr() {
  if (!confirm('Clear DB instruction? Requests fall back to incoming.')) return;
  renderInstrAcc('');
  await saveInstr();
}

async function genInstr() {
  try {
    const r = await api('/api/instructions/generate', 'POST', {});
    renderInstrAcc(r.content || '');
    toast('generated from template — edit + Save');
  } catch (e) {
    toast(e.message + ' (run #9r-sync first)', true);
  }
}

async function previewTpl() {
  try {
    const r = await api('/api/instructions/template');
    const box = document.getElementById('tplBox');
    const pre = document.getElementById('tplPre');
    if (box) box.classList.remove('hidden');
    if (pre) pre.textContent = (r.content || '(no template — run #9r-sync)').slice(0, 4000);
  } catch (e) {
    toast(e.message, true);
  }
}

// ponytail: dep-free markdown->HTML. Handles headers, bold/italic/code, lists,
// fenced code, blockquotes, hr, paragraphs. esc() first so input is safe.
function mdInline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function mdRender(md) {
  const lines = String(md || '').split('\n');
  let html = '';
  let i = 0;
  let listType = null; // 'ul' | 'ol'
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  while (i < lines.length) {
    const ln = lines[i];
    // fenced code block
    const fence = ln.match(/^```(.*)$/);
    if (fence) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // consume closing fence
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    // header
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = h[1].length;
      html += `<h${lv}>${mdInline(h[2].trim())}</h${lv}>`;
      i++;
      continue;
    }
    // horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(ln)) {
      closeList();
      html += '<hr>';
      i++;
      continue;
    }
    // blockquote
    if (/^>\s?/.test(ln)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += `<blockquote>${mdInline(buf.join(' '))}</blockquote>`;
      continue;
    }
    // unordered list
    const ul = ln.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${mdInline(ul[1])}</li>`;
      i++;
      continue;
    }
    // ordered list
    const ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${mdInline(ol[1])}</li>`;
      i++;
      continue;
    }
    // blank line
    if (!ln.trim()) { closeList(); i++; continue; }
    // paragraph (join consecutive non-blank, non-structural lines)
    closeList();
    const buf = [ln];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i]) &&
           !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+[.)]\s/.test(lines[i]) &&
           !/^>\s?/.test(lines[i]) && !/^(\s*[-*_]){3,}\s*$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    html += `<p>${mdInline(buf.join(' '))}</p>`;
  }
  closeList();
  return html;
}

async function loadPreview() {
  const box = document.getElementById('previewBox');
  const metaEl = document.getElementById('previewMeta');
  try {
    const r = await api('/api/instructions');
    const md = r.content || '';
    if (box) {
      box.innerHTML = md.trim()
        ? mdRender(md)
        : '<p class="text-[#8E5A7A] italic">No active instruction — requests fall back to incoming. Run #9r-sync or Generate on the Instructions tab.</p>';
    }
    if (metaEl) {
      metaEl.textContent = (r.active ? 'active' : 'empty') +
        ` · ${md.length} chars` + (r.updatedAt ? ` · ${r.updatedAt}` : '');
    }
  } catch (e) {
    toast(e.message, true);
  }
}

async function downloadInstr() {
  try {
    const r = await api('/api/instructions');
    const md = r.content || '';
    if (!md.trim()) { toast('no active instruction to download', true); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `instructions-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('downloaded ' + a.download);
  } catch (e) {
    toast(e.message, true);
  }
}
