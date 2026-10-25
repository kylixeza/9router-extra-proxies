'use strict';
// Project detection priority: explicit header > body field > ide-context Name: > Active document path > null.
// ponytail: heuristic only; add per-client mapping when new IDE shapes appear.
const GENERIC_DIRS = new Set(['lib', 'src', 'app', 'android', 'ios']);

function collectStrings(v, out, cap) {
  if (out.chars >= cap) return;
  if (typeof v === 'string') {
    out.arr.push(v);
    out.chars += v.length;
    return;
  }
  if (Array.isArray(v)) {
    for (const el of v) {
      collectStrings(el, out, cap);
      if (out.chars >= cap) return;
    }
    return;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      collectStrings(v[k], out, cap);
      if (out.chars >= cap) return;
    }
  }
}

function fromActiveDocument(path) {
  if (!path) return null;
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length) return null;
  // IDE artifact/cache paths: .../projects/<name>.<hash>/.artifacts/... -> <name>
  const pi = parts.findIndex(p => p === 'projects');
  if (pi >= 0 && parts[pi + 1]) return parts[pi + 1].split('.')[0].slice(0, 200) || null;
  const visible = parts.filter(p => !p.startsWith('.'));
  const segs = visible.length ? visible : parts;
  const last = segs[segs.length - 1];
  if (!last.includes('.')) return last.slice(0, 200); // directory path -> project dir
  const idx = segs.findIndex(p => GENERIC_DIRS.has(p));
  if (idx > 0) return segs[idx - 1];
  if (segs.length >= 2) return segs[segs.length - 2];
  return null;
}

function extractProjectName(headers, body) {
  const h = headers || {};
  for (const k of ['x-project-name', 'x-project', 'x-project-id']) {
    if (h[k]) return String(h[k]).slice(0, 200);
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const direct = body.project_name || body.project || body.projectName
      || (body.metadata && (body.metadata.project || body.metadata.project_name));
    if (direct) return String(direct).slice(0, 200);
  }
  const out = { arr: [], chars: 0 };
  collectStrings(body, out, 40000);
  const text = out.arr.join('\n');
  if (!text) return null;
  const nameMatch = text.match(/Name:\s*([A-Za-z0-9_.\-]+)/);
  if (nameMatch) return nameMatch[1].slice(0, 200);
  const docMatch = text.match(/Active document:\s*([^\r\n]+)/);
  if (docMatch) return fromActiveDocument(docMatch[1].trim());
  return null;
}

module.exports = { extractProjectName, fromActiveDocument };
