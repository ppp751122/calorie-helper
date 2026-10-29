// Apple 健康自動同步：iPhone「捷徑」每天自動把活動能量、體重送到這裡，App 打開時再取回
// POST /api/health  { token, burn, weight, date? }   （數字可以帶單位，例如 "523 kcal"）
// GET  /api/health?token=...&burn=523  （捷徑最簡單的寫法：網址帶數字）
// GET  /api/health?token=...&need=1           （捷徑：回傳需要補抓的日期清單，JSON 陣列）
// GET  /api/health?token=...&v=2026-10-22523.4  （捷徑：日期 + 數字直接接在一起，不用打任何字）
// GET  /api/health?token=...&since=YYYY-MM-DD   （App 讀取）
import { getStore } from '@netlify/blobs';

const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const okToken = t => /^[a-z0-9]{24,64}$/.test(t || '');
const num = v => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const twDate = (d = 0) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

export default async (req) => {
  const store = getStore({ name: 'health', consistency: 'strong' });
  const url = new URL(req.url);
  const isWrite = req.method === 'POST' || ['burn', 'weight', 'steps', 'v'].some(k => url.searchParams.has(k));
  // 捷徑先問：哪幾天要補抓（最近 7 天沒資料的，加上昨天和今天一定重抓）
  if (req.method === 'GET' && url.searchParams.has('need')) {
    const token = String(url.searchParams.get('token') || '').toLowerCase();
    if (!okToken(token)) return j({ error: 'token 不對' }, 400);
    const days = [];
    for (let i = 7; i >= 0; i--) {
      const d = twDate(-i);
      if (i <= 1) { days.push(d); continue; }
      const v = await store.get(`${token}/${d}`, { type: 'json' });
      if (!v || v.burn == null || (v.burn === 0 && !v.final)) days.push(d);
    }
    return j(days);
  }
  if (req.method === 'GET' && !isWrite) {
    const token = url.searchParams.get('token');
    if (!okToken(token)) return j({ error: 'token 不對' }, 400);
    const since = url.searchParams.get('since') || '0000';
    const { blobs } = await store.list({ prefix: token + '/' });
    const keys = blobs.map(b => b.key).filter(k => k.slice(token.length + 1) >= since).sort().slice(-120);
    const out = [];
    for (const k of keys) { const v = await store.get(k, { type: 'json' }); if (v) out.push(v); }
    const log = (await getStore({ name: 'healthlog', consistency: 'strong' }).get(token, { type: 'json' })) || [];
    return j({ entries: out, log });
  }
  if (!isWrite) return j({ error: '只接受 GET / POST' }, 405);
  let b = {};
  const ct = req.headers.get('content-type') || '';
  try {
    if (req.method === 'POST') {
      if (ct.includes('json')) b = await req.json();
      else { const f = await req.formData(); f.forEach((v, k) => { b[k] = v; }); }
    }
  } catch { }
  url.searchParams.forEach((v, k) => { if (b[k] == null) b[k] = v; });
  const token = String(b.token || '').trim().toLowerCase();
  if (!okToken(token)) return j({ error: 'token 不對，請到 App 的「我的 → Apple 健康自動同步」重新複製' }, 400);
  // 記錄最近 10 次捷徑送來的內容，方便在 App 裡檢查
  const logStore = getStore({ name: 'healthlog', consistency: 'strong' });
  const note = async (ok, msg) => {
    const L = (await logStore.get(token, { type: 'json' })) || [];
    L.push({ at: Date.now(), raw: String(b.v ?? b.burn ?? '').slice(0, 60), ok, msg });
    await logStore.setJSON(token, L.slice(-10));
  };
  // v = 「日期」接著「數字」，例如 2026-10-22523.4 kcal
  if (b.v != null && b.burn == null) {
    const m = String(b.v).trim().match(/^(\d{4}-\d{1,2}-\d{1,2})\s*(.*)$/);
    if (m) { const [y, mo, dd] = m[1].split('-'); b.date = `${y}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`; b.burn = m[2]; }
    else b.burn = b.v;
  }
  let date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : twDate();
  if (date > twDate() || date < twDate(-31)) date = twDate();
  let burn = num(b.burn), weight = num(b.weight), steps = num(b.steps);
  // 捷徑在健康 App 還沒有資料時會送空白，當作 0
  const emptyBurn = burn == null && 'burn' in b && String(b.burn ?? '').trim() === '';
  if (emptyBurn) burn = 0;
  if (burn == null && weight == null && steps == null) { await note(false, '沒有收到任何數字'); return j({ error: '沒有收到任何數字', 收到的內容: String(b.burn ?? '').slice(0, 80) }, 400); }
  const key = `${token}/${date}`;
  const old = (await store.get(key, { type: 'json' })) || {};
  const rec = Object.assign(old, { date, at: Date.now() });
  if (date < twDate()) rec.final = true; // 過去的日子是整天的總數
  if (burn != null && burn >= 0 && burn < 10000) rec.burn = Math.round(burn);
  if (weight != null && weight > 20 && weight < 300) rec.weight = Math.round(weight * 10) / 10;
  if (steps != null && steps >= 0) rec.steps = Math.round(steps);
  await store.setJSON(key, rec);
  await note(true, (rec.date !== twDate() ? rec.date.slice(5).replace('-', '/') + ' ' : '') + (rec.burn != null ? `運動 ${rec.burn} 大卡` : '已同步'));
  return j({ ok: true, saved: rec, message: `已同步 ${date}` + (rec.burn != null ? `：運動 ${rec.burn} 大卡` : '') + (rec.weight != null ? `、體重 ${rec.weight} kg` : '') + (emptyBurn ? `（健康 App ${date === twDate() ? '今天還' : '那天'}沒有活動能量資料，所以是 0）` : '') });
};
export const config = { path: '/api/health' };
