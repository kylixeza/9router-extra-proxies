'use strict';

function clog(m, isErr = false) {
  const b = document.getElementById('cmdOut');
  if (!b) return;
  const d = document.createElement('div');
  d.className = isErr ? 'text-rose-600 font-semibold' : 'text-[#3B1C32]';
  d.textContent = m;
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}

function clearCmd() {
  const b = document.getElementById('cmdOut');
  if (b) b.innerHTML = '';
}

async function runCmd() {
  const el = document.getElementById('cmd');
  if (!el) return;
  const raw = el.value.trim();
  if (!raw) return;
  el.value = '';
  clog('› ' + raw);
  const low = raw.toLowerCase();

  try {
    if (low === 'help' || low === '?') {
      clog('add skill NAME [path=PATH] [kw=a,b] · add provider NAME [kw=a,b] · del skill|provider NAME · ask|match TEXT');
      return;
    }
    if (low === 'clear') {
      clearCmd();
      return;
    }
    if (low.startsWith('key ')) {
      localStorage.setItem('9r-key', raw.slice(4).trim());
      clog('ok: key saved local only');
      return;
    }
    let m;
    if ((m = raw.match(/^ai\s+([\s\S]+)$/i))) {
      const prompt = m[1];
      if (!localStorage.getItem('9r-key')) {
        clog('err: no key — run: key $KEY first', true);
        return;
      }
      clog('…asking');
      try {
        const r = await api('/api/ask', 'POST', { input: prompt });
        let out = r.output_text || '';
        if (!out && Array.isArray(r.output)) {
          out = r.output.map(o => (o.content || []).map(c => c.text || '').join('')).join('\n');
        }
        clog(String(out || JSON.stringify(r).slice(0, 2000)).slice(0, 4000));
      } catch (e) {
        clog('err: ' + e.message, true);
      }
      return;
    }
    if ((m = raw.match(/^add\s+skill\s+(\S+)\s*(.*)$/i))) {
      const name = m[1].toLowerCase();
      const rest = m[2] || '';
      const pm = rest.match(/path=(\S+)/i);
      const km = rest.match(/(?:kw|keywords?)=(.*)/i);
      const path = pm ? pm[1].trim() : '';
      let kw = [];
      if (km) {
        kw = km[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else {
        const lo = rest.replace(/path=\S+/gi, '').trim();
        if (lo) kw = lo.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      }
      await api('/api/skills', 'POST', { name, path, keywords: kw });
      clog(`ok: skill ${name} +${kw.length} kw`);
      reload();
      return;
    }
    if ((m = raw.match(/^add\s+provider\s+(\S+)\s*(.*)$/i))) {
      const name = m[1].toLowerCase();
      const rest = m[2] || '';
      const km = rest.match(/(?:kw|keywords?)=(.*)/i);
      let kw = [];
      if (km) {
        kw = km[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (rest.trim()) {
        kw = rest.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      }
      await api('/api/providers', 'POST', { name, keywords: kw });
      clog(`ok: provider ${name} +${kw.length} kw`);
      reload();
      return;
    }
    if ((m = raw.match(/^(?:del|rm|delete)\s+(skill|provider)\s+(\S+)\s*$/i))) {
      const kind = m[1].toLowerCase();
      const name = m[2];
      await api(`/${'api'}/${kind}s/${encodeURIComponent(name)}`, 'DELETE');
      clog(`ok: deleted ${kind} ${name}`);
      reload();
      return;
    }
    const text = raw.replace(/^(ask|match|ai)\s+/i, '');
    const r = await api('/api/match', 'POST', { text });
    clog(`match → mcp:[${(r.providers || []).join(', ') || '-'}] skills:[${(r.skills || []).join(', ') || '-'}]`);
    const mt = document.getElementById('mtext');
    if (mt) mt.value = text;
  } catch (e) {
    clog('err: ' + e.message, true);
  }
}
