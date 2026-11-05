const { admin, db, auth, cors } = require('./lib');
const km = (a, b, c, d) => { const r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const u = await auth(req, ['cliente']), b = req.body || {};
    const cfg = (await db.doc('config/entrega').get()).data();
    if (!cfg || !cfg.loja || !(cfg.faixas || []).length) throw new Error('Entrega ainda não configurada');
    let sub = 0; const itens = [];
    for (const i of b.itens || []) {
      const q = Math.floor(+i.q); if (!(q > 0 && q <= 999)) continue;
      const p = (await db.doc('produtos/' + i.id).get()).data();
      if (!p || !p.on) throw new Error('Produto indisponível');
      sub += p.p * q; itens.push([p.n, q, p.p]);
    }
    if (!itens.length) throw new Error('Carrinho vazio');
    const lat = +b.lat, lng = +b.lng; if (!isFinite(lat) || !isFinite(lng)) throw new Error('Localização inválida');
    const d = km(lat, lng, cfg.loja.lat, cfg.loja.lng);
    if (cfg.maxKm && d > cfg.maxKm) throw new Error('Fora da área de entrega (' + cfg.maxKm + ' km)');
    const f = [...cfg.faixas].sort((x, y) => x.km - y.km), fx = f.find(z => d <= z.km) || f[f.length - 1];
    const taxa = fx.p, total = Math.round((sub + taxa) * 100) / 100;
    const n = await db.runTransaction(async t => { const r = db.doc('config/contador'); const v = ((await t.get(r)).data() || { n: 1000 }).n + 1; t.set(r, { n: v }); return v; });
    const teste = !!process.env.MP_TEST; // em teste, "APRO" aprova o Pix sozinho
    const body = { type: 'online', processing_mode: 'automatic', external_reference: String(n), total_amount: total.toFixed(2),
      payer: { email: teste ? 'test@testuser.com' : u.email, first_name: teste ? 'APRO' : String(b.nome || 'Cliente').slice(0, 60) },
      transactions: { payments: [{ amount: total.toFixed(2), payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT30M' }] } };
    const r = await fetch('https://api.mercadopago.com/v1/orders', { method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN, 'Content-Type': 'application/json', 'X-Idempotency-Key': 'pedido-' + n },
      body: JSON.stringify(body) });
    const o = await r.json();
    if (!r.ok) throw new Error('Mercado Pago: ' + String(o.message || JSON.stringify(o.errors || o)).slice(0, 180));
    const pm = o.transactions.payments[0].payment_method;
    await db.doc('pedidos/' + n).set({ n, uid: u.uid, nome: String(b.nome || '').slice(0, 80), tel: String(b.tel || '').slice(0, 30),
      end: String(b.end || '').slice(0, 200), ref: String(b.ref || '').slice(0, 200), lat, lng, km: Math.round(d * 10) / 10,
      taxa, sub, total, itens, pag: 'PIX', status: 'aguardando_pagamento', mpOrder: o.id, criado: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ n, total, taxa, km: Math.round(d * 10) / 10, qr: pm.qr_code, img: pm.qr_code_base64 });
  } catch (e) { res.status(400).json({ erro: e.message }); }
};
