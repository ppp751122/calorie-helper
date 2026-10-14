// Apple 健康自動同步：iPhone「捷徑」每天自動把活動能量、體重送到這裡，App 打開時再取回
// POST /api/health  { token, burn, weight, date? }   （數字可以帶單位，例如 "523 kcal"）
// GET  /api/health?token=...&since=YYYY-MM-DD
import { getStore } from '@netlify/blobs';

const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const okToken = t => /^[a-z0-9]{24,64}$/.test(t || '');
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };
const twDate = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export default async (req) => {
  const store = getStore('health');
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const token = url.searchParams.get('token');
    if (!okToken(token)) return j({ error: 'token 不對' }, 400);
    const since = url.searchParams.get('since') || '0000';
    const { blobs } = await store.list({ prefix: token + '/' });
    const keys = blobs.map(b => b.key).filter(k => k.slice(token.length + 1) >= since).sort().slice(-120);
    const out = [];
    for (const k of keys) { const v = await store.get(k, { type: 'json' }); if (v) out.push(v); }
    return j({ entries: out });
  }
  if (req.method !== 'POST') return j({ error: '只接受 GET / POST' }, 405);
  let b = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('json')) b = await req.json();
    else { const f = await req.formData(); f.forEach((v, k) => { b[k] = v; }); }
  } catch { }
  url.searchParams.forEach((v, k) => { if (b[k] == null) b[k] = v; });
  const token = String(b.token || '').trim().toLowerCase();
  if (!okToken(token)) return j({ error: 'token 不對，請到 App 的「我的 → Apple 健康自動同步」重新複製' }, 400);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : twDate();
  const burn = num(b.burn), weight = num(b.weight), steps = num(b.steps);
  if (burn == null && weight == null && steps == null) return j({ error: '沒有收到任何數字' }, 400);
  const key = `${token}/${date}`;
  const old = (await store.get(key, { type: 'json' })) || {};
  const rec = Object.assign(old, { date, at: Date.now() });
  if (burn != null && burn >= 0 && burn < 10000) rec.burn = Math.round(burn);
  if (weight != null && weight > 20 && weight < 300) rec.weight = Math.round(weight * 10) / 10;
  if (steps != null && steps >= 0) rec.steps = Math.round(steps);
  await store.setJSON(key, rec);
  return j({ ok: true, saved: rec, message: `已同步 ${date}` + (rec.burn != null ? `：運動 ${rec.burn} 大卡` : '') + (rec.weight != null ? `、體重 ${rec.weight} kg` : '') });
};
export const config = { path: '/api/health' };
