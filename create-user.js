const { admin, db, auth, pinFresco, hashPin, crypto, cors } = require('./lib');
module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const a = await auth(req, ['admin']);
    if (!pinFresco(a)) throw new Error('Confirme o PIN novamente');
    const { email, senha, nome, tel, papel, pin } = req.body || {};
    if (!['cliente', 'entregador'].includes(papel)) throw new Error('Papel inválido');
    if (!email || !senha || String(senha).length < 6) throw new Error('E-mail e senha (6+) obrigatórios');
    if (papel === 'entregador' && !/^\d{6}$/.test(String(pin))) throw new Error('PIN do entregador: 6 dígitos');
    const u = await admin.auth().createUser({ email, password: senha, displayName: nome });
    await admin.auth().setCustomUserClaims(u.uid, { role: papel });
    await db.doc('users/' + u.uid).set({ nome: nome || '', tel: tel || '', email, role: papel });
    if (papel === 'entregador') {
      const salt = crypto.randomBytes(16).toString('hex');
      await db.doc('pins/' + u.uid).set({ salt, hash: hashPin(pin, salt), tries: 0 });
    }
    res.json({ ok: true, uid: u.uid });
  } catch (e) { res.status(400).json({ erro: e.message }); }
};
