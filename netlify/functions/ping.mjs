// App 開啟時回報使用狀況（只有統計數字，不含餐點內容或體重）
import { getStore } from '@netlify/blobs';
import { verifyUser } from '../lib/auth.mjs';
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const n = v => (isFinite(+v) ? +v : 0);

export default async (req) => {
  if (req.method !== 'POST') return j({ error: '只接受 POST' }, 405);
  const u = await verifyUser(req);
  if (!u) return j({ error: '請先登入' }, 401);
  let b = {}; try { b = await req.json(); } catch { }
  const st = b.stats || {};
  const store = getStore({ name: 'users', consistency: 'strong' });
  const old = (await store.get(u.uid, { type: 'json' })) || {};
  await store.setJSON(u.uid, {
    uid: u.uid, email: u.email, name: String(b.name || u.name || '').slice(0, 40),
    firstSeen: old.firstSeen || Date.now(), lastSeen: Date.now(),
    stats: {
      days7: n(st.days7), meals7: n(st.meals7), lastMeal: String(st.lastMeal || '').slice(0, 10),
      water7: n(st.water7), body: n(st.body), comp: !!st.comp, health: !!st.health, photo: !!st.photo,
    },
  });
  return j({ ok: true });
};
export const config = { path: '/api/ping' };
