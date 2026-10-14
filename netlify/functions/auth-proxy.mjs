// 把 /__/auth/* 轉給 Firebase 的登入頁，讓登入流程跟 App 在同一個網址
// （iPhone Safari 會擋跨網站的登入資料，不這樣做常常要登好幾次）
export default async (req) => {
  const project = Netlify.env.get('FIREBASE_PROJECT_ID');
  if (!project) return new Response('缺少 FIREBASE_PROJECT_ID', { status: 500 });
  const u = new URL(req.url);
  const target = `https://${project}.firebaseapp.com${u.pathname}${u.search}`;
  const headers = new Headers(req.headers);
  headers.delete('host'); headers.delete('content-length');
  const r = await fetch(target, {
    method: req.method, headers, redirect: 'manual',
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
  });
  const out = new Headers(r.headers);
  out.delete('content-encoding'); out.delete('content-length'); out.delete('transfer-encoding');
  return new Response(r.body, { status: r.status, headers: out });
};
export const config = { path: '/__/auth/*' };
