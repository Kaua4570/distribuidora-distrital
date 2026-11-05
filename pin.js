const { admin, db, auth, hashPin, crypto, cors } = require('./lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const u = await auth(req, ['admin', 'entregador']);
    const ref = db.doc('pins/' + u.uid), p = (await ref.get()).data();
    if (!p) return res.status(400).json({ erro: 'PIN não cadastrado' });
    if (p.lockUntil && p.lockUntil > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Tente em 15 minutos.' });
    const a = Buffer.from(hashPin((req.body || {}).pin || '', p.salt)), b = Buffer.from(p.hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const tries = (p.tries || 0) + 1;
      await ref.update(tries >= 5 ? { tries: 0, lockUntil: Date.now() + 15 * 60e3 } : { tries });
      return res.status(401).json({ erro: 'PIN incorreto' });
    }
    await ref.update({ tries: 0 });
    await admin.auth().setCustomUserClaims(u.uid, { role: u.role, pinAt: Date.now() });
    res.json({ ok: true });
  } catch (e) { res.status(401).json({ erro: e.message }); }
};
