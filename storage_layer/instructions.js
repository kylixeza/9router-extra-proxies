'use strict';
// ponytail: instructions table holds two rows: id='active' (hot path) + id='template' (seeded from #9r-sync incoming).
const ACTIVE_ID = 'active';
const TEMPLATE_ID = 'template';

let cached = null;
let updatedAt = null;
let loaded = false;
let cachedTemplate = null;
let templateUpdatedAt = null;

function store() { try { return require('./store'); } catch (_) { return null; } }

async function ensureTable() {
  const s = store();
  if (!s || !s.isEnabled()) return;
  await s.query(`CREATE TABLE IF NOT EXISTS instructions (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

async function refreshFromDb() {
  const s = store();
  if (!s || !s.isEnabled()) return null;
  try {
    await ensureTable();
    const r = await s.query(`SELECT id, content, updated_at FROM instructions WHERE id IN ('active','template')`);
    if (r) for (const row of r.rows) {
      if (row.id === ACTIVE_ID) { cached = String(row.content || ''); updatedAt = row.updated_at || null; }
      if (row.id === TEMPLATE_ID) { cachedTemplate = String(row.content || ''); templateUpdatedAt = row.updated_at || null; }
    }
    loaded = true;
    return cached;
  } catch (e) { console.error('[instructions] load failed:', e.message); return null; }
}

function getActive() {
  if (!cached || !String(cached).trim()) return null;
  return cached;
}

function getMeta() {
  return { content: cached, updatedAt, loaded, active: !!getActive() };
}

function getTemplate() {
  if (!cachedTemplate || !String(cachedTemplate).trim()) return null;
  return cachedTemplate;
}

function getTemplateMeta() {
  return { content: cachedTemplate, updatedAt: templateUpdatedAt, loaded, active: !!getActive(), hasTemplate: !!getTemplate() };
}

async function saveRow(id, content) {
  content = String(content || '');
  const s = store();
  if (s && s.isEnabled()) {
    try {
      await ensureTable();
      await s.query(`INSERT INTO instructions (id, content, updated_at) VALUES ($1,$2,now())
        ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, updated_at=now()`, [id, content]);
      const r = await s.query(`SELECT updated_at FROM instructions WHERE id=$1`, [id]);
      return r && r.rows.length ? r.rows[0].updated_at : new Date().toISOString();
    } catch (e) { console.error('[instructions] save failed:', e.message); return new Date().toISOString(); }
  }
  return new Date().toISOString();
}

async function saveActive(content) {
  content = String(content || '');
  cached = content;
  updatedAt = await saveRow(ACTIVE_ID, content);
  loaded = true;
  return getMeta();
}

async function saveTemplate(content) {
  content = String(content || '');
  if (!content.trim()) return getTemplateMeta();
  cachedTemplate = content;
  templateUpdatedAt = await saveRow(TEMPLATE_ID, content);
  loaded = true;
  return getTemplateMeta();
}

// generate active from template for editing
async function generateFromTemplate() {
  const t = getTemplate();
  if (!t) return getMeta();
  return saveActive(t);
}

// fire-and-forget warm cache on require
refreshFromDb();

module.exports = { getActive, getMeta, saveActive, refreshFromDb, getTemplate, getTemplateMeta, saveTemplate, generateFromTemplate, ACTIVE_ID, TEMPLATE_ID };
