// 用條碼查 Open Food Facts 開源商品資料庫
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const num = v => (v == null || v === '' || isNaN(+v) ? null : +v);

export default async (req) => {
  const code = (new URL(req.url).searchParams.get('code') || '').replace(/\D/g, '');
  if (code.length < 6 || code.length > 14) return j({ error: '條碼格式不對' }, 400);
  const fields = 'product_name,product_name_zh,product_name_zh-tw,brands,quantity,serving_size,serving_quantity,product_quantity,nutriments';
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`,
    { headers: { 'User-Agent': 'calorie-helper/1.0 (personal app)' } });
  if (r.status === 404) return j({ found: false });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status === 0 || !d.product) return j({ found: false });
  const p = d.product, n = p.nutriments || {};
  const kcal100 = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) != null ? n['energy_100g'] / 4.184 : null);
  return j({
    found: true, code,
    name: p['product_name_zh-tw'] || p.product_name_zh || p.product_name || '',
    brand: (p.brands || '').split(',')[0].trim(),
    quantity: p.quantity || '', productG: num(p.product_quantity),
    serving: p.serving_size || '', servingG: num(p.serving_quantity),
    per100: kcal100 == null ? null : { kcal: kcal100, p: num(n.proteins_100g) || 0, c: num(n.carbohydrates_100g) || 0, f: num(n.fat_100g) || 0 },
  });
};
export const config = { path: '/api/off' };
