// 食藥署「食品營養成分資料集」：從政府開放資料抓下來，整理成精簡清單給 App 用
// 每 100 公克：[品名, 俗名, 分類, 狀態, 大卡, 蛋白質g, 碳水g, 脂肪g]
import zlib from 'node:zlib';
const SRC = 'https://data.fda.gov.tw/data/opendata/export/20/json';

function unzipFirst(buf) {
  // 從中央目錄拿正確的壓縮大小（本地檔頭可能是 0）
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const cd = buf.readUInt32LE(e + 16);
  const csize = buf.readUInt32LE(cd + 20), method = buf.readUInt16LE(cd + 10), loc = buf.readUInt32LE(cd + 42);
  const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

export default async () => {
  try {
    const r = await fetch(SRC, { headers: { 'User-Agent': 'calorie-helper/1.0' } });
    if (!r.ok) throw new Error('食藥署回應 ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const txt = buf[0] === 0x50 && buf[1] === 0x4b ? unzipFirst(buf).toString('utf8') : buf.toString('utf8');
    const rows = JSON.parse(txt);
    const pick = { '熱量': 'k', '修正熱量': 'k2', '粗蛋白': 'p', '總碳水化合物': 'c', '粗脂肪': 'f' };
    const M = {};
    for (const x of rows) {
      const id = x['整合編號'];
      const o = M[id] || (M[id] = {
        n: x['樣品名稱'], a: (x['俗名'] || '').trim(), g: x['食品分類'],
        d: String(x['內容物描述'] || '').replace(/前處理描述:.*/, '').replace('樣品狀態:', '').replace(/[;；]\s*$/, '').trim(),
      });
      const k = pick[x['分析項']];
      if (k && x['每100克含量'] != null) o[k] = +String(x['每100克含量']).trim();
    }
    const r1 = v => (v == null || isNaN(v) ? 0 : Math.round(v * 10) / 10);
    const list = Object.values(M).filter(o => o.k != null || o.k2 != null)
      .map(o => [o.n, o.a, o.g, o.d, Math.round(o.k2 ?? o.k), r1(o.p), r1(o.c), r1(o.f)]);
    return new Response(JSON.stringify(list), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'Netlify-CDN-Cache-Control': 'public, max-age=2592000, durable',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: '讀取食藥署資料失敗：' + e.message }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
};
export const config = { path: '/api/tfnd' };
