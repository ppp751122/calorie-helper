// 共用：驗證 Firebase 登入憑證、找出管理者、AI 價格
const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwkCache = { at: 0, keys: [] };
let ownerCache = { at: 0, email: '' };

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const b64json = s => JSON.parse(new TextDecoder().decode(b64(s)));

async function jwks() {
  if (Date.now() - jwkCache.at < 3600e3 && jwkCache.keys.length) return jwkCache.keys;
  const r = await fetch(JWK_URL);
  const d = await r.json();
  jwkCache = { at: Date.now(), keys: d.keys || [] };
  return jwkCache.keys;
}

// 驗證 Firebase ID token 的簽章與內容，成功回傳 { uid, email, name }
export async function verifyUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const project = Netlify.env.get('FIREBASE_PROJECT_ID');
  if (!token || !project) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const head = b64json(parts[0]), body = b64json(parts[1]);
    const now = Date.now() / 1000;
    if (head.alg !== 'RS256' || body.aud !== project || body.iss !== `https://securetoken.google.com/${project}` || !body.sub || body.exp < now - 30) return null;
    const jwk = (await jwks()).find(k => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    return { uid: body.sub, email: String(body.email || '').toLowerCase(), name: body.name || '', token };
  } catch { return null; }
}

// 管理者 = config.js 裡的 ownerEmail
export async function ownerEmail(req) {
  if (Date.now() - ownerCache.at < 600e3 && ownerCache.email) return ownerCache.email;
  try {
    const r = await fetch(new URL('/config.js', req.url));
    const m = (await r.text()).match(/ownerEmail\s*:\s*['"]([^'"]+)['"]/);
    ownerCache = { at: Date.now(), email: m ? m[1].toLowerCase() : '' };
  } catch { }
  return ownerCache.email;
}

// 每百萬 token 的美元價格（2026/10 官方定價）
export const PRICE = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
export const SEARCH_USD = 0.01;
export function costUSD(model, inTok, outTok, searches) {
  const p = PRICE[model] || PRICE['claude-sonnet-5-5'];
  return (inTok * p[0] + outTok * p[1]) / 1e6 + (searches || 0) * SEARCH_USD;
}
export const twMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
