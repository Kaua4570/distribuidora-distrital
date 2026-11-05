// Uso: FIREBASE_SERVICE_ACCOUNT="$(cat chave.json)" node definir-papel.js EMAIL admin 123456
// (crie antes o usuário no Console do Firebase > Authentication)
const { admin, db, hashPin, crypto } = require('./lib');
(async () => {
  const [email, papel, pin] = process.argv.slice(2);
  if (!email || !['admin', 'entregador', 'cliente'].includes(papel)) return console.log('Uso: node definir-papel.js EMAIL admin|entregador|cliente [PIN 6 dígitos]');
  const u = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(u.uid, { role: papel });
  await db.doc('users/' + u.uid).set({ nome: u.displayName || '', email, role: papel }, { merge: true });
  if (papel !== 'cliente') {
    if (!/^\d{6}$/.test(pin || '')) return console.log('Informe um PIN de 6 dígitos');
    const salt = crypto.randomBytes(16).toString('hex');
    await db.doc('pins/' + u.uid).set({ salt, hash: hashPin(pin, salt), tries: 0 });
  }
  console.log('Pronto:', email, '=>', papel);
})();
