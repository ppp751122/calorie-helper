// 管理者後台資料：使用者狀況、AI 用量與花費
import { getStore } from '@netlify/blobs';
import { verifyUser, isOwnerUser, twMonth } from '../lib/auth.mjs';
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function all(store, prefix) {
  const { blobs } = await store.list(prefix ? { prefix } : undefined);
  const out = [];
  for (const b of blobs) { const v = await store.get(b.key, { type: 'json' }); if (v) out.push([b.key, v]); }
  return out;
}

export default async (req) => {
  const u = await verifyUser(req);
  if (!u) return j({ error: '請先登入' }, 401);
  if (!(await isOwnerUser(u, req))) return j({ error: '只有管理者可以看後台' }, 403);
  const m = twMonth();
  const d = new Date(Date.now() + 8 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  const users = (await all(getStore({ name: 'users', consistency: 'strong' }))).map(([, v]) => v);
  const ust = getStore({ name: 'usage', consistency: 'strong' });
  const usage = {};
  for (const mm of [m, prev]) usage[mm] = Object.fromEntries((await all(ust, mm + '/')).map(([k, v]) => [k.slice(8), v]));
  return j({ month: m, prev, users, usage });
};
export const config = { path: '/api/admin' };
