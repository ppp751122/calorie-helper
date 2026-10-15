// 熱量小幫手：AI 後端（Netlify Function）
// 環境變數：ANTHROPIC_API_KEY、FIREBASE_PROJECT_ID（可選：MODEL_MAIN、MODEL_QUICK）
import { getStore } from '@netlify/blobs';
import { verifyUser, resolvePid, costUSD, twMonth } from '../lib/auth.mjs';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

const MAIN = () => Netlify.env.get('MODEL_MAIN') || 'claude-sonnet-5-5';
const QUICK = () => Netlify.env.get('MODEL_QUICK') || 'claude-haiku-5-5';

async function callClaude(key, req2) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(req2),
  });
  return { r, d: await r.json().catch(() => ({})) };
}

export default async (req) => {
  // 用 Safari 打開 /.netlify/functions/ai 就能檢查設定
  if (req.method === 'GET') {
    const key = Netlify.env.get('ANTHROPIC_API_KEY');
    const out = { 金鑰: key ? '有設定' : '❌ 沒設定 ANTHROPIC_API_KEY', Firebase: Netlify.env.get('FIREBASE_PROJECT_ID') ? '有設定' : '❌ 沒設定 FIREBASE_PROJECT_ID', 辨識模型: MAIN() };
    if (key) {
      const { r, d } = await callClaude(key, { model: MAIN(), max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
      out.AI測試 = r.ok ? '✅ 正常' : '❌ ' + r.status + ' ' + (d?.error?.message || '');
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '請先登入' }, 401);

  const project = Netlify.env.get('FIREBASE_PROJECT_ID');
  const key = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!project || !key) return json({ error: '伺服器還沒設定好（缺環境變數）' }, 500);

  // 用使用者自己的登入憑證讀名單；Firestore 規則只讓名單上的人（和擁有者）讀得到
  const chk = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/config/allow`,
    { headers: { Authorization: 'Bearer ' + token } });
  if (!(chk.status === 200 || chk.status === 404)) return json({ error: '你不在使用名單上，不能用 AI 功能' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: '資料格式錯誤' }, 400); }
  const prompt = String(body.prompt || '');
  if (!prompt || prompt.length > 30000) return json({ error: '提問內容不對' }, 400);
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 3)
    .filter(i => i && typeof i.data === 'string' && i.data.length < 4_000_000);

  const model = body.tier === 'quick' ? QUICK() : MAIN();

  const req2 = {
    model,
    max_tokens: 2000,
    system: '你是熱量小幫手 App 的助手，用繁體中文回答。' + (body.json ? '只回傳 JSON，不要任何其他文字、說明或 markdown 標記。' : ''),
    messages: [{
      role: 'user',
      content: [
        ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type || 'image/jpeg', data: i.data } })),
        { type: 'text', text: prompt },
      ],
    }],
  };
  if (body.search) req2.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];

  let { r, d } = await callClaude(key, req2);
  if (!r.ok && req2.tools) { delete req2.tools; ({ r, d } = await callClaude(key, req2)); } // 上網查詢失敗就改不查
  if (!r.ok) {
    const msg = d?.error?.message || '';
    if (/credit balance/i.test(msg)) return json({ error: 'AI 額度用完了，請通知管理者到 Claude Console 儲值' }, 502);
    if (r.status === 401) return json({ error: 'API 金鑰不對或已失效（401）' }, 502);
    if (r.status === 403) return json({ error: 'API 金鑰沒有權限呼叫模型（403），請檢查金鑰的 Scope' }, 502);
    if (r.status === 404) return json({ error: '找不到模型 ' + model + '（404）' }, 502);
    return json({ error: 'AI 服務錯誤：' + (msg || r.status) }, 502);
  }
  const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  await logUsage(req, model, d.usage || {}, images.length, prompt, !!body.json).catch(() => { });
  return json({ text });
};

// 記錄 AI 用量（給管理者後台看花費）
async function logUsage(req, model, u, nImg, prompt, isJson) {
  const who = await verifyUser(req);
  if (!who) return;
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const outTok = u.output_tokens || 0;
  const searches = u.server_tool_use?.web_search_requests || 0;
  const kind = /InBody/.test(prompt) ? 'inbody' : /人臉/.test(prompt) ? 'face' : nImg ? 'photo' : isJson ? 'text' : 'chat';
  const store = getStore({ name: 'usage', consistency: 'strong' });
  const key = `${twMonth()}/${await resolvePid(who)}`;
  const o = (await store.get(key, { type: 'json' })) || { calls: 0, inTok: 0, outTok: 0, searches: 0, usd: 0, kinds: {} };
  o.email = who.email; o.calls++; o.inTok += inTok; o.outTok += outTok; o.searches += searches;
  o.usd = Math.round((o.usd + costUSD(model, inTok, outTok, searches)) * 1e5) / 1e5;
  o.kinds[kind] = (o.kinds[kind] || 0) + 1; o.last = Date.now();
  await store.setJSON(key, o);
}
