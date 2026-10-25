'use strict';

async function doMatch() {
  const t = document.getElementById('mtext')?.value.trim();
  if (!t) return toast('enter prompt first', true);
  try {
    const r = await api('/api/match', 'POST', { text: t });
    const box = document.getElementById('matchResBox');
    const res = document.getElementById('matchRes');
    if (box) box.classList.remove('hidden');
    if (res) {
      res.innerHTML = (r.providers || []).map(p =>
        `<span class="px-2 py-1 rounded-md text-[11px] font-medium bg-[#3B1C32] text-pink-100 shadow-sm">mcp:${esc(p)}</span>`
      ).join('') + (r.skills || []).map(s =>
        `<span class="px-2 py-1 rounded-md text-[11px] font-medium bg-[#FCE7F3] border border-pink-300 text-rose-900">skill:${esc(s)}</span>`
      ).join('') || '<span class="text-xs text-[#8E5A7A]">no match</span>';
    }
    toast(`matched ${r.providers?.length || 0} prov / ${r.skills?.length || 0} skill`);
  } catch (e) {
    toast(e.message, true);
  }
}

function clearMatch() {
  const mt = document.getElementById('mtext');
  if (mt) mt.value = '';
  const box = document.getElementById('matchResBox');
  if (box) box.classList.add('hidden');
}
