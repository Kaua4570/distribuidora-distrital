const { db, crypto, cors } = require('./lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const sig = req.headers['x-signature'] || '', rid = req.headers['x-request-id'] || '';
    const ts = (sig.match(/ts=([^,]+)/) || [])[1], v1 = (sig.match(/v1=([^,]+)/) || [])[1];
    const id = String((req.body && req.body.data && req.body.data.id) || (req.query || {})['data.id'] || '');
    const h = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(`id:${id.toLowerCase()};request-id:${rid};ts:${ts};`).digest('hex');
    if (!v1 || v1.length !== h.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(v1))) return res.status(401).end();
    const r = await fetch('https://api.mercadopago.com/v1/orders/' + id, { headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN } });
    const o = await r.json();
    if (r.ok && o.status === 'processed') {
      const s = await db.doc('pedidos/' + o.external_reference).get(), p = s.data();
      if (p && p.mpOrder === o.id && p.status === 'aguardando_pagamento' && Number(o.total_amount) === p.total) await s.ref.update({ status: 'pago' });
    }
    res.status(200).end();
  } catch (e) { res.status(500).end(); }
};
