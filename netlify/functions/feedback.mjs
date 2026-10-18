// GET  /.netlify/functions/feedback  -> { items, notes, changes }
// POST { type: 'feedback', screen, screenLabel, name, text }
// POST { type: 'auth' | 'note' | 'change' | 'deleteChange', ... }  (header x-admin-key must equal env ADMIN_KEY)
import { getStore } from '@netlify/blobs';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-admin-key', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim().slice(0, n);
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  const store = getStore({ name: 'plate-party-feedback', consistency: 'strong' });
  const read = async k => (await store.get(k, { type: 'json' })) || (k === 'notes' ? {} : []);

  if (req.method === 'GET') {
    const [items, notes, changes] = await Promise.all([read('items'), read('notes'), read('changes')]);
    return json({ items, notes, changes });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let b = {}; try { b = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const type = b.type || 'feedback';

  if (type === 'feedback') {
    const text = clean(b.text, 1000);
    if (!text) return json({ error: 'empty' }, 400);
    const item = { id: id(), screen: clean(b.screen, 40), screenLabel: clean(b.screenLabel, 60), name: clean(b.name, 40) || 'Anonymous', text, at: Date.now() };
    const items = await read('items'); items.push(item);
    await store.setJSON('items', items.slice(-2000));
    return json({ item });
  }

  const key = process.env.ADMIN_KEY;
  if (!key || req.headers.get('x-admin-key') !== key) return json({ error: 'unauthorized' }, 401);

  if (type === 'auth') return json({ ok: true });
  if (type === 'note') {
    const notes = await read('notes'), screen = clean(b.screen, 40);
    const text = clean(b.text, 3000);
    if (text) notes[screen] = text; else delete notes[screen];
    await store.setJSON('notes', notes);
    return json({ notes });
  }
  if (type === 'change') {
    const changes = await read('changes');
    const entry = { id: id(), version: clean(b.version, 20) || `v${changes.length + 1}`, items: (Array.isArray(b.items) ? b.items : []).map(x => clean(x, 300)).filter(Boolean).slice(0, 40), at: Date.now() };
    if (!entry.items.length) return json({ error: 'empty' }, 400);
    changes.push(entry);
    await store.setJSON('changes', changes);
    return json({ changes });
  }
  if (type === 'deleteFeedback') {
    const items = (await read('items')).filter(x => x.id !== b.id);
    await store.setJSON('items', items);
    return json({ items });
  }
  if (type === 'deleteChange') {
    const changes = (await read('changes')).filter(c => c.id !== b.id);
    await store.setJSON('changes', changes);
    return json({ changes });
  }
  return json({ error: 'type' }, 400);
};
