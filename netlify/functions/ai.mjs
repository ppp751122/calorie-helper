// 熱量小幫手：AI 後端（Netlify Function）
// 環境變數：ANTHROPIC_API_KEY、FIREBASE_PROJECT_ID（可選：MODEL_MAIN、MODEL_QUICK）
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
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

  const model = body.tier === 'quick'
    ? (Netlify.env.get('MODEL_QUICK') || 'claude-haiku-4-5-20251001')
    : (Netlify.env.get('MODEL_MAIN') || 'claude-sonnet-4-6');

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

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(req2),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || '';
    if (/credit balance/i.test(msg)) return json({ error: 'AI 額度用完了，請通知管理者到 Claude Console 儲值' }, 502);
    return json({ error: 'AI 服務錯誤：' + (msg || r.status) }, 502);
  }
  const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return json({ text });
};
